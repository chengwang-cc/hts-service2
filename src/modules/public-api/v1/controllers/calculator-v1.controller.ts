/**
 * Public API v1 — Calculator (LEGACY)
 *
 * Wire-stable, ai-service-backed calculator surface for `hts-web2`. Every
 * tariff/formula route is a thin proxy onto ai-service
 * (https://staging.api.report.chitchats.com/v2/tariff/*). The history
 * routes stay local (audit trail) and are scoped to the API key's
 * organization.
 *
 * Numerical authority for v1: ai-service. Anything wanting native
 * hts-service resolution must use the v2 controller.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../../api-keys/guards/api-key.guard';
import {
  ApiPermissions,
  CurrentApiKey,
} from '../../../api-keys/decorators';
import { SkipJwtAuth } from '../../../api-keys/decorators/skip-jwt-auth.decorator';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { CalculatePublicDto } from '../dto/calculate-public.dto';
import {
  AiRateRequest,
  AiServiceProxyService,
} from '../services/ai-service-proxy.service';
import { CalculationHistoryService } from '../../shared/calculation-history.service';

@ApiTags('Calculator V1 (legacy ai-service proxy)')
@ApiSecurity('api-key')
@SkipJwtAuth()
@Controller('api/v1/calculator')
@UseGuards(ApiKeyGuard)
export class CalculatorV1Controller {
  constructor(
    private readonly aiService: AiServiceProxyService,
    private readonly history: CalculationHistoryService,
  ) {}

  // ── /calculate ───────────────────────────────────────────────────────

  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate import duties (legacy ai-service proxy)',
    description:
      'Proxies the request to ai-service /v2/tariff/rates and stores a local audit row in CalculationHistory. Wire-stable for hts-web2. Use /api/v2/calculator/calculate for the native hts-service implementation.',
  })
  @ApiBody({ type: CalculatePublicDto })
  @ApiResponse({ status: 200, description: 'Calculation successful' })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiResponse({ status: 502, description: 'Upstream ai-service unavailable' })
  @ApiPermissions('hts:calculate')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // tolerant: legacy clients may send extras
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async calculate(
    @Body() input: CalculatePublicDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const aiRequest: AiRateRequest = this.toAiRateRequest(input);
    const [aiRow] = await this.aiService.getRates([aiRequest]);

    if (!aiRow) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          code: 'AI_SERVICE_EMPTY_RESPONSE',
          message: 'Upstream tariff service returned no rows',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const result = this.shapeForV1Clients(input, aiRow);

    // Best-effort audit write. Never block on history failure.
    void this.history.write({
      apiKey,
      input: input as any,
      result,
      source: 'ai_service_proxy_v1',
    });

    return {
      success: true,
      data: result,
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey.organizationId,
        source: 'ai_service_proxy',
      },
    };
  }

  // ── /formula ─────────────────────────────────────────────────────────

  @Get('formula')
  @ApiOperation({
    summary: 'Resolve componentized tariff formula(s) (ai-service)',
    description:
      'Proxies ai-service /v2/tariff/formulas. Returns the formulas with their variables so callers can render an input form matching exactly what each formula needs.',
  })
  @ApiQuery({ name: 'htsCode', required: true })
  @ApiQuery({ name: 'country', required: true })
  @ApiResponse({ status: 200, description: 'Formulas returned' })
  @ApiResponse({ status: 400, description: 'Missing htsCode or country' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 502, description: 'Upstream ai-service unavailable' })
  @ApiPermissions('hts:calculate')
  async getFormula(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
  ) {
    if (!htsCode || !country) {
      throw new BadRequestException('htsCode and country are required');
    }
    const rows = await this.aiService.getFormulas([{ htsCode, country }]);
    const item = rows[0];
    if (!item) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'AI_SERVICE_NO_FORMULA',
          message: 'No formula returned',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      htsCode,
      country,
      effectiveHtsCode: item.effectiveHtsCode ?? null,
      blocked: !!item.blocked,
      blockReason: item.block_reason ?? null,
      message: item.message ?? '',
      exclusiveSection301: !!item.exclusiveSection301,
      formulas: (item.formulas ?? []).map((f) => ({
        tariffType: f.tariffType,
        tariffTypeDescription: f.tariffTypeDescription,
        formula: f.formula,
        formulaVariables: f.formulaVariables ?? [],
        chapter99HtsCode: f.chapter99HtsCode ?? null,
      })),
    };
  }

  // ── /tariff-rates ────────────────────────────────────────────────────

  @Post('tariff-rates')
  @ApiOperation({
    summary: 'Batch evaluate tariff amounts (ai-service)',
    description:
      'Proxies ai-service /v2/tariff/rates with the batched payload as-is.',
  })
  @ApiResponse({ status: 200, description: 'Batch evaluation completed' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 502, description: 'Upstream ai-service unavailable' })
  @ApiPermissions('hts:calculate')
  async getTariffRates(@Body() body: AiRateRequest[]) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Request body must be an array');
    }
    const items = body.map((r) => ({
      htsCode: r.htsCode,
      country: r.country,
      inputs: r.inputs ?? {},
    }));
    const rows = await this.aiService.getRates(items);
    return rows.map((r) => {
      const formulas = Array.isArray(r.formulas) ? r.formulas : [];
      const totalDuty = formulas.reduce(
        (sum, f) => sum + (typeof f.amount === 'number' ? f.amount : 0),
        0,
      );
      return {
        htsCode: r.htsCode,
        country: r.country,
        effectiveHtsCode: r.effectiveHtsCode ?? null,
        blocked: !!r.blocked,
        blockReason: r.block_reason ?? null,
        message: r.message ?? '',
        totalDuty: Math.round(totalDuty * 100) / 100,
        breakdown: formulas.map((f) => ({
          tariffType: f.tariffType,
          tariffTypeDescription: f.tariffTypeDescription,
          amount: typeof f.amount === 'number' ? Math.round(f.amount * 100) / 100 : 0,
          formula: f.formula,
          formulaVariables: f.formulaVariables ?? [],
          chapter99HtsCode: f.chapter99HtsCode ?? null,
          error: null,
        })),
      };
    });
  }

  // ── /calculations/:id ────────────────────────────────────────────────

  @Get('calculations/:id')
  @ApiOperation({
    summary: 'Get a stored calculation by ID',
    description:
      'Returns a calculation audit row scoped to the API key\'s organization. Works for both v1 (ai_service_proxy_v1) and v2 (hts_native_v2) sourced rows.',
  })
  @ApiParam({ name: 'id', description: 'calculationId' })
  @ApiResponse({ status: 200, description: 'Calculation found' })
  @ApiResponse({ status: 404, description: 'Calculation not found' })
  @ApiPermissions('hts:calculate')
  async getCalculation(
    @Param('id') id: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const row = await this.history.findOneForKey(id, apiKey);
    return {
      success: true,
      data: row,
      meta: { apiVersion: 'v1', organizationId: apiKey.organizationId },
    };
  }

  // ── /calculations (list) ─────────────────────────────────────────────

  @Get('calculations')
  @ApiOperation({
    summary: 'List recent stored calculations',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 10' })
  @ApiPermissions('hts:calculate')
  async listCalculations(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.history.listForKey(apiKey, Number(limit) || 10);
    return {
      success: true,
      data: rows,
      meta: { apiVersion: 'v1', organizationId: apiKey.organizationId },
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /**
   * Map a v1 CalculatePublicDto into the AI service's per-row rate request.
   * We send `value` and (when present) `weight` / `quantity` so ai-service
   * can evaluate formulas. The legacy site sends declaredValue (USD).
   */
  private toAiRateRequest(input: CalculatePublicDto): AiRateRequest {
    const inputs: Record<string, number> = {
      value: input.declaredValue,
    };
    if (typeof input.weightKg === 'number') inputs.weight = input.weightKg;
    if (typeof input.quantity === 'number') inputs.quantity = input.quantity;
    // Pass through additional inputs hts-web2 sends (steel/aluminium/copper
    // composition, etc.) so section-232 metal formulas evaluate.
    const extra = (input as any).additionalInputs as
      | Record<string, any>
      | undefined;
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        if (typeof v === 'number' && Number.isFinite(v)) inputs[k] = v;
      }
    }
    return {
      htsCode: input.htsNumber,
      country: input.countryOfOrigin.toUpperCase(),
      inputs,
    };
  }

  /**
   * Translate ai-service's per-row response into the v1 `data` envelope
   * hts-web2 already consumes. Preserves field names the legacy site keys
   * on (totalDuty, baseDuty, breakdown, calculationId, ...).
   */
  private shapeForV1Clients(
    input: CalculatePublicDto,
    aiRow: import('../services/ai-service-proxy.service').AiRateRow,
  ) {
    const formulas = Array.isArray(aiRow.formulas) ? aiRow.formulas : [];
    const breakdown = formulas.map((f) => ({
      tariffType: f.tariffType,
      tariffTypeDescription: f.tariffTypeDescription,
      formula: f.formula,
      formulaVariables: f.formulaVariables ?? [],
      chapter99HtsCode: f.chapter99HtsCode ?? null,
      amount:
        typeof f.amount === 'number' ? Math.round(f.amount * 100) / 100 : 0,
      error: null,
    }));

    const totalDuty = breakdown.reduce((s, b) => s + (b.amount ?? 0), 0);
    const baseDuty =
      typeof aiRow.rate === 'number'
        ? Math.round(aiRow.rate * 100) / 100
        : breakdown.find((b) => (b.tariffType || '').toUpperCase() === 'GENERAL')?.amount ?? 0;
    const additionalTariffs = Math.max(0, totalDuty - baseDuty);

    const declaredValue = input.declaredValue;
    const landedCost = declaredValue + totalDuty;

    return {
      calculationId: `CALC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      htsNumber: input.htsNumber,
      countryOfOrigin: input.countryOfOrigin.toUpperCase(),
      declaredValue,
      effectiveHtsCode: aiRow.effectiveHtsCode ?? null,
      blocked: !!aiRow.blocked,
      blockReason: aiRow.block_reason ?? null,
      message: aiRow.message ?? '',
      exclusiveSection301: !!aiRow.exclusiveSection301,
      baseDuty,
      additionalTariffs: Math.round(additionalTariffs * 100) / 100,
      totalTaxes: 0,
      fees: 0,
      totalDuty: Math.round(totalDuty * 100) / 100,
      landedCost: Math.round(landedCost * 100) / 100,
      breakdown,
      formulaUsed:
        breakdown.find((b) => (b.tariffType || '').toUpperCase() === 'GENERAL')?.formula ??
        breakdown[0]?.formula ??
        null,
      rateSource: 'ai_service_v2',
      createdAt: new Date().toISOString(),
    };
  }
}
