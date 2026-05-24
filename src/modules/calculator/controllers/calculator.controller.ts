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
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CalculationService,
  FormulaEvaluationService,
} from '../services';
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
  constructor(
    private readonly calculationService: CalculationService,
    private readonly formulaEvaluation: FormulaEvaluationService,
    private readonly tariffFormulaResolver: TariffFormulaResolverService,
    private readonly tariffRateBatch: TariffRateBatchService,
    @InjectRepository(CalculationScenarioEntity)
    private readonly scenarioRepository: Repository<CalculationScenarioEntity>,
  ) {}

  // ── Single calculate ───────────────────────────────────────────────────
  // Both JWT users and API-key clients can call this. Organization is
  // derived from the auth context, never from a query parameter.

  @Post('calculate')
  async calculate(
    @Body() calculateDto: CalculateDto,
    @Req() req: any,
  ) {
    const ctx = this.requireCallerContext(req);

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
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    });
  }

  @SkipJwtAuth()
  @UseGuards(ApiKeyGuard)
  @ApiPermissions('calculator:write')
  @Post('calculate.api')
  async calculateApi(
    @Body() calculateDto: CalculateDto,
    @Req() req: any,
  ) {
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

  // ── Local formula metadata (replaces ai-service /v2/tariff/formulas) ───

  @Get('formula')
  async getFormula(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
    @Query('entryDate') entryDate?: string,
    @Query('htsVersion') htsVersion?: string,
    @Req() req?: any,
  ): Promise<unknown> {
    // Auth is already enforced by the global JWT guard; just sanity-check
    // the call site exists.
    this.requireCallerContext(req);

    if (!htsCode || !country) {
      throw new HttpException(
        'htsCode and country are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [item] = await this.tariffRateBatch.batchFormulas([
      { htsCode, country, entryDate, htsVersion },
    ]);

    if (!item) {
      throw new HttpException(
        'No formula returned',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      htsCode,
      country,
      effectiveHtsCode: item.effectiveHtsCode ?? null,
      blocked: item.blocked,
      blockReason: item.blockReason,
      message: item.message,
      exclusiveSection301: false,
      formulas: item.formulas.map((f) => ({
        tariffType: f.tariffType,
        tariffTypeDescription: f.tariffTypeDescription,
        formula: f.formula,
        formulaVariables: f.formulaVariables,
        chapter99HtsCode: f.chapter99HtsCode ?? null,
      })),
    };
  }

  // ── Local batch rates (replaces ai-service /v2/tariff/rates) ───────────

  @Post('tariff-rates')
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
      totalDuty: r.totalDuty,
      breakdown: r.breakdown,
    }));
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

    throw new ForbiddenException('Authenticated organization is required');
  }
}
