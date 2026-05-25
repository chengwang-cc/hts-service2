import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('broker_credit_ledger')
@Index(['organizationId'])
@Index(['eventType'])
@Index(['createdAt'])
export class BrokerCreditLedgerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 60 })
  creditType: 'lead' | 'concierge';

  @Column('int')
  delta: number;

  @Column('varchar', { length: 80 })
  eventType: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('uuid', { nullable: true })
  initiatedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
