import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * SourceCitationEntity - persistent provenance for any normalized rule
 * row (formula, rate, fee, tax, low-value, control, etc).
 */
@Entity('source_citations')
@Index(['snapshotId'])
@Index(['entityType', 'entityId'])
export class SourceCitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  snapshotId: string | null;

  /** 'hts_formula' | 'extra_tax' | 'fee_rule' | 'tax_rule' | 'low_value_rule' | 'control' */
  @Column('varchar', { length: 64 })
  entityType: string;

  @Column('varchar', { length: 128 })
  entityId: string;

  /** Row identifier in the original source (HTS number, footnote id, ch99 row, page ref) */
  @Column('varchar', { length: 255, nullable: true })
  rowIdentifier: string | null;

  @Column('text', { nullable: true })
  excerpt: string | null;

  @Column('varchar', { length: 64, nullable: true })
  pageRef: string | null;

  @Column('date', { nullable: true })
  effectiveDate: string | null;

  @Column('decimal', { precision: 3, scale: 2, nullable: true })
  confidence: number | null;

  @Column('varchar', { length: 64, nullable: true })
  parserVersion: string | null;

  @Column('varchar', { length: 64, nullable: true })
  parserMethod: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
