import {
  Controller,
  Get,
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
  ApiQuery,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { ApiKeyGuard } from '../../../api-keys/guards/api-key.guard';
import {
  ApiPermissions,
  CurrentApiKey,
} from '../../../api-keys/decorators';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { HtsEntity } from '@hts/core';
import { SearchService } from '@hts/lookup';

/**
 * Public API v1 - HTS Lookup
 * Versioned public API for HTS code lookup
 */
@ApiTags('HTS Lookup')
@ApiSecurity('api-key')
@Controller('api/v1/hts')
@UseGuards(ApiKeyGuard)
export class HtsPublicController {
  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly searchService: SearchService,
  ) {}

  /**
   * Look up HTS code details
   * GET /api/v1/hts/lookup?code=0101.21.0000
   */
  @Get('lookup')
  @ApiOperation({
    summary: 'Look up HTS code details',
    description: 'Retrieve complete details for a specific HTS code including description, rates, notes, and units.',
  })
  @ApiQuery({
    name: 'code',
    description: 'HTS code (10-digit format)',
    example: '0101.21.0000',
  })
  @ApiResponse({ status: 200, description: 'HTS code found' })
  @ApiResponse({ status: 400, description: 'HTS code is required' })
  @ApiResponse({ status: 404, description: 'HTS code not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async lookup(
    @Query('code') code: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    if (!code) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'HTS code is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.htsRepository.findOne({
        where: { htsNumber: code, isActive: true },
      });

      if (!result) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `HTS code ${code} not found`,
            error: 'Not Found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: result,
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
          message: 'Failed to lookup HTS code',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Search HTS codes
   * GET /api/v1/hts/search?q=live+horses&limit=10
   */
  @Get('search')
  @ApiOperation({
    summary: 'Search HTS codes',
    description: 'Search for HTS codes using semantic search. Supports natural language queries and product descriptions.',
  })
  @ApiQuery({
    name: 'q',
    description: 'Search query (natural language or keywords)',
    example: 'live horses',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of results (default: 10)',
    example: 10,
  })
  @ApiResponse({ status: 200, description: 'Search results' })
  @ApiResponse({ status: 400, description: 'Search query is required' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async search(
    @Query('q') query: string,
    @Query('limit') limit?: string,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    if (!query) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Search query is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const parsedLimit = limit ? parseInt(limit, 10) : 10;
      const maxResults = Number.isFinite(parsedLimit)
        ? Math.min(Math.max(parsedLimit, 1), 100)
        : 10;
      const results = await this.searchService.hybridSearch(query, maxResults);

      return {
        success: true,
        data: results,
        meta: {
          apiVersion: 'v1',
          query,
          limit: maxResults,
          count: results.length,
          organizationId: apiKey?.organizationId,
        },
      };
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to search HTS codes',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Autocomplete HTS codes
   * GET /api/v1/hts/autocomplete?q=0101&limit=10
   */
  @Get('autocomplete')
  @ApiOperation({
    summary: 'Autocomplete HTS codes',
    description:
      'Fast prefix/keyword autocomplete optimized for real-time UI search.',
  })
  @ApiQuery({
    name: 'q',
    description: 'Autocomplete query',
    example: '0101',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of results (default: 10, max: 20)',
    example: 10,
  })
  @ApiResponse({ status: 200, description: 'Autocomplete results' })
  @ApiResponse({ status: 400, description: 'Query is required' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiPermissions('hts:lookup')
  async autocomplete(
    @Query('q') query: string,
    @Query('limit') limit?: string,
    @CurrentApiKey() apiKey?: ApiKeyEntity,
  ) {
    if (!query || query.trim().length < 2) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Query must be at least 2 characters',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 10;
    const maxResults = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 20)
      : 10;
    const results = await this.searchService.autocomplete(query, maxResults);

    return {
      success: true,
      data: results,
      meta: {
        apiVersion: 'v1',
        query,
        limit: maxResults,
        count: results.length,
        organizationId: apiKey?.organizationId,
      },
    };
  }

  /**
   * Get HTS hierarchy (parent and children)
   * GET /api/v1/hts/hierarchy?code=0101.21.0000
   */
  @Get('hierarchy')
  @ApiOperation({
    summary: 'Get HTS code hierarchy',
    description: 'Retrieve the hierarchical structure for an HTS code including parent and children codes.',
  })
  @ApiQuery({
    name: 'code',
    description: 'HTS code',
    example: '0101.21.0000',
  })
  @ApiResponse({ status: 200, description: 'Hierarchy retrieved' })
  @ApiResponse({ status: 400, description: 'HTS code is required' })
  @ApiResponse({ status: 404, description: 'HTS code not found' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiPermissions('hts:lookup')
  async hierarchy(
    @Query('code') code: string,
    @CurrentApiKey() apiKey: ApiKeyEntity,
  ) {
    if (!code) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'HTS code is required',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Get current entry
      const current = await this.htsRepository.findOne({
        where: { htsNumber: code, isActive: true },
      });

      if (!current) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `HTS code ${code} not found`,
            error: 'Not Found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      // Get parent
      const parent = current.parentHtsNumber
        ? await this.htsRepository.findOne({
            where: { htsNumber: current.parentHtsNumber, isActive: true },
          })
        : null;

      // Get children
      const children = await this.htsRepository.find({
        where: { parentHtsNumber: code, isActive: true },
        order: { htsNumber: 'ASC' },
      });

      return {
        success: true,
        data: {
          current,
          parent,
          children,
        },
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
          message: 'Failed to get HTS hierarchy',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
