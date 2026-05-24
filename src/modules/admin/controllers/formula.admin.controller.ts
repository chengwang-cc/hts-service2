/**
 * Formula Admin Controller
 * REST API endpoints for formula management
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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminPermissionsGuard } from '../guards/admin-permissions.guard';
import { AdminPermissions } from '../decorators/admin-permissions.decorator';
import { FormulaAdminService } from '../services/formula.admin.service';
import {
  ListFormulasDto,
  ListCandidatesDto,
  GenerateFormulasDto,
  ReviewDto,
  BulkApproveDto,
} from '../dto/formula.dto';
import { BadRequestException } from '@nestjs/common';

@ApiTags('Admin - Formulas')
@ApiBearerAuth()
@Controller('admin/formulas')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FormulaAdminController {
  constructor(private readonly formulaService: FormulaAdminService) {}

  /**
   * GET /admin/formulas
   * List all approved formulas with pagination
   */
  @Get()
  @ApiOperation({ summary: 'List all formulas' })
  @ApiResponse({ status: 200, description: 'Formulas retrieved successfully' })
  async findAllFormulas(@Query() query: ListFormulasDto) {
    const result = await this.formulaService.findAllFormulas(query);

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
   * GET /admin/formulas/candidates
   * List pending formula candidates for review
   */
  @Get('candidates')
  @ApiOperation({ summary: 'List formula candidates' })
  @ApiResponse({
    status: 200,
    description: 'Candidates retrieved successfully',
  })
  async getCandidates(@Query() query: ListCandidatesDto) {
    const result = await this.formulaService.getCandidates(query);

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
   * POST /admin/formulas/generate
   * Trigger AI formula generation for HTS entries
   */
  @Post('generate')
  @ApiOperation({ summary: 'Generate formulas' })
  @ApiResponse({ status: 201, description: 'Formula generation job started' })
  async generateFormulas(@Body() dto: GenerateFormulasDto) {
    const result = await this.formulaService.generateFormulas(dto);

    return {
      success: true,
      data: result,
      message: 'Formula generation job started. Check candidates for results.',
    };
  }

  /**
   * POST /admin/formulas/candidates/:id/approve
   * Approve a formula candidate
   */
  @Post('candidates/:id/approve')
  @ApiOperation({ summary: 'Approve formula candidate' })
  @ApiResponse({ status: 200, description: 'Candidate approved successfully' })
  @ApiResponse({ status: 404, description: 'Candidate not found' })
  async approveCandidate(
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @Request() req,
  ) {
    const userId = req.user?.email || 'UNKNOWN';
    await this.formulaService.approveCandidate(id, userId, dto.comment);

    return {
      success: true,
      message: 'Formula candidate approved and applied',
    };
  }

  /**
   * POST /admin/formulas/candidates/:id/reject
   * Reject a formula candidate
   */
  @Post('candidates/:id/reject')
  @ApiOperation({ summary: 'Reject formula candidate' })
  @ApiResponse({ status: 200, description: 'Candidate rejected successfully' })
  @ApiResponse({ status: 404, description: 'Candidate not found' })
  async rejectCandidate(
    @Param('id') id: string,
    @Body() dto: ReviewDto,
    @Request() req,
  ) {
    const userId = req.user?.email || 'UNKNOWN';
    await this.formulaService.rejectCandidate(id, userId, dto.comment);

    return {
      success: true,
      message: 'Formula candidate rejected',
    };
  }

  /**
   * POST /admin/formulas/candidates/bulk-approve
   * Bulk approve candidates above confidence threshold
   */
  @Post('candidates/bulk-approve')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('hts:formula:bulk_approve')
  @ApiOperation({ summary: 'Bulk approve candidates (requires hts:formula:bulk_approve)' })
  @ApiResponse({ status: 200, description: 'Bulk approval completed' })
  @ApiResponse({ status: 403, description: 'Insufficient permission' })
  @ApiResponse({ status: 400, description: 'Comment required or batch too large' })
  async bulkApprove(@Body() dto: BulkApproveDto, @Request() req) {
    // P1.10 — additional defensive checks beyond DTO validation.
    const HARD_CAP = 500;
    const comment = (dto.comment || '').trim();
    if (comment.length < 8) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'BULK_APPROVE_COMMENT_REQUIRED',
        message:
          'A non-empty audit comment (>= 8 characters) is required for bulk approvals',
      });
    }
    const requestedCap = dto.maxBatchSize ?? HARD_CAP;
    if (requestedCap > HARD_CAP) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'BULK_LIMIT_EXCEEDED',
        message: `maxBatchSize cannot exceed ${HARD_CAP}`,
      });
    }

    const userId = req.user?.email || 'UNKNOWN';
    const result = await this.formulaService.bulkApprove(
      dto.minConfidence,
      userId,
      comment,
    );

    return {
      success: true,
      data: result,
      message: `${result.approved} candidates approved successfully`,
    };
  }

  /**
   * GET /admin/formulas/metrics
   * Get formula coverage and quality metrics
   */
  @Get('metrics')
  @ApiOperation({ summary: 'Get formula metrics' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
  async getMetrics() {
    const metrics = await this.formulaService.getMetrics();

    return {
      success: true,
      data: metrics,
    };
  }
}
