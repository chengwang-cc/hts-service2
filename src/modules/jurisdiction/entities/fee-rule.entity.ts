import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * FeeRuleEntity - import/clearance/declaration/processing fees.
 * Examples: US MPF, US HMF, AU import processing charge, NZ IETF,
 * GB declaration fee.
 */
@Entity('fee_rules')
@Index(['jurisdictionCode'])
@Index(['jurisdictionCode', 'feeType'])
@Index(['effectiveFrom'])
export class FeeRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 8 })
  jurisdictionCode: string;

  /** 'MPF' | 'HMF' | 'declaration' | 'brokerage' | 'advancement' | 'prepayment' | 'carrier' */
  @Column('varchar', { length: 32 })
  feeType: string;

  @Column('varchar', { length: 128 })
  name: string;

  /** 'ad_valorem' | 'fixed' | 'tiered' */
  @Column('varchar', { length: 24 })
  rateType: string;

  /** mathjs formula. May reference value/weight/quantity/duty/total. */
  @Column('text')
  formula: string;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  minAmount: number | null;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  maxAmount: number | null;

  /** 'sea' | 'air' | 'truck' | 'rail' | 'mail' | null = all */
  @Column('varchar', { length: 16, nullable: true })
  transportMode: string | null;

  /** 'formal' | 'informal' | 'sezz' | null = all */
  @Column('varchar', { length: 24, nullable: true })
  declarationType: string | null;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  thresholdAmount: number | null;

  @Column('jsonb', { nullable: true })
  appliesWhen: Record<string, any> | null;

  @Column('date')
  effectiveFrom: string;

  @Column('date', { nullable: true })
  effectiveTo: string | null;

  @Column('uuid', { nullable: true })
  sourceCitationId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
