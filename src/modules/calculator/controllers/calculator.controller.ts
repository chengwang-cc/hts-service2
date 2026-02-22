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
import { Repository } from 'typeorm';
import { CalculationService } from '../services';
import { CalculateDto } from '../dto';
import { CalculationScenarioEntity } from '../entities';
import { Public } from '../../auth/decorators/public.decorator';

@Controller('calculator')
export class CalculatorController {
  constructor(
    private readonly calculationService: CalculationService,
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
