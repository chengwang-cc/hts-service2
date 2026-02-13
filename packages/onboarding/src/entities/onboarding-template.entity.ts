import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('onboarding_templates')
@Index(['templateType'])
@Index(['isActive'])
export class OnboardingTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 100 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 50, name: 'template_type' })
  templateType: 'product-catalog' | 'sku-mapping' | 'broker-format' | 'customs-declaration';

  @Column('jsonb')
  schema: {
    fields: Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'date';
      required: boolean;
      validation?: {
        pattern?: string;
        min?: number;
        max?: number;
        options?: string[];
      };
      description?: string;
      example?: string;
    }>;
  };

  @Column('jsonb', { nullable: true, name: 'sample_data' })
  sampleData: Record<string, any>[] | null;

  @Column('text', { nullable: true, name: 'validation_rules' })
  validationRules: string | null;

  @Column('boolean', { name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
