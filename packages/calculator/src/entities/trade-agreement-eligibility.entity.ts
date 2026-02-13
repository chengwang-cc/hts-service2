import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('trade_agreement_eligibility')
@Index(['htsNumber', 'tradeAgreementCode'])
export class TradeAgreementEligibilityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 50 })
  htsNumber: string;

  @Column('varchar', { length: 100 })
  tradeAgreementCode: string;

  @Column('boolean', { default: true })
  isEligible: boolean;

  @Column('decimal', { precision: 5, scale: 2, nullable: true })
  preferentialRate: number | null;

  @Column('varchar', { length: 50, nullable: true })
  rateType: string | null;

  @Column('text', { nullable: true })
  originRequirements: string | null;

  @Column('boolean', { default: false })
  certificateRequired: boolean;

  @Column('varchar', { length: 255, nullable: true })
  certificateType: string | null;

  @Column('jsonb', { nullable: true })
  additionalConditions: string[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
