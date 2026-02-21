import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Historical USITC tariff database snapshot for 2025.
 * Used as a one-time mathematical reference dataset during 2026.
 */
@Entity('hts_tariff_history_2025')
@Index(['sourceYear', 'hts8', 'beginEffectDate', 'endEffectiveDate'], {
  unique: true,
})
@Index(['hts8'])
@Index(['sourceYear'])
@Index(['endEffectiveDate'])
export class HtsTariffHistory2025Entity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('integer', { default: 2025 })
  sourceYear: number;

  @Column('varchar', { length: 30, default: 'tariff_data_2025' })
  sourceDataset: string;

  @Column('varchar', { length: 8 })
  hts8: string;

  @Column('text')
  briefDescription: string;

  @Column('varchar', { length: 20, nullable: true })
  quantity1Code: string | null;

  @Column('varchar', { length: 20, nullable: true })
  quantity2Code: string | null;

  @Column('varchar', { length: 4, nullable: true })
  wtoBindingCode: string | null;

  @Column('varchar', { length: 255, nullable: true })
  mfnTextRate: string | null;

  @Column('varchar', { length: 20, nullable: true })
  mfnRateTypeCode: string | null;

  @Column('numeric', { precision: 16, scale: 8, nullable: true })
  mfnAdValRate: number | null;

  @Column('numeric', { precision: 16, scale: 8, nullable: true })
  mfnSpecificRate: number | null;

  @Column('numeric', { precision: 16, scale: 8, nullable: true })
  mfnOtherRate: number | null;

  @Column('varchar', { length: 255, nullable: true })
  col1SpecialText: string | null;

  @Column('varchar', { length: 50, nullable: true })
  col1SpecialMod: string | null;

  @Column('varchar', { length: 255, nullable: true })
  col2TextRate: string | null;

  @Column('varchar', { length: 20, nullable: true })
  col2RateTypeCode: string | null;

  @Column('numeric', { precision: 16, scale: 8, nullable: true })
  col2AdValRate: number | null;

  @Column('numeric', { precision: 16, scale: 8, nullable: true })
  col2SpecificRate: number | null;

  @Column('numeric', { precision: 16, scale: 8, nullable: true })
  col2OtherRate: number | null;

  @Column('date')
  beginEffectDate: Date;

  @Column('date')
  endEffectiveDate: Date;

  @Column('text', { nullable: true })
  footnoteComment: string | null;

  @Column('text', { nullable: true })
  additionalDuty: string | null;

  @Column('varchar', { length: 10, nullable: true })
  pharmaceuticalIndicator: string | null;

  @Column('varchar', { length: 10, nullable: true })
  dyesIndicator: string | null;

  @Column('varchar', { length: 10, nullable: true })
  nepalIndicator: string | null;

  /**
   * Country/program indicators and duty component values for non-MFN programs.
   */
  @Column('jsonb', { default: () => "'{}'::jsonb" })
  preferencePrograms: Record<string, unknown>;

  /**
   * Computation-ready representation (ad valorem/specific/other components).
   */
  @Column('jsonb', { default: () => "'{}'::jsonb" })
  mathComponents: Record<string, unknown>;

  /**
   * Full fidelity source payload for all 122 tariff_database_2025 columns.
   */
  @Column('jsonb')
  rawRow: Record<string, string | null>;

  @Column('varchar', { length: 64 })
  rowHash: string;

  @Column('boolean', { default: true })
  is2026Reference: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
