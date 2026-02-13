import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('export_templates')
@Index(['organizationId', 'name'], { unique: true })
@Index(['isSystem'])
export class ExportTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'organization_id', nullable: true })
  organizationId: string | null;

  @Column('varchar', { length: 100 })
  name: string;

  @Column('varchar', { length: 255, nullable: true })
  description: string | null;

  @Column('varchar', { name: 'template_type', length: 50 })
  templateType: 'shopify' | 'broker' | 'customs' | 'audit-pack' | 'invoice' | 'packing-list' | 'custom';

  @Column('jsonb')
  fieldMapping: {
    [key: string]: {
      sourceField: string;
      transform?: string;
      required?: boolean;
      defaultValue?: any;
    };
  };

  @Column('jsonb', { nullable: true })
  formatOptions: {
    delimiter?: string;
    quoteChar?: string;
    encoding?: string;
    dateFormat?: string;
    includeHeader?: boolean;
  } | null;

  @Column('boolean', { name: 'is_system', default: false })
  isSystem: boolean;

  @Column('boolean', { name: 'is_active', default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
