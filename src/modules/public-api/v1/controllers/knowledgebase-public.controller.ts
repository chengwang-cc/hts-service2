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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKeyGuard } from '../../../api-keys/guards/api-key.guard';
import { ApiPermissions, CurrentApiKey } from '../../../api-keys/decorators';
import { ApiKeyEntity } from '../../../api-keys/entities/api-key.entity';
import { SearchService } from '@hts/lookup';
import {
  HtsNoteEntity,
  KnowledgeChunkEntity,
  HtsDocumentEntity,
} from '@hts/knowledgebase';

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
    @InjectRepository(HtsNoteEntity)
    private readonly noteRepository: Repository<HtsNoteEntity>,
    @InjectRepository(KnowledgeChunkEntity)
    private readonly chunkRepository: Repository<KnowledgeChunkEntity>,
  ) {}

  /**
   * Query the knowledgebase
   * POST /api/v1/knowledgebase/query
   */
  @Post('query')
  @ApiOperation({
    summary: 'Query the HTS knowledgebase',
    description:
      'Ask questions about HTS codes, tariffs, and trade regulations using natural language.',
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
          example:
            'What is the duty rate for importing cotton t-shirts from China?',
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
      const [results, noteMatches, chunkMatches] = await Promise.all([
        this.searchService.hybridSearch(question, 5),
        this.searchKnowledgeNotes(question, 5),
        this.searchKnowledgeChunks(question, 5),
      ]);

      return {
        success: true,
        data: {
          question,
          results,
          noteMatches,
          chunkMatches,
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
    description:
      'Get AI-powered HTS code recommendations for a product description.',
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
          example:
            'Cotton t-shirts with printed graphics, crew neck, short sleeves',
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
      const [recommendations, noteMatches, chunkMatches] = await Promise.all([
        this.searchService.hybridSearch(productDescription, maxResults),
        this.searchKnowledgeNotes(productDescription, Math.min(maxResults, 5)),
        this.searchKnowledgeChunks(
          productDescription,
          Math.min(maxResults, 5),
        ),
      ]);

      return {
        success: true,
        data: {
          recommendations,
          noteMatches,
          chunkMatches,
        },
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

  private extractQueryTerms(input: string): string[] {
    const terms = (input || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g);

    if (!terms) {
      return [];
    }

    return Array.from(new Set(terms.filter((term) => term.length >= 3))).slice(
      0,
      6,
    );
  }

  private buildExcerpt(content: string, terms: string[], maxLength = 220): string {
    const text = (content || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return '';
    }

    const firstTerm = terms[0];
    if (!firstTerm) {
      return text.slice(0, maxLength);
    }

    const index = text.toLowerCase().indexOf(firstTerm.toLowerCase());
    if (index < 0) {
      return text.slice(0, maxLength);
    }

    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, start + maxLength);
    return text.slice(start, end);
  }

  private async searchKnowledgeNotes(
    query: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      chapter: string;
      year: number;
      noteType: string;
      noteNumber: string;
      title: string | null;
      excerpt: string;
    }>
  > {
    const terms = this.extractQueryTerms(query);
    if (terms.length === 0) {
      return [];
    }

    const qb = this.noteRepository.createQueryBuilder('note').where('1=0');
    terms.forEach((term, index) => {
      const key = `term${index}`;
      const value = `%${term}%`;
      qb.orWhere(`note.content ILIKE :${key}`, { [key]: value });
      qb.orWhere(`note.title ILIKE :${key}`, { [key]: value });
      qb.orWhere(`note.note_number ILIKE :${key}`, { [key]: value });
    });

    const notes = await qb
      .orderBy('note.year', 'DESC')
      .addOrderBy('note.updated_at', 'DESC')
      .limit(limit)
      .getMany();

    return notes.map((note) => ({
      id: note.id,
      chapter: note.chapter,
      year: note.year,
      noteType: note.noteType,
      noteNumber: note.noteNumber,
      title: note.title,
      excerpt: this.buildExcerpt(note.content, terms),
    }));
  }

  private async searchKnowledgeChunks(
    query: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      documentId: string;
      chapter: string | null;
      year: number | null;
      chunkIndex: number;
      excerpt: string;
    }>
  > {
    const terms = this.extractQueryTerms(query);
    if (terms.length === 0) {
      return [];
    }

    const qb = this.chunkRepository
      .createQueryBuilder('chunk')
      .leftJoinAndMapOne(
        'chunk.document',
        HtsDocumentEntity,
        'document',
        'document.id = chunk.document_id',
      )
      .where('1=0');

    terms.forEach((term, index) => {
      const key = `term${index}`;
      qb.orWhere(`chunk.content ILIKE :${key}`, {
        [key]: `%${term}%`,
      });
    });

    const chunks = await qb
      .orderBy('document.year', 'DESC')
      .addOrderBy('chunk.chunk_index', 'ASC')
      .limit(limit)
      .getMany();

    return chunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      chapter: chunk.document?.chapter ?? null,
      year: chunk.document?.year ?? null,
      chunkIndex: chunk.chunkIndex,
      excerpt: this.buildExcerpt(chunk.content, terms),
    }));
  }
}
