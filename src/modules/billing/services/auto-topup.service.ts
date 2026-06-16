import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AutoTopUpConfigEntity } from '../entities/auto-topup-config.entity';
import { CreditBalanceEntity } from '../entities/credit-balance.entity';
import { CreditPurchaseService } from './credit-purchase.service';
import { SubscriptionService } from './subscription.service';
import { StripeService } from './stripe.service';

export interface UpsertAutoTopupInput {
  enabled: boolean;
  triggerThreshold: number;
  rechargeAmount: number;
  monthlySpendingCap?: number | null;
  stripePaymentMethodId?: string | null;
}

/**
 * Auto top-up coordinator (Phase 4a).
 *
 * The user configures: "when my credit balance drops below X credits,
 * automatically buy Y credits using my saved card." The trigger runs
 * inline on the request path that observed the low balance — typically
 * the per-item billing.chargeForEvent call in BatchWorkerService.
 *
 * Why this is dangerous if done naively
 * --------------------------------------
 * Two concurrent requests across two ECS tasks can both observe a
 * balance below threshold and both fire a Stripe Payment Intent. We'd
 * double-charge the customer. The single-flight Redis lock here is
 * the contract that prevents that:
 *
 *   - SET NX EX 60   (atomic "set if not exists, 60s TTL")
 *   - If acquired: we own the top-up for this window. Fire the intent.
 *   - If NOT acquired: another task is already firing — return early.
 *     The OTHER task's webhook will refill the balance; by the time
 *     this request retries, the balance is back above threshold.
 *
 * The 60s TTL is the safety net: if our process crashes between
 * acquiring the lock and firing the intent (or between firing and the
 * webhook landing), the lock auto-expires so the next low-balance
 * request can try again.
 *
 * When Redis is unreachable we FAIL CLOSED (skip the auto-topup) —
 * better to under-charge than risk double-charging. The customer's
 * batch will surface INSUFFICIENT_CREDITS items and they can manually
 * top up.
 */
@Injectable()
export class AutoTopupService {
  private readonly logger = new Logger(AutoTopupService.name);
  private readonly redis: Redis;
  private readonly LOCK_TTL_S = 60;

  constructor(
    @InjectRepository(AutoTopUpConfigEntity)
    private readonly configs: Repository<AutoTopUpConfigEntity>,
    @InjectRepository(CreditBalanceEntity)
    private readonly balances: Repository<CreditBalanceEntity>,
    private readonly credits: CreditPurchaseService,
    private readonly subscriptions: SubscriptionService,
    private readonly stripe: StripeService,
    config: ConfigService,
  ) {
    this.redis = new Redis(
      config.get<string>('REDIS_URL', 'redis://localhost:6379'),
      {
        lazyConnect: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        commandTimeout: 500,
        reconnectOnError: () => true,
      },
    );
    this.redis.on('error', (err) =>
      this.logger.debug(`Redis error (auto-topup fail-closed): ${err?.message ?? err}`),
    );
  }

  // ---------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------

  async getForOrganization(organizationId: string): Promise<AutoTopUpConfigEntity | null> {
    return this.configs.findOne({ where: { organizationId } });
  }

  async upsert(
    organizationId: string,
    dto: UpsertAutoTopupInput,
  ): Promise<AutoTopUpConfigEntity> {
    if (!CreditPurchaseService.VALID_TIERS.includes(dto.rechargeAmount as any)) {
      throw new BadRequestException(
        `rechargeAmount must be one of: ${CreditPurchaseService.VALID_TIERS.join(', ')}`,
      );
    }
    if (dto.triggerThreshold < 0 || dto.triggerThreshold > 10_000) {
      throw new BadRequestException('triggerThreshold out of range');
    }

    let row = await this.configs.findOne({ where: { organizationId } });
    if (!row) {
      row = this.configs.create({ organizationId });
    }
    row.enabled = dto.enabled;
    row.triggerThreshold = dto.triggerThreshold;
    row.rechargeAmount = dto.rechargeAmount;
    row.monthlySpendingCap = dto.monthlySpendingCap ?? null;
    row.stripePaymentMethodId = dto.stripePaymentMethodId ?? row.stripePaymentMethodId ?? null;
    return this.configs.save(row);
  }

  async disable(organizationId: string): Promise<void> {
    const row = await this.configs.findOne({ where: { organizationId } });
    if (!row) throw new NotFoundException('No auto top-up configured');
    row.enabled = false;
    await this.configs.save(row);
  }

  // ---------------------------------------------------------------------
  // Trigger — called from the billing-charge path
  // ---------------------------------------------------------------------

  /**
   * Called by BillingChargeService after a deduction (or by anything
   * that notices a balance dip). Returns true if a top-up Payment
   * Intent was created on THIS call; false if a sibling task is
   * already handling it, the config is disabled, or the balance is
   * still above threshold.
   *
   * Never throws — auto top-up is an enhancement, not a correctness
   * boundary. A failure here surfaces as INSUFFICIENT_CREDITS on the
   * next request, which is the same as auto-topup being disabled.
   */
  async maybeTrigger(organizationId: string): Promise<boolean> {
    try {
      const config = await this.configs.findOne({ where: { organizationId } });
      if (!config?.enabled || !config.stripePaymentMethodId) return false;

      const balance = await this.balances.findOne({ where: { organizationId } });
      const current = balance?.balance ?? 0;
      if (current >= config.triggerThreshold) return false;

      // Monthly cap check — soft guard against runaway top-ups (e.g.
      // a misconfigured threshold + high-volume traffic). Resets on
      // calendar month boundary.
      if (this.isOverMonthlyCap(config)) {
        this.logger.warn(
          `[auto-topup] org=${organizationId} hit monthly cap ($${config.monthlySpendingCap}) — skipping`,
        );
        return false;
      }

      const acquired = await this.acquireLock(organizationId);
      if (!acquired) {
        this.logger.debug(
          `[auto-topup] org=${organizationId} lock contended — sibling task is firing`,
        );
        return false;
      }

      try {
        await this.fireTopUp(config);
        return true;
      } finally {
        // Lock release is best-effort. If Redis dropped the lock will
        // expire on its own. Worst case: 60s window where a duplicate
        // can't fire (acceptable).
        void this.releaseLock(organizationId);
      }
    } catch (err) {
      this.logger.error(
        `[auto-topup] org=${organizationId} trigger failed: ${(err as Error)?.message}`,
      );
      return false;
    }
  }

  private async fireTopUp(config: AutoTopUpConfigEntity): Promise<void> {
    const price = CreditPurchaseService.priceForTier(config.rechargeAmount);
    if (!price) {
      this.logger.error(
        `[auto-topup] org=${config.organizationId} invalid rechargeAmount=${config.rechargeAmount}`,
      );
      return;
    }

    // We don't have the user's email handy here — the customer record
    // already exists if they configured auto-topup. Reuse the
    // pre-existing Stripe customer; getOrCreate will fall through to
    // create if absent (uses a placeholder email).
    const customerId =
      config.stripeCustomerId ??
      (await this.subscriptions.getOrCreateStripeCustomer({
        organizationId: config.organizationId,
        email: 'autotopup@usahts.com',
      }));

    const intent = await this.stripe.createPaymentIntent({
      customerId,
      amountUsd: price,
      purpose: 'auto_topup',
      organizationId: config.organizationId,
      paymentMethodId: config.stripePaymentMethodId!,
      offSession: true,
    });

    // The CreditPurchaseService.creditFromPaymentIntent path expects a
    // pending purchase row keyed by stripePaymentIntentId. Write one
    // here so the webhook routes through the same idempotent code
    // path the manual purchase uses.
    await this.credits['creditPurchaseRepo'].save(
      this.credits['creditPurchaseRepo'].create({
        organizationId: config.organizationId,
        credits: config.rechargeAmount,
        amount: price,
        currency: 'USD',
        status: 'pending',
        returnUrl: '',
        // See credit-purchase.service.ts — stripe_session_id has a
        // unique index; mirror the intent id so the constraint stays
        // satisfied on the Payment Intent path (no Checkout Session).
        stripeSessionId: intent.id,
        stripePaymentIntentId: intent.id,
        metadata: { purpose: 'auto_topup', source: 'auto', triggeredBy: 'AutoTopupService' },
      }),
    );

    config.lastTriggeredAt = new Date();
    config.totalAutoPurchases = (config.totalAutoPurchases ?? 0) + 1;
    await this.bumpMonthlySpent(config, price);
    await this.configs.save(config);

    this.logger.log(
      `[auto-topup] org=${config.organizationId} fired payment_intent=${intent.id} for ${config.rechargeAmount} credits ($${price})`,
    );
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private async acquireLock(organizationId: string): Promise<boolean> {
    try {
      const result = await this.redis.set(
        this.lockKey(organizationId),
        '1',
        'EX',
        this.LOCK_TTL_S,
        'NX',
      );
      return result === 'OK';
    } catch (err) {
      // Fail closed: Redis down → assume someone else is firing. The
      // batch worker will surface INSUFFICIENT_CREDITS on the affected
      // items. Better than double-charging.
      this.logger.warn(
        `[auto-topup] redis lock acquire failed (fail-closed): ${(err as Error)?.message}`,
      );
      return false;
    }
  }

  private async releaseLock(organizationId: string): Promise<void> {
    try {
      await this.redis.del(this.lockKey(organizationId));
    } catch {
      // best-effort
    }
  }

  private lockKey(organizationId: string): string {
    return `autotopup:lock:${organizationId}`;
  }

  private isOverMonthlyCap(config: AutoTopUpConfigEntity): boolean {
    if (config.monthlySpendingCap == null) return false;
    const now = new Date();
    const sameMonth =
      config.currentMonth === now.getMonth() + 1 &&
      config.currentYear === now.getFullYear();
    const spent = sameMonth ? Number(config.currentMonthSpent) : 0;
    const next = spent + CreditPurchaseService.priceForTier(config.rechargeAmount)!;
    return next > Number(config.monthlySpendingCap);
  }

  private async bumpMonthlySpent(
    config: AutoTopUpConfigEntity,
    delta: number,
  ): Promise<void> {
    const now = new Date();
    const sameMonth =
      config.currentMonth === now.getMonth() + 1 &&
      config.currentYear === now.getFullYear();
    config.currentMonthSpent = (sameMonth ? Number(config.currentMonthSpent) : 0) + delta;
    config.currentMonth = now.getMonth() + 1;
    config.currentYear = now.getFullYear();
  }
}
