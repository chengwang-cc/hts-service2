import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TariffConfidenceService } from '../../calculator/services/tariff-confidence.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { FormulaAccuracyLabService } from '../services/formula-accuracy-lab.service';

@ApiTags('Admin - Formula Accuracy')
@ApiBearerAuth()
@Controller('admin/formula-accuracy')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FormulaAccuracyAdminController {
  constructor(
    private readonly formulaAccuracyLab: FormulaAccuracyLabService,
    private readonly tariffConfidence: TariffConfidenceService,
  ) {}

  @Get('dashboard')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get latest formula accuracy dashboard report' })
  async dashboard() {
    return {
      success: true,
      data: await this.formulaAccuracyLab.dashboard(),
    };
  }

  @Get('reports/latest')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({ summary: 'Get latest persisted formula accuracy lab report' })
  async latestReport() {
    return {
      success: true,
      data: await this.formulaAccuracyLab.latestReport(),
    };
  }

  @Post('reports')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.write')
  @ApiOperation({ summary: 'Generate a formula accuracy lab report' })
  @ApiResponse({ status: 201, description: 'Report generated' })
  async generateReport(
    @Body()
    body: {
      reportDate?: string;
      windowDays?: number;
      dryRun?: boolean;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    const report = await this.formulaAccuracyLab.generateReport({
      reportDate: body.reportDate,
      windowDays: body.windowDays,
      dryRun: body.dryRun,
      metadata: body.metadata || null,
    });
    return {
      success: true,
      data: report,
    };
  }

  @Get('confidence')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaAccuracy.read')
  @ApiOperation({
    summary: 'Explain confidence for a specific HTS/country calculation scope',
  })
  async confidence(
    @Query('htsNumber') htsNumber?: string,
    @Query('htsCode') htsCode?: string,
    @Query('countryCode') countryCode?: string,
    @Query('country') country?: string,
    @Query('destinationCode') destinationCode?: string,
    @Query('rateClass') rateClass?: string,
    @Query('componentType') componentType?: string,
  ) {
    const resolvedHtsNumber = htsNumber || htsCode;
    const resolvedCountryCode = countryCode || country;
    if (!resolvedHtsNumber || !resolvedCountryCode) {
      throw new BadRequestException('htsNumber and countryCode are required');
    }

    return {
      success: true,
      data: await this.tariffConfidence.scoreFor({
        htsNumber: resolvedHtsNumber,
        countryCode: resolvedCountryCode,
        destinationCode,
        rateClass,
        componentType,
      }),
    };
  }
}
