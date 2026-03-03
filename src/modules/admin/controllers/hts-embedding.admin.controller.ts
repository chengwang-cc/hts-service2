/**
 * HTS Embedding Admin Controller
 * Endpoints for managing HTS code embeddings for AI semantic search
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Optional,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { HtsEmbeddingGenerationService, EmbeddingService } from '@hts/core';
import { DgxEmbeddingService } from '../../../core/dgx/dgx-embedding.service';

@ApiTags('Admin - HTS Embeddings')
@ApiBearerAuth()
@Controller('admin/hts-embeddings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HtsEmbeddingAdminController {
  constructor(
    private readonly embeddingGenerationService: HtsEmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
    @Optional() private readonly dgxEmbedding: DgxEmbeddingService,
  ) {}

  /**
   * GET /admin/hts-embeddings/statistics
   * Returns counts for both the DGX and OpenAI embedding columns.
   */
  @Get('statistics')
  @ApiOperation({ summary: 'Get HTS embedding statistics for both providers' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getStatistics() {
    const stats = await this.embeddingGenerationService.getStatistics();
    return { success: true, data: stats };
  }

  /**
   * POST /admin/hts-embeddings/generate
   * Generate embeddings using the active SEARCH_EMBEDDING_PROVIDER.
   * Body: { onlyMissing?: boolean }  (default true — skips already-indexed rows)
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate embeddings using the active provider (DGX or OpenAI)' })
  @ApiResponse({ status: 202, description: 'Embedding generation started in background' })
  async generateAllEmbeddings(
    @Request() req,
    @Body() body: { onlyMissing?: boolean } = {},
  ) {
    const userId = req.user?.email || 'UNKNOWN';
    const { provider, column } = this.embeddingService.providerInfo;
    const onlyMissing = body.onlyMissing !== false; // default true
    const model = provider === 'dgx' ? 'bge-m3' : 'text-embedding-3-small';

    this.embeddingGenerationService
      .generateAllEmbeddings(100, model, onlyMissing)
      .then((result) => console.log(`[${userId}] ${provider} embedding generation done:`, result))
      .catch((error) => console.error(`[${userId}] ${provider} embedding generation failed:`, error));

    return {
      success: true,
      message: `${provider.toUpperCase()} embedding generation started in background.`,
      data: { provider, column, onlyMissing, batchSize: 100, model },
    };
  }

  /**
   * POST /admin/hts-embeddings/reindex-openai
   * Populate the `embedding_openai` column (vector(1536)) using OpenAI
   * text-embedding-3-small, regardless of the active SEARCH_EMBEDDING_PROVIDER.
   *
   * Run this to pre-populate the OpenAI column before switching providers,
   * or at any time to fill in missing rows.
   *
   * Body: { onlyMissing?: boolean }  (default true)
   */
  @Post('reindex-openai')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Populate embedding_openai column (1536-dim) using OpenAI text-embedding-3-small',
    description:
      'Runs regardless of SEARCH_EMBEDDING_PROVIDER. Safe to run while DGX is active. ' +
      'onlyMissing=true (default) skips rows that already have an OpenAI embedding.',
  })
  @ApiResponse({ status: 202, description: 'OpenAI reindex started in background' })
  async reindexOpenAi(
    @Request() req,
    @Body() body: { onlyMissing?: boolean } = {},
  ) {
    const userId = req.user?.email || 'UNKNOWN';
    const onlyMissing = body.onlyMissing !== false; // default true

    this.embeddingGenerationService
      .generateOpenAiEmbeddings(100, onlyMissing)
      .then((result) => console.log(`[${userId}] OpenAI reindex done:`, result))
      .catch((error) => console.error(`[${userId}] OpenAI reindex failed:`, error));

    return {
      success: true,
      message: 'OpenAI embedding reindex started in background.',
      data: {
        provider: 'openai',
        column: 'embedding_openai',
        model: 'text-embedding-3-small',
        dimension: 1536,
        onlyMissing,
        batchSize: 100,
      },
    };
  }

  /**
   * POST /admin/hts-embeddings/flush-cache
   * Flush the Redis DGX embedding cache (needed after switching DGX models).
   */
  @Post('flush-cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flush DGX Redis embedding cache' })
  @ApiResponse({ status: 200, description: 'Cache flushed' })
  async flushCache() {
    if (!this.dgxEmbedding?.isEnabled) {
      return { success: true, message: 'DGX embedding disabled — no cache to flush', flushed: 0 };
    }
    const flushed = await this.dgxEmbedding.flushEmbeddingCache();
    return { success: true, message: `Flushed ${flushed} Redis cache entries`, flushed };
  }
}
