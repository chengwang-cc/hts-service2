import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('catalog_product_images')
@Index(['productId'])
export class ProductImageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  productId: string;

  @Column('text')
  url: string;

  /** 'primary' | 'detail' | 'reference' */
  @Column('varchar', { length: 16, default: 'primary' })
  role: string;

  @CreateDateColumn()
  addedAt: Date;
}
