import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * TariffSourceEntity - one row per *source feed* per jurisdiction.
 * Example: USITC HTS archive for US, GOV.UK Trade Tariff API for GB.
 */
@Entity('tariff_sources')
@Index(['jurisdictionCode'])
@Index(['jurisdictionCode', 'sourceName'], { unique: true })
export class TariffSourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 8 })
  jurisdictionCode: string;

  @Column('varchar', { length: 128 })
  sourceName: string;

  @Column('text')
  sourceUrl: string;

  @Column('varchar', { length: 64, nullable: true })
  license: string | null;

  /** 'http_json_api' | 'usitc_archive' | 'pdf' | 'open_data_csv' | 'web_scrape' */
  @Column('varchar', { length: 32 })
  retrievalMethod: string;

  /** 'daily' | 'weekly' | 'monthly' | 'on_release' */
  @Column('varchar', { length: 24 })
  updateCadence: string;

  /** 'deterministic' | 'llm_fallback' | 'hybrid' */
  @Column('varchar', { length: 32 })
  parserType: string;

  @Column('varchar', { length: 64, nullable: true })
  latestVersion: string | null;

  @Column('timestamptz', { nullable: true })
  latestImportAt: Date | null;

  @Column('boolean', { default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
