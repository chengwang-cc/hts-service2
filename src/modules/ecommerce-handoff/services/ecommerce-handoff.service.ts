import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { TelemetryService } from '../../observability/telemetry.service';
import {
  ECOM_HANDOFF_STATES,
  EcommerceHandoffDto,
  EcommerceHandoffItemDto,
} from '../dto/ecommerce-handoff.dto';
import { EcommerceHandoffEntity } from '../entities/ecommerce-handoff.entity';

export type EcomHandoffState = (typeof ECOM_HANDOFF_STATES)[number];

export interface HandoffWritebackPayload {
  state: EcomHandoffState;
  brokerReviewedAt?: string;
  reviewer?: string | null;
  notes?: string | null;
  metafields?: Record<string, unknown>;
}

/**
 * Ecommerce handoff service. Single source of truth for: a Shopify
 * (or WooCommerce / Magento / Wix / Etsy / WordPress / custom) order →
 * a broker review record. Idempotent on (platform, externalOrderId)
 * per tenant.
 *
 * State machine:
 *   classification_needed → landed_cost_ready
 *                         → broker_review_required → broker_released
 *                                                  → fulfillment_blocked
 *
 * Handoff creation does NOT silently fill country-of-origin, HTS, or
 * value — missing inputs flip the handoff to `classification_needed`
 * so the broker queue surfaces what's incomplete.
 */
@Injectable()
export class EcommerceHandoffService {
  private readonly logger = new Logger(EcommerceHandoffService.name);

  constructor(
    @InjectRepository(EcommerceHandoffEntity)
    private readonly handoffs: Repository<EcommerceHandoffEntity>,
    @Optional() private readonly audit: AuditService | null = null,
    @Optional() private readonly telemetry: TelemetryService | null = null,
  ) {}

  /**
   * Create or update the handoff for one external order. Returns the
   * persisted record plus a `wasCreated` boolean so the caller can
   * choose whether to also create a broker review task.
   */
  async upsert(
    organizationId: string,
    actor: string,
    input: EcommerceHandoffDto,
  ): Promise<{
    handoff: EcommerceHandoffEntity;
    wasCreated: boolean;
    missingFields: string[];
  }> {
    const missingFields = detectMissingFields(input);
    const state: EcomHandoffState = missingFields.length
      ? 'classification_needed'
      : 'broker_review_required';

    const existing = await this.handoffs.findOne({
      where: {
        organizationId,
        platform: input.platform,
        externalOrderId: input.externalOrderId,
      },
    });

    const fields = {
      organizationId,
      platform: input.platform,
      externalOrderId: input.externalOrderId,
      externalStoreId: input.externalStoreId ?? null,
      originCountry: input.originCountry.toUpperCase(),
      destinationCountry: input.destinationCountry.toUpperCase(),
      portOfEntry: input.portOfEntry ?? null,
      items: input.items.map((item) => normalizeItem(item)),
      shipmentValue:
        input.shipmentValue != null ? String(input.shipmentValue) : null,
      shipmentCurrency: input.shipmentCurrency ?? null,
      metadata: input.metadata ?? null,
      updatedBy: actor,
    };

    if (existing) {
      Object.assign(existing, fields, {
        // Preserve the existing state if the operator already advanced
        // it; only auto-rewind to classification_needed when newly missing.
        state: missingFields.length ? 'classification_needed' : existing.state,
      });
      const saved = await this.handoffs.save(existing);
      await this.recordAudit(
        'ecommerce_handoff.updated',
        actor,
        saved.id,
        { state: saved.state, missingFields, platform: input.platform },
      );
      this.telemetry?.countEvent('ecommerce_handoff_received_total', {
        platform: input.platform,
        outcome: 'updated',
      });
      return { handoff: saved, wasCreated: false, missingFields };
    }

    const row = this.handoffs.create({
      ...fields,
      state,
      createdBy: actor,
    });
    const saved = await this.handoffs.save(row);
    await this.recordAudit(
      'ecommerce_handoff.created',
      actor,
      saved.id,
      { state: saved.state, missingFields, platform: input.platform },
    );
    this.telemetry?.countEvent('ecommerce_handoff_received_total', {
      platform: input.platform,
      outcome: 'created',
    });
    return { handoff: saved, wasCreated: true, missingFields };
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<EcommerceHandoffEntity> {
    const row = await this.handoffs.findOne({ where: { id } });
    if (!row || row.organizationId !== organizationId) {
      throw new NotFoundException('handoff not found');
    }
    return row;
  }

  async list(
    organizationId: string,
    filter: {
      platform?: string;
      state?: string;
      limit?: number;
    } = {},
  ): Promise<EcommerceHandoffEntity[]> {
    return this.handoffs.find({
      where: {
        organizationId,
        ...(filter.platform ? { platform: filter.platform } : {}),
        ...(filter.state ? { state: filter.state } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.max(1, Math.min(500, filter.limit ?? 100)),
    });
  }

  async transition(
    organizationId: string,
    actor: string,
    id: string,
    target: EcomHandoffState,
    notes?: string | null,
  ): Promise<EcommerceHandoffEntity> {
    const row = await this.getById(organizationId, id);
    const allowed = nextAllowedStates(row.state as EcomHandoffState);
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        `cannot transition handoff from ${row.state} to ${target}`,
      );
    }
    row.state = target;
    row.updatedBy = actor;
    const saved = await this.handoffs.save(row);
    await this.recordAudit(
      `ecommerce_handoff.state_${target}`,
      actor,
      saved.id,
      { previousState: row.state, notes: notes ?? null },
    );
    return saved;
  }

  async recordWriteback(
    organizationId: string,
    actor: string,
    id: string,
    payload: HandoffWritebackPayload,
  ): Promise<EcommerceHandoffEntity> {
    const row = await this.getById(organizationId, id);
    try {
      row.writebackStatus = {
        ...(row.writebackStatus ?? {}),
        state: payload.state,
        brokerReviewedAt: payload.brokerReviewedAt ?? new Date().toISOString(),
        reviewer: payload.reviewer ?? null,
        notes: payload.notes ?? null,
        metafields: payload.metafields ?? null,
      };
      row.updatedBy = actor;
      const saved = await this.handoffs.save(row);
      await this.recordAudit(
        'ecommerce_handoff.writeback',
        actor,
        saved.id,
        { state: payload.state, hasMetafields: !!payload.metafields },
      );
      return saved;
    } catch (e) {
      this.telemetry?.countEvent(
        'ecommerce_handoff_writeback_failures_total',
        { platform: row.platform },
      );
      throw e;
    }
  }

  async linkMarketplaceRequest(
    organizationId: string,
    actor: string,
    id: string,
    marketplaceRequestId: string,
  ): Promise<EcommerceHandoffEntity> {
    const row = await this.getById(organizationId, id);
    row.marketplaceRequestId = marketplaceRequestId;
    row.updatedBy = actor;
    const saved = await this.handoffs.save(row);
    await this.recordAudit(
      'ecommerce_handoff.linked_marketplace_request',
      actor,
      saved.id,
      { marketplaceRequestId },
    );
    return saved;
  }

  private async recordAudit(
    eventType: string,
    actor: string,
    handoffId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.record({
      eventType,
      actorUserId: actor,
      resourceType: 'ecommerce_handoff',
      resourceId: handoffId,
      source: 'ecommerce-handoff',
      metadata,
    });
  }
}

function detectMissingFields(input: EcommerceHandoffDto): string[] {
  const missing: string[] = [];
  if (!input.originCountry) missing.push('originCountry');
  if (!input.destinationCountry) missing.push('destinationCountry');
  if (!input.items?.length) missing.push('items');
  for (let i = 0; i < (input.items ?? []).length; i += 1) {
    const item = input.items[i];
    if (!item.productDescription) missing.push(`items[${i}].productDescription`);
    if (!item.originCountry) missing.push(`items[${i}].originCountry`);
    if (!item.hts) missing.push(`items[${i}].hts`);
  }
  return missing;
}

function normalizeItem(item: EcommerceHandoffItemDto): Record<string, unknown> {
  return {
    productDescription: item.productDescription.trim(),
    hts: item.hts ?? null,
    originCountry: item.originCountry?.toUpperCase() ?? null,
    unitValue: item.unitValue ?? null,
    currency: item.currency ?? null,
    quantity: item.quantity ?? null,
  };
}

function nextAllowedStates(current: EcomHandoffState): EcomHandoffState[] {
  switch (current) {
    case 'classification_needed':
      return ['landed_cost_ready', 'broker_review_required', 'fulfillment_blocked'];
    case 'landed_cost_ready':
      return ['broker_review_required', 'broker_released', 'fulfillment_blocked'];
    case 'broker_review_required':
      return ['broker_released', 'fulfillment_blocked'];
    case 'broker_released':
      return ['fulfillment_blocked'];
    case 'fulfillment_blocked':
      return ['broker_review_required'];
    default:
      return ECOM_HANDOFF_STATES as unknown as EcomHandoffState[];
  }
}
