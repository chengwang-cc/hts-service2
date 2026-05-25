import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PolicyDocumentEntity } from './policy-document.entity';

@Entity('policy_change_proposals')
@Index(['documentId'])
@Index(['status'])
@Index(['htsNumber', 'countryCode', 'rateClass'])
@Index(['effectiveFrom'])
export class PolicyChangeProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  documentId: string;

  @ManyToOne(() => PolicyDocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: PolicyDocumentEntity;

  @Column('varchar', { length: 20, nullable: true })
  htsNumber: string | null;

  @Column('varchar', { length: 8, default: 'ALL' })
  countryCode: string;

  @Column('varchar', { length: 8, default: 'US' })
  destinationCode: string;

  @Column('varchar', { length: 32 })
  rateClass: string;

  @Column('varchar', { length: 32, nullable: true })
  componentType: string | null;

  @Column('date', { nullable: true })
  effectiveFrom: string | null;

  @Column('date', { nullable: true })
  effectiveTo: string | null;

  @Column('text', { nullable: true })
  oldRateText: string | null;

  @Column('text', { nullable: true })
  newRateText: string | null;

  @Column('text', { nullable: true })
  proposedFormula: string | null;

  @Column('jsonb', { nullable: true })
  proposedConditionAst: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  citationQuote: string | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  parserConfidence: number | null;

  @Column('varchar', { length: 64, nullable: true })
  parserName: string | null;

  @Column('varchar', { length: 64, nullable: true })
  parserVersion: string | null;

  @Column('varchar', { length: 32, default: 'pending' })
  status: string;

  @Column('uuid', { nullable: true })
  evidenceId: string | null;

  @Column('text', { nullable: true })
  reviewerNote: string | null;

  @Column('varchar', { length: 128, nullable: true })
  reviewedBy: string | null;

  @Column('timestamptz', { nullable: true })
  reviewedAt: Date | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
