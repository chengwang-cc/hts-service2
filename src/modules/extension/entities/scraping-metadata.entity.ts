import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Scraping Metadata Entity
 * Tracks web scraping operations and results
 * Used for analytics, caching, and debugging
 */
@Entity('scraping_metadata')
@Index(['organizationId', 'createdAt'])
@Index(['urlHash'])
export class ScrapingMetadataEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  organizationId: string;

  @Column('varchar', { length: 2000 })
  url: string;

  @Column('varchar', { length: 64 })
  urlHash: string; // SHA-256 hash for caching/deduplication

  @Column('varchar', { length: 20 })
  method: string; // 'http' | 'puppeteer'

  @Column('boolean', { default: false })
  visionUsed: boolean;

  @Column('int')
  statusCode: number;

  @Column('jsonb', { nullable: true })
  scrapedData: {
    productsFound?: number;
    textLength?: number;
    imagesFound?: number;
    title?: string;
  } | null;

  @Column('int')
  processingTimeMs: number;

  @Column('varchar', { length: 500, nullable: true })
  errorMessage: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
