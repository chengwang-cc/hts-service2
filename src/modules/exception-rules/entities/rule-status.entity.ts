import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * RuleStatusEntity (Phase 1, P1.T4).
 *
 * One row per exception rule recording whether it is currently enabled.
 * Absence of a row means "enabled" — rules ship enabled by default so a
 * fresh deploy of new rules takes effect without an explicit toggle.
 *
 * The `effectiveFrom` / `effectiveTo` window lets operators stage a rule
 * before its statutory effective date and retire it after, without code
 * changes.
 *
 * Audit replay: the calculator's audit snapshot captures the full
 * `ruleStatusSnapshot` at quote time so historical quotes replay
 * correctly even if a rule was later toggled.
 *
 * To materialize this table, run:
 *   scripts/generate-migration.sh rule-status
 *   scripts/run-migration.sh
 */
@Entity('rule_status')
@Index(['effectiveFrom'])
@Index(['effectiveTo'])
export class RuleStatusEntity {
  /** Same shape as `ExceptionRule.id` — e.g. "us.section232.aluminum-smelt-cast". */
  @PrimaryColumn('varchar', { length: 200 })
  ruleId: string;

  @Column('boolean', { default: true })
  enabled: boolean;

  /** Inclusive lower bound; null = no lower bound. */
  @Column('timestamptz', { nullable: true })
  effectiveFrom: Date | null;

  /** Exclusive upper bound; null = no upper bound. */
  @Column('timestamptz', { nullable: true })
  effectiveTo: Date | null;

  /** Free-text reason for the most recent toggle (audit + operator UX). */
  @Column('text', { nullable: true })
  reason: string | null;

  /** User id or system name that made the change. */
  @Column('varchar', { length: 200 })
  changedBy: string;

  @CreateDateColumn()
  changedAt: Date;
}
