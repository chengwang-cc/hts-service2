import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tariff_card_shadow_comparisons')
@Index(['htsNumber', 'countryCode', 'formulaType', 'status'])
@Index(['createdAt'])
export class TariffCardShadowComparisonEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 20 })
  htsNumber: string;

  @Column('varchar', { length: 8 })
  countryCode: string;

  @Column('varchar', { length: 8, default: 'US' })
  destinationCode: string;

  @Column('varchar', { length: 64 })
  formulaType: string;

  @Column('text')
  cardFormula: string;

  @Column('text')
  legacyFormula: string;

  @Column('text')
  normalizedCardFormula: string;

  @Column('text')
  normalizedLegacyFormula: string;

  @Column('varchar', { length: 64, nullable: true })
  legacySource: string | null;

  @Column('decimal', { precision: 5, scale: 4, nullable: true })
  cardConfidence: number | null;

  @Column('date', { nullable: true })
  entryDate: string | null;

  @Column('varchar', { length: 32, default: 'pending' })
  status: string;

  @Column('jsonb', { nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
