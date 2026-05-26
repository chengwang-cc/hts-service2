import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * First-class registry of authoritative policy, tariff, and trade sources.
 *
 * Operators manage rows here instead of changing code when a source is added,
 * paused, retuned, or audited. SourceMonitorJob resolves active rows from this
 * table and falls back to bootstrapped defaults only when the registry is empty.
 */
@Entity('knowledge_sources')
@Index(['url'], { unique: true })
@Index(['status', 'sourceType'])
@Index(['jurisdiction', 'documentType'])
@Index(['publisher'])
@Index(['priority', 'name'])
export class KnowledgeSourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 180 })
  name: string;

  @Column('varchar', { length: 120, nullable: true })
  publisher: string | null;

  @Column('varchar', { length: 32, default: 'rss' })
  sourceType: 'rss' | 'html' | 'document' | 'api' | 'sitemap' | string;

  @Column('text')
  url: string;

  @Column('varchar', { length: 8, nullable: true })
  jurisdiction: string | null;

  @Column('varchar', { length: 50, nullable: true })
  documentType: string | null;

  @Column('varchar', { length: 64, nullable: true })
  category: string | null;

  @Column('varchar', { length: 32, default: 'official' })
  trustTier: 'official' | 'partner' | 'industry' | 'internal' | string;

  @Column('varchar', { length: 16, default: 'active' })
  status: 'active' | 'paused' | 'archived' | 'error' | string;

  @Column('int', { default: 6 })
  crawlFrequencyHours: number;

  @Column('int', { default: 25 })
  itemLimit: number;

  @Column('int', { default: 100 })
  priority: number;

  @Column('boolean', { default: true })
  respectRobots: boolean;

  @Column('boolean', { default: true })
  requiresReview: boolean;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @Column('timestamptz', { nullable: true })
  lastCrawledAt: Date | null;

  @Column('timestamptz', { nullable: true })
  lastSuccessAt: Date | null;

  @Column('timestamptz', { nullable: true })
  lastFailureAt: Date | null;

  @Column('timestamptz', { nullable: true })
  lastDiscoveredAt: Date | null;

  @Column('text', { nullable: true })
  lastErrorMessage: string | null;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @Column('varchar', { length: 200, default: 'system' })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
