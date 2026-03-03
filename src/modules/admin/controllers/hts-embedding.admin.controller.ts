/**
 * HTS Embedding Admin Controller
 * Endpoints for managing HTS code embeddings for AI semantic search
 */

import {
  Controller,
  Get,
  Post,
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
import { HtsEmbeddingGenerationService } from '@hts/core';
import { DgxEmbeddingService } from '../../../core/dgx/dgx-embedding.service';

@ApiTags('Admin - HTS Embeddings')
@ApiBearerAuth()
@Controller('admin/hts-embeddings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HtsEmbeddingAdminController {
  constructor(
    private readonly embeddingService: HtsEmbeddingGenerationService,
    @Optional() private readonly dgxEmbedding: DgxEmbeddingService,
  ) {}

  /**
   * GET /admin/hts-embeddings/statistics
   * Get embedding generation statistics
   */
  @Get('statistics')
  @ApiOperation({ summary: 'Get HTS embedding statistics' })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getStatistics() {
    const stats = await this.embeddingService.getStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * POST /admin/hts-embeddings/generate
   * Trigger embedding generation for all HTS codes
   * This is a long-running operation (takes ~5-10 minutes for 30k codes)
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Generate embeddings for all HTS codes' })
  @ApiResponse({
    status: 202,
    description:
      'Embedding generation started. This process runs in the background and may take several minutes.',
  })
  async generateAllEmbeddings(@Request() req) {
    const userId = req.user?.email || 'UNKNOWN';

    // Run in background - don't await
    this.embeddingService
      .generateAllEmbeddings(100, 'bge-m3')
      .then((result) => {
        console.log(`[${userId}] Embedding generation completed:`, result);
      })
      .catch((error) => {
        console.error(`[${userId}] Embedding generation failed:`, error);
      });

    return {
      success: true,
      message:
        'Embedding generation started. This process runs in the background and may take 5-10 minutes to complete.',
      data: {
        estimatedTime: '5-10 minutes',
        batchSize: 100,
        model: 'bge-m3',
      },
    };
  }

  /**
   * POST /admin/hts-embeddings/flush-cache
   * Flush the Redis embedding cache (required after switching DGX models).
   */
  @Post('flush-cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flush Redis embedding cache' })
  @ApiResponse({ status: 200, description: 'Cache flushed' })
  async flushCache() {
    if (!this.dgxEmbedding?.isEnabled) {
      return { success: true, message: 'DGX embedding disabled — no cache to flush', flushed: 0 };
    }
    const flushed = await this.dgxEmbedding.flushEmbeddingCache();
    return { success: true, message: `Flushed ${flushed} Redis cache entries`, flushed };
  }

}
