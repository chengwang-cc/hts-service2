import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  Get,
  Param,
  Query,
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
import {
  ApiPermissions,
  CurrentApiKey,
} from '../../../api-keys/decorators';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { CalculationService } from '@hts/calculator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationHistoryEntity } from '@hts/core';
import { CalculatePublicDto } from '../dto/calculate-public.dto';

/**
 * Public API v1 - Calculator
 * Versioned public API for duty calculation
 */
@ApiTags('Calculator')
@ApiSecurity('api-key')
@Controller('api/v1/calculator')
@UseGuards(ApiKeyGuard)
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

      // Override organizationId with API key's organization
      const calculationInput = {
        ...input,
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
