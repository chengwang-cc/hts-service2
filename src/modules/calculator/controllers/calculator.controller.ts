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
   * Fetch tariff formulas from the external hts-formulas API, evaluate them
   * server-side, and return calculated duty amounts.  The API key never leaves
   * the server.
   *
   * POST /calculator/tariff-rates
   * Body: [{ htsCode, country, inputs?: { value?, weight?, quantity? } }]
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
    const apiUrl = this.configService.get<string>(
      'TARIFF_FORMULAS_API_URL',
      'https://staging.api.report.chitchats.com/v2/tariff',
    );
    const apiKey = this.configService.get<string>('TARIFF_FORMULAS_API_KEY', '');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    const items = Array.isArray(body) ? body : [];
    const externalRequests = items.map(({ htsCode, country }) => ({ htsCode, country }));

    type ExternalFormula = {
      tariffType: string;
      tariffTypeDescription: string;
      formula: string;
    };
    type ExternalResult = {
      htsCode: string;
      country: string;
      message: string;
      blocked: boolean;
      block_reason: string | null;
      formulas: ExternalFormula[];
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<ExternalResult[]>(
          `${apiUrl}/hts-formulas`,
          externalRequests,
          { headers },
        ),
      );

      return response.data.map((item, idx) => {
        const inputs = items[idx]?.inputs ?? {};

        if (item.blocked || !item.formulas?.length) {
          return {
            htsCode: item.htsCode,
            country: item.country,
            blocked: item.blocked,
            blockReason: item.block_reason,
            message: item.message,
            totalDuty: 0,
            breakdown: [],
          };
        }

        let totalDuty = 0;
        const breakdown = item.formulas.map((f) => {
          let amount = 0;
          try {
            amount = this.formulaEvaluation.evaluate(f.formula, inputs);
          } catch {
            amount = 0;
          }
          totalDuty += amount;
          return {
            tariffType: f.tariffType,
            tariffTypeDescription: f.tariffTypeDescription,
            amount,
            formula: f.formula,
          };
        });

        return {
          htsCode: item.htsCode,
          country: item.country,
          blocked: false,
          blockReason: null,
          message: item.message,
          totalDuty,
          breakdown,
        };
      });
    } catch (err: unknown) {
      const status =
        (err as { response?: { status?: number } })?.response?.status ??
        HttpStatus.BAD_GATEWAY;
      throw new HttpException(
        'Tariff formulas service request failed',
        status >= 400 && status < 600 ? status : HttpStatus.BAD_GATEWAY,
      );
    }
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
