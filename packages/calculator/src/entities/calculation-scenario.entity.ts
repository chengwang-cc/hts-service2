import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('calculation_scenarios')
@Index(['organizationId'])
export class CalculationScenarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('uuid')
  organizationId: string;

  @Column('uuid', { nullable: true })
  userId: string | null;

  @Column('varchar', { length: 50 })
  htsNumber: string;

  @Column('varchar', { length: 100 })
  countryOfOrigin: string;

  @Column('decimal', { precision: 18, scale: 2 })
  declaredValue: number;

  @Column('varchar', { length: 3, default: 'USD' })
  currency: string;

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  weightKg: number | null;

  @Column('integer', { nullable: true })
  quantity: number | null;

  @Column('varchar', { length: 50, nullable: true })
  quantityUnit: string | null;

  @Column('jsonb', { nullable: true })
  additionalInputs: Record<string, any> | null;

  @Column('varchar', { length: 50, nullable: true })
  tradeAgreement: string | null;

  @Column('boolean', { default: false })
  claimPreferential: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
