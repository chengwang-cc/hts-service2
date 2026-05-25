import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tariff_knowledge_card')
@Index(
  [
    'htsNumber',
    'countryCode',
    'destinationCode',
    'rateClass',
    'componentType',
    'effectiveFrom',
  ],
  { unique: true },
)
@Index(['htsNumber', 'countryCode', 'destinationCode', 'rateClass'])
@Index(['status'])
@Index(['consensusSemanticHash'])
@Index(['lastReviewedAt'])
export class TariffKnowledgeCardEntity {
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

  @Column('date')
  effectiveFrom: string;

  @Column('date', { nullable: true })
  effectiveTo: string | null;

  @Column('text', { nullable: true })
  consensusFormula: string | null;

  @Column('jsonb', { nullable: true })
  consensusFormulaAst: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  consensusConditionAst: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  consensusConstraints: Record<string, unknown> | null;

  @Column('jsonb', { nullable: true })
  consensusRoundingPolicy: Record<string, unknown> | null;

  @Column('varchar', { length: 128, nullable: true })
  consensusSemanticHash: string | null;

  @Column('decimal', { precision: 5, scale: 4, default: 0 })
  agreementScore: number;

  @Column('decimal', { precision: 5, scale: 4, default: 0 })
  confidenceScore: number;

  @Column('integer', { default: 0 })
  evidenceCount: number;

  @Column('integer', { default: 0 })
  disagreementCount: number;

  @Column('jsonb', { nullable: true })
  openQuestions: Array<Record<string, unknown>> | null;

  @Column('varchar', { length: 32, default: 'provisional' })
  status: string;

  @Column('timestamptz', { nullable: true })
  lastReviewedAt: Date | null;

  @Column('varchar', { length: 128, nullable: true })
  reviewer: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
