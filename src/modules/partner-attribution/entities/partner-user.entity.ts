import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

/**
 * One row per (partner, end-user) pair. The `externalUserId` is partner-asserted
 * (or verified via the partner's signed JWT in P2) and never authoritative on
 * its own — it just gives us a stable counter for distinct end-users per
 * partner without hammering api_usage_metrics with COUNT(DISTINCT).
 *
 * Metadata is treated as opaque partner-supplied context. Integration guide
 * requires hashed values only (no raw email / phone).
 */
@Entity('partner_users')
@Index(['organizationId', 'externalUserId'], { unique: true })
@Index(['organizationId', 'lastSeenAt'])
export class PartnerUserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @Column('varchar', { length: 255 })
  externalUserId: string;

  @CreateDateColumn()
  firstSeenAt: Date;

  @UpdateDateColumn()
  lastSeenAt: Date;

  @Column('bigint', { default: 0 })
  requestCount: string; // bigint maps to string in TypeORM/pg

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;
}
