import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * RuleStatusHistoryEntity (W0.5.T8 — 2026-05-26).
 *
 * Append-only audit log of every rule-status mutation. The
 * `rule_status` table holds the current state; this table holds the
 * full history. Compliance audits ("when was `eu.cbam` enabled? who
 * enabled it? what was the reason?") query this table.
 *
 * Pattern: written by `RuleStatusService.setEnabled()` on every
 * mutation. Never updated or deleted — pure event log.
 *
 * To materialize this table:
 *   scripts/generate-migration.sh rule-status-history
 *   scripts/run-migration.sh
 */
@Entity('rule_status_history')
@Index(['ruleId'])
@Index(['ruleId', 'changedAt'])
@Index(['changedAt'])
export class RuleStatusHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Same as `RuleStatusEntity.ruleId`. */
  @Column('varchar', { length: 200 })
  ruleId: string;

  /** Previous `enabled` state — null on the row that records the initial seed. */
  @Column('boolean', { nullable: true })
  previousEnabled: boolean | null;

  /** New `enabled` state recorded by this row. */
  @Column('boolean')
  newEnabled: boolean;

  /** Previous effective window — captured for audit completeness. */
  @Column('timestamptz', { nullable: true })
  previousEffectiveFrom: Date | null;

  @Column('timestamptz', { nullable: true })
  previousEffectiveTo: Date | null;

  /** New effective window after the mutation. */
  @Column('timestamptz', { nullable: true })
  newEffectiveFrom: Date | null;

  @Column('timestamptz', { nullable: true })
  newEffectiveTo: Date | null;

  /** Free-text operator-supplied reason. */
  @Column('text', { nullable: true })
  reason: string | null;

  /** User id or system name that made the change. */
  @Column('varchar', { length: 200 })
  changedBy: string;

  @CreateDateColumn()
  changedAt: Date;
}
