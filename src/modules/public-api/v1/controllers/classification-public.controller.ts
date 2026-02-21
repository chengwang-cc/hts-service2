import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiBody,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../../../api-keys/guards/api-key.guard';
import { ApiPermissions, CurrentApiKey } from '../../../api-keys/decorators';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { ClassificationService } from '@hts/lookup';
import { SearchService } from '@hts/lookup';

/**
 * Public API v1 - Product Classification
 * HTS product classification with AI
 */
@ApiTags('Classification')
@ApiSecurity('api-key')
@Controller('api/v1/classifications')
@UseGuards(ApiKeyGuard)
export class ClassificationPublicController {
  constructor(
    private readonly classificationService: ClassificationService,
    private readonly searchService: SearchService,
  ) {}

  /**
   * Create new classification
   * POST /api/v1/classifications
   */
  @Post()
  @ApiOperation({
    summary: 'Classify a product',
    description:
      'Get AI-powered HTS code classification for a product based on description, images, or enhanced details.',
  })
  @ApiBody({
    description: 'Product information for classification',
    schema: {
      type: 'object',
      required: ['productDescription'],
      properties: {
        productDescription: {
          type: 'string',
          description: 'Detailed product description',
          example: 'Cotton t-shirts with printed graphics',
        },
        productName: {
          type: 'string',
          description: 'Product name',
          example: 'Graphic Cotton T-Shirt',
        },
        countryOfOrigin: {
          type: 'string',
          description: 'Country where product is manufactured',
          example: 'China',
        },
        imageUrl: {
          type: 'string',
          description: 'URL of product image',
          example: 'https://example.com/product.jpg',
        },
        materialComposition: {
          type: 'string',
          description: 'Material composition (enhanced mode)',
          example: '100% cotton',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Classification created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:search')
  async createClassification(
    @Body('productDescription') productDescription: string,
    @Body('productName') productName?: string,
    @Body('countryOfOrigin') countryOfOrigin?: string,
    @Body('imageUrl') imageUrl?: string,
    @Body('materialComposition') materialComposition?: string,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    if (!productDescription) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Product description is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Build enhanced description if additional details provided
      let fullDescription = productDescription;
      if (materialComposition) {
        fullDescription += ` | Material: ${materialComposition}`;
      }
      if (countryOfOrigin) {
        fullDescription += ` | Origin: ${countryOfOrigin}`;
      }

      // Use classification service for AI-powered classification
      const result = await this.classificationService.classifyProduct(
        fullDescription,
        apiKey?.organizationId || 'public',
      );

      // Get multiple suggestions using search
      const suggestions = await this.searchService.hybridSearch(
        fullDescription,
        5,
      );

      return {
        success: true,
        data: {
          id: `cls_${Date.now()}`,
          productName: productName || 'Unnamed Product',
          productDescription,
          countryOfOrigin,
          status: 'pending_confirmation',
          suggestions: suggestions.map((s: any) => ({
            htsCode: s.htsNumber,
            description: s.description,
            confidence: s.score || 0.7,
            reasoning: s.reasoning || 'Based on product description match',
          })),
          primarySuggestion: {
            htsCode: result.htsCode || suggestions[0]?.htsNumber,
            confidence: result.confidence || suggestions[0]?.score || 0.7,
            reasoning:
              result.reasoning ||
              'AI-powered classification based on product description',
          },
          createdAt: new Date().toISOString(),
        },
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey?.organizationId,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to classify product',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get classification by ID
   * GET /api/v1/classifications/:id
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get classification details',
    description: 'Retrieve details of a specific classification by ID.',
  })
  @ApiResponse({ status: 200, description: 'Classification found' })
  @ApiResponse({ status: 404, description: 'Classification not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiPermissions('hts:search')
  async getClassification(
    @Param('id') id: string,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    // For now, return a mock response
    // In production, this would fetch from a classification history table
    return {
      success: true,
      data: {
        id,
        status: 'confirmed',
        productName: 'Sample Product',
        productDescription: 'Sample description',
        confirmedHtsCode: '6109.10.0012',
        createdAt: new Date().toISOString(),
      },
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey?.organizationId,
      },
    };
  }

  /**
   * Confirm HTS code selection
   * PATCH /api/v1/classifications/:id/confirm
   */
  @Patch(':id/confirm')
  @ApiOperation({
    summary: 'Confirm HTS code',
    description: 'Confirm the selected HTS code for a classification.',
  })
  @ApiBody({
    description: 'Confirmation data',
    schema: {
      type: 'object',
      required: ['htsCode'],
      properties: {
        htsCode: {
          type: 'string',
          description: 'Confirmed HTS code',
          example: '6109.10.0012',
        },
        notes: {
          type: 'string',
          description: 'Optional notes',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Classification confirmed' })
  @ApiResponse({ status: 404, description: 'Classification not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiPermissions('hts:search')
  async confirmClassification(
    @Param('id') id: string,
    @Body('htsCode') htsCode: string,
    @Body('notes') notes?: string,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    if (!htsCode) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'HTS code is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      success: true,
      data: {
        id,
        status: 'confirmed',
        confirmedHtsCode: htsCode,
        notes,
        confirmedAt: new Date().toISOString(),
      },
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey?.organizationId,
      },
    };
  }

  /**
   * Get classification history
   * GET /api/v1/classifications
   */
  @Get()
  @ApiOperation({
    summary: 'Get classification history',
    description: 'Retrieve classification history for the organization.',
  })
  @ApiResponse({ status: 200, description: 'Classifications retrieved' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiPermissions('hts:search')
  async getClassifications(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    const maxLimit = Math.min(limit || 10, 100);
    const skip = offset || 0;

    // For now, return empty array
    // In production, this would fetch from classification history
    return {
      success: true,
      data: [],
      meta: {
        apiVersion: 'v1',
        organizationId: apiKey?.organizationId,
        limit: maxLimit,
        offset: skip,
        total: 0,
      },
    };
  }
}
