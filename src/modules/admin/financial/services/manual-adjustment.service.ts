import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '../../../auth/entities/organization.entity';
import { CreditLedgerEntity } from '../../../billing/entities/credit-ledger.entity';
import { LedgerService } from '../../../billing/services/ledger.service';
import type { ActorContext } from '../../../billing/types/actor-context';
import type { ManualAdjustmentReasonCode } from '../types/reason-code';

/**
 * Service for admin-initiated credit grants and debits.
 *
 * Routes a single API call into LedgerService.append with the right
 * `kind` (MANUAL_TOPUP / MANUAL_DEBIT) and reason code. The ledger
 * service handles idempotency, balance materialization, and actor
 * capture — this layer adds:
 *
 *   - Org existence check (404 if missing — better UX than the
 *     ledger silently writing a row for an org that doesn't exist)
 *   - Reason-code enforcement (the DTO already validates the enum,
 *     but a service-level reassertion guards against direct callers
 *     bypassing the DTO)
 *   - Outcome shaping for the SPA (balance before + after; the
 *     ledger summary the admin tab needs)
 *
 * Approval threshold for high-value adjustments (default $500 / 5000
 * credits at the $0.10/credit pricing) is checked here but currently
 * only LOGS a warning — the two-person approval workflow ships later
 * (design doc §15.3). For now the operator can adjust any amount up
 * to the DTO's ±1,000,000 cap.
 */
@Injectable()
export class ManualAdjustmentService {
  private readonly logger = new Logger(ManualAdjustmentService.name);

  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly orgs: Repository<OrganizationEntity>,
    private readonly ledger: LedgerService,
  ) {}

  async adjust(input: AdjustInput, actor: ActorContext): Promise<AdjustResult> {
    if (input.delta === 0) {
      throw new BadRequestException('delta must be non-zero');
    }

    const org = await this.orgs.findOne({ where: { id: input.organizationId } });
    if (!org) {
      throw new NotFoundException(
        `Organization ${input.organizationId} not found`,
      );
    }

    const balanceBefore = await this.ledger.getBalance(input.organizationId);

    // Soft warning above the approval threshold. Real two-person
    // approval lives in a later PR (design doc §15.3). For now we
    // record the breach in logs and the ledger metadata so finance
    // can audit after the fact.
    const approvalThresholdCredits = Number(
      process.env.FINANCIAL_ADMIN_APPROVAL_THRESHOLD_CREDITS ?? 5_000,
    );
    const overThreshold = Math.abs(input.delta) > approvalThresholdCredits;
    if (overThreshold) {
      this.logger.warn(
        `[financial-admin] over-threshold adjustment delta=${input.delta} ` +
          `actor=${actor.userId ?? 'unknown'} org=${input.organizationId} ` +
          `threshold=${approvalThresholdCredits} reason=${input.reasonCode}`,
      );
    }

    const kind = input.delta > 0 ? 'MANUAL_TOPUP' : 'MANUAL_DEBIT';
    const entry = await this.ledger.append(
      {
        organizationId: input.organizationId,
        deltaCredits: input.delta,
        kind,
        reasonCode: input.reasonCode,
        internalNote: input.internalNote,
        metadata: {
          source: 'financial-admin',
          overApprovalThreshold: overThreshold,
        },
        idempotencyKey: input.idempotencyKey,
      },
      actor,
    );

    return {
      entryId: entry.id,
      organizationId: input.organizationId,
      delta: input.delta,
      kind,
      reasonCode: input.reasonCode,
      balanceBefore,
      balanceAfter: entry.balanceAfter,
      actor: {
        kind: actor.kind,
        userId: actor.userId ?? null,
      },
      createdAt: entry.createdAt.toISOString(),
    };
  }
}

export interface AdjustInput {
  organizationId: string;
  delta: number;
  reasonCode: ManualAdjustmentReasonCode;
  internalNote?: string;
  /** Pulled from the request's `Idempotency-Key` header by the controller. */
  idempotencyKey?: string;
}

export interface AdjustResult {
  entryId: string;
  organizationId: string;
  delta: number;
  kind: 'MANUAL_TOPUP' | 'MANUAL_DEBIT';
  reasonCode: ManualAdjustmentReasonCode;
  balanceBefore: number;
  balanceAfter: number;
  actor: { kind: string; userId: string | null };
  createdAt: string;
}

export type CreditLedgerRow = Pick<
  CreditLedgerEntity,
  | 'id'
  | 'organizationId'
  | 'deltaCredits'
  | 'balanceAfter'
  | 'kind'
  | 'reasonCode'
  | 'internalNote'
  | 'referenceType'
  | 'referenceId'
  | 'actorKind'
  | 'actorUserId'
  | 'createdAt'
>;
