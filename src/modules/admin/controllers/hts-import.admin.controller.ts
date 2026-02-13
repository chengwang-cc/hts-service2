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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/services/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { HtsImportService } from '../services/hts-import.service';
import { TriggerImportDto, ListImportsDto, LogsPaginationDto } from '../dto/hts-import.dto';

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
  @ApiResponse({ status: 200, description: 'Import history list retrieved successfully' })
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
  @ApiResponse({ status: 200, description: 'Import details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async findOne(@Param('id') id: string) {
    const importHistory = await this.htsImportService.findOne(id);

    // Calculate progress percentage
    const totalProcessed =
      importHistory.importedEntries +
      importHistory.updatedEntries +
      importHistory.skippedEntries +
      importHistory.failedEntries;

    const progress = importHistory.totalEntries > 0
      ? {
          total: importHistory.totalEntries,
          processed: totalProcessed,
          percentage: Math.round((totalProcessed / importHistory.totalEntries) * 100),
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
    const logs = await this.htsImportService.getLogs(id, query.offset, query.limit);

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
  @ApiResponse({ status: 200, description: 'Failed entries retrieved successfully' })
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
}
