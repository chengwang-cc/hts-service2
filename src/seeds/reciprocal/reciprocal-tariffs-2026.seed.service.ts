import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsExtraTaxEntity, HtsSettingEntity } from '@hts/core';
import { reciprocalTariffs2026Seed } from './reciprocal-tariffs-2026.seed';

@Injectable()
export class ReciprocalTariffs2026SeedService {
  private readonly logger = new Logger(ReciprocalTariffs2026SeedService.name);
  private readonly loadedSettingKey = 'seed.reciprocal_tariffs_2026.v2.loaded';
  private readonly minimumExpectedRows = reciprocalTariffs2026Seed.length;

  constructor(
    @InjectRepository(HtsExtraTaxEntity)
    private readonly extraTaxRepo: Repository<HtsExtraTaxEntity>,
    @InjectRepository(HtsSettingEntity)
    private readonly settingRepo: Repository<HtsSettingEntity>,
  ) {}

  async upsertReciprocalTariffs2026(): Promise<{
    processed: number;
    skipped: boolean;
    reason?: string;
  }> {
    const alreadyLoaded = await this.isMarkedAsLoaded();
    const existingRows = await this.extraTaxRepo
      .createQueryBuilder('tax')
      .where("tax.taxCode LIKE 'RECIP_%'")
      .andWhere('tax.isActive = :isActive', { isActive: true })
      .getCount();

    if (alreadyLoaded && existingRows >= this.minimumExpectedRows) {
      const reason = `setting "${this.loadedSettingKey}" already marked true`;
      this.logger.log(`Skipping reciprocal tariff seed: ${reason}`);
      return { processed: 0, skipped: true, reason };
    }

    if (alreadyLoaded && existingRows < this.minimumExpectedRows) {
      this.logger.warn(
        `Reciprocal seed marker is true but only ${existingRows} RECIP_* rows are active; rehydrating to ${this.minimumExpectedRows} rows.`,
      );
    }

    let processed = 0;
    for (const row of reciprocalTariffs2026Seed) {
      const existing = await this.extraTaxRepo
        .createQueryBuilder('tax')
        .where('tax.taxCode = :taxCode', { taxCode: row.taxCode })
        .andWhere('tax.countryCode = :countryCode', { countryCode: row.countryCode })
        .andWhere('tax.isActive = :isActive', { isActive: true })
        .orderBy('tax.updatedAt', 'DESC')
        .getOne();

      const payload: Partial<HtsExtraTaxEntity> = {
        taxCode: row.taxCode,
        taxName: row.taxName,
        description: row.description,
        htsNumber: '*',
        htsChapter: '99',
        countryCode: row.countryCode,
        extraRateType: row.extraRateType,
        rateText: row.rateText,
        rateFormula: row.rateFormula,
        minimumAmount: null,
        maximumAmount: null,
        isPercentage: true,
        applyTo: 'VALUE',
        conditions: row.conditions,
        priority: row.priority,
        isActive: true,
        effectiveDate: this.parseDate(row.effectiveDate),
        expirationDate: this.parseDate(row.expirationDate),
        legalReference: row.legalReference,
        notes: row.notes,
        metadata: {
          source: 'SEED_2026_RECIPROCAL_BASELINE',
          policyType: 'RECIPROCAL_TARIFF',
          seedVersion: '2026.2',
          seededAt: new Date().toISOString(),
        },
      };

      if (existing) {
        Object.assign(existing, payload);
        await this.extraTaxRepo.save(existing);
      } else {
        await this.extraTaxRepo.save(this.extraTaxRepo.create(payload));
      }
      processed += 1;
    }

    await this.markAsLoaded(processed, null);
    this.logger.log(`Reciprocal tariff seed complete: ${processed} rows upserted`);
    return { processed, skipped: false };
  }

  private async isMarkedAsLoaded(): Promise<boolean> {
    const setting = await this.settingRepo.findOne({
      where: {
        key: this.loadedSettingKey,
        category: 'seed',
      },
    });
    if (!setting) {
      return false;
    }

    const normalized = String(setting.value ?? '').trim().toLowerCase();
    return ['true', '1', 'yes', 'y'].includes(normalized);
  }

  private async markAsLoaded(processed: number, reason: string | null): Promise<void> {
    const existing = await this.settingRepo.findOne({
      where: {
        key: this.loadedSettingKey,
        category: 'seed',
      },
    });

    const payload: Partial<HtsSettingEntity> = {
      key: this.loadedSettingKey,
      value: 'true',
      dataType: 'BOOLEAN',
      category: 'seed',
      description: `One-time reciprocal tariff 2026 seed loaded (${processed} rows).`,
      notes: JSON.stringify({
        processed,
        reason,
        seededAt: new Date().toISOString(),
      }),
    };

    if (existing) {
      Object.assign(existing, payload);
      await this.settingRepo.save(existing);
      return;
    }

    await this.settingRepo.save(this.settingRepo.create(payload));
  }

  private parseDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
