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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'crypto';
import {
  SearchService,
  UrlClassifierService,
  LookupConversationAgentService,
  ClassificationService,
} from '../services';
import { VisionService } from '@hts/core';
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

@Controller('lookup')
export class LookupController {
  constructor(
    private readonly searchService: SearchService,
    private readonly urlClassifierService: UrlClassifierService,
    private readonly classificationService: ClassificationService,
    private readonly visionService: VisionService,
    private readonly noteResolutionService: NoteResolutionService,
    private readonly lookupConversationAgentService: LookupConversationAgentService,
    private readonly queueService: QueueService,
    private readonly rerankService: RerankService,
    private readonly smartClassifyService: SmartClassifyService,
  ) {}

  @Public()
  @Post('search')
  async search(@Body() searchDto: SearchDto) {
    const results = await this.searchService.hybridSearch(
      searchDto.query,
      searchDto.limit || 20,
    );

    return {
      query: searchDto.query,
      results,
      count: results.length,
    };
  }

  /**
   * Rerank autocomplete candidates using gpt-5-nano.
   * Accepts the original user query and the autocomplete candidate list,
   * returns the same candidates reordered by AI relevance score.
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
   * Requires JWT authentication (resource-intensive: calls GPT-4o vision + classification).
   */
  @Post('classify-hts-from-url')
  async classifyHtsFromUrl(
    @CurrentUser() user: any,
    @Body() dto: ClassifyHtsFromUrlDto,
  ) {
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }

    const urlResult = await this.urlClassifierService.classifyUrl(dto.url);

    if (urlResult.type === UrlType.INVALID) {
      throw new BadRequestException(urlResult.error ?? 'Invalid or inaccessible URL');
    }

    let productDescription: string;
    let visionUsed = false;
    let detectedProduct: Record<string, unknown> | null = null;

    if (urlResult.type === UrlType.IMAGE) {
      // Direct image URL — analyze with GPT-4o vision
      const analysis = await this.analyzeProductImageWithFallback(dto.url, {
        url: dto.url,
        title: urlResult.metadata?.title,
      });
      if (!analysis.products.length) {
        throw new BadRequestException('No product detected in the image');
      }
      const product = analysis.products[0];
      productDescription = [product.name, product.description, ...(product.materials ?? [])].filter(Boolean).join(', ');
      visionUsed = true;
      detectedProduct = {
        name: product.name,
        description: product.description,
        materials: product.materials,
        brand: product.brand,
        confidence: product.confidence,
      };
    } else if (urlResult.imageUrl) {
      // Product or webpage with an OG image — analyze image, supplement with OG text
      const analysis = await this.analyzeProductImageWithFallback(urlResult.imageUrl, {
        url: dto.url,
        title: urlResult.metadata?.title,
      });
      const visionDescription = analysis.products[0]
        ? [analysis.products[0].name, analysis.products[0].description, ...(analysis.products[0].materials ?? [])].filter(Boolean).join(', ')
        : '';
      const ogDescription = [urlResult.metadata?.productName, urlResult.metadata?.description].filter(Boolean).join(' — ');
      productDescription = visionDescription || ogDescription;
      visionUsed = !!visionDescription;
      detectedProduct = analysis.products[0]
        ? {
            name: analysis.products[0].name,
            description: analysis.products[0].description,
            materials: analysis.products[0].materials,
            brand: analysis.products[0].brand,
            confidence: analysis.products[0].confidence,
          }
        : null;
    } else {
      // Webpage with no image — use extracted text description
      productDescription = [urlResult.metadata?.productName, urlResult.metadata?.description].filter(Boolean).join(' — ');
    }

    if (!productDescription?.trim()) {
      throw new BadRequestException('Unable to extract product description from URL');
    }

    const classification = await this.classificationService.classifyProduct(
      productDescription,
      user.organizationId,
      {
        inputMethod:
          urlResult.type === UrlType.IMAGE
            ? 'IMAGE_URL'
            : urlResult.type === UrlType.PRODUCT
              ? 'PRODUCT_URL'
              : 'WEBPAGE_URL',
        sourceUrl: dto.url,
        sourceImageUrl:
          urlResult.type === UrlType.IMAGE ? dto.url : (urlResult.imageUrl ?? null),
        sourceEvidence: {
          urlType: urlResult.type,
          metadata: urlResult.metadata ?? null,
          visionUsed,
          detectedProduct,
        },
      },
    );

    return {
      success: true,
      data: {
        ...classification,
        source: {
          ...(classification.source ?? {}),
          url: dto.url,
          urlType: urlResult.type,
          visionUsed,
          productDescription,
        },
      },
    };
  }

  /**
   * Full pipeline: uploaded image → vision analysis → HTS classification
   * Accepts PNG, JPG, WebP images up to 10 MB.
   * Requires JWT authentication.
   */
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
    if (!user?.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!image) {
      throw new BadRequestException('Image file is required (field name: "image")');
    }

    const analysis = await this.visionService.analyzeProductImage(image.buffer, {
      title: image.originalname,
    });

    if (!analysis.products.length) {
      throw new BadRequestException('No product detected in the uploaded image');
    }

    const product = analysis.products[0];
    const productDescription = [product.name, product.description, ...(product.materials ?? [])].filter(Boolean).join(', ');
    const imageHash = createHash('sha256').update(image.buffer).digest('hex');

    const classification = await this.classificationService.classifyProduct(
      productDescription,
      user.organizationId,
      {
        inputMethod: 'IMAGE_UPLOAD',
        sourceImageHash: imageHash,
        sourceEvidence: {
          originalFilename: image.originalname,
          mimeType: image.mimetype,
          sizeBytes: image.size,
          visionUsed: true,
          detectedProduct: {
            name: product.name,
            description: product.description,
            materials: product.materials,
            brand: product.brand,
            confidence: product.confidence,
          },
        },
      },
    );

    return {
      success: true,
      data: {
        ...classification,
        source: {
          ...(classification.source ?? {}),
          visionUsed: true,
          productDescription,
          detectedProduct: {
            name: product.name,
            description: product.description,
            materials: product.materials,
            brand: product.brand,
            confidence: product.confidence,
          },
        },
      },
    };
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

  private async analyzeProductImageWithFallback(
    imageUrl: string,
    context?: { url?: string; title?: string },
  ) {
    try {
      return await this.visionService.analyzeProductImage(imageUrl, context);
    } catch (error) {
      if (!this.shouldRetryVisionWithDownloadedBuffer(imageUrl, error)) {
        throw error;
      }

      const imageBuffer = await this.downloadImageBuffer(imageUrl);
      return this.visionService.analyzeProductImage(imageBuffer, context);
    }
  }

  private shouldRetryVisionWithDownloadedBuffer(
    imageUrl: string,
    error: unknown,
  ): boolean {
    const message =
      error instanceof Error ? error.message : String(error ?? '');

    return (
      imageUrl.startsWith('http://127.0.0.1') ||
      imageUrl.startsWith('http://localhost') ||
      /error while downloading/i.test(message) ||
      /status code:\s*407/i.test(message)
    );
  }

  private async downloadImageBuffer(imageUrl: string): Promise<Buffer> {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new BadRequestException(
        `Unable to download product image (${response.status})`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new BadRequestException('Extracted product asset is not an image');
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 10 * 1024 * 1024) {
      throw new BadRequestException('Extracted product image is too large');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Extracted product image is too large');
    }

    return buffer;
  }
}
