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
import { TariffSourceEntity } from '../../jurisdiction/entities/tariff-source.entity';

@Entity('tariff_evidence')
@Index(['htsNumber', 'countryCode', 'destinationCode', 'rateClass'])
@Index(['htsNumber', 'countryCode', 'rateClass', 'sourceEffectiveFrom'])
@Index(['sourceId', 'retrievedAt'])
@Index(['status'])
@Index(['validationStatus'])
@Index(['formulaSemanticHash'])
export class TariffEvidenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('varchar', { length: 8 })
  countryCode: string;

  @Column('varchar', { length: 8, default: 'US' })
  destinationCode: string;

  @Column('varchar', { length: 32 })
  rateClass: string;

  @Column('varchar', { length: 32 })
  componentType: string;

  @Column('varchar', { length: 32 })
  calculationStage: string;

  @Column('uuid', { nullable: true })
  sourceId: string | null;

  @ManyToOne(() => TariffSourceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_id' })
  source: TariffSourceEntity | null;

  @Column('text', { nullable: true })
  citationUrl: string | null;

  @Column('text', { nullable: true })
  citationQuote: string | null;

  @Column('text', { nullable: true })
  citationSnapshotUri: string | null;

  @Column('date', { nullable: true })
  sourceEffectiveFrom: string | null;

  @Column('date', { nullable: true })
  sourceEffectiveTo: string | null;

  @Column('timestamptz', { default: () => 'CURRENT_TIMESTAMP' })
  retrievedAt: Date;

  @Column('text', { nullable: true })
  rateText: string | null;

  @Column('text', { nullable: true })
  formulaText: string | null;

  @Column('jsonb', { nullable: true })
  formulaAst: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  formulaCanonical: string | null;

  @Column('text', { nullable: true })
  compiledFormula: string | null;

  @Column('varchar', { length: 128, nullable: true })
  formulaSemanticHash: string | null;

  @Column('jsonb', { nullable: true })
  conditionAst: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  unitDimensions: Record<string, string> | null;

  @Column('jsonb', { nullable: true })
  constraints: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  roundingPolicy: Record<string, unknown> | null;

  @Column('varchar', { length: 64, nullable: true })
  parserName: string | null;

  @Column('varchar', { length: 64, nullable: true })
  parserVersion: string | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  parserConfidence: number | null;

  @Column('varchar', { length: 64, nullable: true })
  aiModel: string | null;

  @Column('varchar', { length: 64, nullable: true })
  aiPromptVersion: string | null;

  @Column('varchar', { length: 32, default: 'pending' })
  validationStatus: string;

  @Column('jsonb', { nullable: true })
  validationErrors: string[] | null;

  @Column('jsonb', { nullable: true })
  testVectors: Array<Record<string, unknown>> | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  reviewerConfidence: number | null;

  @Column('varchar', { length: 128, nullable: true })
  reviewer: string | null;

  @Column('timestamptz', { nullable: true })
  reviewedAt: Date | null;

  @Column('varchar', { length: 32, default: 'pending' })
  status: string;

  @Column('uuid', { nullable: true })
  supersededBy: string | null;

  @ManyToOne(() => TariffEvidenceEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'superseded_by' })
  supersededByEvidence: TariffEvidenceEntity | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
