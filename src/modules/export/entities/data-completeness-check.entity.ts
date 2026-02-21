import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('data_completeness_checks')
@Index(['organizationId', 'createdAt'])
@Index(['resourceType', 'resourceId'])
export class DataCompletenessCheckEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('varchar', { name: 'resource_type', length: 50 })
  resourceType: 'classification' | 'calculation' | 'product' | 'batch';

  @Column('uuid', { name: 'resource_id' })
  resourceId: string;

  @Column({ name: 'overall_score', type: 'decimal', precision: 5, scale: 2 })
  overallScore: number;

  @Column('boolean', { name: 'is_export_ready', default: false })
  isExportReady: boolean;

  @Column('jsonb')
  issues: Array<{
    field: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
    blocker: boolean;
    suggestion?: string;
  }>;

  @Column('jsonb', { nullable: true })
  completeness: {
    classification?: number;
    valuation?: number;
    origin?: number;
    weight?: number;
    documentation?: number;
  } | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
