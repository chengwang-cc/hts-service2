import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('data_transformer_run_issues')
@Index(['runId', 'severity'])
@Index(['runId', 'createdAt'])
export class DataTransformerRunIssueEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  runId: string;

  @Column('varchar', { length: 16 })
  severity: 'info' | 'warning' | 'error' | string;

  @Column('integer', { nullable: true })
  rowIndex: number | null;

  @Column('varchar', { length: 200, nullable: true })
  field: string | null;

  @Column('text')
  message: string;

  @Column('jsonb', { nullable: true })
  context: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
