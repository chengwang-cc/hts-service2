/**
 * HTS Embedding Admin Controller
 * Endpoints for managing HTS code embeddings for AI semantic search
 */

import {
  Controller,
  Get,
  Post,
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

@ApiTags('Admin - HTS Embeddings')
@ApiBearerAuth()
@Controller('admin/hts-embeddings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class HtsEmbeddingAdminController {
  constructor(
    private readonly embeddingService: HtsEmbeddingGenerationService,
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
      .generateAllEmbeddings(100, 'text-embedding-3-small')
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
        model: 'text-embedding-3-small',
      },
    };
  }

}
