/**
 * Knowledge Admin Controller
 * REST API endpoints for knowledge document management
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/services/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { KnowledgeAdminService } from '../services/knowledge.admin.service';
import { UploadDocumentDto, ListDocumentsDto } from '../dto/knowledge.dto';

@ApiTags('Admin - Knowledge Library')
@ApiBearerAuth()
@Controller('admin/knowledge')
@UseGuards(JwtAuthGuard, AdminGuard)
export class KnowledgeAdminController {
  constructor(private readonly knowledgeService: KnowledgeAdminService) {}

  /**
   * GET /admin/knowledge/documents
   * List all documents with filters
   */
  @Get('documents')
  @ApiOperation({ summary: 'List knowledge documents' })
  @ApiResponse({ status: 200, description: 'Documents retrieved successfully' })
  async getDocuments(@Query() query: ListDocumentsDto) {
    const result = await this.knowledgeService.findAll(query);

    return {
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  /**
   * GET /admin/knowledge/documents/:id
   * Get document by ID
   */
  @Get('documents/:id')
  @ApiOperation({ summary: 'Get document details' })
  @ApiResponse({ status: 200, description: 'Document retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocument(@Param('id') id: string) {
    const document = await this.knowledgeService.findOne(id);

    return {
      success: true,
      data: document,
    };
  }

  /**
   * POST /admin/knowledge/documents
   * Upload document (text, URL, or PDF file)
   */
  @Post('documents')
  @ApiOperation({ summary: 'Upload document' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Document uploaded successfully' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const document = await this.knowledgeService.uploadDocument(dto, file);

    return {
      success: true,
      data: document,
      message: 'Document uploaded. Processing will begin shortly.',
    };
  }

  /**
   * POST /admin/knowledge/documents/:id/reindex
   * Re-index single document
   */
  @Post('documents/:id/reindex')
  @ApiOperation({ summary: 'Re-index document' })
  @ApiResponse({ status: 200, description: 'Re-indexing started' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async reindexDocument(@Param('id') id: string) {
    await this.knowledgeService.reindexDocument(id);

    return {
      success: true,
      message: 'Document re-indexing started',
    };
  }

  /**
   * POST /admin/knowledge/reindex-all
   * Re-index all documents
   */
  @Post('reindex-all')
  @ApiOperation({ summary: 'Re-index all documents' })
  @ApiResponse({ status: 200, description: 'Batch re-indexing started' })
  async reindexAll() {
    const result = await this.knowledgeService.reindexAll();

    return {
      success: true,
      data: result,
      message: `Re-indexing ${result.count} documents`,
    };
  }

  /**
   * DELETE /admin/knowledge/documents/:id
   * Delete document and its chunks/embeddings
   */
  @Delete('documents/:id')
  @ApiOperation({ summary: 'Delete document' })
  @ApiResponse({ status: 200, description: 'Document deleted successfully' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async deleteDocument(@Param('id') id: string) {
    await this.knowledgeService.remove(id);

    return {
      success: true,
      message: 'Document and associated chunks deleted',
    };
  }

  /**
   * GET /admin/knowledge/stats
   * Get knowledge library statistics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get knowledge statistics' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getStats() {
    const stats = await this.knowledgeService.getStats();

    return {
      success: true,
      data: stats,
    };
  }
}
