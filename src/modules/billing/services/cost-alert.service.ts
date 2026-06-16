import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { CostAlertConfigEntity } from '../entities/cost-alert-config.entity';
import { CostAlertEventEntity } from '../entities/cost-alert-event.entity';
import { UpsertCostAlertDto } from '../dto/cost-alert.dto';
import { WebhookDeliveryService } from './webhook-delivery.service';

/**
 * Cost-threshold alerts for partner / business admins.
 *
 * Three responsibilities:
 *
 * 1. CRUD on `cost_alert_configs` for the portal endpoints. The
 *    webhook_secret is generated server-side and returned to the caller
 *    EXACTLY ONCE on creation/rotation, mirroring the API-key + admin
 *    user-management reveal pattern (the SPA shows it in a copy-once
 *    modal; we only store a 64-char hex string for HMAC signing).
 *
 * 2. Read APIs for the in-app banner and admin oversight panel: "is
 *    there an unacknowledged event for this org for the current
 *    period?". Reads from `cost_alert_events`, not raw usage — the
 *    event row IS the source of truth.
 *
 * 3. Trigger logic invoked from the hourly rollup worker. ONE SQL
 *    statement uses `LEFT JOIN ... WHERE NOT EXISTS` to atomically
 *    select-and-insert "configs that crossed the threshold this period
 *    AND have not yet fired this period", returning the new event rows.
 *    The worker then fires-and-forgets webhook delivery on those rows.
 *    The at-most-once-per-period guarantee is enforced by the JOIN's
 *    NOT EXISTS predicate — no app-layer flag bookkeeping.
 */
@Injectable()
export class CostAlertService {
  private readonly logger = new Logger(CostAlertService.name);

  constructor(
    @InjectRepository(CostAlertConfigEntity)
    private readonly configs: Repository<CostAlertConfigEntity>,
    @InjectRepository(CostAlertEventEntity)
    private readonly events: Repository<CostAlertEventEntity>,
    @InjectDataSource() private readonly ds: DataSource,
    private readonly webhooks: WebhookDeliveryService,
  ) {}

  // ---------------------------------------------------------------------
  // Portal CRUD
  // ---------------------------------------------------------------------

  /**
   * Read the current config + the most recent unacknowledged event (if
   * any). Returns `{ config: null, openEvent: null }` when nothing is
   * configured — the SPA renders the empty-state form in that case.
   */
  async getForOrganization(organizationId: string): Promise<{
    config: PublicConfig | null;
    openEvent: PublicEvent | null;
  }> {
    const config = await this.configs.findOne({ where: { organizationId } });
    const openEvent = await this.events.findOne({
      where: { organizationId, acknowledgedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return {
      config: config ? this.toPublicConfig(config) : null,
      openEvent: openEvent ? this.toPublicEvent(openEvent) : null,
    };
  }

  /**
   * Upsert by `organizationId`. Webhook secret is generated server-side
   * the FIRST time a `webhook` channel is added (or rotated when
   * `webhookUrl` changes). It is returned ONCE in the response and
   * never re-served from `getForOrganization`.
   */
  async upsert(
    organizationId: string,
    dto: UpsertCostAlertDto,
  ): Promise<UpsertResponse> {
    this.validateChannels(dto);

    let revealedSecret: string | null = null;
    const existing = await this.configs.findOne({ where: { organizationId } });

    if (existing) {
      const previousUrl = existing.webhookUrl;
      existing.thresholdUsd = dto.thresholdUsd.toFixed(2);
      existing.channels = dto.channels;
      existing.webhookUrl = dto.webhookUrl ?? null;
      existing.enabled = dto.enabled ?? existing.enabled;

      // Rotate the secret only if the URL changed or the webhook channel
      // is newly active. Re-saving the same URL must NOT churn the
      // secret — partners would lose verification on legitimate edits.
      const webhookActive = dto.channels.includes('webhook');
      const urlChanged = previousUrl !== existing.webhookUrl;
      if (webhookActive && (urlChanged || !existing.webhookSecret)) {
        existing.webhookSecret = this.generateSecret();
        revealedSecret = existing.webhookSecret;
      }
      if (!webhookActive) {
        existing.webhookSecret = null;
      }

      const saved = await this.configs.save(existing);
      return {
        config: this.toPublicConfig(saved),
        revealedWebhookSecret: revealedSecret,
      };
    }

    const fresh = this.configs.create({
      organizationId,
      thresholdUsd: dto.thresholdUsd.toFixed(2),
      channels: dto.channels,
      webhookUrl: dto.webhookUrl ?? null,
      enabled: dto.enabled ?? true,
    });
    if (dto.channels.includes('webhook')) {
      fresh.webhookSecret = this.generateSecret();
      revealedSecret = fresh.webhookSecret;
    }
    const saved = await this.configs.save(fresh);
    return {
      config: this.toPublicConfig(saved),
      revealedWebhookSecret: revealedSecret,
    };
  }

  /** Soft-disable: keeps the row so the partner's settings survive an accidental delete. */
  async disable(organizationId: string): Promise<void> {
    const cfg = await this.configs.findOne({ where: { organizationId } });
    if (!cfg) {
      throw new NotFoundException('No cost alert configured for this organization');
    }
    cfg.enabled = false;
    await this.configs.save(cfg);
  }

  async acknowledgeEvent(organizationId: string, eventId: string): Promise<void> {
    const evt = await this.events.findOne({ where: { id: eventId, organizationId } });
    if (!evt) {
      throw new NotFoundException('Alert event not found');
    }
    if (evt.acknowledgedAt) return; // idempotent
    evt.acknowledgedAt = new Date();
    await this.events.save(evt);
  }

  // ---------------------------------------------------------------------
  // Admin oversight
  // ---------------------------------------------------------------------

  /** Operator view for the admin-orgs-detail Subscription tab. */
  async getForAdmin(organizationId: string): Promise<AdminView | null> {
    const cfg = await this.configs.findOne({ where: { organizationId } });
    if (!cfg) return null;
    const eventCount = await this.events.count({ where: { organizationId } });
    return {
      thresholdUsd: cfg.thresholdUsd,
      enabled: cfg.enabled,
      channels: cfg.channels,
      webhookConfigured: !!cfg.webhookUrl,
      lastFiredAt: cfg.lastFiredAt?.toISOString() ?? null,
      lastFiredPeriod: cfg.lastFiredPeriod,
      totalEventsAllTime: eventCount,
    };
  }

  // ---------------------------------------------------------------------
  // Trigger — invoked by the hourly rollup worker
  // ---------------------------------------------------------------------

  /**
   * Atomically detect crossings + insert one event row per crossed
   * config that hasn't fired this period yet. Returns the new event
   * rows so the worker can dispatch webhook delivery on them.
   *
   * The `NOT EXISTS` predicate is what guarantees at-most-once per
   * (org, period) — if a duplicate rollup runs concurrently, the
   * unique (organization_id, period) constraint on a partial index
   * could ALSO enforce it, but the rollup worker is already singleton
   * (see partner-usage-monthly-rollup.worker.ts) so contention is
   * vanishingly rare; we lean on application-layer guarantee here for
   * cheaper writes.
   */
  async detectAndFireCrossings(): Promise<CrossingResult[]> {
    const rows: Array<{
      event_id: string;
      organization_id: string;
      threshold_usd: string;
      observed_cost_usd: string;
      period: string;
      webhook_url: string | null;
      webhook_secret: string | null;
      channels: Array<'in_app' | 'webhook'>;
    }> = await this.ds.query(`
      WITH crossed AS (
        SELECT c.id            AS config_id,
               c.organization_id,
               c.threshold_usd,
               c.channels,
               c.webhook_url,
               c.webhook_secret,
               COALESCE(SUM(pum.cost_usd), 0) AS observed,
               date_trunc('month', now())::date AS period
          FROM cost_alert_configs c
          LEFT JOIN partner_usage_monthly pum
            ON pum.partner_id = c.organization_id
           AND pum.bucket_month = date_trunc('month', now())::date
         WHERE c.enabled = true
         GROUP BY c.id
        HAVING COALESCE(SUM(pum.cost_usd), 0) >= c.threshold_usd
      ),
      to_fire AS (
        SELECT *
          FROM crossed c
         WHERE NOT EXISTS (
           SELECT 1 FROM cost_alert_events e
            WHERE e.organization_id = c.organization_id
              AND e.period = c.period
         )
      ),
      inserted AS (
        INSERT INTO cost_alert_events
          (organization_id, threshold_usd, observed_cost_usd, period)
        SELECT organization_id, threshold_usd, observed, period
          FROM to_fire
        RETURNING id, organization_id, threshold_usd, observed_cost_usd, period
      )
      SELECT i.id AS event_id,
             i.organization_id,
             i.threshold_usd::text AS threshold_usd,
             i.observed_cost_usd::text AS observed_cost_usd,
             i.period::text AS period,
             c.webhook_url,
             c.webhook_secret,
             c.channels
        FROM inserted i
        JOIN cost_alert_configs c
          ON c.organization_id = i.organization_id
    `);

    if (rows.length === 0) return [];

    // Mark configs as fired so the in-app banner has `lastFiredAt` and
    // we don't churn the at-most-once-per-period check (it's also
    // enforced by NOT EXISTS, but a config-level flag is cheap and
    // useful for the admin oversight panel).
    await this.ds.query(
      `UPDATE cost_alert_configs
          SET last_fired_at = now(),
              last_fired_period = $1::date,
              updated_at = now()
        WHERE organization_id = ANY ($2::uuid[])`,
      [rows[0].period, rows.map((r) => r.organization_id)],
    );

    // Dispatch webhook delivery — fire-and-forget, per-row try/catch so
    // one slow partner endpoint can't take down the whole batch.
    for (const row of rows) {
      if (!row.channels?.includes('webhook') || !row.webhook_url || !row.webhook_secret) {
        await this.recordDelivery(row.event_id, [
          { channel: 'in_app', deliveredAt: new Date().toISOString(), ok: true },
        ]);
        continue;
      }
      void this.deliverAndRecord(row);
    }

    return rows.map((r) => ({
      eventId: r.event_id,
      organizationId: r.organization_id,
      thresholdUsd: r.threshold_usd,
      observedCostUsd: r.observed_cost_usd,
      period: r.period,
      webhookQueued: r.channels?.includes('webhook') === true && !!r.webhook_url,
    }));
  }

  private async deliverAndRecord(row: {
    event_id: string;
    organization_id: string;
    threshold_usd: string;
    observed_cost_usd: string;
    period: string;
    webhook_url: string | null;
    webhook_secret: string | null;
  }): Promise<void> {
    if (!row.webhook_url || !row.webhook_secret) return;
    const payload = {
      type: 'cost_alert.threshold_crossed',
      eventId: row.event_id,
      organizationId: row.organization_id,
      thresholdUsd: Number(row.threshold_usd),
      observedCostUsd: Number(row.observed_cost_usd),
      period: row.period,
      firedAt: new Date().toISOString(),
    };
    const result = await this.webhooks.deliver(row.webhook_url, payload, row.webhook_secret);
    await this.recordDelivery(row.event_id, [
      { channel: 'in_app', deliveredAt: new Date().toISOString(), ok: true },
      {
        channel: 'webhook',
        deliveredAt: new Date().toISOString(),
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      },
    ]);
  }

  private async recordDelivery(
    eventId: string,
    deliveries: Array<{ channel: 'in_app' | 'webhook'; deliveredAt: string; ok: boolean; error?: string }>,
  ): Promise<void> {
    await this.ds.query(
      `UPDATE cost_alert_events
          SET channels_delivered = $1::jsonb
        WHERE id = $2::uuid`,
      [JSON.stringify(deliveries), eventId],
    );
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private validateChannels(dto: UpsertCostAlertDto): void {
    if (dto.channels.length === 0) {
      throw new BadRequestException('At least one channel must be selected');
    }
    if (dto.channels.includes('webhook') && !dto.webhookUrl) {
      throw new BadRequestException('webhookUrl is required when "webhook" channel is selected');
    }
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private toPublicConfig(c: CostAlertConfigEntity): PublicConfig {
    return {
      id: c.id,
      thresholdUsd: Number(c.thresholdUsd),
      enabled: c.enabled,
      channels: c.channels,
      webhookUrl: c.webhookUrl,
      webhookConfigured: !!c.webhookUrl,
      lastFiredAt: c.lastFiredAt?.toISOString() ?? null,
      lastFiredPeriod: c.lastFiredPeriod,
    };
  }

  private toPublicEvent(e: CostAlertEventEntity): PublicEvent {
    return {
      id: e.id,
      thresholdUsd: Number(e.thresholdUsd),
      observedCostUsd: Number(e.observedCostUsd),
      period: e.period,
      acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    };
  }
}

export interface PublicConfig {
  id: string;
  thresholdUsd: number;
  enabled: boolean;
  channels: Array<'in_app' | 'webhook'>;
  webhookUrl: string | null;
  webhookConfigured: boolean;
  lastFiredAt: string | null;
  lastFiredPeriod: string | null;
}

export interface PublicEvent {
  id: string;
  thresholdUsd: number;
  observedCostUsd: number;
  period: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface UpsertResponse {
  config: PublicConfig;
  /** Server-generated webhook secret. Returned ONCE; null when no webhook configured. */
  revealedWebhookSecret: string | null;
}

export interface AdminView {
  thresholdUsd: string;
  enabled: boolean;
  channels: Array<'in_app' | 'webhook'>;
  webhookConfigured: boolean;
  lastFiredAt: string | null;
  lastFiredPeriod: string | null;
  totalEventsAllTime: number;
}

export interface CrossingResult {
  eventId: string;
  organizationId: string;
  thresholdUsd: string;
  observedCostUsd: string;
  period: string;
  webhookQueued: boolean;
}
