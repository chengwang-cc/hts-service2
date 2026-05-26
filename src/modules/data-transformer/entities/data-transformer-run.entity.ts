import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('data_transformer_runs')
@Index(['organizationId', 'createdAt'])
@Index(['profileId', 'createdAt'])
@Index(['status'])
export class DataTransformerRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid')
  profileId: string;

  @Column('varchar', { length: 24, default: 'pending' })
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'partial' | string;

  @Column('integer', { default: 0 })
  inputRowCount: number;

  @Column('integer', { default: 0 })
  outputRowCount: number;

  @Column('integer', { default: 0 })
  issueCount: number;

  @Column('jsonb', { nullable: true })
  output: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage: string | null;

  @Column('varchar', { length: 200, default: 'system' })
  triggeredBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
