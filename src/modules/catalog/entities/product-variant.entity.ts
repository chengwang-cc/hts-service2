import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('catalog_product_variants')
@Index(['productId'])
@Index(['productId', 'sku'], { unique: true })
export class ProductVariantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  productId: string;

  @Column('varchar', { length: 128 })
  sku: string;

  @Column('jsonb', { nullable: true })
  attributes: Record<string, any> | null;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  weightKg: number | null;

  @Column('decimal', { precision: 15, scale: 4, nullable: true })
  unitValue: number | null;

  @Column('varchar', { length: 8, nullable: true })
  currency: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
