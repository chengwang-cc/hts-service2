import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  NotFoundException,
} from '@nestjs/common';
import {
  SearchService,
  ClassificationService,
  UrlClassifierService,
} from '../services';
import { SearchDto, ClassifyProductDto, ClassifyUrlRequestDto } from '../dto';
import { RateLimit, Public } from '../decorators';
import { NoteResolutionService } from '@hts/knowledgebase';

@Controller('lookup')
export class LookupController {
  constructor(
    private readonly searchService: SearchService,
    private readonly classificationService: ClassificationService,
    private readonly urlClassifierService: UrlClassifierService,
    private readonly noteResolutionService: NoteResolutionService,
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
  @RateLimit({ endpoint: 'classify' })
  async classifyProduct(
    @Body() classifyDto: ClassifyProductDto,
    @Query('organizationId') organizationId: string,
  ) {
    const classification = await this.classificationService.classifyProduct(
      classifyDto.description,
      organizationId,
    );

    // Transform entity to simple classification result for API response
    return {
      htsCode: classification.suggestedHts,
      confidence: classification.confidence,
      reasoning:
        classification.aiSuggestions?.[0]?.reasoning || 'AI classification',
    };
  }

  @Public()
  @Post('classify-url')
  async classifyUrl(@Body() dto: ClassifyUrlRequestDto) {
    return this.urlClassifierService.classifyUrl(dto.url);
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
