import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('query_builder_templates')
@Index(['organizationId', 'name'])
export class QueryBuilderTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @Column('varchar', { length: 120 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('jsonb')
  input: Record<string, unknown>;

  @Column('varchar', { length: 200, default: 'system' })
  createdBy: string;

  @Column('varchar', { length: 200, default: 'system' })
  updatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
