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
import { OrganizationEntity } from '../../auth/entities/organization.entity';

@Entity('broker_clients')
@Index(['brokerOrganizationId'])
@Index(['clientOrganizationId'])
@Index(['status'])
@Index(['brokerOrganizationId', 'name'])
// NOTE: a partial unique index on (brokerOrganizationId, clientOrganizationId)
// WHERE clientOrganizationId IS NOT NULL is enforced at the migration level
// to prevent duplicate broker↔business client rows from racing accept-quote
// handoffs. TypeORM decorators cannot express partial indexes.
export class BrokerClientEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  brokerOrganizationId: string;

  @Column('uuid', { nullable: true })
  clientOrganizationId: string | null;

  @Column('varchar', { length: 200 })
  name: string;

  @Column('varchar', { length: 200, nullable: true })
  legalName: string | null;

  @Column('varchar', { length: 60, nullable: true })
  importerIdLast4: string | null;

  @Column('jsonb', { nullable: true })
  encryptedImporterId: {
    algorithm: 'aes-256-gcm';
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: string;
  } | null;

  @Column('varchar', { length: 10, nullable: true })
  defaultCurrency: string | null;

  @Column('varchar', { length: 255, nullable: true })
  contactEmail: string | null;

  @Column('varchar', { length: 60, nullable: true })
  contactPhone: string | null;

  @Column('jsonb', { nullable: true })
  address: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  } | null;

  @Column('jsonb', { nullable: true })
  settings: Record<string, unknown> | null;

  /**
   * R1-E-03 — per-client tolerance (percent) used by the packet
   * reconciliation service when comparing values across documents. Defaults
   * to the system-wide `BROKER_RECONCILIATION_DEFAULT_TOLERANCE` env (1%)
   * when null. Org admins update from /broker/clients/:id.
   */
  @Column('numeric', { precision: 6, scale: 3, nullable: true })
  reconciliationTolerancePct: string | null;

  @Column('varchar', { length: 40, default: 'active' })
  status: 'active' | 'onboarding' | 'inactive' | 'archived';

  @Column('text', { nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'broker_organization_id' })
  brokerOrganization?: OrganizationEntity;
}
