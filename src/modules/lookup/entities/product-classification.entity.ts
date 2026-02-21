import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('product_classifications')
@Index(['organizationId'])
@Index(['status'])
export class ProductClassificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 500 })
  productName: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 20, nullable: true })
  suggestedHts: string | null;

  @Column('varchar', { length: 20, nullable: true })
  confirmedHts: string | null;

  @Column('varchar', { length: 50, default: 'DRAFT' })
  status: string;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  confidence: number | null;

  @Column('jsonb', { nullable: true })
  aiSuggestions: any[] | null;

  @Column('jsonb', { nullable: true })
  attributes: Record<string, any> | null;

  @Column('varchar', { length: 255, nullable: true })
  createdBy: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
