import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('trade_agreements')
export class TradeAgreementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 100, unique: true })
  code: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('jsonb')
  countries: string[];

  @Column('boolean', { default: true })
  isActive: boolean;

  @Column('date', { nullable: true })
  effectiveDate: Date | null;

  @Column('date', { nullable: true })
  expiryDate: Date | null;

  @Column('jsonb', { nullable: true })
  rules: {
    certificateRequired?: boolean;
    originRules?: string;
    additionalRequirements?: string[];
  } | null;

  @Column('varchar', { length: 500, nullable: true })
  documentationUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
