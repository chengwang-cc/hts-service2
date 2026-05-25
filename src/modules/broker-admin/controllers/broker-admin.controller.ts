import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminPermissions } from '../../admin/decorators/admin-permissions.decorator';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { AdminPermissionsGuard } from '../../admin/guards/admin-permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  CreateAdapterDto,
  CreateExportJobDto,
  UpdateAdapterDto,
} from '../../broker-adapters/dto/broker-adapters.dto';
import { BrokerAdaptersService } from '../../broker-adapters/services/broker-adapters.service';
import {
  AcknowledgeIssueDto,
  UpsertRuleDto,
} from '../../broker-rules/dto/broker-rules.dto';
import { BrokerRulesService } from '../../broker-rules/services/broker-rules.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { VerifyBrokerProfileDto } from '../../marketplace/dto/marketplace.dto';
import { MarketplaceRequestsService } from '../../marketplace-requests/services/marketplace-requests.service';
import { TelemetryService } from '../../observability/telemetry.service';
import { PolicyChangeBridge } from '../../broker-post-entry/jobs/policy-change-bridge.service';
import { SecretRotationService } from '../../security/secret-rotation.service';
import { BrokerAdminService } from '../services/broker-admin.service';

/**
 * Admin-scoped surface required by the plan under /admin/marketplace and
 * /admin/broker. Mostly thin wrappers over the existing tenant-scoped
 * controllers, plus the cross-tenant analytics + audit feeds.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BrokerAdminController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly rules: BrokerRulesService,
    private readonly adapters: BrokerAdaptersService,
    private readonly admin: BrokerAdminService,
    private readonly secretRotation: SecretRotationService,
    private readonly marketplaceRequests: MarketplaceRequestsService,
    private readonly policyChange: PolicyChangeBridge,
    private readonly telemetry: TelemetryService,
  ) {}

  /**
   * R4-A-01 / R4-A-02 — in-process telemetry snapshot. Returns the live
   * counter + latency histogram view that operators can poll while a real
   * OTLP collector + Grafana dashboard binding lands.
   */
  @Get('broker/metrics')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:analytics:view')
  async metrics() {
    return { success: true, data: this.telemetry.snapshot() };
  }

  /**
   * R2-E-04 — manually dispatch a policy-change event to the bridge.
   * Used by operators to trigger remediation when the upstream
   * policy-change-monitor isn't bound yet. Body: { affectedHts: string[],
   * eventSummary: string, organizationIds?: string[] }.
   */
  @Post('broker/policy-change/dispatch')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:rules:write')
  async dispatchPolicyChange(
    @Body()
    body: {
      affectedHts: string[];
      eventSummary: string;
      organizationIds?: string[];
    },
  ) {
    await this.policyChange.handle(body);
    return { success: true };
  }

  // --- Marketplace admin aliases (plan paths)
  @Get('marketplace/brokers/pending')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async pendingBrokers() {
    return {
      success: true,
      data: await this.marketplace.listAdmin({
        verificationStatus: 'pending',
      }),
    };
  }

  @Post('marketplace/brokers/:id/verify')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:verify')
  async verifyBroker(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    const dto: VerifyBrokerProfileDto = {
      status: 'verified',
      note: body?.note ?? null,
    };
    return {
      success: true,
      data: await this.marketplace.adminReview(
        id,
        dto,
        resolveRequestContext(req),
      ),
    };
  }

  @Post('marketplace/brokers/:id/suspend')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:verify')
  async suspendBroker(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { note?: string },
  ) {
    const dto: VerifyBrokerProfileDto = {
      status: 'suspended',
      note: body?.note ?? null,
    };
    return {
      success: true,
      data: await this.marketplace.adminReview(
        id,
        dto,
        resolveRequestContext(req),
      ),
    };
  }

  @Get('marketplace/requests')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async allRequests(@Query('status') status?: string) {
    return {
      success: true,
      data: await this.admin.listAllRequests({ status }),
    };
  }

  @Get('marketplace/quality')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async quality() {
    return { success: true, data: await this.admin.marketplaceQuality() };
  }

  // --- Broker rules under /admin (in addition to /broker for tenant editing)
  @Get('broker/rules')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:rules:view')
  async listRules(@Req() req: Request) {
    return {
      success: true,
      data: await this.rules.listRules(resolveRequestContext(req)),
    };
  }

  @Post('broker/rules')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:rules:write')
  async upsertRule(@Req() req: Request, @Body() dto: UpsertRuleDto) {
    return {
      success: true,
      data: await this.rules.upsertRule(resolveRequestContext(req), dto),
    };
  }

  @Patch('broker/issues/:issueId')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:rules:write')
  async acknowledgeIssue(
    @Req() req: Request,
    @Param('issueId', ParseUUIDPipe) issueId: string,
    @Body() dto: AcknowledgeIssueDto,
  ) {
    return {
      success: true,
      data: await this.rules.acknowledgeIssue(
        resolveRequestContext(req),
        issueId,
        dto,
      ),
    };
  }

  // --- Broker adapters under /admin
  @Get('broker/adapters')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:adapters:view')
  async listAdapters(@Req() req: Request) {
    return {
      success: true,
      data: await this.adapters.listAdapters(resolveRequestContext(req)),
    };
  }

  @Post('broker/adapters')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:adapters:write')
  async createAdapter(@Req() req: Request, @Body() dto: CreateAdapterDto) {
    return {
      success: true,
      data: await this.adapters.createAdapter(
        resolveRequestContext(req),
        dto,
      ),
    };
  }

  @Patch('broker/adapters/:id')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:adapters:write')
  async updateAdapter(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdapterDto,
  ) {
    return {
      success: true,
      data: await this.adapters.updateAdapter(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Post('broker/adapters/:id/test')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:adapters:write')
  async testAdapter(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.adapters.testAdapter(resolveRequestContext(req), id),
    };
  }

  @Post('broker/adapters/export')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:adapters:write')
  async export(@Req() req: Request, @Body() dto: CreateExportJobDto) {
    return {
      success: true,
      data: await this.adapters.createExportJob(
        resolveRequestContext(req),
        dto,
      ),
    };
  }

  // --- Cross-tenant analytics + audit + ai governance
  @Get('broker/analytics')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:analytics:view')
  async analytics() {
    return { success: true, data: await this.admin.brokerAnalytics() };
  }

  @Get('broker/ai-governance')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:analytics:view')
  async aiGovernance() {
    return { success: true, data: await this.admin.aiGovernance() };
  }

  /**
   * R1-B-04 — admin concierge queue: requests with priority='concierge'
   * (paid for priority intake) plus the standard queue when no filter is
   * passed. Sorted concierge-first then by most recent.
   */
  @Get('marketplace/requests/priority')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:view')
  async priorityQueue(@Query('priority') priority?: string) {
    const filter =
      priority === 'concierge' || priority === 'standard'
        ? (priority as 'concierge' | 'standard')
        : undefined;
    return {
      success: true,
      data: await this.marketplaceRequests.listAdminByPriority(filter),
    };
  }

  /**
   * R1-A-04 — admin hides (or unhides) a marketplace message. Hidden
   * messages render as a redacted placeholder to participants.
   */
  @Post('marketplace/messages/:id/hide')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:moderate')
  async hideMessage(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    const userId =
      (req as any).user?.id ?? resolveRequestContext(req).userId;
    return {
      success: true,
      data: await this.marketplaceRequests.setMessageHidden(
        userId,
        id,
        true,
        body?.reason ?? null,
      ),
    };
  }

  @Post('marketplace/messages/:id/unhide')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('marketplace:moderate')
  async unhideMessage(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userId =
      (req as any).user?.id ?? resolveRequestContext(req).userId;
    return {
      success: true,
      data: await this.marketplaceRequests.setMessageHidden(
        userId,
        id,
        false,
        null,
      ),
    };
  }

  @Post('broker/security/rotate-secrets')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:adapters:write')
  async rotateSecrets(
    @Body() body: { oldKeyEnv?: string; batchSize?: number; dryRun?: boolean },
  ) {
    return {
      success: true,
      data: await this.secretRotation.rotateAll({
        oldKeyEnv: body?.oldKeyEnv,
        batchSize: body?.batchSize,
        dryRun: body?.dryRun,
      }),
    };
  }

  @Get('broker/audit')
  @UseGuards(AdminPermissionsGuard)
  @AdminPermissions('broker:audit:view')
  async audit(
    @Query('eventType') eventType?: string,
    @Query('organizationId') organizationId?: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? Math.min(500, Number(limitStr)) : 100;
    return {
      success: true,
      data: await this.admin.auditFeed({
        eventTypeContains: eventType,
        organizationId,
        limit,
      }),
    };
  }
}
