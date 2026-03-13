import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('lookup_intent_rule')
@Index(['ruleId'], { unique: true })
@Index(['enabled'])
@Index(['priority'])
export class LookupIntentRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique rule identifier, e.g. 'FIRE_PIT_INTENT' */
  @Column('varchar', { length: 100 })
  ruleId: string;

  @Column('text')
  description: string;

  /** Serialized TokenPattern */
  @Column('jsonb')
  pattern: Record<string, unknown>;

  /** Serialized { stripTokens?: string[] } */
  @Column('jsonb', { nullable: true })
  lexicalFilter: Record<string, unknown> | null;

  /** Serialized InjectSpec[] */
  @Column('jsonb', { nullable: true })
  inject: Record<string, unknown>[] | null;

  /** Serialized WhitelistSpec */
  @Column('jsonb', { nullable: true })
  whitelist: Record<string, unknown> | null;

  /** Serialized ScoreAdjustment[] */
  @Column('jsonb', { nullable: true })
  boosts: Record<string, unknown>[] | null;

  /** Serialized ScoreAdjustment[] */
  @Column('jsonb', { nullable: true })
  penalties: Record<string, unknown>[] | null;

  @Column('boolean', { default: true })
  enabled: boolean;

  /** Lower priority value = evaluated first */
  @Column('integer', { default: 0 })
  priority: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
