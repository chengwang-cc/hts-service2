import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * ClassificationEntity - the confirmed (or pending) HS classification for
 * a catalog product against a specific destination jurisdiction.
 */
@Entity('catalog_classifications')
@Index(['productId', 'destinationJurisdictionCode'], { unique: true })
@Index(['status'])
@Index(['expiresAt'])
export class ClassificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  productId: string;

  @Column('varchar', { length: 8 })
  destinationJurisdictionCode: string;

  @Column('varchar', { length: 6 })
  hs6: string;

  @Column('varchar', { length: 20 })
  destinationCode: string;

  /** 'confirmed' | 'estimated' | 'pending_review' | 'expired' */
  @Column('varchar', { length: 24, default: 'estimated' })
  status: string;

  @Column('decimal', { precision: 3, scale: 2 })
  confidence: number;

  @Column('timestamptz', { nullable: true })
  confirmedAt: Date | null;

  @Column('varchar', { length: 128, nullable: true })
  confirmedBy: string | null;

  @Column('timestamptz', { nullable: true })
  expiresAt: Date | null;

  @Column('uuid', { nullable: true })
  sourceCitationId: string | null;

  @Column('varchar', { length: 64, nullable: true })
  modelVersion: string | null;

  @Column('jsonb', { nullable: true })
  featuresUsed: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
