import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpException,
  HttpStatus,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import {
  ApiPermissions,
  CurrentApiKey,
  SkipJwtAuth,
} from '../../api-keys/decorators';
import { ApiKeyEntity } from '../../api-keys/entities/api-key.entity';
import { DetectionService } from '../services/detection.service';
import {
  DetectProductDto,
  BulkClassifyDto,
  FeedbackDto,
} from '../dto/detect-product.dto';
import { DetectFromImageDto, DetectFromUrlDto } from '../dto/vision.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtensionFeedbackEntity } from '../entities/extension-feedback.entity';
import { VisionAnalysisEntity } from '../entities/vision-analysis.entity';
import { ScrapingMetadataEntity } from '../entities/scraping-metadata.entity';
import { sanitizeFeedbackText, sanitizeUrl } from '../utils/sanitize.util';
import {
  validateImageFile,
  validateImageUrl,
} from '../utils/image-validation.util';
import { VisionService } from '@hts/core';
import { AgentOrchestrationService } from '../services/agent-orchestration.service';
import { VisionRateLimitGuard } from '../guards/vision-rate-limit.guard';
import { VisionMonitoringService } from '../services/vision-monitoring.service';
import * as crypto from 'crypto';

/**
 * Extension API Controller
 * Endpoints for Chrome extension support
 * Uses API Key authentication (@UseGuards(ApiKeyGuard)) instead of JWT
 * Explicitly skips global JWT guard via @SkipJwtAuth() decorator
 */
@SkipJwtAuth()
@ApiTags('Extension')
@ApiSecurity('api-key')
@Controller('api/v1/extension')
@UseGuards(ApiKeyGuard)
export class ExtensionController {
  private readonly logger = new Logger(ExtensionController.name);

  constructor(
    private readonly detectionService: DetectionService,
    private readonly visionService: VisionService,
    private readonly agentOrchestrationService: AgentOrchestrationService,
    private readonly monitoringService: VisionMonitoringService,
    @InjectRepository(ExtensionFeedbackEntity)
    private readonly feedbackRepository: Repository<ExtensionFeedbackEntity>,
    @InjectRepository(VisionAnalysisEntity)
    private readonly visionAnalysisRepository: Repository<VisionAnalysisEntity>,
    @InjectRepository(ScrapingMetadataEntity)
    private readonly scrapingMetadataRepository: Repository<ScrapingMetadataEntity>,
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
      const products =
        await this.detectionService.detectProductWithLLM(detectDto);

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
   * Detect products from uploaded image
   * POST /api/v1/extension/detect-from-image
   */
  @Post('detect-from-image')
  @UseGuards(VisionRateLimitGuard)
  @ApiOperation({
    summary: 'Detect products from uploaded image',
    description:
      'Use GPT-4o vision to identify products in images. Supports PNG, JPG, WebP formats up to 10MB.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 200,
    description: 'Products detected from image successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid image or input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/image\/(png|jpeg|jpg|webp)/)) {
          return cb(
            new BadRequestException(
              'Only image files are allowed (PNG, JPG, WebP)',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  @ApiPermissions('hts:lookup')
  async detectFromImage(
    @UploadedFile() image: Express.Multer.File,
    @Body() dto: DetectFromImageDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const startTime = Date.now();

    try {
      // Validate image file
      if (!image) {
        throw new BadRequestException('Image file is required');
      }

      // Security validation (MIME, size, dimensions)
      const validation = await validateImageFile(image);

      // Check for duplicate analysis (optional optimization)
      const existingAnalysis = await this.visionAnalysisRepository.findOne({
        where: {
          organizationId: apiKey.organizationId,
          imageHash: validation.hash,
        },
        order: { createdAt: 'DESC' },
      });

      // If analyzed within last hour, return cached result
      const ONE_HOUR = 60 * 60 * 1000;
      if (
        existingAnalysis &&
        Date.now() - existingAnalysis.createdAt.getTime() < ONE_HOUR
      ) {
        // Log cached request
        this.monitoringService.logVisionRequest({
          organizationId: apiKey.organizationId,
          imageSize: existingAnalysis.imageSizeBytes,
          processingTime: 0,
          tokensUsed: 0,
          productsFound: existingAnalysis.analysisResult.products.length,
          cached: true,
        });

        return {
          success: true,
          data: {
            products: existingAnalysis.analysisResult.products,
            confidence: existingAnalysis.analysisResult.overallConfidence,
            method: 'vision',
            model: existingAnalysis.modelUsed,
            cached: true,
          },
          meta: {
            apiVersion: 'v1',
            organizationId: apiKey.organizationId,
            imageSize: existingAnalysis.imageSizeBytes,
            processingTimeMs: 0, // Cached
            count: existingAnalysis.analysisResult.products.length,
          },
        };
      }

      // Analyze image with vision service
      const analysis = await this.visionService.analyzeProductImage(
        image.buffer,
        {
          url: dto.sourceUrl,
          title: dto.pageTitle,
        },
      );

      // Save analysis result
      const visionAnalysis = this.visionAnalysisRepository.create({
        organizationId: apiKey.organizationId,
        imageHash: validation.hash,
        sourceUrl: dto.sourceUrl || null,
        analysisResult: {
          products: analysis.products,
          overallConfidence: analysis.overallConfidence,
          modelVersion: analysis.modelVersion,
        },
        modelUsed: 'gpt-4o',
        processingTimeMs: analysis.processingTime,
        imageSizeBytes: validation.sizeBytes,
        imageFormat: validation.format,
        tokensUsed: analysis.tokensUsed || null,
      });

      await this.visionAnalysisRepository.save(visionAnalysis);

      const totalTime = Date.now() - startTime;

      // Log vision request
      this.monitoringService.logVisionRequest({
        organizationId: apiKey.organizationId,
        imageSize: validation.sizeBytes,
        processingTime: totalTime,
        tokensUsed: analysis.tokensUsed || 0,
        productsFound: analysis.products.length,
        cached: false,
      });

      return {
        success: true,
        data: {
          products: analysis.products,
          confidence: analysis.overallConfidence,
          method: 'vision',
          model: 'gpt-4o',
          cached: false,
        },
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
          imageSize: validation.sizeBytes,
          imageDimensions: `${validation.width}x${validation.height}`,
          processingTimeMs: totalTime,
          tokensUsed: analysis.tokensUsed,
          count: analysis.products.length,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to detect products from image',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Detect products from URL with agent orchestration
   * POST /api/v1/extension/detect-from-url
   */
  @Post('detect-from-url')
  @UseGuards(VisionRateLimitGuard)
  @ApiOperation({
    summary: 'Detect products from URL',
    description:
      'Scrape webpage and use AI agent to detect products. Automatically uses Puppeteer for JS-heavy sites. Optionally enables vision analysis.',
  })
  @ApiResponse({
    status: 200,
    description: 'Products detected from URL successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid URL or input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async detectFromUrl(
    @Body() dto: DetectFromUrlDto,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const startTime = Date.now();

    try {
      // Validate and sanitize URL
      const sanitizedUrl = sanitizeUrl(dto.url);
      if (!sanitizedUrl) {
        throw new BadRequestException('Invalid URL');
      }

      // SSRF prevention - validate URL is not internal
      validateImageUrl(sanitizedUrl);

      // Calculate URL hash for caching
      const urlHash = crypto
        .createHash('sha256')
        .update(sanitizedUrl)
        .digest('hex');

      // Check for recent scraping result (optional caching)
      const CACHE_TTL = 60 * 60 * 1000; // 1 hour
      const recentScraping = await this.scrapingMetadataRepository.findOne({
        where: {
          organizationId: apiKey.organizationId,
          urlHash,
        },
        order: { createdAt: 'DESC' },
      });

      // If scraped recently and successful, return cached suggestion
      if (
        recentScraping &&
        Date.now() - recentScraping.createdAt.getTime() < CACHE_TTL &&
        !recentScraping.errorMessage
      ) {
        this.logger.log(`Using cached scraping result for ${sanitizedUrl}`);
        // Note: For simplicity, we're not caching full results, just metadata
        // A production system might cache full product detection results
      }

      // Use agent orchestration for intelligent scraping
      const result = await this.agentOrchestrationService.detectProductFromUrl(
        sanitizedUrl,
        {
          usePuppeteer: dto.usePuppeteer,
          enableVision: dto.enableVision,
          scrapingOptions: dto.scrapingOptions,
        },
      );

      // Save scraping metadata
      const scrapingMetadata = this.scrapingMetadataRepository.create({
        organizationId: apiKey.organizationId,
        url: sanitizedUrl,
        urlHash,
        method: result.method,
        visionUsed: dto.enableVision || false,
        statusCode: 200,
        scrapedData: {
          productsFound: result.products.length,
          textLength: 0, // Not tracked in simplified version
          imagesFound: 0,
        },
        processingTimeMs: result.processingTime,
        errorMessage: null,
      });

      await this.scrapingMetadataRepository.save(scrapingMetadata);

      const totalTime = Date.now() - startTime;

      // Log scraping request
      this.monitoringService.logScrapingRequest({
        organizationId: apiKey.organizationId,
        url: sanitizedUrl,
        method: result.method,
        processingTime: totalTime,
        productsFound: result.products.length,
        visionUsed: dto.enableVision || false,
        success: true,
        toolsUsed: result.toolsUsed,
      });

      return {
        success: true,
        data: {
          products: result.products,
          scrapingMethod: result.method,
          visionUsed: result.visionAnalysis !== null,
          confidence: result.confidence,
          toolsUsed: result.toolsUsed,
        },
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey.organizationId,
          processingTimeMs: totalTime,
          url: sanitizedUrl,
          count: result.products.length,
          agentRunId: result.agentRunId,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Save failed scraping attempt
      const urlHash = crypto.createHash('sha256').update(dto.url).digest('hex');
      const failedMetadata = this.scrapingMetadataRepository.create({
        organizationId: apiKey.organizationId,
        url: dto.url,
        urlHash,
        method: 'http',
        visionUsed: false,
        statusCode: 0,
        scrapedData: null,
        processingTimeMs: Date.now() - startTime,
        errorMessage: error.message,
      });
      await this.scrapingMetadataRepository
        .save(failedMetadata)
        .catch(() => {});

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to detect products from URL',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Validate input to determine type (text/url/image)
   * POST /api/v1/extension/validate-input
   */
  @Post('validate-input')
  @ApiOperation({
    summary: 'Validate input and determine type',
    description:
      "Analyzes user input to determine if it's text, URL, or image data. Returns validation result with suggestions.",
  })
  @ApiResponse({ status: 200, description: 'Input validated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiPermissions('hts:lookup')
  async validateInput(
    @Body() body: { input: string },
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    const input = body.input?.trim() || '';

    // Empty check
    if (input.length === 0) {
      return {
        type: 'invalid',
        confidence: 1.0,
        suggestion: 'Please provide some input to search',
        errors: ['Input is empty'],
      };
    }

    // Too short check
    if (input.length < 3) {
      return {
        type: 'invalid',
        confidence: 0.95,
        suggestion: 'Input too short - please provide more details',
        errors: ['Input must be at least 3 characters'],
      };
    }

    // Check if it's a URL
    try {
      const urlObj = new URL(input);
      if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
        // Validate URL is not blocked (SSRF prevention)
        try {
          validateImageUrl(input);

          // Check if it's an image URL
          const isImageUrl = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(
            input,
          );

          return {
            type: 'url',
            confidence: isImageUrl ? 0.98 : 0.95,
            suggestion: isImageUrl
              ? 'Detected image URL - will fetch and analyze with vision AI'
              : 'Detected webpage URL - will scrape content and detect products',
          };
        } catch (error) {
          // URL blocked by SSRF prevention
          return {
            type: 'invalid',
            confidence: 0.99,
            suggestion: 'This URL cannot be accessed for security reasons',
            errors: [error.message],
          };
        }
      }
    } catch {
      // Not a URL, continue checks
    }

    // Check for base64 image data
    if (input.startsWith('data:image/')) {
      return {
        type: 'image',
        confidence: 0.99,
        suggestion: 'Detected base64 image data - will analyze with vision AI',
      };
    }

    // Check if it looks like a file path (local image reference)
    if (
      /^[a-z]:\\/i.test(input) ||
      input.startsWith('/') ||
      input.startsWith('./')
    ) {
      return {
        type: 'invalid',
        confidence: 0.9,
        suggestion:
          'Local file paths cannot be accessed. Please upload the file or provide a URL.',
        errors: ['Cannot access local file system'],
      };
    }

    // Default to text search
    return {
      type: 'text',
      confidence: 0.8,
      suggestion: 'Will search for products matching this description',
    };
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
    description: 'Collect user corrections and feedback for ML improvement.',
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
        userComment: feedbackDto.userComment
          ? sanitizeFeedbackText(feedbackDto.userComment, 5000)
          : null,
        userAgent: feedbackDto.userAgent
          ? sanitizeFeedbackText(feedbackDto.userAgent, 500)
          : null,
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
