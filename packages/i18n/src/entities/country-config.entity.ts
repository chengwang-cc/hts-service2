import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('country_configs')
@Index(['countryCode'])
@Index(['isActive'])
export class CountryConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('varchar', { length: 2, name: 'country_code', unique: true })
  countryCode: string; // ISO 2-letter code

  @Column('varchar', { length: 100 })
  name: string;

  @Column('varchar', { length: 3, name: 'currency_code' })
  currencyCode: string; // ISO 3-letter currency code

  @Column('varchar', { length: 10, name: 'tariff_system' })
  tariffSystem: 'HTS' | 'HS' | 'CN' | 'TARIC'; // Classification system used

  @Column('jsonb', { name: 'locale_settings' })
  localeSettings: {
    language: string; // Primary language code
    dateFormat: string;
    numberFormat: {
      decimalSeparator: string;
      thousandsSeparator: string;
      currencySymbol: string;
    };
    timezone: string;
  };

  @Column('jsonb', { name: 'tax_config' })
  taxConfig: {
    vatEnabled: boolean;
    vatRate?: number;
    gstEnabled: boolean;
    gstRate?: number;
    customsProcessingFee?: number;
    additionalTaxes?: Array<{
      name: string;
      rate: number;
      type: 'percentage' | 'fixed';
    }>;
  };

  @Column('jsonb', { name: 'trade_agreements', default: [] })
  tradeAgreements: Array<{
    agreementCode: string;
    name: string;
    partnerCountries: string[];
    effectiveDate: string;
  }>;

  @Column('jsonb', { name: 'data_sources', nullable: true })
  dataSources: {
    tariffDataUrl?: string;
    updateFrequency?: string;
    lastImported?: string;
  } | null;

  @Column('boolean', { name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
