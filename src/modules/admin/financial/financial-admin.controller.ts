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

  private assertEnabled(): void {
    if (process.env.FINANCIAL_ADMIN_ENABLED !== 'true') {
      throw new ForbiddenException(
        'Financial admin endpoints are disabled. Set FINANCIAL_ADMIN_ENABLED=true to enable.',
      );
    }
  }
}
