import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('connectors')
@Index(['organizationId'])
@Index(['connectorType', 'isActive'])
export class ConnectorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @Column('varchar', { length: 50, name: 'connector_type' })
  connectorType: 'shopify' | 'broker' | 'woocommerce' | 'magento' | 'bigcommerce';

  @Column('varchar', { length: 100 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('jsonb')
  config: {
    shopUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    webhookUrl?: string;
    syncEnabled?: boolean;
    syncInterval?: number; // minutes
    fieldMappings?: Record<string, string>;
    filters?: Record<string, any>;
  };

  @Column('boolean', { name: 'is_active', default: true })
  isActive: boolean;

  @Column('varchar', { length: 50, default: 'disconnected' })
  status: 'connected' | 'disconnected' | 'error' | 'pending';

  @Column('timestamp', { name: 'last_sync_at', nullable: true })
  lastSyncAt: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  lastError: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
