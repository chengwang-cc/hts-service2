import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WrapResponseInterceptor } from '../../observability/wrap-response.interceptor';
import { QueueService } from '../../queue/queue.service';
import { KNOWLEDGEBASE_SOURCE_MONITOR_QUEUE } from '../jobs/knowledge-source-queues';
import { SourceMonitorJob } from '../jobs/source-monitor.job';
import { KnowledgeCardIngestionService } from '../services/knowledge-card-ingestion.service';
import { KnowledgeCardService } from '../services/knowledge-card.service';
import { KnowledgeSourceRegistryService } from '../services/knowledge-source-registry.service';
import { RuleReviewAlertService } from '../services/rule-review-alert.service';
import { IngestUrlDto } from '../dto/ingest-url.dto';
import { AlertResolveDto } from '../dto/alert-resolve.dto';
import {
  CreateKnowledgeSourceDto,
  RunKnowledgeSourceCrawlDto,
  UpdateKnowledgeSourceDto,
} from '../dto/knowledge-source.dto';

/**
 * Admin endpoints for the knowledge-cards subsystem (Phase 8).
 *
 *   POST /admin/knowledgebase/cards/ingest-url    — fetch URL + ingest
 *   POST /admin/knowledgebase/cards/upload        — multipart upload + ingest (≤25 MB)
 *   GET  /admin/knowledgebase/cards               — list active cards
 *   GET  /admin/knowledgebase/cards/:cardKey      — history for a cardKey
 *   POST /admin/knowledgebase/cards/:id/promote   — pending_review → active
 *
 *   GET  /admin/rule-review-alerts                — list open alerts
 *   GET  /admin/rule-review-alerts/by-rule/:ruleId — list per rule
 *   PUT  /admin/rule-review-alerts/:id/resolve     — dismiss or action
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@UseInterceptors(WrapResponseInterceptor)
@Controller('admin')
export class KnowledgebaseCardsAdminController {
  constructor(
    private readonly ingest: KnowledgeCardIngestionService,
    private readonly cards: KnowledgeCardService,
    private readonly sources: KnowledgeSourceRegistryService,
    private readonly sourceMonitor: SourceMonitorJob,
    private readonly queue: QueueService,
    private readonly alerts: RuleReviewAlertService,
  ) {}

  @Post('knowledgebase/cards/ingest-url')
  @ApiOperation({ summary: 'Fetch a URL and ingest as a knowledge card.' })
  async ingestUrl(@Body() body: IngestUrlDto, @Req() req: any) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    const result = await this.ingest.ingestUrl({
      url: body.url,
      hint: {
        documentType: body.documentType,
        suggestedCardKey: body.suggestedCardKey,
        jurisdiction: body.jurisdiction,
      },
      ingestedBy: `url:${body.url}|by:${actor}`,
    });
    return result;
  }

  @Post('knowledgebase/cards/upload')
  @ApiOperation({ summary: 'Multipart upload (PDF/HTML/TXT/MD) — ingest as knowledge card.' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
    }),
  )
  async upload(
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
    @Body() body: Partial<IngestUrlDto>,
    @Req() req: any,
  ) {
    if (!file) {
      return { error: 'no file uploaded' };
    }
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    const result = await this.ingest.ingestBuffer({
      buffer: file.buffer,
      contentType: file.mimetype,
      originalFilename: file.originalname,
      hint: {
        documentType: body.documentType,
        suggestedCardKey: body.suggestedCardKey,
        jurisdiction: body.jurisdiction,
      },
      storageRef: `upload:${file.originalname}`,
      ingestedBy: `upload:${file.originalname}|by:${actor}|size:${file.size}`,
    });
    return result;
  }

  @Get('knowledgebase/cards')
  @ApiOperation({ summary: 'List active knowledge cards (small page).' })
  async list(@Query('cardKey') cardKey?: string, @Query('limit') limit?: string) {
    if (cardKey) {
      return this.cards.history(cardKey);
    }
    // H3 fix (2026-05-27): previously called `history('')` which returned
    // an empty array because no card has an empty `cardKey`. Now uses
    // the dedicated `listActive()`.
    const n = Math.max(1, Math.min(200, Number(limit ?? 50)));
    return this.cards.listActive(n);
  }

  @Get('knowledgebase/sources')
  @ApiOperation({ summary: 'List authoritative knowledge sources.' })
  async listSources(
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    return this.sources.list({ status, sourceType });
  }

  @Post('knowledgebase/sources/bootstrap-defaults')
  @ApiOperation({ summary: 'Persist the built-in official source defaults.' })
  async bootstrapSources(@Req() req: any) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    return this.sources.seedDefaultSources(actor);
  }

  @Post('knowledgebase/sources')
  @ApiOperation({ summary: 'Create an authoritative knowledge source.' })
  async createSource(@Body() body: CreateKnowledgeSourceDto, @Req() req: any) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    return this.sources.create(body, actor);
  }

  @Post('knowledgebase/sources/crawl')
  @ApiOperation({ summary: 'Crawl every active authoritative source.' })
  async crawlAllSources(
    @Body() body: RunKnowledgeSourceCrawlDto | undefined,
    @Req() req: any,
  ) {
    return this.runSourceCrawl(null, body, req);
  }

  @Get('knowledgebase/sources/:id')
  @ApiOperation({ summary: 'Read one authoritative knowledge source.' })
  async getSource(@Param('id', ParseUUIDPipe) id: string) {
    return this.sources.requireSource(id);
  }

  @Put('knowledgebase/sources/:id')
  @ApiOperation({ summary: 'Update an authoritative knowledge source.' })
  async updateSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateKnowledgeSourceDto,
    @Req() req: any,
  ) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    return this.sources.update(id, body, actor);
  }

  @Get('knowledgebase/sources/:id/items')
  @ApiOperation({ summary: 'List discovered/ingested items for one source.' })
  async listSourceItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.sources.listItems(id, Math.max(1, Math.min(250, Number(limit ?? 100))));
  }

  @Get('knowledgebase/sources/:id/runs')
  @ApiOperation({ summary: 'List crawl runs for one source.' })
  async listSourceRuns(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.sources.listRuns(id, Math.max(1, Math.min(250, Number(limit ?? 100))));
  }

  @Post('knowledgebase/sources/:id/crawl')
  @ApiOperation({ summary: 'Crawl one authoritative source.' })
  async crawlSource(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RunKnowledgeSourceCrawlDto | undefined,
    @Req() req: any,
  ) {
    return this.runSourceCrawl(id, body, req);
  }

  @Get('knowledgebase/cards/:cardKey')
  @ApiOperation({ summary: 'History for one cardKey, newest first.' })
  async history(@Param('cardKey') cardKey: string) {
    return this.cards.history(cardKey);
  }

  @Post('knowledgebase/cards/:id/promote')
  @ApiOperation({ summary: 'Promote a pending_review card to active.' })
  async promote(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    return this.cards.promoteToActive(id, actor);
  }

  @Get('knowledgebase/cards/diff/:cardKey')
  @ApiOperation({
    summary:
      'Diff the active card vs the most-recent pending_review card for one cardKey.',
  })
  async diffPending(@Param('cardKey') cardKey: string) {
    return this.cards.diffPending(cardKey);
  }

  @Get('rule-review-alerts')
  @ApiOperation({ summary: 'List open rule-review alerts.' })
  async listAlerts(@Query('limit') limit?: string) {
    return this.alerts.listOpen(Math.max(1, Math.min(200, Number(limit ?? 50))));
  }

  @Get('rule-review-alerts/by-rule/:ruleId')
  @ApiOperation({ summary: 'List all alerts for one rule.' })
  async listByRule(@Param('ruleId') ruleId: string) {
    return this.alerts.listByRule(ruleId);
  }

  @Put('rule-review-alerts/:id/resolve')
  @ApiOperation({ summary: 'Resolve an alert (dismiss or mark actioned).' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AlertResolveDto,
    @Req() req: any,
  ) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    return this.alerts.resolve({
      id,
      status: body.status,
      actor,
      note: body.note ?? null,
      prUrl: body.prUrl ?? null,
    });
  }

  private async runSourceCrawl(
    sourceId: string | null,
    body: RunKnowledgeSourceCrawlDto | undefined,
    req: any,
  ) {
    const actor = req?.user?.email ?? req?.user?.id ?? 'admin';
    const force = body?.force === true;
    const trigger = `admin:${actor}`;
    if ((body?.mode ?? 'enqueue') === 'inline') {
      return {
        mode: 'inline',
        result: await this.sourceMonitor.runOnce({ sourceId, force, trigger }),
      };
    }

    const jobId = await this.queue.sendJob(
      KNOWLEDGEBASE_SOURCE_MONITOR_QUEUE,
      { sourceId, force, trigger },
      {
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
        singletonKey: sourceId ? `knowledge-source:${sourceId}` : 'knowledge-sources:all',
      },
    );
    return { mode: 'queued', jobId };
  }
}
