import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('catalog_products')
@Index(['organizationId', 'externalId'], { unique: true })
@Index(['organizationId', 'gtin'])
@Index(['organizationId', 'createdAt'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  organizationId: string;

  @Column('varchar', { length: 128, nullable: true })
  externalId: string | null;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('varchar', { length: 255, nullable: true })
  categoryPath: string | null;

  @Column('varchar', { length: 8, nullable: true })
  defaultCountryOfOrigin: string | null;

  @Column('varchar', { length: 20, nullable: true })
  defaultHsCode: string | null;

  @Column('varchar', { length: 64, nullable: true })
  manufacturerId: string | null;

  @Column('varchar', { length: 32, nullable: true })
  gtin: string | null;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
