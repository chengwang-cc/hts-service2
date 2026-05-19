import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  NotFoundException,
  GoneException,
  UnauthorizedException,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  SearchService,
  UrlClassifierService,
  LookupConversationAgentService,
  LookupClassificationJobService,
} from '../services';
import { QueueService } from '../../queue/queue.service';
import { LOOKUP_CONVERSATION_QUEUE } from '../lookup.module';
import {
  SearchDto,
  ClassifyUrlRequestDto,
  ClassifyHtsFromUrlDto,
  CreateLookupConversationDto,
  LookupConversationMessageDto,
  LookupConversationFeedbackDto,
  RerankDto,
  SmartClassifyDto,
} from '../dto';
import { RerankService } from '../services/rerank.service';
import { SmartClassifyService } from '../services/smart-classify.service';
import { Public } from '../decorators';
import { NoteResolutionService } from '@hts/knowledgebase';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UrlType } from '../dto/classify-url.dto';
import { VisionService } from '@hts/core';

@Controller('lookup')
export class LookupController {
  constructor(
    private readonly searchService: SearchService,
    private readonly urlClassifierService: UrlClassifierService,
    private readonly lookupClassificationJobService: LookupClassificationJobService,
    private readonly noteResolutionService: NoteResolutionService,
    private readonly lookupConversationAgentService: LookupConversationAgentService,
    private readonly queueService: QueueService,
    private readonly rerankService: RerankService,
    private readonly smartClassifyService: SmartClassifyService,
    private readonly visionService: VisionService,
  ) {}

  @Public()
  @Post('search')
  async search(@Body() searchDto: SearchDto) {
    const searchResult = await this.searchService.searchWithStandardization(
      searchDto.query,
      searchDto.limit || 20,
    );

    return {
      query: searchDto.query,
      normalizedQuery: searchResult.standardizedQuery,
      standardizedQuery: searchResult.standardizedQuery,
      searchPhrases: searchResult.searchPhrases,
      headingHints: searchResult.headingHints,
      results: searchResult.results,
      count: searchResult.results.length,
    };
  }

  /**
   * Rerank autocomplete candidates with a latency-bounded AI pipeline.
   * Uses a bounded OpenAI pass and falls back gracefully when unavailable.
   */
  @Public()
  @Post('rerank')
  async rerank(@Body() dto: RerankDto) {
    const ranked = await this.rerankService.rerank(dto.query, dto.candidates);
    return { query: dto.query, ranked };
  }

  /**
   * 3-phase hierarchical smart classification:
   * Phase 1 — chapter identification via autocomplete (~95% accurate)
   * Phase 2 — focused semantic search within identified chapters
   * Phase 3 — AI reranking with domain-aware prompt (material/species/processing)
   */
  @Public()
  @Post('smart-classify')
  async smartClassify(@Body() dto: SmartClassifyDto) {
    const result = await this.smartClassifyService.classify(dto.query);
    return result;
  }

  @Public()
  @Get('autocomplete')
  async autocomplete(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const maxResults = Math.min(
      Math.max(parseInt(limit || '10', 10) || 10, 1),
      20,
    );
    const results = await this.searchService.autocomplete(
      query || '',
      maxResults,
    );

    return {
      success: true,
      data: results,
      meta: {
        query: query || '',
        count: results.length,
        limit: maxResults,
      },
    };
  }

  @Public()
  @Post('classify')
  async classifyProduct() {
    throw new GoneException(
      'lookup/classify is deprecated. Use lookup/autocomplete, lookup/search, or lookup/conversations instead.',
    );
  }

  @Public()
  @Post('classify-url')
  async classifyUrl(@Body() dto: ClassifyUrlRequestDto) {
    return this.urlClassifierService.classifyUrl(dto.url);
  }

  /**
   * Full pipeline: URL → (vision or text) → HTS classification
   * Handles product pages, image URLs, and general web pages.
   * Runs asynchronously through pg-boss to avoid edge/gateway timeouts.
   */
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('classify-hts-from-url')
  async classifyHtsFromUrl(
    @CurrentUser() user: any,
    @Body() dto: ClassifyHtsFromUrlDto,
  ) {
    return {
      success: true,
      data: await this.lookupClassificationJobService.createUrlJob(user, dto.url),
    };
  }

  /**
   * Full pipeline: uploaded image → vision analysis → HTS classification
   * Accepts PNG, JPG, WebP images up to 10 MB.
   * Runs asynchronously through pg-boss to avoid edge/gateway timeouts.
   */
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('classify-hts-from-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/image\/(png|jpeg|jpg|webp)/)) {
          return cb(new BadRequestException('Only PNG, JPG, and WebP images are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async classifyHtsFromImage(
    @CurrentUser() user: any,
    @UploadedFile() image: Express.Multer.File,
  ) {
    return {
      success: true,
      data: await this.lookupClassificationJobService.createImageJob(user, image),
    };
  }

  @Public()
  @Get('classify-hts-jobs/:jobId')
  async getClassificationJob(
    @CurrentUser() user: any,
    @Param('jobId') jobId: string,
  ) {
    return {
      success: true,
      data: await this.lookupClassificationJobService.getJob(
        jobId,
        user?.organizationId ?? null,
      ),
    };
  }

  /**
   * List classification jobs for the current organization.
   * Supports optional source ('WEB' | 'SHOPIFY' | 'API') and status filters
   * plus simple limit/offset pagination (limit defaults to 25, max 100).
   */
  @Get('classify-hts-jobs')
  async listClassificationJobs(
    @CurrentUser() user: any,
    @Query('source') source?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const normalizedSource = this.normalizeSourceFilter(source);
    const normalizedStatus = this.normalizeStatusFilter(status);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;

    return {
      success: true,
      data: await this.lookupClassificationJobService.listJobs(
        user.organizationId,
        {
          source: normalizedSource,
          status: normalizedStatus,
          limit: Number.isFinite(parsedLimit) ? (parsedLimit as number) : undefined,
          offset: Number.isFinite(parsedOffset) ? (parsedOffset as number) : undefined,
        },
      ),
    };
  }

  private normalizeSourceFilter(
    raw?: string,
  ): 'WEB' | 'SHOPIFY' | 'API' | null {
    if (!raw) return null;
    const value = raw.trim().toUpperCase();
    return value === 'WEB' || value === 'SHOPIFY' || value === 'API'
      ? (value as 'WEB' | 'SHOPIFY' | 'API')
      : null;
  }

  private normalizeStatusFilter(
    raw?: string,
  ): 'pending' | 'processing' | 'completed' | 'failed' | null {
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    return value === 'pending' ||
      value === 'processing' ||
      value === 'completed' ||
      value === 'failed'
      ? (value as 'pending' | 'processing' | 'completed' | 'failed')
      : null;
  }

  @Public()
  @Get('hts/:htsNumber')
  async getHtsDetail(@Param('htsNumber') htsNumber: string) {
    const entry = await this.searchService.findByHtsNumber(htsNumber);
    if (!entry) {
      throw new NotFoundException(`HTS ${htsNumber} not found`);
    }
    return entry;
  }

  @Public()
  @Get('hts/:htsNumber/notes')
  async getHtsNotes(
    @Param('htsNumber') htsNumber: string,
    @Query('year') year?: string,
  ) {
    const entry = await this.searchService.findByHtsNumber(htsNumber);
    if (!entry) {
      throw new NotFoundException(`HTS ${htsNumber} not found`);
    }

    const resolvedYear = this.resolveYear(year, entry.sourceVersion ?? null);
    const candidates: Array<{
      sourceColumn: 'general' | 'other';
      referenceText: string | null;
    }> = [
      { sourceColumn: 'general', referenceText: entry.general ?? null },
      { sourceColumn: 'other', referenceText: entry.other ?? null },
    ];

    const notes: Array<Record<string, any>> = [];
    for (const candidate of candidates) {
      if (!this.hasLikelyNoteReference(candidate.referenceText)) {
        continue;
      }

      const resolved = await this.noteResolutionService.resolveNoteReference(
        entry.htsNumber,
        candidate.referenceText || '',
        candidate.sourceColumn,
        resolvedYear,
        { persistResolution: false },
      );

      if (resolved) {
        notes.push({
          sourceColumn: candidate.sourceColumn,
          referenceText: candidate.referenceText,
          ...resolved,
        });
      }
    }

    return {
      htsNumber: entry.htsNumber,
      chapter: entry.chapter,
      year: resolvedYear,
      count: notes.length,
      notes,
    };
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'lookup' };
  }

  @Post('conversations')
  async createConversation(
    @CurrentUser() user: any,
    @Body() dto: CreateLookupConversationDto,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.lookupConversationAgentService.createConversation({
      organizationId: user.organizationId,
      userId: user.id,
      userProfile: dto.userProfile,
    });
    return {
      success: true,
      data: {
        conversationId: session.id,
        status: session.status,
        createdAt: session.createdAt,
        usage: session.usage || null,
      },
    };
  }

  @Get('conversations/:conversationId')
  async getConversation(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = await this.lookupConversationAgentService.getConversation(
      conversationId,
      user.organizationId,
    );
    return {
      success: true,
      data: session,
    };
  }

  @Get('conversations/:conversationId/messages')
  async getConversationMessages(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const safeLimit = Math.min(
      Math.max(parseInt(limit || '100', 10) || 100, 1),
      500,
    );
    const data = await this.lookupConversationAgentService.getMessages(
      conversationId,
      user.organizationId,
      safeLimit,
    );
    return {
      success: true,
      data,
    };
  }

  @Post('conversations/:conversationId/messages')
  async sendConversationMessage(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: LookupConversationMessageDto,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.lookupConversationAgentService.enqueueMessage(
      conversationId,
      user.organizationId,
      dto.message,
    );

    await this.queueService.sendJob(LOOKUP_CONVERSATION_QUEUE, {
      conversationId,
      messageId: result.messageId,
      message: dto.message,
    });

    return {
      success: true,
      data: result,
    };
  }

  @Get('conversations/:conversationId/messages/:messageId/status')
  async getConversationMessageStatus(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.lookupConversationAgentService.getMessageStatus(
      messageId,
      conversationId,
      user.organizationId,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Post('conversations/:conversationId/feedback')
  async submitConversationFeedback(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: LookupConversationFeedbackDto,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = await this.lookupConversationAgentService.recordFeedback(
      conversationId,
      user.organizationId,
      dto,
    );
    return {
      success: true,
      data: result,
    };
  }

  private hasLikelyNoteReference(value: string | null | undefined): boolean {
    if (!value) {
      return false;
    }

    return /note\s+[0-9]/i.test(value);
  }

  private resolveYear(
    year: string | undefined,
    sourceVersion: string | null,
  ): number {
    const parsedYear = year ? parseInt(year, 10) : NaN;
    if (Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 9999) {
      return parsedYear;
    }

    if (sourceVersion) {
      const match = sourceVersion.match(/(19|20)\d{2}/);
      if (match) {
        return parseInt(match[0], 10);
      }
    }

    return new Date().getFullYear();
  }
}
