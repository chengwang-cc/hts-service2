import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WrapResponseInterceptor } from '../../observability/wrap-response.interceptor';
import { KnowledgeQueryService } from '../services/knowledge-query.service';

/**
 * Read-side knowledge query endpoint. Authenticated but tenant-agnostic
 * (knowledge content is shared across tenants). Returns citations
 * (active cards + their parent source freshness) — clients can render
 * cited answers without an AI roundtrip.
 *
 * Example:
 *   GET /knowledge/query?jurisdiction=US&documentType=csms&limit=10
 */
@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(WrapResponseInterceptor)
@Controller('knowledge')
export class KnowledgeQueryController {
  constructor(private readonly query: KnowledgeQueryService) {}

  @Get('query')
  @ApiOperation({
    summary: 'Query active knowledge cards by jurisdiction/type/date.',
  })
  async run(
    @Query('jurisdiction') jurisdiction?: string,
    @Query('documentType') documentType?: string,
    @Query('category') category?: string,
    @Query('sourceType') sourceType?: string,
    @Query('cardKey') cardKey?: string,
    @Query('effectiveAfter') effectiveAfter?: string,
    @Query('effectiveBefore') effectiveBefore?: string,
    @Query('includePending') includePending?: string,
    @Query('limit') limit?: string,
  ) {
    return this.query.query({
      jurisdiction,
      documentType,
      category,
      sourceType,
      cardKey,
      effectiveAfter: effectiveAfter ? new Date(effectiveAfter) : undefined,
      effectiveBefore: effectiveBefore ? new Date(effectiveBefore) : undefined,
      includePending: includePending === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }
}
