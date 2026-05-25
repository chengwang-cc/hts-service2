import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrokerShipmentEntity } from './broker-shipment.entity';
import { BrokerEntryLineEntity } from './broker-entry-line.entity';

@Entity('broker_entries')
@Index(['brokerOrganizationId'])
@Index(['clientId'])
@Index(['shipmentId'])
@Index(['status'])
@Index(['riskLevel'])
@Index(['assigneeUserId'])
@Index(['entryNumber'])
export class BrokerEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid')
  clientId: string;

  @Column('uuid', { nullable: true })
  shipmentId: string | null;

  @Column('uuid', { nullable: true })
  packetId: string | null;

  @Column('varchar', { length: 60, nullable: true })
  entryNumber: string | null;

  @Column('varchar', { length: 40, default: 'consumption' })
  entryType:
    | 'consumption'
    | 'informal'
    | 'warehouse'
    | 'fta'
    | 'tib'
    | 'in_bond'
    | 'isf'
    | 'other';

  @Column('varchar', { length: 40, default: 'draft' })
  status:
    | 'draft'
    | 'in_review'
    | 'ready_to_file'
    | 'approved'
    | 'exported'
    | 'transmitted'
    | 'accepted'
    | 'rejected'
    | 'cancelled';

  @Column('varchar', { length: 20, default: 'medium' })
  riskLevel: 'low' | 'medium' | 'high';

  @Column('uuid', { nullable: true })
  assigneeUserId: string | null;

  @Column('timestamp', { nullable: true })
  dueAt: Date | null;

  @Column('timestamp', { nullable: true })
  approvedAt: Date | null;

  @Column('uuid', { nullable: true })
  approvedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  exportedAt: Date | null;

  @Column('varchar', { length: 10, nullable: true })
  currency: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  totalValue: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  totalDuty: string | null;

  @Column('jsonb', { nullable: true })
  blockers: Array<{
    code: string;
    message: string;
    severity: 'blocker' | 'warning';
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  internalNotes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerShipmentEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'shipment_id' })
  shipment?: BrokerShipmentEntity | null;

  @OneToMany(() => BrokerEntryLineEntity, (line) => line.entry)
  lines?: BrokerEntryLineEntity[];
}
