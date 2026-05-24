import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('catalog_product_materials')
@Index(['productId'])
export class ProductMaterialEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  productId: string;

  @Column('varchar', { length: 128 })
  material: string;

  @Column('decimal', { precision: 5, scale: 2 })
  percent: number;

  @Column('varchar', { length: 128, nullable: true })
  verifiedBy: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
