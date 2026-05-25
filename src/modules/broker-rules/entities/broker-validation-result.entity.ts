import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_validation_results')
@Index(['brokerOrganizationId'])
@Index(['entryId'])
@Index(['lineId'])
@Index(['ruleCode'])
@Index(['severity'])
@Index(['status'])
@Index(['entryId', 'status'])
export class BrokerValidationResultEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  entryId: string;

  @Column('uuid', { nullable: true })
  lineId: string | null;

  @Column('varchar', { length: 80 })
  ruleCode: string;

  @Column('varchar', { length: 20 })
  severity: 'info' | 'warning' | 'blocker';

  @Column('varchar', { length: 40, default: 'open' })
  status: 'open' | 'acknowledged' | 'resolved' | 'suppressed';

  @Column('text')
  message: string;

  @Column('jsonb', { nullable: true })
  details: Record<string, unknown> | null;

  @Column('uuid', { nullable: true })
  resolvedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
