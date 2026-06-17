import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiBody,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard } from '../../../api-keys/guards/api-key.guard';
import { ApiPermissions, CurrentApiKey, SkipJwtAuth } from '../../../api-keys/decorators';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { PartnerQuotaGuard } from '../../../billing/guards/partner-quota.guard';
import { getPerItemUsd } from '../../../billing/config/per-call-pricing.config';
import { BatchJobService } from '../../../batch/services/batch-job.service';
import { BatchAsyncDto } from '../dto/batch-async.dto';

/**
 * Public API v1 — Async batch classification.
 *
 * Unlike POST /api/v1/hts/lookup/batch (synchronous, exact-code lookup) and
 * POST /api/v1/calculator/calculate/batch (synchronous, ≤50 items), this
 * endpoint accepts a JSON payload of free-text product descriptions, enqueues
 * a pg-boss-backed background job, and returns immediately with a job id. The
 * caller polls the status/items endpoints to collect results. This is the
 * right surface for large workloads (up to 500 items) where running the full
 * classifier inline would blow the request timeout.
 *
 * @SkipJwtAuth bypasses the global JwtAuthGuard so the X-API-Key path isn't
 * blocked first — same pattern as the other public v1 controllers.
 */
@ApiTags('Batch')
@ApiSecurity('api-key')
@SkipJwtAuth()
@Controller('api/v1/hts/batch')
@UseGuards(ApiKeyGuard, PartnerQuotaGuard)
export class BatchPublicController {
  constructor(private readonly batchJobService: BatchJobService) {}

  /**
   * Submit an async batch classification job.
   * POST /api/v1/hts/batch
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit an async batch classification job',
    description:
      'Enqueue a background job to classify up to 500 product descriptions. Returns 202 immediately with a job id; poll GET /api/v1/hts/batch/:jobId for status and GET /api/v1/hts/batch/:jobId/items for results. Only one active job per organization at a time (409 otherwise).',
  })
  @ApiBody({ type: BatchAsyncDto })
  @ApiResponse({ status: 202, description: 'Job accepted and queued' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 402, description: 'Monthly quota exceeded' })
  @ApiResponse({ status: 409, description: 'Organization already has an active batch job' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async submit(
    @Body() input: BatchAsyncDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Req() req: Request,
  ) {
    const owner = this.batchJobService.resolveApiKeyOwner(apiKey.organizationId);

    // Charge per item up front. autocomplete is a free DB read; deep_search is
    // embedding-backed, so only deep_search accrues per-item cost — matching
    // the synchronous search/autocomplete split in the price book.
    if (req.attribution) {
      const perItem =
        input.method === 'deep_search'
          ? getPerItemUsd('POST', '/api/v1/hts/batch')
          : 0;
      req.attribution.extras.costUsd = perItem * input.items.length;
    }

    const { job } = await this.batchJobService.createJob(
      owner,
      input.method,
      input.items,
      'api',
      undefined,
      input.metadata,
    );

    return {
      success: true,
      data: job,
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey.organizationId,
        totalItems: job.totalItems,
      },
    };
  }

  /**
   * Poll job status.
   * GET /api/v1/hts/batch/:jobId
   */
  @Get(':jobId')
  @ApiOperation({
    summary: 'Get async batch job status',
    description:
      'Retrieve job status and progress counters. Poll until `status` is `completed`, `failed`, or `cancelled`.',
  })
  @ApiParam({ name: 'jobId', description: 'Batch job id returned from submit' })
  @ApiResponse({ status: 200, description: 'Job status' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiPermissions('hts:lookup')
  async status(
    @Param('jobId') jobId: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const owner = this.batchJobService.resolveApiKeyOwner(apiKey.organizationId);
    const job = await this.batchJobService.getJob(jobId, owner.ownerKey);
    return {
      success: true,
      data: job,
      meta: { apiVersion: 'v1', organizationId: apiKey.organizationId },
    };
  }

  /**
   * Fetch paginated results.
   * GET /api/v1/hts/batch/:jobId/items?page=1&limit=100
   */
  @Get(':jobId/items')
  @ApiOperation({
    summary: 'Get async batch job results',
    description:
      'Retrieve per-item classification results in input order. Paginated; each row carries the original `referenceId` (when supplied) for joining back to your records.',
  })
  @ApiParam({ name: 'jobId', description: 'Batch job id returned from submit' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (1–200, default: 100)', example: 100 })
  @ApiResponse({ status: 200, description: 'Job results page' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiPermissions('hts:lookup')
  async items(
    @Param('jobId') jobId: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const owner = this.batchJobService.resolveApiKeyOwner(apiKey.organizationId);
    const { items, total } = await this.batchJobService.getJobItems(
      jobId,
      owner.ownerKey,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 100,
    );
    return {
      success: true,
      data: items,
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey.organizationId,
        total,
        count: items.length,
      },
    };
  }
}
