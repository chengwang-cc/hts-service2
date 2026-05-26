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

@ApiTags('Admin - HTS Embeddings')
@ApiBearerAuth()
@Controller('admin/hts-embeddings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HtsEmbeddingAdminController {
  constructor(
    private readonly embeddingGenerationService: HtsEmbeddingGenerationService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * GET /admin/hts-embeddings/statistics
   * Returns row counts for the OpenAI embedding column.
   * (DGX embedding column dropped 2026-05-27; column still exists on the
   * table but is dead data until a follow-up migration removes it.)
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
   * Generate embeddings via OpenAI text-embedding-3-small (1536-dim).
   * Body: { onlyMissing?: boolean }  (default true — skips already-indexed rows)
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate HTS embeddings via OpenAI text-embedding-3-small' })
  @ApiResponse({ status: 202, description: 'Embedding generation started in background' })
  async generateAllEmbeddings(
    @Request() req,
    @Body() body: { onlyMissing?: boolean } = {},
  ) {
    const userId = req.user?.email || 'UNKNOWN';
    const { provider, column } = this.embeddingService.providerInfo;
    const onlyMissing = body.onlyMissing !== false; // default true
    const model = 'text-embedding-3-small';

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
   * Deprecated — DGX cache was retired 2026-05-27 (replaced by OpenAI +
   * shared Redis cache key `hts:emb:oai:*`). Kept as a no-op so existing
   * runbooks don't 404.
   */
  @Post('flush-cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'No-op (DGX cache retired)' })
  @ApiResponse({ status: 200, description: 'No-op response' })
  async flushCache() {
    return {
      success: true,
      message:
        'DGX embedding cache was retired 2026-05-27. ' +
        'OpenAI embedding cache uses Redis key prefix "hts:emb:oai:*" — ' +
        'flush via redis-cli DEL if needed.',
      flushed: 0,
    };
  }
}
