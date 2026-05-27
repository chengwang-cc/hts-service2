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
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import type { EncryptedSecret } from '../../security/encrypted-secret.service';
import { MarketplaceBrokerCredentialEntity } from './marketplace-broker-credential.entity';

@Entity('marketplace_broker_profiles')
@Index(['slug'], { unique: true })
@Index(['organizationId'])
@Index(['ownerUserId'])
@Index(['status', 'verificationStatus'])
@Index(['publishedAt'])
export class MarketplaceBrokerProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  ownerUserId: string;

  @Column('varchar', { length: 160 })
  companyName: string;

  @Column('varchar', { length: 180 })
  slug: string;

  @Column('varchar', { length: 220, nullable: true })
  tagline: string | null;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 40, default: 'draft' })
  status: 'draft' | 'published' | 'suspended';

  @Column('varchar', { length: 40, default: 'unverified' })
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';

  @Column('jsonb', { default: [] })
  countries: string[];

  @Column('jsonb', { default: [] })
  ports: string[];

  @Column('jsonb', { default: [] })
  serviceCategories: string[];

  @Column('jsonb', { default: [] })
  shipmentModes: string[];

  @Column('jsonb', { default: [] })
  languages: string[];

  @Column('jsonb', { default: [] })
  specialties: string[];

  @Column('jsonb', { default: [] })
  complianceBadges: string[];

  @Column('jsonb', { nullable: true })
  aiCapabilities: {
    supportsAiClassification?: boolean;
    supportsDocumentAutomation?: boolean;
    supportsDutyAudit?: boolean;
    notes?: string;
  } | null;

  @Column('jsonb', { nullable: true })
  metrics: {
    averageResponseHours?: number;
    completedShipments?: number;
    satisfactionScore?: number;
  } | null;

  @Column('varchar', { length: 255, nullable: true })
  websiteUrl: string | null;

  /**
   * AES-256-GCM envelope of the broker's contact email. Kept encrypted at
   * rest so a raw DB read does not surface PII; the service-layer
   * `publicContactExposure` gate still controls API exposure. Use the
   * MarketplaceService helpers (encryptContact / decryptContact) when
   * touching this column — never read it directly from another service.
   */
  @Column('jsonb', { nullable: true, name: 'contact_email_enc' })
  contactEmailEnc: EncryptedSecret | null;

  /** AES-256-GCM envelope of the broker's contact phone (see contactEmailEnc). */
  @Column('jsonb', { nullable: true, name: 'contact_phone_enc' })
  contactPhoneEnc: EncryptedSecret | null;

  /**
   * Admin-controlled contact exposure on the public broker profile.
   * Default `platform_only` hides raw email/phone/address; an admin can
   * flip to `email_only`, `phone_only`, or `full` per broker — each
   * change is audited via marketplace_profile.contact_exposure_set.
   */
  @Column('varchar', { length: 24, default: 'platform_only' })
  publicContactExposure:
    | 'platform_only'
    | 'email_only'
    | 'phone_only'
    | 'full'
    | string;

  /**
   * AES-256-GCM envelope of the broker's office address (JSON-stringified
   * before encryption). Same access discipline as contactEmailEnc.
   */
  @Column('jsonb', { nullable: true, name: 'office_address_enc' })
  officeAddressEnc: EncryptedSecret | null;

  @Column('varchar', { length: 120, nullable: true })
  minimumEngagement: string | null;

  @Column('text', { nullable: true })
  searchKeywords: string | null;

  @Column('timestamp', { nullable: true })
  submittedForVerificationAt: Date | null;

  @Column('timestamp', { nullable: true })
  verifiedAt: Date | null;

  @Column('uuid', { nullable: true })
  verifiedByUserId: string | null;

  @Column('timestamp', { nullable: true })
  publishedAt: Date | null;

  @Column('timestamp', { nullable: true })
  suspendedAt: Date | null;

  @Column('text', { nullable: true })
  moderationNote: string | null;

  /**
   * R2-D-01 — monetization tier. 'free' (default) | 'pro'. Pro tiers get
   * the sponsored placement slot and reduced lead-credit consumption.
   */
  @Column('varchar', { length: 20, default: 'free' })
  tier: 'free' | 'pro';

  @Column('timestamp', { nullable: true })
  tierActiveUntil: Date | null;

  /**
   * R2-D-03 — composite ranking score that drives the sponsored placement
   * engine. Recomputed by BrokerPerformanceService nightly; floor lookup
   * happens at match time. Allow null until first computed.
   */
  @Column('numeric', { precision: 5, scale: 2, nullable: true })
  qualityAdjustedRank: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  owner?: UserEntity;

  @OneToMany(
    () => MarketplaceBrokerCredentialEntity,
    (credential) => credential.profile,
  )
  credentials?: MarketplaceBrokerCredentialEntity[];
}
