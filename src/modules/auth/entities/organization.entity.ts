import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tagged organization rows. `type` distinguishes:
 *   - 'internal'  → first-party (usahts)
 *   - 'partner'   → integrated third-party (chitchats, proto-ecommerce)
 *   - 'customer'  → end-customer organizations (the legacy default)
 *
 * `slug` is the stable, human-readable identifier used by seed scripts and
 * the partner-attribution module to look up specific orgs without UUIDs.
 */
export type OrganizationType = 'internal' | 'partner' | 'customer';

@Entity('organizations')
@Index(['name'])
@Index(['type', 'isActive'])
@Index(['slug'], { unique: true, where: 'slug IS NOT NULL' })
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('varchar', { length: 20, default: 'customer' })
  type: OrganizationType;

  @Column('varchar', { length: 64, nullable: true })
  slug: string | null;

  @Column('varchar', { length: 50, default: 'FREE' })
  plan: string;

  @Column('boolean', { default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  settings: Record<string, any> | null;

  @Column('jsonb', { nullable: true })
  usageQuotas: Record<string, number> | null;

  @Column('jsonb', { nullable: true })
  currentUsage: Record<string, number> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
