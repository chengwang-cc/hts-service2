import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Stripe dispute (chargeback) mirror + internal workflow state.
 *
 * One row per Stripe Dispute object. The flow:
 *
 *   1. `charge.dispute.created` arrives → INSERT row with
 *      internal_state='OPEN', funds_withdrawn_at=NULL, evidence_due_by
 *      populated. We also freeze auto_topup_configs.enabled on the org
 *      (chargebacks usually mean a card is stolen or compromised; we
 *      don't want to re-charge that card automatically until ops can
 *      look at it).
 *   2. `charge.dispute.funds_withdrawn` arrives → write a CHARGEBACK
 *      row into credit_ledger (debits the org's balance for the
 *      amount we lost to Stripe), store the ledger uuid in
 *      `chargeback_ledger_entry_id`.
 *   3. `charge.dispute.updated` arrives → UPDATE stripe_status,
 *      evidence_due_by, evidence (Stripe normalizes the evidence
 *      object as the merchant types into the Dashboard).
 *   4. Admin posts evidence via POST .../disputes/:id/respond →
 *      we call stripe.disputes.update with submit:true, then flip
 *      internal_state='EVIDENCE_SUBMITTED' and bump submission_count.
 *   5. `charge.dispute.closed` arrives →
 *      - status='won': forward-post a REVERSAL row that undoes the
 *        CHARGEBACK, flip internal_state='WON'.
 *      - status='lost': leave the CHARGEBACK in place, flip
 *        internal_state='LOST'. No funds return.
 *
 * Append-only invariant: the chargeback + reversal ledger rows are
 * pgsql-trigger-protected (see CreditLedger migration). The dispute
 * row itself is mutable — it's a state machine, not a journal.
 *
 * Stripe enums (per their API docs as of 2026):
 *   stripe_status:
 *     warning_needs_response, warning_under_review, warning_closed,
 *     needs_response, under_review, won, lost, prevented
 *   reason: free-form short string from Stripe (~12 known values)
 *
 * Design doc:    docs/2026-06-17/0736_financial-management-system-design.md §9
 * Execution doc: docs/2026-06-17/0747_financial-management-execution-plan.md §6.1
 */
export type DisputeStripeStatus =
  | 'warning_needs_response'
  | 'warning_under_review'
  | 'warning_closed'
  | 'needs_response'
  | 'under_review'
  | 'won'
  | 'lost'
  | 'prevented';

/**
 * Internal workflow state — distinct from Stripe's status so we can
 * track our own evidence-drafting flow without mutating Stripe-mirror
 * columns.
 *
 *   OPEN                — dispute landed; ops hasn't looked at it yet
 *   EVIDENCE_DRAFTING   — ops opened the detail page (optional intermediate)
 *   EVIDENCE_SUBMITTED  — admin submitted via our endpoint; Stripe is reviewing
 *   WON                 — Stripe ruled in our favor; CHARGEBACK reversed
 *   LOST                — Stripe ruled against us; CHARGEBACK stands
 *   WITHDRAWN           — customer withdrew the dispute before close
 */
export type DisputeInternalState =
  | 'OPEN'
  | 'EVIDENCE_DRAFTING'
  | 'EVIDENCE_SUBMITTED'
  | 'WON'
  | 'LOST'
  | 'WITHDRAWN';

@Entity('disputes')
@Index(['organizationId', 'createdAt'])
@Index(['internalState', 'evidenceDueBy'])
@Index(['stripeDisputeId'], { unique: true })
@Index(['stripeChargeId'])
export class DisputeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  /** Stripe `dp_*` id. Always present on insert. */
  @Column('varchar', { length: 64, name: 'stripe_dispute_id' })
  stripeDisputeId: string;

  /** Stripe `ch_*` id. The charge being disputed. */
  @Column('varchar', { length: 64, name: 'stripe_charge_id' })
  stripeChargeId: string;

  /** Stripe `pi_*` id. Optional — older charges may not link back. */
  @Column('varchar', {
    length: 64,
    name: 'stripe_payment_intent_id',
    nullable: true,
  })
  stripePaymentIntentId: string | null;

  /** Disputed amount in minor units (cents for USD). */
  @Column('bigint', { name: 'amount_minor_units' })
  amountMinorUnits: string;

  @Column('char', { length: 3, default: 'USD' })
  currency: string;

  /**
   * Short Stripe reason code (e.g. "fraudulent", "product_not_received").
   * Free-form on Stripe's side — we don't constrain it here.
   */
  @Column('varchar', { length: 64 })
  reason: string;

  @Column('varchar', { length: 32, name: 'stripe_status' })
  stripeStatus: DisputeStripeStatus;

  @Column('varchar', { length: 32, name: 'internal_state', default: 'OPEN' })
  internalState: DisputeInternalState;

  /**
   * Hard deadline from Stripe — after this, the dispute auto-loses if
   * we haven't submitted evidence. Sorted ASC on the admin queue.
   */
  @Column('timestamp', { name: 'evidence_due_by', nullable: true })
  evidenceDueBy: Date | null;

  /** Number of times evidence has been submitted. Stripe allows one. */
  @Column('int', { name: 'submission_count', default: 0 })
  submissionCount: number;

  /**
   * Stripe's `is_charge_refundable` field. False once funds withdrawn;
   * we surface this on the admin form so ops can't accidentally
   * issue a refund + dispute the same charge.
   */
  @Column('boolean', { name: 'is_charge_refundable', default: false })
  isChargeRefundable: boolean;

  /**
   * Stripe's normalized evidence bag (~30 fields). Stored as jsonb so
   * the schema stays flexible if Stripe adds fields. Populated by
   * `charge.dispute.updated` webhook + our own POST.
   */
  @Column('jsonb', { default: () => `'{}'::jsonb` })
  evidence: Record<string, unknown>;

  /** Set on `charge.dispute.funds_withdrawn` webhook. */
  @Column('timestamp', { name: 'funds_withdrawn_at', nullable: true })
  fundsWithdrawnAt: Date | null;

  /** Set on `charge.dispute.funds_reinstated` (a "won" dispute). */
  @Column('timestamp', { name: 'funds_reinstated_at', nullable: true })
  fundsReinstatedAt: Date | null;

  /** FK to credit_ledger CHARGEBACK row. NULL until funds_withdrawn fires. */
  @Column('uuid', { name: 'chargeback_ledger_entry_id', nullable: true })
  chargebackLedgerEntryId: string | null;

  /** FK to credit_ledger REVERSAL row. Set on `closed` if won. */
  @Column('uuid', { name: 'reversal_ledger_entry_id', nullable: true })
  reversalLedgerEntryId: string | null;

  /**
   * Stripe-shape idempotency on evidence submission. Prevents two
   * concurrent admin clicks from double-submitting (Stripe rejects
   * the second, but we never want to make the call twice).
   */
  @Column('varchar', {
    length: 255,
    name: 'submission_idempotency_key',
    nullable: true,
  })
  submissionIdempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
