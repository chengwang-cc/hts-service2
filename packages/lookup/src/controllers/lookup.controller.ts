import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { SearchService, ClassificationService } from '../services';
import { SearchDto, ClassifyProductDto } from '../dto';

@Controller('lookup')
export class LookupController {
  constructor(
    private readonly searchService: SearchService,
    private readonly classificationService: ClassificationService,
  ) {}

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

  @Get('autocomplete')
  async autocomplete(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const maxResults = Math.min(Math.max(parseInt(limit || '10', 10) || 10, 1), 20);
    const results = await this.searchService.autocomplete(query || '', maxResults);

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

  @Post('classify')
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
      reasoning: classification.aiSuggestions?.[0]?.reasoning || 'AI classification',
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'lookup' };
  }
}
