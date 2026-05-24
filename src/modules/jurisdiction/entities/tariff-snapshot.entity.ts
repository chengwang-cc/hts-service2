import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * TariffSnapshotEntity - one row per *version* of a source feed.
 * Used for quote reproducibility.
 */
@Entity('tariff_snapshots')
@Index(['sourceId'])
@Index(['sourceId', 'version'], { unique: true })
@Index(['effectiveDate'])
export class TariffSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sourceId: string;

  @Column('varchar', { length: 64 })
  version: string;

  @Column('date')
  effectiveDate: string;

  @Column('timestamptz')
  downloadedAt: Date;

  @Column('varchar', { length: 128 })
  checksum: string;

  @Column('text', { nullable: true })
  storageUri: string | null;

  @Column('uuid', { nullable: true })
  importJobId: string | null;

  @Column('text', { nullable: true })
  releaseUrl: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;
}
