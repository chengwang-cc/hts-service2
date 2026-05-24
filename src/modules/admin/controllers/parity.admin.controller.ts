/**
 * Parity Admin Controller — /admin/parity/*
 *
 * Reviewers use this to start parity sweeps comparing ai-service vs
 * hts-service, browse mismatch rows, see AI verdicts, and triage.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
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
import { ParityAdminService } from '../services/parity.admin.service';
import {
  ReviewParityRowDto,
  StartParityRunDto,
} from '../dto/parity.dto';

@ApiTags('Admin - Parity Comparison')
@ApiBearerAuth()
@Controller('admin/parity')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ParityAdminController {
  constructor(private readonly parity: ParityAdminService) {}

  // ── Runs ───────────────────────────────────────────────────────────

  @Post('runs')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.write')
  @ApiOperation({ summary: 'Start a new parity comparison run' })
  @ApiResponse({ status: 201, description: 'Run queued' })
  async startRun(@Body() dto: StartParityRunDto, @Request() req) {
    const initiatedBy = req.user?.email || 'UNKNOWN';
    return this.parity.startRun({ dto, initiatedBy });
  }

  @Get('runs')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.read')
  @ApiOperation({ summary: 'List parity runs' })
  async listRuns(@Query('limit') limit?: string) {
    return this.parity.listRuns(Number(limit) || 50);
  }

  @Get('runs/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.read')
  async getRun(@Param('id') id: string) {
    return this.parity.getRun(id);
  }

  @Get('runs/:id/summary')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.read')
  @ApiOperation({
    summary: 'Aggregated mismatch summary (by reason / chapter / country / verdict)',
  })
  async getRunSummary(@Param('id') id: string) {
    return this.parity.summary(id);
  }

  @Delete('runs/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.write')
  async cancelRun(@Param('id') id: string, @Body() body?: { reason?: string }) {
    return this.parity.cancelRun(id, body?.reason);
  }

  // ── Rows ───────────────────────────────────────────────────────────

  @Get('runs/:id/rows')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.read')
  @ApiOperation({ summary: 'List rows for a run with filters' })
  async listRows(
    @Param('id') runId: string,
    @Query('matched') matched?: 'true' | 'false',
    @Query('mismatchReason') mismatchReason?: string,
    @Query('chapter') chapter?: string,
    @Query('country') country?: string,
    @Query('reviewStatus') reviewStatus?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.parity.listRows(runId, {
      matched,
      mismatchReason,
      chapter,
      country,
      reviewStatus,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('rows/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.read')
  async getRow(@Param('id') id: string) {
    return this.parity.getRow(id);
  }

  @Post('rows/:id/review')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.review')
  async reviewRow(
    @Param('id') id: string,
    @Body() dto: ReviewParityRowDto,
    @Request() req,
  ) {
    const reviewedBy = req.user?.email || 'UNKNOWN';
    return this.parity.reviewRow(id, dto, reviewedBy);
  }

  @Post('rows/:id/revalidate')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('admin.parity.write')
  @ApiOperation({ summary: 'Re-queue the AI validation job for this row' })
  async revalidateRow(@Param('id') id: string) {
    return this.parity.revalidateRow(id);
  }
}
