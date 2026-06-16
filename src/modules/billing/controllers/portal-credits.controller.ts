import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserEntity } from '../../auth/entities/user.entity';
import { CreditPurchaseService } from '../services/credit-purchase.service';
import { AutoTopupService } from '../services/auto-topup.service';
import { CreditsPurchaseDto } from '../dto/credits-purchase.dto';
import { UpsertAutoTopupDto } from '../dto/auto-topup.dto';

/**
 * Portal endpoints for one-off credit purchase + auto top-up
 * configuration. Org is derived from the JWT — never from the body.
 *
 * Credit purchase flow (one-off):
 *   POST /portal/billing/credits/purchase  body: { credits, paymentMethodId? }
 *     → 201 { paymentIntentClientSecret, customerId, credits, amountUsd }
 *
 * The SPA uses the client_secret with Stripe Elements; on success
 * Stripe fires `payment_intent.succeeded`, which lands in the existing
 * BillingController webhook handler and refills the balance.
 *
 * Auto top-up CRUD:
 *   GET    /portal/billing/auto-topup
 *   PUT    /portal/billing/auto-topup     body: { enabled, triggerThreshold, rechargeAmount, ... }
 *   DELETE /portal/billing/auto-topup     soft-disable; preserves settings
 */
@Controller('portal/billing')
@UseGuards(JwtAuthGuard)
export class PortalCreditsController {
  constructor(
    private readonly credits: CreditPurchaseService,
    private readonly autoTopup: AutoTopupService,
  ) {}

  // ── Credits ─────────────────────────────────────────────────────────

  @Post('credits/purchase')
  @HttpCode(201)
  async purchaseCredits(
    @CurrentUser() user: UserEntity,
    @Body() dto: CreditsPurchaseDto,
  ) {
    return this.credits.createPaymentIntentForCredits({
      organizationId: user.organizationId,
      email: user.email,
      credits: dto.credits,
      paymentMethodId: dto.paymentMethodId,
    });
  }

  @Get('credits/purchases')
  async listPurchases(@CurrentUser() user: UserEntity) {
    const rows = await this.credits.listRecentPurchases(user.organizationId);
    return {
      data: rows.map((r) => ({
        id: r.id,
        credits: r.credits,
        amount: Number(r.amount),
        currency: r.currency,
        status: r.status,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ── Auto top-up ─────────────────────────────────────────────────────

  @Get('auto-topup')
  async getAutoTopup(@CurrentUser() user: UserEntity) {
    const row = await this.autoTopup.getForOrganization(user.organizationId);
    if (!row) return { config: null };
    return {
      config: {
        id: row.id,
        enabled: row.enabled,
        triggerThreshold: row.triggerThreshold,
        rechargeAmount: row.rechargeAmount,
        monthlySpendingCap: row.monthlySpendingCap == null ? null : Number(row.monthlySpendingCap),
        paymentMethodConfigured: !!row.stripePaymentMethodId,
        lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
        totalAutoPurchases: row.totalAutoPurchases,
      },
    };
  }

  @Put('auto-topup')
  async upsertAutoTopup(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpsertAutoTopupDto,
  ) {
    const row = await this.autoTopup.upsert(user.organizationId, {
      enabled: dto.enabled,
      triggerThreshold: dto.triggerThreshold,
      rechargeAmount: dto.rechargeAmount,
      monthlySpendingCap: dto.monthlySpendingCap ?? null,
      stripePaymentMethodId: dto.stripePaymentMethodId,
    });
    return { config: row };
  }

  @Delete('auto-topup')
  @HttpCode(204)
  async disableAutoTopup(@CurrentUser() user: UserEntity): Promise<void> {
    await this.autoTopup.disable(user.organizationId);
  }
}
