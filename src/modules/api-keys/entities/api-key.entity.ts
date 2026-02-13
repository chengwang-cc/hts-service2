import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';

/**
 * API Key Entity
 * Represents API keys for external access to the HTS Service
 */
@Entity('api_keys')
@Index(['keyHash'], { unique: true })
@Index(['organizationId', 'isActive'])
@Index(['organizationId', 'createdAt'])
export class ApiKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * SHA-256 hash of the API key
   * Never store plain-text keys
   */
  @Column('varchar', { length: 64, unique: true })
  keyHash: string;

  /**
   * First 8 characters of the key for display (e.g., "hts_live_12345678...")
   * Allows users to identify keys without exposing full value
   */
  @Column('varchar', { length: 20 })
  keyPrefix: string;

  /**
   * Human-readable name for the key
   */
  @Column('varchar', { length: 255 })
  name: string;

  /**
   * Optional description
   */
  @Column('text', { nullable: true })
  description: string | null;

  /**
   * Organization that owns this key
   */
  @Column('uuid')
  organizationId: string;

  @ManyToOne(() => OrganizationEntity)
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  /**
   * Environment: test or live
   */
  @Column('varchar', { length: 10 })
  environment: 'test' | 'live';

  /**
   * Permissions granted to this key
   * Example: ['hts:lookup', 'hts:calculate', 'kb:query']
   */
  @Column('jsonb')
  permissions: string[];

  /**
   * Rate limit (requests per minute)
   */
  @Column('integer', { default: 60 })
  rateLimitPerMinute: number;

  /**
   * Rate limit (requests per day)
   */
  @Column('integer', { default: 10000 })
  rateLimitPerDay: number;

  /**
   * Is the key currently active?
   */
  @Column('boolean', { default: true })
  isActive: boolean;

  /**
   * Key expiration date (nullable = no expiration)
   */
  @Column('timestamp', { nullable: true })
  expiresAt: Date | null;

  /**
   * Last time the key was used
   */
  @Column('timestamp', { nullable: true })
  lastUsedAt: Date | null;

  /**
   * IP whitelist (null = allow all)
   * Example: ['192.168.1.1', '10.0.0.0/24']
   */
  @Column('jsonb', { nullable: true })
  ipWhitelist: string[] | null;

  /**
   * Allowed origins for CORS (null = allow all)
   * Example: ['https://example.com', 'https://app.example.com']
   */
  @Column('jsonb', { nullable: true })
  allowedOrigins: string[] | null;

  /**
   * Metadata (for extensibility)
   */
  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  /**
   * User who created this key (for audit trail)
   */
  @Column('uuid', { nullable: true })
  createdBy: string | null;
}
