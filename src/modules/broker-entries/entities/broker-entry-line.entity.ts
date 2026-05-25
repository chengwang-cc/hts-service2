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
import { BrokerEntryEntity } from './broker-entry.entity';

@Entity('broker_entry_lines')
@Index(['entryId'])
@Index(['lineNumber'])
@Index(['htsNumber'])
@Index(['classificationStatus'])
export class BrokerEntryLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  entryId: string;

  @Column('int')
  lineNumber: number;

  @Column('varchar', { length: 120, nullable: true })
  sku: string | null;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 20, nullable: true })
  htsNumber: string | null;

  @Column('varchar', { length: 10, nullable: true })
  countryOfOrigin: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  quantity: string | null;

  @Column('varchar', { length: 20, nullable: true })
  unitOfMeasure: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  unitValue: string | null;

  @Column('varchar', { length: 10, nullable: true })
  currency: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  totalValue: string | null;

  @Column('numeric', { precision: 18, scale: 4, nullable: true })
  estimatedDuty: string | null;

  @Column('varchar', { length: 40, default: 'unclassified' })
  classificationStatus:
    | 'unclassified'
    | 'ai_suggested'
    | 'human_accepted'
    | 'human_overridden'
    | 'needs_review';

  @Column('jsonb', { nullable: true })
  classificationEvidence: {
    suggestedHts?: string;
    suggestedConfidence?: number;
    alternatives?: Array<{ hts: string; confidence: number; reason?: string }>;
    rulings?: Array<{ ruling: string; url?: string }>;
    notes?: string;
  } | null;

  @Column('jsonb', { nullable: true })
  validationIssues: Array<{
    code: string;
    message: string;
    severity: 'blocker' | 'warning' | 'info';
  }> | null;

  @Column('jsonb', { nullable: true })
  policyFlags: Array<{
    program: string;
    code?: string;
    note?: string;
  }> | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => BrokerEntryEntity, (entry) => entry.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'entry_id' })
  entry?: BrokerEntryEntity;
}
