import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_decisions')
@Index(['brokerOrganizationId'])
@Index(['targetType', 'targetId'])
@Index(['suggestionId'])
@Index(['decidedByUserId'])
@Index(['decidedAt'])
@Index(['decision'])
export class BrokerDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid', { nullable: true })
  suggestionId: string | null;

  @Column('varchar', { length: 60 })
  targetType: string;

  @Column('uuid')
  targetId: string;

  @Column('varchar', { length: 60 })
  suggestionType: string;

  @Column('varchar', { length: 40 })
  decision: 'accept' | 'reject' | 'override';

  @Column('jsonb', { nullable: true })
  finalValue: Record<string, unknown> | null;

  @Column('uuid')
  decidedByUserId: string;

  @Column('boolean', { default: false })
  licensedBrokerRequired: boolean;

  @Column('boolean', { default: false })
  licensedBrokerSatisfied: boolean;

  @Column('uuid', { nullable: true })
  licensedBrokerUserId: string | null;

  @Column('text', { nullable: true })
  reason: string | null;

  @Column('jsonb', { nullable: true })
  bulkContext: {
    bulkActionId: string;
    sharedRationale: string;
    affectedTargetCount: number;
  } | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'decided_at' })
  decidedAt: Date;
}
