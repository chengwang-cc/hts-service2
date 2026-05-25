#!/usr/bin/env ts-node
/**
 * Seed `jurisdictions`, plus the well-known GB low-value rule and
 * standard VAT rule. Idempotent — re-running is safe.
 *
 * Usage:
 *   npm run seed:jurisdictions             # writes
 *   npm run seed:jurisdictions -- --dry    # report-only
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  JurisdictionEntity,
  LowValueRuleEntity,
  TariffSourceEntity,
  TaxRuleEntity,
} from '../src/modules/jurisdiction/entities';
import { AUTHORITATIVE_TARIFF_SOURCES } from '../src/modules/jurisdiction/constants/authoritative-tariff-sources';

interface SeedJurisdiction {
  code: string;
  displayName: string;
  type: JurisdictionEntity['type'];
  parentCode?: string;
  currencyCode: string;
  defaultLocale?: string;
  tariffSchema: string;
}

const JURISDICTIONS: SeedJurisdiction[] = [
  { code: 'US', displayName: 'United States', type: 'country', currencyCode: 'USD', defaultLocale: 'en-US', tariffSchema: 'HTS_10' },
  { code: 'CA', displayName: 'Canada', type: 'country', currencyCode: 'CAD', defaultLocale: 'en-CA', tariffSchema: 'HS_10' },
  { code: 'CN', displayName: 'China', type: 'country', currencyCode: 'CNY', defaultLocale: 'zh-CN', tariffSchema: 'HS_10' },
  { code: 'GB', displayName: 'United Kingdom', type: 'country', currencyCode: 'GBP', defaultLocale: 'en-GB', tariffSchema: 'GB_10' },
  { code: 'HK', displayName: 'Hong Kong', type: 'country', currencyCode: 'HKD', defaultLocale: 'en-HK', tariffSchema: 'HK_FREE_PORT' },
  { code: 'EU', displayName: 'European Union', type: 'customs_union', currencyCode: 'EUR', defaultLocale: 'en-EU', tariffSchema: 'TARIC_10' },
  // EU member states — currencies are the local currency. Tariffs are TARIC; VAT differs per MS.
  { code: 'DE', displayName: 'Germany', type: 'member_state', parentCode: 'EU', currencyCode: 'EUR', defaultLocale: 'de-DE', tariffSchema: 'TARIC_10' },
  { code: 'FR', displayName: 'France', type: 'member_state', parentCode: 'EU', currencyCode: 'EUR', defaultLocale: 'fr-FR', tariffSchema: 'TARIC_10' },
  { code: 'NL', displayName: 'Netherlands', type: 'member_state', parentCode: 'EU', currencyCode: 'EUR', defaultLocale: 'nl-NL', tariffSchema: 'TARIC_10' },
  { code: 'IE', displayName: 'Ireland', type: 'member_state', parentCode: 'EU', currencyCode: 'EUR', defaultLocale: 'en-IE', tariffSchema: 'TARIC_10' },
  { code: 'ES', displayName: 'Spain', type: 'member_state', parentCode: 'EU', currencyCode: 'EUR', defaultLocale: 'es-ES', tariffSchema: 'TARIC_10' },
  { code: 'IT', displayName: 'Italy', type: 'member_state', parentCode: 'EU', currencyCode: 'EUR', defaultLocale: 'it-IT', tariffSchema: 'TARIC_10' },
  { code: 'AU', displayName: 'Australia', type: 'country', currencyCode: 'AUD', defaultLocale: 'en-AU', tariffSchema: 'HS_10' },
  { code: 'NZ', displayName: 'New Zealand', type: 'country', currencyCode: 'NZD', defaultLocale: 'en-NZ', tariffSchema: 'HS_10' },
  { code: 'JP', displayName: 'Japan', type: 'country', currencyCode: 'JPY', defaultLocale: 'ja-JP', tariffSchema: 'JP_9' },
  { code: 'KR', displayName: 'South Korea', type: 'country', currencyCode: 'KRW', defaultLocale: 'ko-KR', tariffSchema: 'KR_10' },
  { code: 'TW', displayName: 'Taiwan', type: 'country', currencyCode: 'TWD', defaultLocale: 'zh-TW', tariffSchema: 'TW_11' },
];

async function main() {
  const dry = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const jurRepo = app.get<Repository<JurisdictionEntity>>(
      getRepositoryToken(JurisdictionEntity),
    );
    const lvRepo = app.get<Repository<LowValueRuleEntity>>(
      getRepositoryToken(LowValueRuleEntity),
    );
    const taxRepo = app.get<Repository<TaxRuleEntity>>(
      getRepositoryToken(TaxRuleEntity),
    );
    const sourceRepo = app.get<Repository<TariffSourceEntity>>(
      getRepositoryToken(TariffSourceEntity),
    );

    let upsertedJurisdictions = 0;
    let upsertedLowValue = 0;
    let upsertedTax = 0;
    let upsertedSources = 0;

    for (const j of JURISDICTIONS) {
      const existing = await jurRepo.findOne({ where: { code: j.code } });
      if (!existing) {
        if (!dry) await jurRepo.save(jurRepo.create({ ...j, isActive: true }));
        upsertedJurisdictions++;
      } else {
        // Keep displayName / tariffSchema fresh.
        const dirty =
          existing.displayName !== j.displayName ||
          existing.tariffSchema !== j.tariffSchema ||
          existing.parentCode !== (j.parentCode ?? null) ||
          existing.currencyCode !== j.currencyCode;
        if (dirty && !dry) {
          await jurRepo.save({ ...existing, ...j });
          upsertedJurisdictions++;
        }
      }
    }

    for (const source of AUTHORITATIVE_TARIFF_SOURCES) {
      const existing = await sourceRepo.findOne({
        where: {
          jurisdictionCode: source.jurisdictionCode,
          sourceName: source.sourceName,
        },
      });
      if (!existing) {
        if (!dry) {
          await sourceRepo.save(
            sourceRepo.create({
              ...source,
              latestVersion: null,
              latestImportAt: null,
              isActive: true,
              metadata: source.metadata || null,
            }),
          );
        }
        upsertedSources++;
        continue;
      }

      const dirty =
        existing.sourceUrl !== source.sourceUrl ||
        existing.license !== source.license ||
        existing.retrievalMethod !== source.retrievalMethod ||
        existing.updateCadence !== source.updateCadence ||
        existing.parserType !== source.parserType ||
        JSON.stringify(existing.metadata || null) !==
          JSON.stringify(source.metadata || null);

      if (dirty) {
        if (!dry) {
          await sourceRepo.save({
            ...existing,
            sourceUrl: source.sourceUrl,
            license: source.license,
            retrievalMethod: source.retrievalMethod,
            updateCadence: source.updateCadence,
            parserType: source.parserType,
            metadata: source.metadata || null,
            isActive: true,
          });
        }
        upsertedSources++;
      }
    }

    // GB low-value rule: GBP 135 threshold, seller-collected VAT below.
    const gbLvAlreadyThere = await lvRepo.findOne({
      where: { jurisdictionCode: 'GB', threshold: 135 },
    });
    if (!gbLvAlreadyThere) {
      if (!dry) {
        await lvRepo.save(
          lvRepo.create({
            jurisdictionCode: 'GB',
            currency: 'GBP',
            threshold: 135,
            dutyTreatment: 'exempt',
            taxTreatment: 'seller_collected_vat',
            sellerCollection: true,
            excludedHsPrefixes: ['22.', '24.'],
            effectiveFrom: '2021-01-01',
            effectiveTo: null,
            sourceCitationId: null,
          }),
        );
      }
      upsertedLowValue++;
    }

    // GB standard VAT 20%.
    const gbVatAlreadyThere = await taxRepo.findOne({
      where: { jurisdictionCode: 'GB', taxType: 'VAT', name: 'Standard VAT' },
    });
    if (!gbVatAlreadyThere) {
      if (!dry) {
        await taxRepo.save(
          taxRepo.create({
            jurisdictionCode: 'GB',
            memberStateCode: null,
            taxType: 'VAT',
            name: 'Standard VAT',
            rate: 0.2,
            baseFormula: null,
            collectionPoint: 'border',
            thresholdId: null,
            exemptions: null,
            appliesWhen: null,
            effectiveFrom: '2011-01-04', // last UK VAT rate change
            effectiveTo: null,
            sourceCitationId: null,
          }),
        );
      }
      upsertedTax++;
    }

    // ── CA low-value: CUSMA CAD 40 (tax-free) / CAD 150 (duty-free) ──────
    // Operator note: the LV table stores ONE threshold per row, so we
    // capture the more-permissive duty threshold here and rely on
    // CaLowValueResolverService for the multi-tier nuance at runtime.
    const caLvAlreadyThere = await lvRepo.findOne({
      where: { jurisdictionCode: 'CA', threshold: 150 },
    });
    if (!caLvAlreadyThere) {
      if (!dry) {
        await lvRepo.save(
          lvRepo.create({
            jurisdictionCode: 'CA',
            currency: 'CAD',
            threshold: 150,
            dutyTreatment: 'exempt',
            taxTreatment: 'border',
            sellerCollection: false,
            excludedHsPrefixes: ['22.', '24.'],
            effectiveFrom: '2020-07-01', // CUSMA entry into force
            effectiveTo: null,
            sourceCitationId: null,
          }),
        );
      }
      upsertedLowValue++;
    }

    // CA federal GST 5%.
    const caGstAlreadyThere = await taxRepo.findOne({
      where: { jurisdictionCode: 'CA', taxType: 'GST', name: 'Federal GST' },
    });
    if (!caGstAlreadyThere) {
      if (!dry) {
        await taxRepo.save(
          taxRepo.create({
            jurisdictionCode: 'CA',
            memberStateCode: null,
            taxType: 'GST',
            name: 'Federal GST',
            rate: 0.05,
            baseFormula: null,
            collectionPoint: 'border',
            thresholdId: null,
            exemptions: null,
            appliesWhen: null,
            effectiveFrom: '2008-01-01',
            effectiveTo: null,
            sourceCitationId: null,
          }),
        );
      }
      upsertedTax++;
    }

    // ── EU IOSS low-value: EUR 150 cart threshold ────────────────────────
    const euIossAlreadyThere = await lvRepo.findOne({
      where: { jurisdictionCode: 'EU', threshold: 150 },
    });
    if (!euIossAlreadyThere) {
      if (!dry) {
        await lvRepo.save(
          lvRepo.create({
            jurisdictionCode: 'EU',
            currency: 'EUR',
            threshold: 150,
            dutyTreatment: 'exempt',
            taxTreatment: 'seller_collected_vat',
            sellerCollection: true,
            excludedHsPrefixes: ['22.', '24.'],
            effectiveFrom: '2021-07-01', // IOSS launch
            effectiveTo: null,
            sourceCitationId: null,
          }),
        );
      }
      upsertedLowValue++;
    }

    // ── Per-Member-State standard VAT rates (effective 2026-05) ──────────
    const EU_VAT: Array<{ ms: string; rate: number; effectiveFrom: string }> = [
      { ms: 'AT', rate: 0.20,  effectiveFrom: '2016-01-01' },
      { ms: 'BE', rate: 0.21,  effectiveFrom: '1996-01-01' },
      { ms: 'BG', rate: 0.20,  effectiveFrom: '2007-01-01' },
      { ms: 'HR', rate: 0.25,  effectiveFrom: '2012-03-01' },
      { ms: 'CY', rate: 0.19,  effectiveFrom: '2014-01-13' },
      { ms: 'CZ', rate: 0.21,  effectiveFrom: '2013-01-01' },
      { ms: 'DK', rate: 0.25,  effectiveFrom: '1992-01-01' },
      { ms: 'EE', rate: 0.22,  effectiveFrom: '2024-01-01' },
      { ms: 'FI', rate: 0.255, effectiveFrom: '2024-09-01' },
      { ms: 'FR', rate: 0.20,  effectiveFrom: '2014-01-01' },
      { ms: 'DE', rate: 0.19,  effectiveFrom: '2007-01-01' },
      { ms: 'GR', rate: 0.24,  effectiveFrom: '2016-06-01' },
      { ms: 'HU', rate: 0.27,  effectiveFrom: '2012-01-01' },
      { ms: 'IE', rate: 0.23,  effectiveFrom: '2012-01-01' },
      { ms: 'IT', rate: 0.22,  effectiveFrom: '2013-10-01' },
      { ms: 'LV', rate: 0.21,  effectiveFrom: '2018-01-01' },
      { ms: 'LT', rate: 0.21,  effectiveFrom: '2009-09-01' },
      { ms: 'LU', rate: 0.17,  effectiveFrom: '2024-01-01' },
      { ms: 'MT', rate: 0.18,  effectiveFrom: '2004-05-01' },
      { ms: 'NL', rate: 0.21,  effectiveFrom: '2012-10-01' },
      { ms: 'PL', rate: 0.23,  effectiveFrom: '2011-01-01' },
      { ms: 'PT', rate: 0.23,  effectiveFrom: '2011-01-01' },
      { ms: 'RO', rate: 0.19,  effectiveFrom: '2017-01-01' },
      { ms: 'SK', rate: 0.23,  effectiveFrom: '2025-01-01' },
      { ms: 'SI', rate: 0.22,  effectiveFrom: '2013-07-01' },
      { ms: 'ES', rate: 0.21,  effectiveFrom: '2012-09-01' },
      { ms: 'SE', rate: 0.25,  effectiveFrom: '1990-07-01' },
    ];
    for (const row of EU_VAT) {
      const exists = await taxRepo.findOne({
        where: {
          jurisdictionCode: 'EU',
          memberStateCode: row.ms,
          taxType: 'VAT',
          name: 'Standard VAT',
        },
      });
      if (exists) continue;
      if (!dry) {
        await taxRepo.save(
          taxRepo.create({
            jurisdictionCode: 'EU',
            memberStateCode: row.ms,
            taxType: 'VAT',
            name: 'Standard VAT',
            rate: row.rate,
            baseFormula: null,
            collectionPoint: 'border',
            thresholdId: null,
            exemptions: null,
            appliesWhen: null,
            effectiveFrom: row.effectiveFrom,
            effectiveTo: null,
            sourceCitationId: null,
          }),
        );
      }
      upsertedTax++;
    }

    process.stdout.write(
      `\nseed-jurisdictions ${dry ? '(DRY) ' : ''}done: ` +
        `jurisdictions=${upsertedJurisdictions} sources=${upsertedSources} lowValue=${upsertedLowValue} tax=${upsertedTax}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('seed-jurisdictions failed:', err?.stack || err);
  process.exit(1);
});
