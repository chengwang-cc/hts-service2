import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

export type PartnerOriginPurpose = 'web' | 'server' | 'mobile';

/**
 * Maps an origin pattern (glob or full hostname) to a partner organization.
 *
 * Patterns:
 *   - Exact:      'https://www.chitchats.com'  matches that one origin
 *   - Subdomain:  '*.chitchats.com'            matches any subdomain of chitchats.com
 *   - Wildcard:   '*.proto.com'                same shape
 *
 * Matching is performed by PartnerOriginCacheService which compiles each
 * pattern to a RegExp on boot and on a 5-minute refresh interval.
 * Specificity ordering: longer literal prefix wins so 'merchant.proto.com'
 * is preferred over '*.proto.com' when both match the same Origin header.
 *
 * Purpose discriminates the context the pattern is for. Today this is mostly
 * informational; in P3 it lets us apply different rate-limit defaults to
 * 'web' (browser) vs 'server' partners.
 */
@Entity('partner_origins')
@Index(['isActive', 'organizationId'])
@Index(['originPattern'])
export class PartnerOriginEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @Column('varchar', { length: 255 })
  originPattern: string;

  @Column('varchar', { length: 20, default: 'web' })
  purpose: PartnerOriginPurpose;

  @Column('boolean', { default: true })
  isActive: boolean;

  @Column('text', { nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
