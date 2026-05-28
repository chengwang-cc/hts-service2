import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

export type SavedShipmentStatus = 'draft' | 'finalized' | 'archived';

export interface SavedShipmentLastQuoteSnapshot {
  payable: number;
  currency: string;
  calculatedAt: string;
}

@Entity('saved_shipments')
@Index(['organizationId', 'createdByUserId'])
@Index(['organizationId', 'updatedAt'])
@Index(['organizationId', 'status'])
@Index(['organizationId', 'lastOpenedAt'])
export class SavedShipmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  createdByUserId: string;

  @Column('varchar', { length: 200 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 20, default: 'draft' })
  status: SavedShipmentStatus;

  @Column('text', { array: true, default: () => "'{}'::text[]" })
  tags: string[];

  @Column('boolean', { default: false })
  sharedWithOrg: boolean;

  /** Full {@link Shipment} payload (destination, currency, dates, etc.). */
  @Column('jsonb')
  shipment: Record<string, unknown>;

  /** Full {@link LineItem}[] payload (HTS, origin, formula inputs, etc.). */
  @Column('jsonb', { default: () => "'[]'::jsonb" })
  lines: Record<string, unknown>[];

  @Column('jsonb', { nullable: true })
  lastQuoteSnapshot: SavedShipmentLastQuoteSnapshot | null;

  @Column('timestamp with time zone', { default: () => 'now()' })
  lastOpenedAt: Date;

  @Column('timestamp with time zone', { nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy?: UserEntity;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;
}
