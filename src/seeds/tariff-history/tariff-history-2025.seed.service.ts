import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { HtsSettingEntity, HtsTariffHistory2025Entity } from '@hts/core';

type TariffCsvRow = Record<string, string | null>;

@Injectable()
export class TariffHistory2025SeedService {
  private readonly logger = new Logger(TariffHistory2025SeedService.name);
  private readonly loadedSettingKey = 'seed.tariff_history_2025.loaded';

  constructor(
    @InjectRepository(HtsTariffHistory2025Entity)
    private readonly tariffHistoryRepo: Repository<HtsTariffHistory2025Entity>,
    @InjectRepository(HtsSettingEntity)
    private readonly settingRepo: Repository<HtsSettingEntity>,
  ) {}

  async upsertTariffHistory2025(): Promise<{
    processed: number;
    skipped: boolean;
    reason?: string;
    filePath?: string;
  }> {
    const existingCount = await this.tariffHistoryRepo.count({
      where: { sourceYear: 2025 },
    });

    const alreadyLoaded = await this.isMarkedAsLoaded();
    if (alreadyLoaded || existingCount > 0) {
      const reason = alreadyLoaded
        ? `setting "${this.loadedSettingKey}" already marked true`
        : `table already contains ${existingCount} rows for source_year=2025`;

      if (!alreadyLoaded && existingCount > 0) {
        await this.markAsLoaded(existingCount, null);
      }

      this.logger.log(`Skipping tariff history load: ${reason}`);
      return { processed: 0, skipped: true, reason };
    }

    const filePath = this.resolveInputFilePath();
    const processed = await this.loadFileAndUpsert(filePath);

    await this.markAsLoaded(processed, filePath);
    this.logger.log(
      `Tariff history 2025 load completed: ${processed} rows processed from ${filePath}`,
    );

    return { processed, skipped: false, filePath };
  }

  private async loadFileAndUpsert(filePath: string): Promise<number> {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const reader = createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let headers: string[] | null = null;
    let lineNumber = 0;
    let processed = 0;
    let skipped = 0;
    let batch: QueryDeepPartialEntity<HtsTariffHistory2025Entity>[] = [];

    for await (const rawLine of reader) {
      lineNumber++;
      const line = rawLine.replace(/\r$/, '');
      if (!line.trim()) {
        continue;
      }

      if (!headers) {
        headers = this.parseCsvLine(line).map((value) =>
          value.trim().toLowerCase(),
        );
        this.validateHeader(headers);
        continue;
      }

      const values = this.parseCsvLine(line);
      if (values.length !== headers.length) {
        skipped++;
        if (skipped <= 5) {
          this.logger.warn(
            `Skipping line ${lineNumber}: expected ${headers.length} columns, got ${values.length}`,
          );
        }
        continue;
      }

      const row = this.toRow(headers, values);
      const entity = this.mapRowToEntity(row);
      if (!entity) {
        skipped++;
        continue;
      }

      batch.push(entity);
      processed++;

      if (batch.length >= 500) {
        await this.flushBatch(batch);
        batch = [];
      }

      if (processed % 2000 === 0) {
        this.logger.log(`Processed ${processed} tariff history rows...`);
      }
    }

    if (batch.length > 0) {
      await this.flushBatch(batch);
    }

    if (skipped > 0) {
      this.logger.warn(
        `Skipped ${skipped} rows due to parsing/validation issues`,
      );
    }

    return processed;
  }

  private async flushBatch(
    batch: QueryDeepPartialEntity<HtsTariffHistory2025Entity>[],
  ): Promise<void> {
    await this.tariffHistoryRepo.upsert(batch, {
      conflictPaths: [
        'sourceYear',
        'hts8',
        'beginEffectDate',
        'endEffectiveDate',
      ],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  private mapRowToEntity(
    row: TariffCsvRow,
  ): QueryDeepPartialEntity<HtsTariffHistory2025Entity> | null {
    const hts8 = row.hts8;
    const beginEffectDate = this.parseDate(row.begin_effect_date);
    const endEffectDate = this.parseDate(row.end_effective_date);

    if (!hts8 || !beginEffectDate || !endEffectDate) {
      return null;
    }

    return {
      sourceYear: 2025,
      sourceDataset: 'tariff_data_2025',
      hts8,
      briefDescription: row.brief_description || '',
      quantity1Code: row.quantity_1_code,
      quantity2Code: row.quantity_2_code,
      wtoBindingCode: row.wto_binding_code,
      mfnTextRate: row.mfn_text_rate,
      mfnRateTypeCode: row.mfn_rate_type_code,
      mfnAdValRate: this.parseNumeric(row.mfn_ad_val_rate),
      mfnSpecificRate: this.parseNumeric(row.mfn_specific_rate),
      mfnOtherRate: this.parseNumeric(row.mfn_other_rate),
      col1SpecialText: row.col1_special_text,
      col1SpecialMod: row.col1_special_mod,
      col2TextRate: row.col2_text_rate,
      col2RateTypeCode: row.col2_rate_type_code,
      col2AdValRate: this.parseNumeric(row.col2_ad_val_rate),
      col2SpecificRate: this.parseNumeric(row.col2_specific_rate),
      col2OtherRate: this.parseNumeric(row.col2_other_rate),
      beginEffectDate,
      endEffectiveDate: endEffectDate,
      footnoteComment: row.footnote_comment,
      additionalDuty: row.additional_duty,
      pharmaceuticalIndicator: row.pharmaceutical_ind,
      dyesIndicator: row.dyes_indicator,
      nepalIndicator: row.nepal_indicator,
      preferencePrograms: this.buildPreferencePrograms(row) as any,
      mathComponents: this.buildMathComponents(row) as any,
      rawRow: row as any,
      rowHash: this.buildRowHash(row),
      is2026Reference: true,
    };
  }

  private buildMathComponents(row: TariffCsvRow): Record<string, unknown> {
    const quantity1Code = row.quantity_1_code;
    const quantity2Code = row.quantity_2_code;

    return {
      quantityCodes: {
        quantity1Code,
        quantity2Code,
      },
      mfn: this.buildRateComponent(
        row.mfn_text_rate,
        row.mfn_rate_type_code,
        row.mfn_ad_val_rate,
        row.mfn_specific_rate,
        row.mfn_other_rate,
        quantity1Code,
        quantity2Code,
      ),
      col2: this.buildRateComponent(
        row.col2_text_rate,
        row.col2_rate_type_code,
        row.col2_ad_val_rate,
        row.col2_specific_rate,
        row.col2_other_rate,
        quantity1Code,
        quantity2Code,
      ),
      programs: {
        mexico: this.buildRateComponent(
          row.nafta_mexico_ind,
          row.mexico_rate_type_code,
          row.mexico_ad_val_rate,
          row.mexico_specific_rate,
          null,
          quantity1Code,
          quantity2Code,
        ),
        cbi: this.buildRateComponent(
          row.cbi_indicator,
          null,
          row.cbi_ad_val_rate,
          row.cbi_specific_rate,
          null,
          quantity1Code,
          quantity2Code,
        ),
        cbtpa: this.buildRateComponent(
          row.cbtpa_indicator,
          row.cbtpa_rate_type_code,
          row.cbtpa_ad_val_rate,
          row.cbtpa_specific_rate,
          null,
          quantity1Code,
          quantity2Code,
        ),
        atpa: this.buildRateComponent(
          row.atpa_indicator,
          null,
          row.atpa_ad_val_rate,
          row.atpa_specific_rate,
          null,
          quantity1Code,
          quantity2Code,
        ),
        jordan: this.buildRateComponent(
          row.jordan_indicator,
          row.jordan_rate_type_code,
          row.jordan_ad_val_rate,
          row.jordan_specific_rate,
          row.jordan_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        singapore: this.buildRateComponent(
          row.singapore_indicator,
          row.singapore_rate_type_code,
          row.singapore_ad_val_rate,
          row.singapore_specific_rate,
          row.singapore_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        chile: this.buildRateComponent(
          row.chile_indicator,
          row.chile_rate_type_code,
          row.chile_ad_val_rate,
          row.chile_specific_rate,
          row.chile_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        morocco: this.buildRateComponent(
          row.morocco_indicator,
          row.morocco_rate_type_code,
          row.morocco_ad_val_rate,
          row.morocco_specific_rate,
          row.morocco_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        australia: this.buildRateComponent(
          row.australia_indicator,
          row.australia_rate_type_code,
          row.australia_ad_val_rate,
          row.australia_specific_rate,
          row.australia_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        bahrain: this.buildRateComponent(
          row.bahrain_indicator,
          row.bahrain_rate_type_code,
          row.bahrain_ad_val_rate,
          row.bahrain_specific_rate,
          row.bahrain_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        drCafta: this.buildRateComponent(
          row.dr_cafta_indicator,
          row.dr_cafta_rate_type_code,
          row.dr_cafta_ad_val_rate,
          row.dr_cafta_specific_rate,
          row.dr_cafta_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        drCaftaPlus: this.buildRateComponent(
          row.dr_cafta_plus_indicator,
          row.dr_cafta_plus_rate_type_code,
          row.dr_cafta_plus_ad_val_rate,
          row.dr_cafta_plus_specific_rate,
          row.dr_cafta_plus_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        oman: this.buildRateComponent(
          row.oman_indicator,
          row.oman_rate_type_code,
          row.oman_ad_val_rate,
          row.oman_specific_rate,
          row.oman_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        peru: this.buildRateComponent(
          row.peru_indicator,
          row.peru_rate_type_code,
          row.peru_ad_val_rate,
          row.peru_specific_rate,
          row.peru_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        korea: this.buildRateComponent(
          row.korea_indicator,
          row.korea_rate_type_code,
          row.korea_ad_val_rate,
          row.korea_specific_rate,
          row.korea_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        colombia: this.buildRateComponent(
          row.colombia_indicator,
          row.colombia_rate_type_code,
          row.colombia_ad_val_rate,
          row.colombia_specific_rate,
          row.colombia_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        panama: this.buildRateComponent(
          row.panama_indicator,
          row.panama_rate_type_code,
          row.panama_ad_val_rate,
          row.panama_specific_rate,
          row.panama_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        japan: this.buildRateComponent(
          row.japan_indicator,
          row.japan_rate_type_code,
          row.japan_ad_val_rate,
          row.japan_specific_rate,
          row.japan_other_rate,
          quantity1Code,
          quantity2Code,
        ),
        usmca: this.buildRateComponent(
          row.usmca_indicator,
          row.usmca_rate_type_code,
          row.usmca_ad_val_rate,
          row.usmca_specific_rate,
          row.usmca_other_rate,
          quantity1Code,
          quantity2Code,
        ),
      },
    };
  }

  private buildPreferencePrograms(row: TariffCsvRow): Record<string, unknown> {
    return {
      gsp: {
        indicator: row.gsp_indicator,
        excludedCountry: row.gsp_ctry_excluded,
      },
      apta: row.apta_indicator,
      civilAir: row.civil_air_indicator,
      naftaCanada: row.nafta_canada_ind,
      naftaMexico: row.nafta_mexico_ind,
      agoa: row.agoa_indicator,
      cbi: row.cbi_indicator,
      cbtpa: row.cbtpa_indicator,
      israelFta: row.israel_fta_indicator,
      atpa: row.atpa_indicator,
      atpdea: row.atpdea_indicator,
      jordan: row.jordan_indicator,
      singapore: row.singapore_indicator,
      chile: row.chile_indicator,
      morocco: row.morocco_indicator,
      australia: row.australia_indicator,
      bahrain: row.bahrain_indicator,
      drCafta: row.dr_cafta_indicator,
      drCaftaPlus: row.dr_cafta_plus_indicator,
      oman: row.oman_indicator,
      peru: row.peru_indicator,
      pharmaceutical: row.pharmaceutical_ind,
      dyes: row.dyes_indicator,
      korea: row.korea_indicator,
      colombia: row.colombia_indicator,
      panama: row.panama_indicator,
      nepal: row.nepal_indicator,
      japan: row.japan_indicator,
      usmca: row.usmca_indicator,
    };
  }

  private buildRateComponent(
    textOrIndicator: string | null,
    rateTypeCode: string | null,
    adValRateRaw: string | null,
    specificRateRaw: string | null,
    otherRateRaw: string | null,
    quantity1Code: string | null,
    quantity2Code: string | null,
  ): Record<string, unknown> {
    const adValRate = this.parseNumeric(adValRateRaw);
    const specificRate = this.parseNumeric(specificRateRaw);
    const otherRate = this.parseNumeric(otherRateRaw);

    const components: Array<Record<string, unknown>> = [];

    if (adValRate !== null && adValRate !== 0) {
      components.push({
        type: 'ad_valorem',
        variable: 'value',
        rate: adValRate,
      });
    }

    if (specificRate !== null && specificRate !== 0) {
      components.push({
        type: 'specific',
        variable: 'quantity_1',
        unitCode: quantity1Code,
        rate: specificRate,
      });
    }

    if (otherRate !== null && otherRate !== 0) {
      components.push({
        type: 'other',
        variable: 'quantity_2',
        unitCode: quantity2Code || quantity1Code,
        rate: otherRate,
      });
    }

    return {
      text: textOrIndicator,
      rateTypeCode,
      adValRate,
      specificRate,
      otherRate,
      components,
    };
  }

  private resolveInputFilePath(): string {
    const envPath = process.env.TARIFF_DATABASE_2025_FILE?.trim();

    const candidates = [
      envPath,
      resolve(process.cwd(), '.tmp/usitc/tariff_database_2025.txt'),
      resolve(process.cwd(), '.tmp/tariff_database_2025.txt'),
      resolve(process.cwd(), 'tariff_database_2025.txt'),
      resolve(process.cwd(), '../hts-docs/tariff_database_2025.txt'),
    ].filter((candidate): candidate is string => !!candidate);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `tariff_database_2025.txt not found. Looked at: ${candidates.join(', ')}`,
    );
  }

  private validateHeader(headers: string[]): void {
    const required = [
      'hts8',
      'brief_description',
      'mfn_text_rate',
      'col2_text_rate',
      'begin_effect_date',
      'end_effective_date',
    ];
    const missing = required.filter((field) => !headers.includes(field));
    if (missing.length > 0) {
      throw new Error(
        `Invalid tariff file header. Missing fields: ${missing.join(', ')}`,
      );
    }
    if (headers.length !== 122) {
      this.logger.warn(
        `Expected 122 columns in tariff_database_2025.txt header but got ${headers.length}`,
      );
    }
  }

  private toRow(headers: string[], values: string[]): TariffCsvRow {
    const row: TariffCsvRow = {};
    for (let i = 0; i < headers.length; i++) {
      const value = (values[i] ?? '').trim();
      row[headers[i]] = value === '' ? null : value;
    }
    return row;
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current);
    return values;
  }

  private parseNumeric(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }
    const parts = value.split('/');
    if (parts.length !== 3) {
      return null;
    }
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    const year = Number(parts[2]);
    if (
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      !Number.isInteger(year)
    ) {
      return null;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  }

  private buildRowHash(row: TariffCsvRow): string {
    return createHash('sha256').update(JSON.stringify(row)).digest('hex');
  }

  private async isMarkedAsLoaded(): Promise<boolean> {
    const setting = await this.settingRepo.findOne({
      where: { key: this.loadedSettingKey },
    });
    if (!setting) {
      return false;
    }

    if (setting.dataType === 'BOOLEAN') {
      return setting.value === 'true';
    }

    try {
      const parsed = JSON.parse(setting.value);
      return !!parsed?.loaded;
    } catch {
      return setting.value === 'true';
    }
  }

  private async markAsLoaded(
    rowCount: number,
    filePath: string | null,
  ): Promise<void> {
    const payload = {
      loaded: true,
      rowCount,
      sourceYear: 2025,
      loadedAt: new Date().toISOString(),
      filePath,
    };

    await this.settingRepo.upsert(
      {
        key: this.loadedSettingKey,
        value: JSON.stringify(payload),
        dataType: 'JSON',
        category: 'seed',
        description:
          'One-time historical tariff seed marker for tariff_database_2025.txt',
        isEditable: false,
        isSensitive: false,
        defaultValue: JSON.stringify({ loaded: false }),
        notes:
          'Used for 2026 tariff math reference. Keep immutable unless intentionally rebuilding seed.',
      },
      ['key'],
    );
  }
}
