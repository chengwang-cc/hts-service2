import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CountryConfigEntity } from '../entities/country-config.entity';

export interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  tariffSystem: string;
  locale: string;
}

@Injectable()
export class CountryService {
  constructor(
    @InjectRepository(CountryConfigEntity)
    private readonly countryRepo: Repository<CountryConfigEntity>,
  ) {}

  private readonly builtInCountries: Record<
    string,
    Partial<CountryConfigEntity>
  > = {
    US: {
      countryCode: 'US',
      name: 'United States',
      currencyCode: 'USD',
      tariffSystem: 'HTS',
      localeSettings: {
        language: 'en-US',
        dateFormat: 'MM/DD/YYYY',
        numberFormat: {
          decimalSeparator: '.',
          thousandsSeparator: ',',
          currencySymbol: '$',
        },
        timezone: 'America/New_York',
      },
      taxConfig: {
        vatEnabled: false,
        gstEnabled: false,
        customsProcessingFee: 0.003464, // MPF fee
      },
      tradeAgreements: [
        {
          agreementCode: 'USMCA',
          name: 'United States-Mexico-Canada Agreement',
          partnerCountries: ['CA', 'MX'],
          effectiveDate: '2020-07-01',
        },
      ],
      isActive: true,
    },
    CA: {
      countryCode: 'CA',
      name: 'Canada',
      currencyCode: 'CAD',
      tariffSystem: 'HS',
      localeSettings: {
        language: 'en-CA',
        dateFormat: 'YYYY-MM-DD',
        numberFormat: {
          decimalSeparator: '.',
          thousandsSeparator: ',',
          currencySymbol: '$',
        },
        timezone: 'America/Toronto',
      },
      taxConfig: {
        vatEnabled: false,
        gstEnabled: true,
        gstRate: 0.05,
      },
      tradeAgreements: [
        {
          agreementCode: 'USMCA',
          name: 'Canada-United States-Mexico Agreement',
          partnerCountries: ['US', 'MX'],
          effectiveDate: '2020-07-01',
        },
      ],
      isActive: true,
    },
    GB: {
      countryCode: 'GB',
      name: 'United Kingdom',
      currencyCode: 'GBP',
      tariffSystem: 'HS',
      localeSettings: {
        language: 'en-GB',
        dateFormat: 'DD/MM/YYYY',
        numberFormat: {
          decimalSeparator: '.',
          thousandsSeparator: ',',
          currencySymbol: '£',
        },
        timezone: 'Europe/London',
      },
      taxConfig: {
        vatEnabled: true,
        vatRate: 0.2,
        gstEnabled: false,
      },
      isActive: true,
    },
    EU: {
      countryCode: 'EU',
      name: 'European Union',
      currencyCode: 'EUR',
      tariffSystem: 'TARIC',
      localeSettings: {
        language: 'en-EU',
        dateFormat: 'DD/MM/YYYY',
        numberFormat: {
          decimalSeparator: ',',
          thousandsSeparator: '.',
          currencySymbol: '€',
        },
        timezone: 'Europe/Brussels',
      },
      taxConfig: {
        vatEnabled: true,
        vatRate: 0.19, // Varies by country
        gstEnabled: false,
      },
      isActive: true,
    },
    CN: {
      countryCode: 'CN',
      name: 'China',
      currencyCode: 'CNY',
      tariffSystem: 'CN',
      localeSettings: {
        language: 'zh-CN',
        dateFormat: 'YYYY-MM-DD',
        numberFormat: {
          decimalSeparator: '.',
          thousandsSeparator: ',',
          currencySymbol: '¥',
        },
        timezone: 'Asia/Shanghai',
      },
      taxConfig: {
        vatEnabled: true,
        vatRate: 0.13,
        gstEnabled: false,
      },
      isActive: true,
    },
  };

  async getCountryConfig(
    countryCode: string,
  ): Promise<CountryConfigEntity | null> {
    // Try to get from database first
    let config = await this.countryRepo.findOne({
      where: { countryCode: countryCode.toUpperCase(), isActive: true },
    });

    // If not in database, check built-in configs
    if (!config && this.builtInCountries[countryCode.toUpperCase()]) {
      const builtIn = this.builtInCountries[countryCode.toUpperCase()];
      config = this.countryRepo.create(builtIn);
      // Optionally save to database
      await this.countryRepo.save(config);
    }

    return config;
  }

  async listCountries(): Promise<CountryConfigEntity[]> {
    const dbCountries = await this.countryRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    // If database is empty, return built-in countries
    if (dbCountries.length === 0) {
      return Object.values(this.builtInCountries).map((c) =>
        this.countryRepo.create(c),
      );
    }

    return dbCountries;
  }

  async getSupportedCountries(): Promise<CountryInfo[]> {
    const countries = await this.listCountries();

    return countries.map((c) => ({
      code: c.countryCode,
      name: c.name,
      currency: c.currencyCode,
      tariffSystem: c.tariffSystem,
      locale: c.localeSettings.language,
    }));
  }

  async getTradeAgreements(countryCode: string): Promise<any[]> {
    const config = await this.getCountryConfig(countryCode);
    return config?.tradeAgreements || [];
  }

  async getTaxConfig(countryCode: string): Promise<any> {
    const config = await this.getCountryConfig(countryCode);
    return config?.taxConfig || {};
  }

  async formatCurrency(amount: number, countryCode: string): Promise<string> {
    const config = await this.getCountryConfig(countryCode);

    if (!config) {
      return amount.toFixed(2);
    }

    const { currencySymbol, decimalSeparator, thousandsSeparator } =
      config.localeSettings.numberFormat;

    const parts = amount.toFixed(2).split('.');
    const integerPart = parts[0].replace(
      /\B(?=(\d{3})+(?!\d))/g,
      thousandsSeparator,
    );
    const decimalPart = parts[1];

    return `${currencySymbol}${integerPart}${decimalSeparator}${decimalPart}`;
  }

  async formatDate(date: Date, countryCode: string): Promise<string> {
    const config = await this.getCountryConfig(countryCode);

    if (!config) {
      return date.toISOString().split('T')[0];
    }

    const format = config.localeSettings.dateFormat;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day);
  }

  getBuiltInCountryCodes(): string[] {
    return Object.keys(this.builtInCountries);
  }

  async initializeBuiltInCountries(): Promise<void> {
    for (const [code, config] of Object.entries(this.builtInCountries)) {
      const existing = await this.countryRepo.findOne({
        where: { countryCode: code },
      });

      if (!existing) {
        const entity = this.countryRepo.create(config);
        await this.countryRepo.save(entity);
      }
    }
  }
}
