import {
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { FormulaMaintenanceService } from '../services/formula-maintenance.service';

@ApiTags('Admin - Formula Maintenance')
@ApiBearerAuth()
@Controller('admin/formula-maintenance')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FormulaMaintenanceAdminController {
  constructor(private readonly formulaMaintenance: FormulaMaintenanceService) {}

  @Post('runs')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaMaintenance.write')
  @ApiOperation({
    summary: 'Run continuous formula maintenance over HTS diffs and parser gaps',
  })
  @ApiResponse({ status: 201, description: 'Maintenance run completed' })
  async run(
    @Body()
    body: {
      importId?: string;
      limit?: number;
      dryRun?: boolean;
      aiEnabled?: boolean;
      includeParserGaps?: boolean;
    } = {},
  ) {
    return {
      success: true,
      data: await this.formulaMaintenance.runContinuousMaintenance(body),
    };
  }

  @Get('runs/latest')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaMaintenance.read')
  @ApiOperation({ summary: 'Get latest continuous formula maintenance run' })
  async latestRun() {
    return {
      success: true,
      data: await this.formulaMaintenance.latestRun(),
    };
  }

  @Get('items')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.formulaMaintenance.read')
  @ApiOperation({ summary: 'List maintenance items for reviewer triage' })
  async listItems(
    @Query('runId') runId?: string,
    @Query('classification') classification?: string,
    @Query('reviewerStatus') reviewerStatus?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.formulaMaintenance.listItems({
      runId,
      classification,
      reviewerStatus,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return {
      success: true,
      data: result.data,
      meta: { total: result.total },
    };
  }
}
