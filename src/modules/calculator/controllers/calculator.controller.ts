import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { CalculationService, FormulaEvaluationService } from '../services';
import { CalculateDto } from '../dto';
import { CalculationScenarioEntity } from '../entities';
import { Public } from '../../auth/decorators/public.decorator';

interface ExternalFormulaVariable {
  name: string;
  unit: string;
  type: string;
  description: string;
}

interface ExternalFormula {
  tariffType: string;
  tariffTypeDescription: string;
  /**
   * Plain-language explanation of the tariff type (e.g. "Section 301
   * tariffs on Chinese-origin products are applied through HTS Chapter 99
   * amendments."). Emitted by ai-service for non-base formulas; surfaced
   * in the calculator UI as a tooltip on the breakdown row.
   */
  tariffTypeExplanation?: string;
  formula: string;
  formulaVariables?: ExternalFormulaVariable[];
  chapter99HtsCode?: string;
  amount?: number;
}

interface ExternalTariffResult {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string;
  message: string;
  blocked: boolean;
  block_reason: string | null;
  exclusiveSection301?: boolean;
  /**
   * True when the HTS code is eligible for CUSMA / USMCA preferential
   * treatment. Only emitted by ai-service's X-API-Key-gated
   * /v2/tariff/hts-formulas endpoint (not the public /formulas one).
   */
  isCusmaFreeTrade?: boolean | null;
  formulas: ExternalFormula[];
}

@Controller('calculator')
export class CalculatorController {
  constructor(
    private readonly calculationService: CalculationService,
    private readonly formulaEvaluation: FormulaEvaluationService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(CalculationScenarioEntity)
    private readonly scenarioRepository: Repository<CalculationScenarioEntity>,
  ) {}

  @Public()
  @Post('calculate')
  async calculate(
    @Body() calculateDto: CalculateDto,
    @Query('organizationId') organizationId: string,
    @Query('userId') userId?: string,
  ) {
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
      organizationId,
      userId,
    });

    return result;
  }

  @Get('calculations/:calculationId')
  async getCalculation(@Param('calculationId') calculationId: string) {
    const calculation =
      await this.calculationService.getCalculationHistory(calculationId);

    if (!calculation) {
      return {
        statusCode: 404,
        message: 'Calculation not found',
      };
    }

    return calculation;
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'calculator' };
  }

  /**
   * Fetch tariff formula metadata (variables + descriptions) for a single
   * HTS code / country pair, without evaluating. Used by the calculator UI
   * to render a form whose inputs match what the formula actually needs.
   *
   * GET /calculator/formula?htsCode=&country=
   *
   * Proxies ai-service POST /v2/tariff/formulas — ai-service is the single
   * source of truth for formulas and calculation.
   */
  @Public()
  @Get('formula')
  async getFormula(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
  ): Promise<unknown> {
    if (!htsCode || !country) {
      throw new HttpException(
        'htsCode and country are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const [item] = await this.fetchFormulasFromAiService([{ htsCode, country }]);
    if (!item) {
      throw new HttpException(
        'No formula returned by upstream',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      htsCode: item.htsCode ?? htsCode,
      country: item.country ?? country,
      effectiveHtsCode: item.effectiveHtsCode ?? null,
      blocked: !!item.blocked,
      // Emit both casings so callers don't have to guess. ai-service uses
      // block_reason (snake) natively; the camelCase alias stays for
      // back-compat with existing hts-web2 builds.
      block_reason: item.block_reason ?? null,
      blockReason: item.block_reason ?? null,
      message: item.message ?? '',
      exclusiveSection301: item.exclusiveSection301 ?? false,
      // Forwarded from /hts-formulas; drives the CUSMA Free Trade badge
      // + results row in the calculator UI.
      isCusmaFreeTrade: item.isCusmaFreeTrade ?? null,
      formulas: (item.formulas ?? []).map((f) => ({
        tariffType: f.tariffType,
        tariffTypeDescription: f.tariffTypeDescription,
        // Per-formula human-readable explanation — shown as a tooltip on
        // the breakdown row in the calculator UI.
        tariffTypeExplanation: f.tariffTypeExplanation ?? null,
        formula: f.formula,
        formulaVariables: f.formulaVariables ?? [],
        chapter99HtsCode: f.chapter99HtsCode ?? null,
      })),
    };
  }

  /**
   * Calculate tariff amounts. Proxies ai-service POST /v2/tariff/rates which
   * already evaluates per-formula amounts and returns Chapter 99 codes.
   *
   * POST /calculator/tariff-rates
   * Body: [{ htsCode, country, inputs?: Record<string, number> }]
   */
  @Public()
  @Post('tariff-rates')
  async getTariffRates(
    @Body()
    body: Array<{
      htsCode: string;
      country: string;
      inputs?: Record<string, number>;
    }>,
  ): Promise<unknown> {
    const items = Array.isArray(body) ? body : [];
    const data = await this.fetchRatesFromAiService(
      items.map(({ htsCode, country, inputs }) => ({
        htsCode,
        country,
        inputs: inputs ?? {},
      })),
    );

    return data.map((item) => {
      const formulas = Array.isArray(item.formulas) ? item.formulas : [];
      const breakdown = formulas.map((f) => ({
        tariffType: f.tariffType,
        tariffTypeDescription: f.tariffTypeDescription,
        // Match /formula's shape — the FE renders the same tooltip on both
        // breakdown sources.
        tariffTypeExplanation: f.tariffTypeExplanation ?? null,
        amount: typeof f.amount === 'number' ? f.amount : 0,
        formula: f.formula,
        formulaVariables: f.formulaVariables ?? [],
        chapter99HtsCode: f.chapter99HtsCode ?? null,
        error: null,
      }));
      const totalDuty = breakdown.reduce((sum, b) => sum + (b.amount ?? 0), 0);

      return {
        htsCode: item.htsCode,
        country: item.country,
        effectiveHtsCode: item.effectiveHtsCode ?? null,
        blocked: !!item.blocked,
        block_reason: item.block_reason ?? null,
        blockReason: item.block_reason ?? null,
        message: item.message ?? '',
        isCusmaFreeTrade: item.isCusmaFreeTrade ?? null,
        totalDuty: Math.round(totalDuty * 100) / 100,
        breakdown,
      };
    });
  }

  private aiServiceUrl(): string {
    return (
      this.configService.get<string>('AI_SERVICE_URL') ??
      this.configService.get<string>(
        'TARIFF_FORMULAS_API_URL',
        'http://localhost:3001/v2/tariff',
      )
    );
  }

  private aiServiceHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Accept either env var name. Prod secrets use TARIFF_FORMULAS_API_KEY
    // (see hts/app-secrets in Secrets Manager); some local envs use the
    // older AI_SERVICE_API_KEY. Either resolves /hts-formulas auth.
    const apiKey =
      this.configService.get<string>('AI_SERVICE_API_KEY') ||
      this.configService.get<string>('TARIFF_FORMULAS_API_KEY') ||
      '';
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  }

  private async fetchFormulasFromAiService(
    requests: Array<{ htsCode: string; country: string }>,
  ): Promise<ExternalTariffResult[]> {
    if (!requests.length) return [];
    try {
      // Use /hts-formulas (X-API-Key gated) rather than the public
      // /formulas endpoint — only /hts-formulas emits isCusmaFreeTrade
      // and the per-formula tariffTypeExplanation.
      const response = await firstValueFrom(
        this.httpService.post<ExternalTariffResult[]>(
          `${this.aiServiceUrl()}/hts-formulas`,
          requests,
          { headers: this.aiServiceHeaders() },
        ),
      );
      return response.data ?? [];
    } catch (err: unknown) {
      throw this.translateUpstreamError(err);
    }
  }

  private async fetchRatesFromAiService(
    requests: Array<{ htsCode: string; country: string; inputs: Record<string, number> }>,
  ): Promise<ExternalTariffResult[]> {
    if (!requests.length) return [];
    try {
      const response = await firstValueFrom(
        this.httpService.post<ExternalTariffResult[]>(
          `${this.aiServiceUrl()}/rates`,
          requests,
          { headers: this.aiServiceHeaders() },
        ),
      );
      return response.data ?? [];
    } catch (err: unknown) {
      throw this.translateUpstreamError(err);
    }
  }

  private translateUpstreamError(err: unknown): HttpException {
    const status =
      (err as { response?: { status?: number } })?.response?.status ??
      HttpStatus.BAD_GATEWAY;
    // Treat upstream auth/quota failures as 502 to avoid leaking key state.
    const safeStatus =
      status === 401 || status === 403 || status === 429
        ? HttpStatus.BAD_GATEWAY
        : status >= 400 && status < 600
          ? status
          : HttpStatus.BAD_GATEWAY;
    return new HttpException(
      'Tariff formulas service request failed',
      safeStatus,
    );
  }

  /**
   * Save a calculation scenario for reuse
   * POST /calculator/scenarios
   */
  @Post('scenarios')
  async saveScenario(
    @Body() scenarioData: Partial<CalculationScenarioEntity>,
    @Query('organizationId') organizationId: string,
    @Query('userId') userId?: string,
  ) {
    if (!scenarioData.name || !scenarioData.htsNumber) {
      throw new HttpException(
        'Scenario name and HTS number are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const scenario = this.scenarioRepository.create({
      ...scenarioData,
      organizationId,
      userId: userId || null,
    });

    const saved = await this.scenarioRepository.save(scenario);

    return {
      success: true,
      data: saved,
      message: 'Scenario saved successfully',
    };
  }

  /**
   * Calculate using a saved scenario
   * POST /calculator/scenarios/:id/calculate
   */
  @Post('scenarios/:id/calculate')
  async calculateScenario(
    @Param('id') scenarioId: string,
    @Body() overrides?: Partial<CalculateDto>,
  ) {
    const scenario = await this.scenarioRepository.findOne({
      where: { id: scenarioId },
    });

    if (!scenario) {
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

    // Merge scenario with any overrides
    const calculationInput = {
      htsNumber: overrides?.htsNumber || scenario.htsNumber,
      countryOfOrigin: overrides?.countryOfOrigin || scenario.countryOfOrigin,
      declaredValue: overrides?.declaredValue ?? scenario.declaredValue,
      currency: overrides?.currency || scenario.currency,
      weightKg: overrides?.weightKg ?? scenario.weightKg ?? undefined,
      quantity: overrides?.quantity ?? scenario.quantity ?? undefined,
      quantityUnit:
        overrides?.quantityUnit ?? scenario.quantityUnit ?? undefined,
      entryDate:
        overrides?.entryDate ??
        (typeof scenario.additionalInputs?.entryDate === 'string'
          ? scenario.additionalInputs.entryDate
          : undefined),
      additionalInputs:
        overrides?.additionalInputs ?? scenario.additionalInputs ?? undefined,
      htsVersion: overrides?.htsVersion ?? undefined,
      tradeAgreementCode,
      tradeAgreementCertificate,
      organizationId: scenario.organizationId,
      userId: scenario.userId ?? undefined,
      scenarioId: scenario.id,
    };

    const result = await this.calculationService.calculate(calculationInput);

    return {
      success: true,
      data: result,
      scenario: {
        id: scenario.id,
        name: scenario.name,
      },
    };
  }

  /**
   * Get saved scenarios for an organization
   * GET /calculator/scenarios
   */
  @Get('scenarios')
  async getScenarios(@Query('organizationId') organizationId: string) {
    const scenarios = await this.scenarioRepository.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });

    return {
      success: true,
      data: scenarios,
      count: scenarios.length,
    };
  }
}
