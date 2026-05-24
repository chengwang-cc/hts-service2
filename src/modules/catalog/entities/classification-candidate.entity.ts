import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * ClassificationCandidateEntity - one row per candidate HS code suggested
 * by the classifier for a given product. The chosen candidate gets
 * promoted to ClassificationEntity once a reviewer confirms.
 */
@Entity('catalog_classification_candidates')
@Index(['productId'])
@Index(['productId', 'destinationJurisdictionCode'])
@Index(['producedAt'])
export class ClassificationCandidateEntity {
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

  @Column('decimal', { precision: 3, scale: 2 })
  confidence: number;

  @Column('text', { nullable: true })
  rationale: string | null;

  @Column('integer')
  rank: number;

  @Column('timestamptz')
  producedAt: Date;

  @Column('varchar', { length: 64 })
  producedBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
