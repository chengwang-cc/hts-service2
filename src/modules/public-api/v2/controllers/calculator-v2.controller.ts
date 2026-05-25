/**
 * Public API v2 — Calculator (NATIVE hts-service)
 *
 * Used by hts-ui. Every route resolves entirely inside hts-service via
 * the local TariffFormulaResolver / TariffRateBatchService /
 * CalculationService / LandedCostService — no ai-service dependency.
 *
 * Routes:
 *   POST /api/v2/calculator/calculate       — single-line calc, native engine
 *   GET  /api/v2/calculator/formula         — componentized formula resolution
 *   POST /api/v2/calculator/tariff-rates    — batch rate evaluation
 *   POST /api/v2/calculator/quote           — multi-jurisdiction landed-cost
 *   GET  /api/v2/calculator/jurisdictions   — supported destination list
 *   GET  /api/v2/calculator/calculations/:id — history fetch (shared w/ v1)
 *   GET  /api/v2/calculator/calculations    — history list (shared w/ v1)
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
import { ApiPermissions, CurrentApiKey } from '../../../api-keys/decorators';
import { SkipJwtAuth } from '../../../api-keys/decorators/skip-jwt-auth.decorator';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { CalculationService, TariffRateBatchService } from '@hts/calculator';
import { LandedCostService } from '../../../landed-cost/services/landed-cost.service';
import { JurisdictionService } from '../../../jurisdiction/services/jurisdiction.service';
import { LandedCostQuoteRequestDto } from '../../../landed-cost/dto/quote-request.dto';
import { CalculatePublicV2Dto } from '../dto/calculate-public-v2.dto';
import { CalculationHistoryService } from '../../shared/calculation-history.service';

@ApiTags('Calculator V2 (native hts-service)')
@ApiSecurity('api-key')
@SkipJwtAuth()
@Controller('api/v2/calculator')
@UseGuards(ApiKeyGuard)
export class CalculatorV2Controller {
  constructor(
    private readonly calculationService: CalculationService,
    private readonly tariffRateBatch: TariffRateBatchService,
    private readonly landedCost: LandedCostService,
    private readonly jurisdictions: JurisdictionService,
    private readonly history: CalculationHistoryService,
  ) {}

  // ── /calculate ───────────────────────────────────────────────────────

  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate import duties (native hts-service)',
    description:
      'Single-line tariff calculation backed by the local componentized resolver. Response carries both the legacy flat fields and the canonical `totals.*` block.',
  })
  @ApiBody({ type: CalculatePublicV2Dto })
  @ApiResponse({ status: 200, description: 'Calculation successful' })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:calculate')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async calculate(
    @Body() input: CalculatePublicV2Dto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const tradeAgreementCode = input.tradeAgreementCode || input.tradeAgreement;
    const tradeAgreementCertificate =
      typeof input.tradeAgreementCertificate === 'boolean'
        ? input.tradeAgreementCertificate
        : input.claimPreferential;

    try {
      const result = await this.calculationService.calculate({
        htsNumber: input.htsNumber,
        countryOfOrigin: input.countryOfOrigin,
        destinationCountry: input.destinationCountry || 'US',
        declaredValue: input.declaredValue,
        currency: input.currency,
        weightKg: input.weightKg,
        quantity: input.quantity,
        quantityUnit: input.quantityUnit,
        entryDate: input.entryDate,
        tradeAgreementCode,
        tradeAgreementCertificate,
        additionalInputs: (input as any).additionalInputs,
        htsVersion: (input as any).htsVersion,
        tariffSelectionMode: input.tariffSelectionMode,
        organizationId: apiKey.organizationId,
      });

      // Best-effort audit write — non-blocking.
      void this.history.write({
        apiKey,
        input: input as any,
        result: result as any,
        source: 'hts_native_v2',
      });

      return {
        success: true,
        data: this.withConfidenceObject(
          result as unknown as Record<string, unknown>,
        ),
        meta: {
          apiVersion: 'v2',
          organizationId: apiKey.organizationId,
          source: 'hts_native',
        },
      };
    } catch (e: any) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: e?.code || 'CALCULATION_FAILED',
          message: e?.message || 'Calculation failed',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  // ── /formula ─────────────────────────────────────────────────────────

  @Get('formula')
  @ApiOperation({
    summary: 'Resolve componentized tariff formula(s) (native)',
    description:
      'Returns base + special + chapter-99 + section-301/232/122 + MPF/HMF + post-tax components. Same shape as the v1 proxy but evaluated locally.',
  })
  @ApiQuery({ name: 'htsCode', required: true })
  @ApiQuery({ name: 'country', required: true })
  @ApiQuery({ name: 'entryDate', required: false })
  @ApiQuery({ name: 'htsVersion', required: false })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiPermissions('hts:calculate')
  async getFormula(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
    @Query('entryDate') entryDate?: string,
    @Query('htsVersion') htsVersion?: string,
  ) {
    if (!htsCode || !country) {
      throw new BadRequestException('htsCode and country are required');
    }
    const [row] = await this.tariffRateBatch.batchFormulas([
      { htsCode, country, entryDate, htsVersion },
    ]);
    if (!row) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NO_FORMULA',
          message: 'No formula resolved for the given HTS code',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      htsCode,
      country,
      effectiveHtsCode: row.effectiveHtsCode ?? null,
      blocked: row.blocked,
      blockReason: row.blockReason,
      message: row.message,
      systemSelectedChapter99Headings:
        row.systemSelectedChapter99Headings ?? [],
      exclusiveSection301: false,
      formulas: row.formulas,
    };
  }

  // ── /tariff-rates ────────────────────────────────────────────────────

  @Post('tariff-rates')
  @ApiOperation({
    summary: 'Batch evaluate tariff amounts (native)',
    description:
      'Per-row totalDuty is customs duty only. MPF/HMF and tax components are returned separately as fees, taxes, and structured totals.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiPermissions('hts:calculate')
  async getTariffRates(
    @Body()
    body: Array<{
      htsCode: string;
      country: string;
      inputs?: Record<string, number>;
      entryDate?: string;
      htsVersion?: string;
      selectedChapter99Headings?: string[];
    }>,
  ) {
    if (!Array.isArray(body)) {
      throw new BadRequestException('Request body must be an array');
    }
    const results = await this.tariffRateBatch.batchCalculate(body);
    return results.map((r) => ({
      htsCode: r.htsCode,
      country: r.country,
      effectiveHtsCode: r.effectiveHtsCode ?? null,
      blocked: r.blocked,
      blockReason: r.blockReason,
      message: r.message,
      systemSelectedChapter99Headings: r.systemSelectedChapter99Headings ?? [],
      totalDuty: r.totalDuty,
      fees: r.fees ?? 0,
      taxes: r.taxes ?? 0,
      totals: r.totals,
      confidenceScore: r.confidence,
      confidence: this.confidenceObject(r.confidenceDetails, r.confidence),
      confidenceDetails: r.confidenceDetails,
      breakdown: r.breakdown,
      sources: r.sources ?? [],
    }));
  }

  // ── /quote (multi-jurisdiction landed cost) ──────────────────────────

  @Post('quote')
  @ApiOperation({
    summary: 'Multi-jurisdiction landed-cost quote',
    description:
      'One-shot landed cost across destination US/GB/HK/CA/EU. Mirrors POST /landed-cost/quotes but lives under the calculator namespace for UI convenience.',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiPermissions('landed-cost:write')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async createQuote(
    @Body() body: LandedCostQuoteRequestDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    try {
      return await this.landedCost.createQuote({
        organizationId: apiKey.organizationId,
        apiKeyId: apiKey.id,
        request: body,
      });
    } catch (e: any) {
      if (e?.code === 'EU_REQUIRES_MEMBER_STATE') {
        throw new HttpException(
          { statusCode: 400, code: e.code, message: e.message },
          400,
        );
      }
      if (e?.code === 'UNSUPPORTED_JURISDICTION') {
        throw new HttpException(
          { statusCode: 400, code: e.code, message: e.message },
          400,
        );
      }
      throw new HttpException(
        e?.message || 'Quote failed',
        e?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── /jurisdictions ───────────────────────────────────────────────────

  @Get('jurisdictions')
  @ApiOperation({
    summary: 'List supported destination jurisdictions',
    description:
      'Returns active rows from the jurisdictions table. UIs use this to populate destination pickers and reason about routing (EU customs union vs member states).',
  })
  @ApiResponse({ status: 200 })
  @ApiPermissions('hts:calculate')
  async listJurisdictions() {
    const rows = await this.jurisdictions.listActive();
    return {
      success: true,
      count: rows.length,
      data: rows.map((j) => ({
        code: j.code,
        displayName: j.displayName,
        type: j.type,
        parentCode: j.parentCode,
        currencyCode: j.currencyCode,
        defaultLocale: j.defaultLocale,
        tariffSchema: j.tariffSchema,
        isActive: j.isActive,
      })),
    };
  }

  // ── /calculations (shared with v1) ───────────────────────────────────

  @Get('calculations/:id')
  @ApiOperation({ summary: 'Get a stored calculation by ID' })
  @ApiParam({ name: 'id', description: 'calculationId' })
  @ApiPermissions('hts:calculate')
  async getCalculation(
    @Param('id') id: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const row = await this.history.findOneForKey(id, apiKey);
    return {
      success: true,
      data: row,
      meta: { apiVersion: 'v2', organizationId: apiKey.organizationId },
    };
  }

  @Get('calculations')
  @ApiOperation({ summary: 'List recent stored calculations' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '1..200, default 10',
  })
  @ApiPermissions('hts:calculate')
  async listCalculations(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.history.listForKey(apiKey, Number(limit) || 10);
    return {
      success: true,
      data: rows,
      meta: { apiVersion: 'v2', organizationId: apiKey.organizationId },
    };
  }

  private withConfidenceObject(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    const score =
      typeof value.confidence === 'number'
        ? value.confidence
        : typeof (value.confidenceDetails as any)?.score === 'number'
          ? (value.confidenceDetails as any).score
          : null;
    return {
      ...value,
      confidenceScore: score,
      confidence: this.confidenceObject(value.confidenceDetails, score),
    };
  }

  private confidenceObject(
    details: unknown,
    fallbackScore: number | null | undefined,
  ): Record<string, unknown> {
    const confidenceDetails =
      details && typeof details === 'object'
        ? (details as Record<string, unknown>)
        : null;
    const score =
      typeof confidenceDetails?.score === 'number'
        ? confidenceDetails.score
        : typeof fallbackScore === 'number'
          ? fallbackScore
          : null;
    return {
      score,
      label:
        typeof confidenceDetails?.label === 'string'
          ? confidenceDetails.label
          : this.confidenceLabel(score),
      source:
        typeof confidenceDetails?.source === 'string'
          ? confidenceDetails.source
          : 'fallback',
      basedOn: confidenceDetails?.basedOn || null,
      caveats: Array.isArray(confidenceDetails?.caveats)
        ? confidenceDetails.caveats
        : [],
    };
  }

  private confidenceLabel(score: number | null): string {
    if (score === null) return 'review';
    if (score >= 0.9) return 'high';
    if (score >= 0.75) return 'medium';
    if (score >= 0.5) return 'low';
    return 'review';
  }
}
