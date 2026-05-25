import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('evidence_reconciliation_packets')
@Index(['cardId'])
@Index(['status'])
@Index(['createdAt'])
export class EvidenceReconciliationPacketEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  cardId: string;

  @Column('jsonb')
  cardScope: Record<string, unknown>;

  @Column('jsonb')
  cardSnapshot: Record<string, unknown>;

  @Column('jsonb')
  acceptedEvidence: Array<Record<string, unknown>>;

  @Column('jsonb')
  pendingEvidence: Array<Record<string, unknown>>;

  @Column('jsonb', { nullable: true })
  crossRulings: Array<Record<string, unknown>> | null;

  @Column('jsonb', { nullable: true })
  recommendation: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  recommendationText: string | null;

  @Column('varchar', { length: 64, nullable: true })
  aiModel: string | null;

  @Column('varchar', { length: 64, nullable: true })
  aiPromptVersion: string | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  confidence: number | null;

  @Column('varchar', { length: 32, default: 'pending_review' })
  status: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
