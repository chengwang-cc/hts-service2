import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('organizations')
@Index(['name'])
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('varchar', { length: 50, default: 'FREE' })
  plan: string;

  @Column('boolean', { default: true })
  isActive: boolean;

  @Column('jsonb', { nullable: true })
  settings: Record<string, any> | null;

  @Column('jsonb', { nullable: true })
  usageQuotas: Record<string, number> | null;

  @Column('jsonb', { nullable: true })
  currentUsage: Record<string, number> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
