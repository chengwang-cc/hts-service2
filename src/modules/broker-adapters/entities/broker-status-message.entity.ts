import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_status_messages')
@Index(['organizationId'])
@Index(['entryId'])
@Index(['source'])
@Index(['messageType'])
@Index(['createdAt'])
export class BrokerStatusMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  entryId: string;

  @Column('uuid', { nullable: true })
  exportJobId: string | null;

  @Column('varchar', { length: 60 })
  source: string;

  @Column('varchar', { length: 80 })
  messageType: string;

  @Column('varchar', { length: 20, default: 'info' })
  severity: 'info' | 'warning' | 'error' | 'success';

  @Column('text', { nullable: true })
  normalizedStatus: string | null;

  @Column('jsonb')
  rawMessage: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
