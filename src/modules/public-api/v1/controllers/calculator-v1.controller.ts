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
import { Public } from '../../../auth/decorators/public.decorator';
import { CalculatePublicDto } from '../dto/calculate-public.dto';
import {
  AiRateRequest,
  AiServiceProxyService,
} from '../services/ai-service-proxy.service';
import { CalculationHistoryService } from '../../shared/calculation-history.service';

/**
 * Auth shape on this controller:
 *
 *   ┌────────────────────────────┬──────────────┬─────────────────────────────┐
 *   │ Route                      │ Auth         │ Notes                       │
 *   ├────────────────────────────┼──────────────┼─────────────────────────────┤
 *   │ POST  /calculate           │ @Public()    │ hts-web2 calls anonymously  │
 *   │ GET   /formula             │ @Public()    │ hts-web2 calls anonymously  │
 *   │ POST  /tariff-rates        │ @Public()    │ hts-web2 calls anonymously  │
 *   │ GET   /calculations/:id    │ ApiKeyGuard  │ partner audit history       │
 *   │ GET   /calculations        │ ApiKeyGuard  │ partner audit history       │
 *   └────────────────────────────┴──────────────┴─────────────────────────────┘
 *
 * `@SkipJwtAuth()` is still applied at the class level so the global
 * JwtAuthGuard never rejects these requests. The three tariff routes are
 * marked @Public() (no auth at all) for the hts-web2 use case; protection
 * relies on CORS origin allowlist + per-IP rate limiting at the edge.
 *
 * For the tariff routes, `apiKey` is optional — `@CurrentApiKey()` returns
 * undefined for anonymous callers, and the history-write call skips the row
 * rather than attributing it to a synthetic org.
 */
@ApiTags('Calculator V1 (legacy ai-service proxy)')
@ApiSecurity('api-key')
@SkipJwtAuth()
@Controller('api/v1/calculator')
export class CalculatorV1Controller {
  constructor(
    private readonly aiService: AiServiceProxyService,
    private readonly history: CalculationHistoryService,
  ) {}

  // ── /calculate ───────────────────────────────────────────────────────

  @Public()
  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate import duties (legacy ai-service proxy)',
    description:
      'Proxies the request to ai-service /v2/tariff/rates and stores a local audit row in CalculationHistory. Wire-stable for hts-web2 (anonymous). Partner traffic with a valid API key also writes history. Use /api/v2/calculator/calculate for the native hts-service implementation.',
  })
  @ApiBody({ type: CalculatePublicDto })
  @ApiResponse({ status: 200, description: 'Calculation successful' })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiResponse({ status: 502, description: 'Upstream ai-service unavailable' })
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
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    // Pure passthrough: convert the hts-web2-style single-item input into
    // ai-service's batched /rates request, call upstream, return the
    // first item verbatim. No reshaping, no envelope, no per-row
    // evaluation — the frontend constructs the breakdown from this raw
    // response.
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
    // History attribution is best-effort and only when an API key is
    // present (anonymous hts-web2 traffic doesn't attribute to an org).
    if (apiKey) {
      void this.history.write({
        apiKey,
        input: input as any,
        result: aiRow,
        source: 'ai_service_proxy_v1',
      });
    }
    return aiRow;
  }

  // ── /formula ─────────────────────────────────────────────────────────

  @Public()
  @Get('formula')
  @ApiOperation({
    summary: 'Resolve componentized tariff formula(s) (ai-service)',
    description:
      'Proxies ai-service /v2/tariff/formulas. Returns the formulas with their variables so callers can render an input form matching exactly what each formula needs. Anonymous — used by hts-web2 to build the dynamic input UI.',
  })
  @ApiQuery({ name: 'htsCode', required: true })
  @ApiQuery({ name: 'country', required: true })
  @ApiResponse({ status: 200, description: 'Formulas returned' })
  @ApiResponse({ status: 400, description: 'Missing htsCode or country' })
  @ApiResponse({ status: 404, description: 'No formula returned by upstream' })
  @ApiResponse({ status: 502, description: 'Upstream ai-service unavailable' })
  async getFormula(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
  ) {
    if (!htsCode || !country) {
      throw new BadRequestException('htsCode and country are required');
    }
    // Pure passthrough: returns ai-service /v2/tariff/hts-formulas response
    // (first item) verbatim — `block_reason`, `isCusmaFreeTrade`, the formulas
    // array — exactly as ai-service emits it. The frontend constructs the
    // breakdown.
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
    return item;
  }

  // ── /tariff-rates ────────────────────────────────────────────────────

  @Public()
  @Post('tariff-rates')
  @ApiOperation({
    summary: 'Batch evaluate tariff amounts (ai-service)',
    description:
      'Proxies ai-service /v2/tariff/rates with the batched payload as-is. Anonymous — protection via CORS origin allowlist + IP rate-limit.',
  })
  @ApiResponse({ status: 200, description: 'Batch evaluation completed' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 502, description: 'Upstream ai-service unavailable' })
  async getTariffRates(@Body() body: AiRateRequest[]) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Request body must be an array');
    }
    // Pure passthrough: hand the batch to ai-service /v2/tariff/rates and
    // return the raw array verbatim. No per-row evaluation, no field
    // renaming. The frontend builds the breakdown from this raw response.
    const items = body.map((r) => ({
      htsCode: r.htsCode,
      country: r.country,
      inputs: r.inputs ?? {},
    }));
    return this.aiService.getRates(items);
  }

  // ── /calculations/:id ────────────────────────────────────────────────

  @UseGuards(ApiKeyGuard)
  @Get('calculations/:id')
  @ApiOperation({
    summary: 'Get a stored calculation by ID',
    description:
      'Returns a calculation audit row scoped to the API key\'s organization. Works for both v1 (ai_service_proxy_v1) and v2 (hts_native_v2) sourced rows.',
  })
  @ApiParam({ name: 'id', description: 'calculationId' })
  @ApiResponse({ status: 200, description: 'Calculation found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
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

  @UseGuards(ApiKeyGuard)
  @Get('calculations')
  @ApiOperation({
    summary: 'List recent stored calculations',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1..200, default 10' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
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

}
