import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per saved transformer profile. A profile bundles an input
 * schema (kind + columns + sample) with a target output kind so the
 * mapping editor knows what to validate against.
 */
@Entity('data_transformer_profiles')
@Index(['organizationId', 'name'])
@Index(['organizationId', 'inputKind'])
export class DataTransformerProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 120 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 32 })
  inputKind:
    | 'csv'
    | 'json'
    | 'shopify_orders'
    | 'shopify_products'
    | 'woocommerce_orders'
    | 'woocommerce_products'
    | 'magento_products'
    | 'magento_orders'
    | 'broker_document_fields'
    | string;

  @Column('varchar', { length: 32 })
  outputKind:
    | 'marketplace_request'
    | 'broker_entry'
    | 'landed_cost_quote'
    | 'classification_batch'
    | 'export_adapter_payload'
    | string;

  @Column('jsonb')
  inputSchema: Record<string, unknown>;

  @Column('jsonb', { default: {} })
  defaults: Record<string, unknown>;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @Column('varchar', { length: 200, default: 'system' })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
