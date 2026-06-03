import {
  Controller,
  Post,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  Get,
  Param,
  Query,
  Req,
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
import { ApiKeyGuard } from '../../../api-keys/guards/api-key.guard';
import { ApiPermissions, CurrentApiKey } from '../../../api-keys/decorators';
import { SkipJwtAuth } from '../../../api-keys/decorators/skip-jwt-auth.decorator';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { PartnerQuotaGuard } from '../../../billing/guards/partner-quota.guard';
import { getPerItemUsd } from '../../../billing/config/per-call-pricing.config';
import { CalculationService } from '@hts/calculator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationHistoryEntity } from '@hts/core';
import { CalculatePublicDto } from '../dto/calculate-public.dto';
import { CalculateBatchPublicDto } from '../dto/calculate-batch-public.dto';
import type { Request } from 'express';

/**
 * Public API v1 - Calculator
 * Versioned public API for duty calculation
 */
@ApiTags('Calculator')
@ApiSecurity('api-key')
@SkipJwtAuth()
@Controller('api/v1/calculator')
@UseGuards(ApiKeyGuard, PartnerQuotaGuard)
export class CalculatorPublicController {
  constructor(
    private readonly calculationService: CalculationService,
    @InjectRepository(CalculationHistoryEntity)
    private readonly calculationHistoryRepository: Repository<CalculationHistoryEntity>,
  ) {}

  /**
   * Calculate duties and taxes
   * POST /api/v1/calculator/calculate
   */
  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate import duties and taxes',
    description:
      'Calculate duties, tariffs, and taxes for an HTS code with declared value, country of origin, and other parameters.',
  })
  @ApiBody({ type: CalculatePublicDto })
  @ApiResponse({ status: 200, description: 'Calculation successful' })
  @ApiResponse({ status: 400, description: 'Invalid input parameters' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:calculate')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async calculate(
    @Body() input: CalculatePublicDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    try {
      const entryDate =
        typeof input.entryDate === 'string' && input.entryDate.trim()
          ? input.entryDate.trim()
          : typeof input.additionalInputs?.entryDate === 'string' &&
              input.additionalInputs.entryDate.trim()
            ? input.additionalInputs.entryDate.trim()
            : undefined;

      const normalizedCountryOfOrigin = input.countryOfOrigin
        .trim()
        .toUpperCase();

      // Override organizationId with API key's organization
      const calculationInput = {
        ...input,
        countryOfOrigin: normalizedCountryOfOrigin,
        entryDate,
        organizationId: apiKey.organizationId,
      };

      const result = await this.calculationService.calculate(calculationInput);

      return {
        success: true,
        data: result,
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
          countryOfOrigin: normalizedCountryOfOrigin,
        },
      };
    } catch (error) {
      const mapped = this.mapCalculationError(error);

      throw new HttpException(
        {
          statusCode: mapped.status,
          message: mapped.message,
          error: mapped.error,
        },
        mapped.status,
      );
    }
  }

  /**
   * Batch calculate duties for many cart items at once. Returns one entry
   * per input item in input order; per-item failures are surfaced inline
   * with `{ ok: false, error }` so a single bad SKU doesn't break the cart.
   *
   * Concurrency is capped at 5 in-flight so a 50-item batch can't hog the
   * rate retrieval service.
   *
   * POST /api/v1/calculator/calculate/batch
   */
  @Post('calculate/batch')
  @ApiOperation({
    summary: 'Batch calculate duties for many items',
    description:
      'Calculate duties for up to 50 items in one round-trip. Designed for e-commerce checkout. Per-item failures are reported in-line; overall response is 200 unless DTO validation fails.',
  })
  @ApiBody({ type: CalculateBatchPublicDto })
  @ApiResponse({ status: 200, description: 'Batch calculation results' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 402, description: 'Monthly quota exceeded' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:calculate')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )
  async calculateBatch(
    @Body() input: CalculateBatchPublicDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Req() req: Request,
  ) {
    const persistHistory = input.persistHistory === true;

    // Charge per item — usage attribution is one HTTP call, but the cost
    // accumulates by line item so the partner can't get a discount by
    // bundling.
    if (req.attribution) {
      req.attribution.extras.costUsd =
        getPerItemUsd('POST', '/api/v1/calculator/calculate/batch') * input.items.length;
    }

    const results = await runWithConcurrency(input.items, 5, async (item) => {
      try {
        const calculationInput = {
          ...item,
          countryOfOrigin: (item.countryOfOrigin ?? '').trim().toUpperCase(),
          entryDate:
            typeof item.entryDate === 'string' && item.entryDate.trim()
              ? item.entryDate.trim()
              : undefined,
          organizationId: apiKey.organizationId,
          // Honored by CalculationService.calculate — when false, skip the
          // calculation_history row. Default off for batch to avoid
          // write-amplification at checkout volume.
          persistHistory,
        };
        const result = await this.calculationService.calculate(calculationInput);
        return { ok: true as const, htsNumber: item.htsNumber, result };
      } catch (err) {
        const mapped = this.mapCalculationError(err);
        return {
          ok: false as const,
          htsNumber: item.htsNumber,
          error: { status: mapped.status, message: mapped.message, code: mapped.error },
        };
      }
    });

    const successes = results.filter((r) => r.ok).length;

    return {
      success: true,
      data: results,
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey.organizationId,
        count: input.items.length,
        successes,
        failures: results.length - successes,
        persistHistory,
      },
    };
  }

  private mapCalculationError(error: any): {
    status: HttpStatus;
    message: string;
    error: string;
  } {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const response = error.getResponse() as any;
      return {
        status,
        message: response?.message || error.message || 'Request failed',
        error: response?.error || error.name || 'HttpException',
      };
    }

    const message = String(error?.message || '');
    if (/HTS code .+ not found/i.test(message)) {
      const mapped = new NotFoundException(message);
      return {
        status: mapped.getStatus(),
        message,
        error: mapped.name,
      };
    }

    if (/No formula available for HTS/i.test(message)) {
      const mapped = new UnprocessableEntityException(message);
      return {
        status: mapped.getStatus(),
        message,
        error: mapped.name,
      };
    }

    if (/Formula evaluation error/i.test(message)) {
      const mapped = new BadRequestException(message);
      return {
        status: mapped.getStatus(),
        message,
        error: mapped.name,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Failed to calculate duties',
      error: message || 'Internal Server Error',
    };
  }

  /**
   * Get calculation by ID
   * GET /api/v1/calculator/calculations/:id
   */
  @Get('calculations/:id')
  @ApiOperation({
    summary: 'Get calculation by ID',
    description: 'Retrieve a specific calculation result by its ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Calculation ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Calculation found' })
  @ApiResponse({ status: 404, description: 'Calculation not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:calculate')
  async getCalculation(
    @Param('id') calculationId: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    try {
      const calculation = await this.calculationHistoryRepository.findOne({
        where: {
          calculationId,
          organizationId: apiKey.organizationId,
        },
      });

      if (!calculation) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Calculation ${calculationId} not found`,
            error: 'Not Found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: calculation,
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to retrieve calculation',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * List recent calculations
   * GET /api/v1/calculator/calculations?limit=10
   */
  @Get('calculations')
  @ApiOperation({
    summary: 'List recent calculations',
    description:
      'Retrieve a list of recent calculations for your organization. Results are sorted by creation date (newest first).',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of results (1-100, default: 10)',
    example: 10,
  })
  @ApiResponse({ status: 200, description: 'List of calculations' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:calculate')
  async listCalculations(
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('limit') limitStr?: string,
  ) {
    try {
      const limit = limitStr ? parseInt(limitStr, 10) : 10;
      const maxResults = Math.min(Math.max(1, limit), 100); // Bounds: 1-100

      const calculations = await this.calculationHistoryRepository.find({
        where: {
          organizationId: apiKey.organizationId,
        },
        order: {
          createdAt: 'DESC',
        },
        take: maxResults,
      });

      return {
        success: true,
        data: calculations,
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
          count: calculations.length,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to list calculations',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

/**
 * Run `worker` against each item with a max of `limit` in flight. Preserves
 * input order in the output. Used by the batch calculate endpoint to avoid
 * a 50-item burst hammering the rate retrieval service.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
