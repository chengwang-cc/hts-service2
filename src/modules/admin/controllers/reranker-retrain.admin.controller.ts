/**
 * Reranker Retrain Admin Controller
 * REST API endpoints for monitoring and triggering reranker retraining
 */

import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { QueueService } from '../../queue/queue.service';
import { RerankerTrainingRunEntity } from '../entities/reranker-training-run.entity';

class ListRetrainRunsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number = 20;
}

@ApiTags('Admin - Reranker Retraining')
@ApiBearerAuth()
@Controller('admin/reranker-retrain')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RerankerRetrainAdminController {
  constructor(
    @InjectRepository(RerankerTrainingRunEntity)
    private readonly runRepo: Repository<RerankerTrainingRunEntity>,
    private readonly queueService: QueueService,
  ) {}

  /**
   * GET /admin/reranker-retrain
   * List all reranker training runs with pagination
   */
  @Get()
  @ApiOperation({ summary: 'List reranker training runs' })
  @ApiResponse({ status: 200, description: 'Training runs retrieved successfully' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async findAll(@Query() query: ListRetrainRunsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [data, total] = await this.runRepo.findAndCount({
      order: { startedAt: 'DESC' },
      skip,
      take: pageSize,
    });

    return {
      success: true,
      data,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * POST /admin/reranker-retrain/trigger
   * Manually trigger a reranker retrain job
   */
  @Post('trigger')
  @ApiOperation({ summary: 'Manually trigger a reranker retrain job' })
  @ApiResponse({ status: 201, description: 'Retrain job enqueued successfully' })
  async trigger(@Request() req) {
    const triggeredBy = `manual:${req.user?.email ?? 'admin'}`;
    const jobId = await this.queueService.sendJob('reranker-retrain', {
      triggeredBy,
    });

    return {
      success: true,
      data: { jobId },
      message: 'Retrain job enqueued. Check training runs list for progress.',
    };
  }
}
