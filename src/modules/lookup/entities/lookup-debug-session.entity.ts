import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { IntentRule } from '../services/intent-rules';

export interface DebugIteration {
  iterationNumber: number;
  topResults: { htsNumber: string; rank: number }[];
  expectedRank: number | null;
  diagnosis: string;
  ruleApplied: IntentRule | null;
}

@Entity('lookup_debug_session')
@Index(['status'])
export class LookupDebugSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('text')
  query: string;

  @Column('varchar', { length: 20 })
  expectedHtsNumber: string;

  @Column('varchar', { length: 20, default: 'pending' })
  status: string;
  // 'pending' | 'running' | 'resolved' | 'failed' | 'max-iterations'

  @Column('jsonb', { default: [] })
  iterations: DebugIteration[];

  @Column('simple-array', { nullable: true })
  rulesAdded: string[] | null;

  @Column('integer', { nullable: true })
  resolvedAtRank: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
