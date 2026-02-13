import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import {
  ApiPermissions,
  CurrentApiKey,
} from '../../api-keys/decorators';
import { ApiKeyEntity } from '../../api-keys/entities/api-key.entity';
import { DetectionService } from '../services/detection.service';
import {
  DetectProductDto,
  BulkClassifyDto,
  FeedbackDto,
} from '../dto/detect-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtensionFeedbackEntity } from '../entities/extension-feedback.entity';
import { sanitizeFeedbackText, sanitizeUrl } from '../utils/sanitize.util';

/**
 * Extension API Controller
 * Endpoints for Chrome extension support
 */
@ApiTags('Extension')
@ApiSecurity('api-key')
@Controller('api/v1/extension')
@UseGuards(ApiKeyGuard)
export class ExtensionController {
  constructor(
    private readonly detectionService: DetectionService,
    @InjectRepository(ExtensionFeedbackEntity)
    private readonly feedbackRepository: Repository<ExtensionFeedbackEntity>,
  ) {}

  /**
   * LLM-assisted product detection
   * POST /api/v1/extension/detect
   */
  @Post('detect')
  @ApiOperation({
    summary: 'LLM-assisted product detection',
    description:
      'Use AI to detect products on web pages when heuristic detection fails or has low confidence.',
  })
  @ApiResponse({ status: 200, description: 'Products detected successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async detectProducts(
    @Body() detectDto: DetectProductDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    try {
      const products = await this.detectionService.detectProductWithLLM(
        detectDto,
      );

      return {
        success: true,
        data: {
          products,
          method: 'llm',
          model: 'gpt-4o-mini',
        },
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
          count: products.length,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to detect products',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Bulk product classification
   * POST /api/v1/extension/bulk-classify
   */
  @Post('bulk-classify')
  @ApiOperation({
    summary: 'Bulk classify products',
    description:
      'Classify multiple products at once (useful for shopping carts).',
  })
  @ApiResponse({
    status: 200,
    description: 'Products classified successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async bulkClassify(
    @Body() bulkClassifyDto: BulkClassifyDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    try {
      // Limit to 20 products per request to avoid timeout
      if (bulkClassifyDto.products.length > 20) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Maximum 20 products per request',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const classifications = await this.detectionService.bulkClassifyProducts(
        bulkClassifyDto.products,
        apiKey.organizationId,
      );

      return {
        success: true,
        data: classifications,
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
          count: classifications.length,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to classify products',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Submit user feedback
   * POST /api/v1/extension/feedback
   */
  @Post('feedback')
  @ApiOperation({
    summary: 'Submit user feedback',
    description:
      'Collect user corrections and feedback for ML improvement.',
  })
  @ApiResponse({ status: 201, description: 'Feedback saved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async submitFeedback(
    @Body() feedbackDto: FeedbackDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
    @Query('userId') userId?: string,
  ) {
    try {
      // SECURITY: Sanitize all user-provided text to prevent XSS
      const feedback = this.feedbackRepository.create({
        organizationId: apiKey.organizationId,
        userId: userId || null,
        productId: sanitizeFeedbackText(feedbackDto.productId, 255),
        field: sanitizeFeedbackText(feedbackDto.field, 100),
        originalValue: feedbackDto.originalValue, // JSON value, validated by DTO
        correctedValue: feedbackDto.correctedValue, // JSON value, validated by DTO
        userComment: feedbackDto.userComment ? sanitizeFeedbackText(feedbackDto.userComment, 5000) : null,
        userAgent: feedbackDto.userAgent ? sanitizeFeedbackText(feedbackDto.userAgent, 500) : null,
        pageUrl: feedbackDto.pageUrl ? sanitizeUrl(feedbackDto.pageUrl) : null,
      });

      await this.feedbackRepository.save(feedback);

      return {
        success: true,
        data: {
          id: feedback.id,
          createdAt: feedback.createdAt,
        },
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to save feedback',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
