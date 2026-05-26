import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationService, FormulaEvaluationService } from '../services';
import { TariffFormulaResolverService } from '../services/tariff-formula-resolver.service';
import { TariffRateBatchService } from '../services/tariff-rate-batch.service';
import { CalculateDto } from '../dto';
import { CalculationScenarioEntity } from '../entities';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import { ApiPermissions } from '../../api-keys/decorators/api-permissions.decorator';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import { Public } from '../../auth/decorators/public.decorator';

interface CallerContext {
  organizationId: string;
  userId?: string;
}

@Controller('calculator')
export class CalculatorController {
  private readonly logger = new Logger(CalculatorController.name);

  constructor(
    private readonly calculationService: CalculationService,
    private readonly formulaEvaluation: FormulaEvaluationService,
    private readonly tariffFormulaResolver: TariffFormulaResolverService,
    private readonly tariffRateBatch: TariffRateBatchService,
    @InjectRepository(CalculationScenarioEntity)
    private readonly scenarioRepository: Repository<CalculationScenarioEntity>,
  ) {}

  // Note: `POST /api/v1/calculator/calculate`, `GET /api/v1/calculator/formula`,
  // and `POST /api/v1/calculator/tariff-rates` are intentionally NOT defined
  // on this controller. They are served exclusively by the ai-service-proxy
  // CalculatorV1Controller (modules/public-api/v1) so the v1 surface stays a
  // transparent relay for hts-web2. The native engine for hts-ui sits on the
  // v2 routes below (`v2/formula`, `v2/tariff-rates`, `v2/calculate`).
  //
  // Keeping duplicate routes here would cause registration-order ambiguity
  // and silently override the public-api proxy — that's how we ended up
  // surfacing the "Auto-imported from ai-service…" leak in seed data.

  @SkipJwtAuth()
  @UseGuards(ApiKeyGuard)
  @ApiPermissions('calculator:write')
  @Post('calculate.api')
  async calculateApi(@Body() calculateDto: CalculateDto, @Req() req: any) {
    const organizationId = req.organizationId as string;
    if (!organizationId) {
      throw new ForbiddenException('Missing organization on API key');
    }

    const tradeAgreementCode =
      calculateDto.tradeAgreementCode || calculateDto.tradeAgreement;
    const tradeAgreementCertificate =
      typeof calculateDto.tradeAgreementCertificate === 'boolean'
        ? calculateDto.tradeAgreementCertificate
        : calculateDto.claimPreferential;

    return this.calculationService.calculate({
      ...calculateDto,
      tradeAgreementCode,
      tradeAgreementCertificate,
      organizationId,
    });
  }

  // ── History (now tenant-scoped) ────────────────────────────────────────

  @Get('calculations/:calculationId')
  async getCalculation(
    @Param('calculationId') calculationId: string,
    @Req() req: any,
  ) {
    const ctx = this.requireCallerContext(req);

    const calculation =
      await this.calculationService.getCalculationHistory(calculationId);

    if (!calculation) {
      throw new HttpException(
        { statusCode: 404, message: 'Calculation not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      calculation.organizationId &&
      calculation.organizationId !== ctx.organizationId
    ) {
      // Don't leak existence of other-tenant data.
      throw new HttpException(
        { statusCode: 404, message: 'Calculation not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    return calculation;
  }

  // ── Health ─────────────────────────────────────────────────────────────

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'calculator' };
  }

  // ── JWT-friendly Calculator v2 endpoints (browser path) ────────────────
  //
  // The calculator-v2 UI is a JWT-authenticated browser client. It must not
  // need an API key to hit native v2 calculation logic, so we mount the
  // richer v2 contract under the standard app namespace at
  // `/api/v1/calculator/v2/*`. These delegate to the same native services
  // as the public `/api/v2/calculator/*` controller — only the auth shape
  // differs.
  //
  // The response shape is identical to the public v2 controller and now
  // carries program family, legal authority, Chapter 99 reporting code,
  // source citation, and constraints for every component.

  @Get('v2/formula')
  async getFormulaV2(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
    @Query('entryDate') entryDate?: string,
    @Query('htsVersion') htsVersion?: string,
    @Query('selectedChapter99Headings') selectedChapter99Headings?: string,
    @Req() req?: any,
  ): Promise<unknown> {
    this.requireCallerContext(req);

    if (!htsCode || !country) {
      throw new HttpException(
        'htsCode and country are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const headings = parseHeadingList(selectedChapter99Headings);
    const [item] = await this.tariffRateBatch.batchFormulas([
      {
        htsCode,
        country,
        entryDate,
        htsVersion,
        selectedChapter99Headings: headings,
      },
    ]);

    if (!item) {
      throw new HttpException('No formula returned', HttpStatus.NOT_FOUND);
    }

    return {
      htsCode,
      country,
      effectiveHtsCode: item.effectiveHtsCode ?? null,
      blocked: item.blocked,
      blockReason: item.blockReason,
      message: item.message,
      systemSelectedChapter99Headings:
        item.systemSelectedChapter99Headings ?? [],
      exclusiveSection301: false,
      formulas: item.formulas,
      // P2.T5 — forward rule-declared inputs (aluminum smelt/cast,
      // AD/CVD exporter, CBAM tonnage, etc.) so the FE renderer can
      // surface them. Computed by `TariffRateBatchService.collectRuleInputs()`.
      // I1 fix (2026-05-26): filter out entries that don't carry the
      // minimum required shape so a malformed batch-service response
      // doesn't break the FE renderer. Logged so we can chase the
      // root cause without breaking the user-facing response.
      additionalInputs: this.sanitizeAdditionalInputs(item.additionalInputs),
    };
  }

  /**
   * I1 fix (2026-05-26): defensive shape check on the rule-declared
   * inputs forwarded to the FE. Drops anything missing the `name` or
   * `type` field; surfaces the count of dropped entries via debug log.
   */
  private sanitizeAdditionalInputs(
    inputs: unknown,
  ): Array<{ name: string; type: string; [k: string]: unknown }> {
    if (!Array.isArray(inputs)) return [];
    const ok: Array<{ name: string; type: string; [k: string]: unknown }> = [];
    let dropped = 0;
    for (const raw of inputs) {
      if (
        raw &&
        typeof raw === 'object' &&
        typeof (raw as any).name === 'string' &&
        (raw as any).name.length > 0 &&
        typeof (raw as any).type === 'string' &&
        (raw as any).type.length > 0
      ) {
        ok.push(raw as any);
      } else {
        dropped += 1;
      }
    }
    if (dropped > 0) {
      this.logger.debug(
        `/v2/formula additionalInputs: dropped ${dropped} malformed entries`,
      );
    }
    return ok;
  }

  @Post('v2/tariff-rates')
  async getTariffRatesV2(
    @Body()
    body: Array<{
      htsCode: string;
      country: string;
      inputs?: Record<string, number>;
      entryDate?: string;
      htsVersion?: string;
      selectedChapter99Headings?: string[];
    }>,
    @Req() req: any,
  ): Promise<unknown> {
    this.requireCallerContext(req);

    const items = Array.isArray(body) ? body : [];
    const results = await this.tariffRateBatch.batchCalculate(items);

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
      confidence: r.confidence,
      confidenceDetails: r.confidenceDetails,
      breakdown: r.breakdown,
      sources: r.sources ?? [],
    }));
  }

  @Post('v2/calculate')
  async calculateV2(@Body() calculateDto: CalculateDto, @Req() req: any) {
    const ctx = this.requireCallerContext(req);

    const tradeAgreementCode =
      calculateDto.tradeAgreementCode || calculateDto.tradeAgreement;
    const tradeAgreementCertificate =
      typeof calculateDto.tradeAgreementCertificate === 'boolean'
        ? calculateDto.tradeAgreementCertificate
        : calculateDto.claimPreferential;

    const result = await this.calculationService.calculate({
      ...calculateDto,
      tradeAgreementCode,
      tradeAgreementCertificate,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    });

    return {
      success: true,
      data: result,
      meta: {
        apiVersion: 'v2',
        engine: 'hts-native-v2',
        organizationId: ctx.organizationId,
      },
    };
  }

  // ── Scenarios (tenant-scoped) ──────────────────────────────────────────

  @Post('scenarios')
  async saveScenario(
    @Body() scenarioData: Partial<CalculationScenarioEntity>,
    @Req() req: any,
  ) {
    const ctx = this.requireCallerContext(req);

    if (!scenarioData.name || !scenarioData.htsNumber) {
      throw new HttpException(
        'Scenario name and HTS number are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const scenario = this.scenarioRepository.create({
      ...scenarioData,
      organizationId: ctx.organizationId,
      userId: ctx.userId || null,
    });

    const saved = await this.scenarioRepository.save(scenario);

    return {
      success: true,
      data: saved,
      message: 'Scenario saved successfully',
    };
  }

  @Post('scenarios/:id/calculate')
  async calculateScenario(
    @Param('id') scenarioId: string,
    @Body() overrides: Partial<CalculateDto> | undefined,
    @Req() req: any,
  ) {
    const ctx = this.requireCallerContext(req);

    const scenario = await this.scenarioRepository.findOne({
      where: { id: scenarioId },
    });

    if (!scenario) {
      throw new HttpException('Scenario not found', HttpStatus.NOT_FOUND);
    }

    if (scenario.organizationId !== ctx.organizationId) {
      // Cross-tenant — return 404 to avoid existence leak.
      throw new HttpException('Scenario not found', HttpStatus.NOT_FOUND);
    }

    const tradeAgreementCode =
      overrides?.tradeAgreementCode ||
      overrides?.tradeAgreement ||
      scenario.tradeAgreement ||
      undefined;
    const tradeAgreementCertificate =
      typeof overrides?.tradeAgreementCertificate === 'boolean'
        ? overrides.tradeAgreementCertificate
        : typeof overrides?.claimPreferential === 'boolean'
          ? overrides.claimPreferential
          : scenario.claimPreferential;

    const result = await this.calculationService.calculate({
      htsNumber: overrides?.htsNumber || scenario.htsNumber,
      countryOfOrigin: overrides?.countryOfOrigin || scenario.countryOfOrigin,
      destinationCountry: overrides?.destinationCountry,
      declaredValue: overrides?.declaredValue ?? scenario.declaredValue,
      currency: overrides?.currency || scenario.currency,
      weightKg: overrides?.weightKg ?? scenario.weightKg ?? undefined,
      quantity: overrides?.quantity ?? scenario.quantity ?? undefined,
      quantityUnit:
        overrides?.quantityUnit ?? scenario.quantityUnit ?? undefined,
      entryDate:
        overrides?.entryDate ??
        (typeof scenario.additionalInputs?.entryDate === 'string'
          ? (scenario.additionalInputs as any).entryDate
          : undefined),
      additionalInputs: (overrides?.additionalInputs ??
        scenario.additionalInputs ??
        undefined) as Record<string, any> | undefined,
      htsVersion: overrides?.htsVersion ?? undefined,
      tradeAgreementCode,
      tradeAgreementCertificate,
      tariffSelectionMode: overrides?.tariffSelectionMode,
      organizationId: scenario.organizationId,
      userId: scenario.userId ?? ctx.userId ?? undefined,
      scenarioId: scenario.id,
    });

    return {
      success: true,
      data: result,
      scenario: { id: scenario.id, name: scenario.name },
    };
  }

  @Get('scenarios')
  async getScenarios(@Req() req: any) {
    const ctx = this.requireCallerContext(req);

    const scenarios = await this.scenarioRepository.find({
      where: { organizationId: ctx.organizationId },
      order: { createdAt: 'DESC' },
    });

    return {
      success: true,
      data: scenarios,
      count: scenarios.length,
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private requireCallerContext(req: any): CallerContext {
    const ctx = this.tryGetCallerContext(req);
    if (ctx) return ctx;
    throw new ForbiddenException('Authenticated organization is required');
  }

  /**
   * Best-effort caller context extraction. Returns null when no auth is
   * present so @Public() routes can serve both anonymous (hts-web2) and
   * authenticated (hts-ui, partner API key) callers without rejecting the
   * anonymous case. Routes that genuinely require auth keep using
   * requireCallerContext().
   */
  private tryGetCallerContext(req: any): CallerContext | null {
    const fromUser = req?.user;
    if (fromUser?.organizationId) {
      return {
        organizationId: fromUser.organizationId,
        userId: fromUser.id,
      };
    }

    const fromApiKey = req?.organizationId;
    if (fromApiKey) {
      return { organizationId: fromApiKey };
    }

    return null;
  }
}

function parseHeadingList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
