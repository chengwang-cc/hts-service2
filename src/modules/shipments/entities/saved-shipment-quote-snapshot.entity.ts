import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SavedShipmentEntity } from './saved-shipment.entity';

@Entity('saved_shipment_quote_snapshots')
@Index(['savedShipmentId', 'createdAt'])
@Index(['organizationId', 'createdAt'])
export class SavedShipmentQuoteSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  savedShipmentId: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  createdByUserId: string;

  @Column('jsonb')
  quoteRequest: Record<string, unknown>;

  @Column('jsonb')
  quoteResponse: Record<string, unknown>;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  payable: string | null;

  @Column('varchar', { length: 8, nullable: true })
  currency: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => SavedShipmentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'saved_shipment_id' })
  shipment?: SavedShipmentEntity;
}
