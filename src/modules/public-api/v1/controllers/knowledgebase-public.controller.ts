import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
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
import {
  ApiPermissions,
  CurrentApiKey,
} from '../../../api-keys/decorators';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { SearchService } from '@hts/lookup';
import { DocumentService } from '@hts/knowledgebase';

/**
 * Public API v1 - Knowledgebase
 * Versioned public API for AI-powered HTS queries
 */
@ApiTags('Knowledgebase')
@ApiSecurity('api-key')
@Controller('api/v1/knowledgebase')
@UseGuards(ApiKeyGuard)
export class KnowledgebasePublicController {
  constructor(
    private readonly searchService: SearchService,
    private readonly documentService: DocumentService,
  ) {}

  /**
   * Query the knowledgebase
   * POST /api/v1/knowledgebase/query
   */
  @Post('query')
  @ApiOperation({
    summary: 'Query the HTS knowledgebase',
    description: 'Ask questions about HTS codes, tariffs, and trade regulations using natural language.',
  })
  @ApiBody({
    description: 'Query parameters',
    schema: {
      type: 'object',
      required: ['question'],
      properties: {
        question: {
          type: 'string',
          description: 'Natural language question',
          example: 'What is the duty rate for importing cotton t-shirts from China?',
        },
        context: {
          type: 'object',
          description: 'Additional context for the query',
          example: { countryOfOrigin: 'CN' },
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Query results' })
  @ApiResponse({ status: 400, description: 'Question is required' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @HttpCode(HttpStatus.OK)
  @ApiPermissions('kb:query')
  async query(
    @Body('question') question: string,
    @Body('context') context?: any,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    if (!question) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Question is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Use search service for semantic search
      const results = await this.searchService.hybridSearch(question, 5);

      return {
        success: true,
        data: { question, results },
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey?.organizationId,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to query knowledgebase',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get recommended HTS codes for a product description
   * POST /api/v1/knowledgebase/recommend
   */
  @Post('recommend')
  @ApiOperation({
    summary: 'Get HTS code recommendations',
    description: 'Get AI-powered HTS code recommendations for a product description.',
  })
  @ApiBody({
    description: 'Product description and options',
    schema: {
      type: 'object',
      required: ['productDescription'],
      properties: {
        productDescription: {
          type: 'string',
          description: 'Detailed product description',
          example: 'Cotton t-shirts with printed graphics, crew neck, short sleeves',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of recommendations (default: 5)',
          example: 5,
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Recommendations generated' })
  @ApiResponse({ status: 400, description: 'Product description is required' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @HttpCode(HttpStatus.OK)
  @ApiPermissions('kb:query')
  async recommend(
    @Body('productDescription') productDescription: string,
    @Body('limit') limit?: number,
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
      const maxResults = limit || 5;
      const recommendations = await this.searchService.hybridSearch(
        productDescription,
        maxResults,
      );

      return {
        success: true,
        data: recommendations,
        meta: {
          apiVersion: 'v1',
          organizationId: apiKey?.organizationId,
          limit: maxResults,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to get recommendations',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
