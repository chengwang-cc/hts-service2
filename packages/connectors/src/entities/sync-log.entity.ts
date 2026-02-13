import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('connector_sync_logs')
@Index(['connectorId', 'createdAt'])
@Index(['status'])
export class SyncLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'connector_id' })
  connectorId: string;

  @Column('varchar', { length: 50, name: 'sync_type' })
  syncType: 'import' | 'export' | 'full-sync';

  @Column('varchar', { length: 50 })
  status: 'started' | 'completed' | 'failed' | 'partial';

  @Column('integer', { name: 'items_processed', default: 0 })
  itemsProcessed: number;

  @Column('integer', { name: 'items_succeeded', default: 0 })
  itemsSucceeded: number;

  @Column('integer', { name: 'items_failed', default: 0 })
  itemsFailed: number;

  @Column('timestamp', { name: 'started_at' })
  startedAt: Date;

  @Column('timestamp', { name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column('integer', { name: 'duration_ms', nullable: true })
  durationMs: number | null;

  @Column('jsonb', { nullable: true })
  errors: Array<{
    itemId?: string;
    error: string;
    details?: any;
  }> | null;

  @Column('jsonb', { nullable: true })
  summary: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
