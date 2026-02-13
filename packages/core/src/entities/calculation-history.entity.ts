import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('calculation_history')
@Index(['calculationId'], { unique: true })
@Index(['organizationId', 'createdAt'])
export class CalculationHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 100, unique: true })
  calculationId: string;

  @Column('uuid')
  organizationId: string;

  @Column('uuid', { nullable: true })
  userId: string | null;

  @Column('uuid', { nullable: true })
  scenarioId: string | null;

  @Column('jsonb')
  inputs: {
    htsNumber: string;
    countryOfOrigin: string;
    declaredValue: number;
    currency: string;
    weightKg?: number;
    quantity?: number;
    quantityUnit?: string;
    tradeAgreement?: string;
    claimPreferential?: boolean;
    additionalInputs?: Record<string, any>;
  };

  @Column('decimal', { precision: 18, scale: 2 })
  baseDuty: number;

  @Column('decimal', { precision: 18, scale: 2, default: '0' })
  additionalTariffs: number;

  @Column('decimal', { precision: 18, scale: 2, default: '0' })
  totalTaxes: number;

  @Column('decimal', { precision: 18, scale: 2 })
  totalDuty: number;

  @Column('decimal', { precision: 18, scale: 2 })
  landedCost: number;

  @Column('jsonb')
  breakdown: {
    baseDuty: number;
    additionalTariffs: Array<{
      type: string;
      amount: number;
      description: string;
    }>;
    taxes: Array<{
      type: string;
      amount: number;
      description: string;
    }>;
    totalDuty: number;
    totalTax: number;
    landedCost: number;
  };

  @Column('jsonb', { nullable: true })
  tradeAgreementInfo: {
    agreement: string;
    eligible: boolean;
    preferentialRate?: number;
    requiresCertificate?: boolean;
  } | null;

  @Column('jsonb', { nullable: true })
  complianceWarnings: Array<{
    type: string;
    severity: string;
    message: string;
    requiredAction?: string;
  }> | null;

  @Column('varchar', { length: 50 })
  htsVersion: string;

  @Column('varchar', { length: 50, nullable: true })
  ruleVersion: string | null;

  @Column('varchar', { length: 50 })
  engineVersion: string;

  @Column('varchar', { length: 1000, nullable: true })
  formulaUsed: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
