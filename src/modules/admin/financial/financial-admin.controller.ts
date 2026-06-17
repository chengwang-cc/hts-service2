import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { CreditLedgerEntity } from '../../billing/entities/credit-ledger.entity';
import { LedgerService } from '../../billing/services/ledger.service';
import { CreditPurchaseService } from '../../billing/services/credit-purchase.service';
import { RefundService } from '../../billing/refunds/services/refund.service';
import { CreateRefundDto } from '../../billing/refunds/dto/create-refund.dto';
import { DisputeService } from '../../billing/disputes/services/dispute.service';
import { DisputeEntity } from '../../billing/entities/dispute.entity';
import { SubmitEvidenceDto } from '../../billing/disputes/dto/submit-evidence.dto';
import { Idempotent } from '../../idempotency/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../idempotency/interceptors/idempotency.interceptor';
import { FinanceAdminGuard } from './guards/finance-admin.guard';
import { ManualAdjustmentService } from './services/manual-adjustment.service';
import { CreditAdjustDto } from './dto/credit-adjust.dto';

/**
 * Platform admin / Finance admin financial endpoints. Mounted at
 * `/api/v1/admin/financial/*`. Gated by FINANCIAL_ADMIN_ENABLED env
 * flag (default false during rollout) AND by the FinanceAdminGuard
 * (Platform OR Finance role).
 *
 * Scope of this PR (F3.1)
 * -----------------------
 * - POST /organizations/:id/credits/adjust  (manual topup / debit)
 * - GET  /organizations/:id/financial-summary  (balance + lifetime
 *   stats for the Financial admin tab)
 * - GET  /organizations/:id/ledger  (paginated ledger preview)
 *
 * Out of scope (later PRs)
 * ------------------------
 * - Refunds (F4.1)
 * - Disputes (F5.1)
 * - Reports (F9.1)
 *
 * Feature flag
 * ------------
 * When `FINANCIAL_ADMIN_ENABLED !== 'true'`, every endpoint returns
 * 403 with a clear "feature disabled" message. Lets us deploy this
 * code dark and flip the flag when ready, separately from the SPA
 * release that lands the UI.
 */
@Controller('admin/financial')
@UseGuards(JwtAuthGuard, FinanceAdminGuard)
export class FinancialAdminController {
  constructor(
    private readonly adjustments: ManualAdjustmentService,
    private readonly ledger: LedgerService,
    private readonly credits: CreditPurchaseService,
    private readonly refunds: RefundService,
    private readonly disputes: DisputeService,
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    @InjectRepository(CreditLedgerEntity)
    private readonly ledgerRepo: Repository<CreditLedgerEntity>,
  ) {}

  /**
   * Manually grant or debit credits. The Idempotency-Key header is
   * required by convention (the SPA mints a UUID v4 on form mount);
   * the IdempotencyInterceptor handles same-body replays + 409 on
   * mismatched-body replays.
   */
  @Post('organizations/:id/credits/adjust')
  @Idempotent('admin.credits.adjust')
  @UseInterceptors(IdempotencyInterceptor)
  async adjust(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreditAdjustDto,
    @CurrentUser() user: UserEntity,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    return this.adjustments.adjust(
      {
        organizationId,
        delta: dto.delta,
        reasonCode: dto.reasonCode,
        internalNote: dto.internalNote,
        idempotencyKey,
      },
      {
        kind: 'ADMIN',
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
      },
    );
  }

  /**
   * Financial summary for the org-detail Financial tab. Bundles
   * balance + recent ledger preview so the SPA only makes one call
   * on tab mount.
   */
  @Get('organizations/:id/financial-summary')
  async summary(@Param('id', ParseUUIDPipe) organizationId: string) {
    this.assertEnabled();
    const org = await this.orgs.findOne({ where: { id: organizationId } });
    if (!org) {
      throw new ForbiddenException(`Organization ${organizationId} not found`);
    }

    const balance = await this.ledger.getBalance(organizationId);
    const recentLedger = await this.ledger.listForOrganization(organizationId, 20);

    return {
      organizationId,
      organizationName: org.name,
      currentBalance: balance,
      currency: 'USD',
      recentLedger: recentLedger.map((r) => this.toLedgerRowDto(r)),
    };
  }

  /**
   * Recent credit purchases for an org — the SPA refund modal uses
   * this to render the picker. Limit defaults to 20; covers the
   * typical "refund the last purchase" workflow.
   */
  @Get('organizations/:id/purchases')
  async purchases(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query('limit') limitRaw?: string,
  ) {
    this.assertEnabled();
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '20', 10) || 20, 1), 100);
    const rows = await this.credits.listRecentPurchases(organizationId, limit);
    return {
      organizationId,
      count: rows.length,
      data: rows.map((p) => ({
        id: p.id,
        credits: p.credits,
        amount: Number(p.amount),
        currency: p.currency,
        status: p.status,
        stripePaymentIntentId: p.stripePaymentIntentId,
        stripeSessionId: p.stripeSessionId,
        completedAt: p.completedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  /**
   * List refunds for an org. Used by the Financial tab to render a
   * "Recent refunds" section under the purchase table.
   */
  @Get('organizations/:id/refunds')
  async listRefunds(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    this.assertEnabled();
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(offsetRaw ?? '0', 10) || 0, 0);
    const rows = await this.refunds.listForOrganization(organizationId, limit, offset);
    return {
      organizationId,
      count: rows.length,
      data: rows.map((r) => ({
        id: r.id,
        originalPaymentIntentId: r.originalPaymentIntentId,
        stripeRefundId: r.stripeRefundId,
        amountMinorUnits: Number(r.amountMinorUnits),
        currency: r.currency,
        reason: r.reason,
        status: r.status,
        creditsReturned: r.creditsReturned,
        failureReason: r.failureReason,
        internalNote: r.internalNote,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Issue a Stripe refund. The Idempotency-Key header is required
   * (forwarded to Stripe so a retry doesn't fork the refund). Body:
   *
   *   {
   *     paymentIntentId: 'pi_...',
   *     amountMinorUnits?: 2000,           // default = full purchase
   *     reason: 'requested_by_customer',   // duplicate | fraudulent | requested_by_customer
   *     internalNote?: 'support ticket #123'
   *   }
   *
   * Returns the refund row (status='pending' until webhook flips it
   * to 'succeeded' or 'failed').
   */
  @Post('organizations/:id/refunds')
  @Idempotent('admin.refund.create')
  @UseInterceptors(IdempotencyInterceptor)
  async createRefund(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateRefundDto,
    @CurrentUser() user: UserEntity,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    if (process.env.STRIPE_REFUNDS_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Stripe refunds are disabled. Set STRIPE_REFUNDS_ENABLED=true to enable.',
      );
    }
    return this.refunds.createRefund(
      {
        organizationId,
        paymentIntentId: dto.paymentIntentId,
        amountMinorUnits: dto.amountMinorUnits,
        reason: dto.reason,
        internalNote: dto.internalNote,
        idempotencyKey,
      },
      {
        kind: 'ADMIN',
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
      },
    );
  }

  /**
   * Paginated ledger view. `limit` capped server-side at 200 to
   * keep responses bounded; SPA paginates via `offset`.
   */
  @Get('organizations/:id/ledger')
  async ledger_(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    this.assertEnabled();
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(offsetRaw ?? '0', 10) || 0, 0);

    const rows = await this.ledger.listForOrganization(organizationId, limit, offset);
    return {
      organizationId,
      limit,
      offset,
      count: rows.length,
      data: rows.map((r) => this.toLedgerRowDto(r)),
    };
  }

  private toLedgerRowDto(r: CreditLedgerEntity) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      deltaCredits: r.deltaCredits,
      balanceAfter: r.balanceAfter,
      kind: r.kind,
      reasonCode: r.reasonCode,
      internalNote: r.internalNote,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      actorKind: r.actorKind,
      actorUserId: r.actorUserId,
      currency: r.currency,
      createdAt: r.createdAt.toISOString(),
    };
  }

  // ─── Disputes (Phase 5, PR F5.1) ────────────────────────────────────

  /**
   * Cross-org queue of open disputes, sorted by evidence_due_by ASC.
   * The SPA renders rows due < 48h in red. Internal_state filtered to
   * OPEN | EVIDENCE_DRAFTING | EVIDENCE_SUBMITTED — closed disputes
   * (WON/LOST) live in the per-org view.
   *
   * Gated by DISPUTES_ENABLED in addition to FINANCIAL_ADMIN_ENABLED so
   * the flag can be flipped late once Stripe Dashboard subscribes to
   * the dispute webhook events.
   */
  @Get('disputes')
  async listOpenDisputes(
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    this.assertEnabled();
    this.assertDisputesEnabled();
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(offsetRaw ?? '0', 10) || 0, 0);
    const rows = await this.disputes.listOpen(limit, offset);
    return {
      count: rows.length,
      limit,
      offset,
      data: rows.map((r) => this.toDisputeDto(r)),
    };
  }

  @Get('organizations/:id/disputes')
  async listOrgDisputes(
    @Param('id', ParseUUIDPipe) organizationId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    this.assertEnabled();
    this.assertDisputesEnabled();
    const limit = Math.min(Math.max(Number.parseInt(limitRaw ?? '20', 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(offsetRaw ?? '0', 10) || 0, 0);
    const rows = await this.disputes.listForOrganization(organizationId, limit, offset);
    return {
      organizationId,
      count: rows.length,
      data: rows.map((r) => this.toDisputeDto(r)),
    };
  }

  @Get('disputes/:id')
  async getDispute(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    this.assertDisputesEnabled();
    const row = await this.disputes.getById(id);
    return this.toDisputeDto(row);
  }

  /**
   * Submit evidence to Stripe. The Idempotency-Key header is required.
   * Stripe accepts ONE submission per dispute, so the controller
   * rejects retries via DisputeService's submission_count guard.
   */
  @Post('disputes/:id/respond')
  @Idempotent('admin.dispute.evidence')
  @UseInterceptors(IdempotencyInterceptor)
  async submitEvidence(
    @Param('id', ParseUUIDPipe) disputeId: string,
    @Body() dto: SubmitEvidenceDto,
    @CurrentUser() user: UserEntity,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    this.assertEnabled();
    this.assertDisputesEnabled();
    if (!idempotencyKey) {
      throw new ForbiddenException('Idempotency-Key header is required.');
    }

    // Map our DTO → Stripe's DisputeUpdateParams.Evidence shape.
    const evidence = {
      ...(dto.customerCommunication !== undefined && {
        customer_communication: dto.customerCommunication,
      }),
      ...(dto.accessActivityLog !== undefined && {
        access_activity_log: dto.accessActivityLog,
      }),
      ...(dto.productDescription !== undefined && {
        product_description: dto.productDescription,
      }),
      ...(dto.refundPolicy !== undefined && { refund_policy: dto.refundPolicy }),
      ...(dto.refundPolicyDisclosure !== undefined && {
        refund_policy_disclosure: dto.refundPolicyDisclosure,
      }),
      ...(dto.serviceDate !== undefined && { service_date: dto.serviceDate }),
      ...(dto.serviceDocumentation !== undefined && {
        service_documentation: dto.serviceDocumentation,
      }),
      ...(dto.uncategorizedText !== undefined && {
        uncategorized_text: dto.uncategorizedText,
      }),
      ...(dto.customerEmailAddress !== undefined && {
        customer_email_address: dto.customerEmailAddress,
      }),
      ...(dto.customerName !== undefined && { customer_name: dto.customerName }),
      ...(dto.customerPurchaseIp !== undefined && {
        customer_purchase_ip: dto.customerPurchaseIp,
      }),
    };

    const row = await this.disputes.submitEvidence(
      disputeId,
      evidence,
      {
        kind: 'ADMIN',
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: (req.headers['x-request-id'] as string | undefined) ?? undefined,
      },
      idempotencyKey,
    );
    return this.toDisputeDto(row);
  }

  private toDisputeDto(r: DisputeEntity) {
    return {
      id: r.id,
      organizationId: r.organizationId,
      stripeDisputeId: r.stripeDisputeId,
      stripeChargeId: r.stripeChargeId,
      stripePaymentIntentId: r.stripePaymentIntentId,
      amountMinorUnits: Number(r.amountMinorUnits),
      currency: r.currency,
      reason: r.reason,
      stripeStatus: r.stripeStatus,
      internalState: r.internalState,
      evidenceDueBy: r.evidenceDueBy?.toISOString() ?? null,
      submissionCount: r.submissionCount,
      isChargeRefundable: r.isChargeRefundable,
      evidence: r.evidence,
      fundsWithdrawnAt: r.fundsWithdrawnAt?.toISOString() ?? null,
      fundsReinstatedAt: r.fundsReinstatedAt?.toISOString() ?? null,
      chargebackLedgerEntryId: r.chargebackLedgerEntryId,
      reversalLedgerEntryId: r.reversalLedgerEntryId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private assertDisputesEnabled(): void {
    if (process.env.DISPUTES_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Disputes are disabled. Set DISPUTES_ENABLED=true to enable.',
      );
    }
  }

  private assertEnabled(): void {
    if (process.env.FINANCIAL_ADMIN_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Financial admin endpoints are disabled. Set FINANCIAL_ADMIN_ENABLED=true to enable.',
      );
    }
  }
}
