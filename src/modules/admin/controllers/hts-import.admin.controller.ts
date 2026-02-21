/**
 * HTS Import Admin Controller
 * REST API endpoints for HTS import management
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { HtsImportService } from '../services/hts-import.service';
import {
  TriggerImportDto,
  ListImportsDto,
  LogsPaginationDto,
  StageValidationQueryDto,
  StageDiffQueryDto,
  StageChapter99PreviewQueryDto,
  RejectImportDto,
} from '../dto/hts-import.dto';

@ApiTags('Admin - HTS Imports')
@ApiBearerAuth()
@Controller('admin/hts-imports')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HtsImportAdminController {
  constructor(private readonly htsImportService: HtsImportService) {}

  /**
   * GET /admin/hts-imports
   * List all import history records with pagination and filters
   */
  @Get()
  @ApiOperation({ summary: 'List all HTS imports' })
  @ApiResponse({
    status: 200,
    description: 'Import history list retrieved successfully',
  })
  async findAll(@Query() query: ListImportsDto) {
    const result = await this.htsImportService.findAll(query);

    return {
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages,
      },
    };
  }

  /**
   * POST /admin/hts-imports
   * Trigger a new HTS import from USITC
   */
  @Post()
  @ApiOperation({ summary: 'Trigger new HTS import' })
  @ApiResponse({ status: 201, description: 'Import triggered successfully' })
  @ApiResponse({ status: 400, description: 'Import already in progress' })
  async triggerImport(@Body() dto: TriggerImportDto, @Request() req) {
    const userId = req.user?.email || 'UNKNOWN';
    const importHistory = await this.htsImportService.createImport(dto, userId);

    return {
      success: true,
      data: importHistory,
      message: 'Import job triggered. Processing will begin shortly.',
    };
  }

  /**
   * GET /admin/hts-imports/:id
   * Get detailed information about a specific import
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get import details' })
  @ApiResponse({
    status: 200,
    description: 'Import details retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async findOne(@Param('id') id: string) {
    const importHistory = await this.htsImportService.findOne(id);

    // Calculate progress percentage
    const totalProcessed =
      importHistory.importedEntries +
      importHistory.updatedEntries +
      importHistory.skippedEntries +
      importHistory.failedEntries;

    const progress =
      importHistory.totalEntries > 0
        ? {
            total: importHistory.totalEntries,
            processed: totalProcessed,
            percentage: Math.round(
              (totalProcessed / importHistory.totalEntries) * 100,
            ),
          }
        : null;

    return {
      success: true,
      data: {
        ...importHistory,
        progress,
      },
    };
  }

  /**
   * POST /admin/hts-imports/:id/rollback
   * Rollback a completed import
   */
  @Post(':id/rollback')
  @ApiOperation({ summary: 'Rollback completed import' })
  @ApiResponse({ status: 200, description: 'Import rolled back successfully' })
  @ApiResponse({ status: 400, description: 'Import cannot be rolled back' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async rollback(@Param('id') id: string, @Request() req) {
    const userId = req.user?.email || 'UNKNOWN';
    await this.htsImportService.rollback(id, userId);

    return {
      success: true,
      message: 'Import rolled back successfully',
    };
  }

  /**
   * GET /admin/hts-imports/:id/logs
   * Get import logs with pagination
   */
  @Get(':id/logs')
  @ApiOperation({ summary: 'Get import logs' })
  @ApiResponse({ status: 200, description: 'Logs retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async getLogs(@Param('id') id: string, @Query() query: LogsPaginationDto) {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    const logs = await this.htsImportService.getLogs(id, offset, limit);

    return {
      success: true,
      data: logs,
      meta: {
        offset: query.offset,
        limit: query.limit,
        count: logs.length,
      },
    };
  }

  /**
   * GET /admin/hts-imports/:id/failed-entries
   * Get list of failed entries for an import
   */
  @Get(':id/failed-entries')
  @ApiOperation({ summary: 'Get failed entries' })
  @ApiResponse({
    status: 200,
    description: 'Failed entries retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async getFailedEntries(@Param('id') id: string) {
    const failedEntries = await this.htsImportService.getFailedEntries(id);

    return {
      success: true,
      data: failedEntries,
      meta: {
        total: failedEntries.length,
      },
    };
  }

  /**
   * GET /admin/hts-imports/:id/stage/summary
   * Get staging summary (counts for staged entries, validation issues, and diffs)
   */
  @Get(':id/stage/summary')
  @ApiOperation({ summary: 'Get staging summary' })
  @ApiResponse({
    status: 200,
    description: 'Staging summary retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:review')
  async getStageSummary(@Param('id') id: string) {
    const summary = await this.htsImportService.getStageSummary(id);

    return {
      success: true,
      data: summary,
    };
  }

  /**
   * GET /admin/hts-imports/:id/stage/formula-gate
   * Get formula coverage and formula-gate decision for staged entries
   */
  @Get(':id/stage/formula-gate')
  @ApiOperation({ summary: 'Get staging formula gate summary' })
  @ApiResponse({
    status: 200,
    description: 'Formula gate summary retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:review')
  async getStageFormulaGate(@Param('id') id: string) {
    const summary = await this.htsImportService.getStageFormulaGate(id);

    return {
      success: true,
      data: summary,
    };
  }

  /**
   * GET /admin/hts-imports/:id/stage/validation
   * Get validation issues for staged entries
   */
  @Get(':id/stage/validation')
  @ApiOperation({ summary: 'Get staging validation issues' })
  @ApiResponse({
    status: 200,
    description: 'Validation issues retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:review')
  async getStageValidation(
    @Param('id') id: string,
    @Query() query: StageValidationQueryDto,
  ) {
    const result = await this.htsImportService.getStageValidationIssues(
      id,
      query,
    );

    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  /**
   * GET /admin/hts-imports/:id/stage/diffs
   * Get side-by-side diffs for staged entries
   */
  @Get(':id/stage/diffs')
  @ApiOperation({ summary: 'Get staging diffs' })
  @ApiResponse({ status: 200, description: 'Diffs retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:review')
  async getStageDiffs(
    @Param('id') id: string,
    @Query() query: StageDiffQueryDto,
  ) {
    const result = await this.htsImportService.getStageDiffs(id, query);

    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  /**
   * GET /admin/hts-imports/:id/stage/chapter99-preview
   * Preview deterministic Chapter 99 synthesis before promotion
   */
  @Get(':id/stage/chapter99-preview')
  @ApiOperation({
    summary: 'Get Chapter 99 synthesis preview for staged entries',
  })
  @ApiResponse({
    status: 200,
    description: 'Chapter 99 preview retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:review')
  async getStageChapter99Preview(
    @Param('id') id: string,
    @Query() query: StageChapter99PreviewQueryDto,
  ) {
    const result = await this.htsImportService.getStageChapter99Preview(
      id,
      query,
    );

    return {
      success: true,
      data: result.data,
      meta: result.meta,
    };
  }

  /**
   * GET /admin/hts-imports/:id/stage/diffs/export
   * Export diffs as CSV
   */
  @Get(':id/stage/diffs/export')
  @ApiOperation({ summary: 'Export staging diffs as CSV' })
  @ApiResponse({ status: 200, description: 'CSV exported successfully' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:export')
  async exportStageDiffs(
    @Param('id') id: string,
    @Query() query: StageDiffQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.htsImportService.exportStageDiffsCsv(id, query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hts-diffs-${id}.csv"`,
    );
    res.send(csv);
  }

  /**
   * POST /admin/hts-imports/:id/promote
   * Promote a staged import to production HTS
   */
  @Post(':id/promote')
  @ApiOperation({ summary: 'Promote staged HTS import' })
  @ApiResponse({ status: 200, description: 'Promotion triggered successfully' })
  @ApiResponse({ status: 400, description: 'Import cannot be promoted' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:promote')
  async promote(@Param('id') id: string, @Request() req) {
    const userId = req.user?.email || 'UNKNOWN';
    const userPermissions = (req.user?.roles || [])
      .flatMap((role: any) => role.permissions || [])
      .filter(Boolean);
    const canOverride = this.hasPermission(
      userPermissions,
      'hts:import:override',
    );
    const result = await this.htsImportService.promoteImport(
      id,
      userId,
      canOverride,
    );

    return {
      success: true,
      data: result,
      message: 'Promotion job triggered. Processing will begin shortly.',
    };
  }

  /**
   * POST /admin/hts-imports/:id/reject
   * Reject a staged import
   */
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject staged HTS import' })
  @ApiResponse({ status: 200, description: 'Import rejected successfully' })
  @ApiResponse({ status: 400, description: 'Import cannot be rejected' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:import:review')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectImportDto,
    @Request() req,
  ) {
    const userId = req.user?.email || 'UNKNOWN';
    const result = await this.htsImportService.rejectImport(
      id,
      userId,
      dto?.reason,
    );

    return {
      success: true,
      data: result,
      message: 'Import rejected.',
    };
  }

  private hasPermission(userPermissions: string[], needed: string): boolean {
    if (userPermissions.includes(needed) || userPermissions.includes('admin:*'))
      return true;

    for (const permission of userPermissions) {
      if (permission.endsWith('*')) {
        const prefix = permission.slice(0, -1);
        if (needed.startsWith(prefix)) return true;
      }
    }

    return false;
  }
}
