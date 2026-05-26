import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WrapResponseInterceptor } from '../../observability/wrap-response.interceptor';
import {
  BulkUpsertBrokerOutreachLeadsDto,
  CreateBrokerOutreachCampaignDto,
  CreateBrokerOutreachInviteDto,
  DiscoverGoogleBrokerLeadsDto,
  DiscoverOsmBrokerLeadsDto,
  DraftBrokerOutreachEmailDto,
} from '../dto/broker-outreach.dto';
import { BrokerOutreachCampaignEngineService } from '../services/broker-outreach-campaign-engine.service';
import { BrokerOutreachDiscoveryLedgerService } from '../services/broker-outreach-discovery-ledger.service';
import { BrokerOutreachRetentionService } from '../services/broker-outreach-retention.service';
import { BrokerOutreachEmailService } from '../services/broker-outreach-email.service';
import { BrokerOutreachService } from '../services/broker-outreach.service';

@ApiTags('admin broker outreach')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@UseInterceptors(WrapResponseInterceptor)
@Controller('admin/broker-outreach')
export class BrokerOutreachAdminController {
  constructor(
    private readonly outreach: BrokerOutreachService,
    private readonly discoveryLedger: BrokerOutreachDiscoveryLedgerService,
    private readonly email: BrokerOutreachEmailService,
    private readonly campaigns: BrokerOutreachCampaignEngineService,
    private readonly retention: BrokerOutreachRetentionService,
  ) {}

  @Get('leads')
  @ApiOperation({ summary: 'List broker/exporter/importer outreach leads.' })
  async listLeads(
    @Query('status') status?: string,
    @Query('sourceProvider') sourceProvider?: string,
    @Query('limit') limit?: string,
  ) {
    return this.outreach.listLeads({
      status,
      sourceProvider,
      limit: Number(limit ?? 100),
    });
  }

  @Post('leads/import')
  @ApiOperation({ summary: 'Bulk upsert OSM/Google/manual outreach leads.' })
  async importLeads(
    @Body() body: BulkUpsertBrokerOutreachLeadsDto,
    @Req() req: any,
  ) {
    return this.outreach.bulkUpsertLeads(body, actor(req));
  }

  @Post('discovery/osm')
  @ApiOperation({ summary: 'Discover and persist broker/export-import leads from OSM Overpass.' })
  async discoverOsm(
    @Body() body: DiscoverOsmBrokerLeadsDto,
    @Req() req: any,
  ) {
    return this.outreach.discoverFromOsm(body, actor(req));
  }

  @Post('discovery/google')
  @ApiOperation({
    summary:
      'Discover broker/export-import leads via Puppeteer-driven Google Search (POC). Requires BROKER_OUTREACH_GOOGLE_SCRAPER_ENABLED=true. Does NOT use the paid Google Places API.',
  })
  async discoverGoogle(
    @Body() body: DiscoverGoogleBrokerLeadsDto,
    @Req() req: any,
  ) {
    return this.outreach.discoverFromGoogleSearch(body, actor(req));
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'List outreach campaigns.' })
  async listCampaigns(@Query('status') status?: string) {
    return this.outreach.listCampaigns(status);
  }

  @Post('campaigns')
  @ApiOperation({ summary: 'Create an outreach campaign draft.' })
  async createCampaign(
    @Body() body: CreateBrokerOutreachCampaignDto,
    @Req() req: any,
  ) {
    return this.outreach.createCampaign(body, actor(req));
  }

  @Post('emails/draft')
  @ApiOperation({ summary: 'Draft a personalized outreach email.' })
  async draftEmail(@Body() body: DraftBrokerOutreachEmailDto) {
    return this.outreach.draftEmail(body);
  }

  @Get('invites')
  @ApiOperation({ summary: 'List generated outreach invites.' })
  async listInvites(
    @Query('leadId') leadId?: string,
    @Query('campaignId') campaignId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.outreach.listInvites({
      leadId,
      campaignId,
      status,
      limit: Number(limit ?? 100),
    });
  }

  @Post('invites')
  @ApiOperation({ summary: 'Create one-click trial invite for a lead.' })
  async createInvite(
    @Body() body: CreateBrokerOutreachInviteDto,
    @Req() req: any,
  ) {
    return this.outreach.createInvite(body, actor(req));
  }

  @Post('leads/:id/invites')
  @ApiOperation({ summary: 'Create one-click trial invite for one lead.' })
  async createInviteForLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Omit<CreateBrokerOutreachInviteDto, 'leadId'>,
    @Req() req: any,
  ) {
    return this.outreach.createInvite({ ...body, leadId: id }, actor(req));
  }

  @Get('discovery/runs')
  @ApiOperation({ summary: 'List recent outreach discovery runs.' })
  async listDiscoveryRuns(
    @Query('provider') provider?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.discoveryLedger.listRuns({
      provider,
      status,
      limit: Number(limit ?? 50),
    });
  }

  @Get('discovery/runs/:id/results')
  @ApiOperation({ summary: 'List discovered candidates for one run.' })
  async listDiscoveryResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.discoveryLedger.listResults(id, Number(limit ?? 200));
  }

  @Get('email/suppression')
  @ApiOperation({ summary: 'List outreach email suppression entries.' })
  async listSuppression() {
    return { entries: this.email.listSuppressed() };
  }

  @Post('email/suppression')
  @ApiOperation({ summary: 'Add an email address to the suppression list.' })
  async addSuppression(@Body() body: { email: string; reason?: string }) {
    this.email.suppress(body.email, body.reason ?? 'manual');
    return { ok: true };
  }

  @Post('email/suppression/remove')
  @ApiOperation({ summary: 'Remove an email address from the suppression list.' })
  async removeSuppression(@Body() body: { email: string }) {
    return { removed: this.email.unsuppress(body.email) };
  }

  @Get('campaigns/:id/drafts')
  @ApiOperation({ summary: 'List all draft variants saved on a campaign.' })
  async listCampaignDrafts(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.listDrafts(id);
  }

  @Post('campaigns/:id/drafts')
  @ApiOperation({ summary: 'Save a new draft variant for a campaign.' })
  async saveCampaignDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      subject: string;
      body: string;
      label?: string;
      promptHint?: string | null;
    },
    @Req() req: any,
  ) {
    return this.campaigns.saveDraft(
      {
        campaignId: id,
        subject: body.subject,
        body: body.body,
        label: body.label,
        promptHint: body.promptHint ?? null,
      },
      actor(req),
    );
  }

  @Post('campaigns/:id/drafts/ai-generate')
  @ApiOperation({
    summary:
      'Generate AI-assisted draft variants. Saves each variant as a new draft on the campaign and selects the last one. Falls back to a deterministic draft when AI is unavailable.',
  })
  async generateAiDrafts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { leadId?: string; variants?: number; toneHint?: string },
    @Req() req: any,
  ) {
    return this.campaigns.generateAiDrafts(
      {
        campaignId: id,
        leadId: body.leadId,
        variants: body.variants,
        toneHint: body.toneHint ?? null,
      },
      actor(req),
    );
  }

  @Post('campaigns/:id/drafts/:draftId/promote')
  @ApiOperation({ summary: 'Promote one of a campaign\'s draft variants as the selected one.' })
  async promoteCampaignDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('draftId') draftId: string,
    @Req() req: any,
  ) {
    return this.campaigns.promoteDraft(id, draftId, actor(req));
  }

  @Post('retention/sweep')
  @ApiOperation({
    summary:
      'Run the retention sweep inline (expire invites + purge stale discovery runs).',
  })
  async runRetentionSweep() {
    return this.retention.sweep();
  }

  @Post('campaigns/:id/send')
  @ApiOperation({ summary: 'Send invites for this campaign to a set of leads.' })
  async sendCampaign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { leadIds: string[]; expiresInDays?: number },
    @Req() req: any,
  ) {
    return this.campaigns.sendToLeads(
      {
        campaignId: id,
        leadIds: body.leadIds,
        expiresInDays: body.expiresInDays,
      },
      actor(req),
    );
  }
}

function actor(req: any): string {
  return req?.user?.email ?? req?.user?.id ?? 'admin';
}
