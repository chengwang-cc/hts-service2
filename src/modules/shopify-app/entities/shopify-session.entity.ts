import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('shopify_sessions')
@Index(['shop'], { unique: true })
@Index(['organizationId'])
export class ShopifySessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255, unique: true })
  shop: string;

  @Column('text')
  accessToken: string;

  @Column('jsonb')
  scopes: string[];

  @Column('uuid', { nullable: true })
  organizationId: string | null;

  @Column('uuid', { nullable: true })
  connectorId: string | null;

  @Column('varchar', { length: 50, nullable: true })
  nonce: string | null;

  @Column('boolean', { default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  installedAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
