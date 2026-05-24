#!/usr/bin/env ts-node
/**
 * P4.1 — One-time CLI: promote US `hts_extra_taxes` rows into normalized
 * `fee_rules` / `tax_rules` rows under jurisdictionCode='US'.
 *
 * Heuristic mapping:
 *   - taxCode starts with MPF/HMF, or extraRateType='POST_CALCULATION' with
 *     '*fee*' in the taxCode -> FeeRuleEntity
 *   - taxCode starts with SECTION_301/232/122, IEEPA, RECIP_ -> remain in
 *     hts_extra_taxes (those are componentized by the resolver, not the
 *     generic rule engine).
 *   - All other POST_CALCULATION rows -> TaxRuleEntity
 *
 * Usage:
 *   npm run promote-extra-taxes -- --dry-run
 *   npm run promote-extra-taxes
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../src/app.module';
import { HtsExtraTaxEntity } from '../src/core/entities/hts-extra-tax.entity';
import {
  FeeRuleEntity,
  TaxRuleEntity,
} from '../src/modules/jurisdiction/entities';

function feeBucket(taxCode: string): boolean {
  const t = (taxCode || '').toUpperCase();
  if (t.startsWith('MPF') || t.startsWith('HMF')) return true;
  if (t.includes('FEE')) return true;
  return false;
}

function isComponentized(taxCode: string): boolean {
  const t = (taxCode || '').toUpperCase();
  return (
    t.startsWith('SECTION_301') ||
    t.startsWith('SECTION_232') ||
    t.startsWith('SECTION_122') ||
    t.startsWith('IEEPA') ||
    t.startsWith('RECIP_') ||
    t.startsWith('CH99') ||
    t.startsWith('CHAPTER_99')
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const extraRepo = app.get<Repository<HtsExtraTaxEntity>>(
      getRepositoryToken(HtsExtraTaxEntity),
    );
    const feeRepo = app.get<Repository<FeeRuleEntity>>(
      getRepositoryToken(FeeRuleEntity),
    );
    const taxRepo = app.get<Repository<TaxRuleEntity>>(
      getRepositoryToken(TaxRuleEntity),
    );

    const rows = await extraRepo.find({ where: { isActive: true } });
    let promotedFee = 0;
    let promotedTax = 0;
    let skippedComponentized = 0;

    // AUDIT FIX H2 — idempotent: re-running the CLI must NOT insert
    // duplicate fee/tax rows. We key on (jurisdictionCode, name) which
    // is the natural identity for these promoted rules.
    let skippedAlreadyPromoted = 0;

    for (const row of rows) {
      if (isComponentized(row.taxCode)) {
        skippedComponentized++;
        continue;
      }
      const name = row.taxName || row.taxCode;
      if (feeBucket(row.taxCode)) {
        const exists = await feeRepo.findOne({
          where: { jurisdictionCode: 'US', name },
        });
        if (exists) {
          skippedAlreadyPromoted++;
          continue;
        }
        const fee = feeRepo.create({
          jurisdictionCode: 'US',
          feeType: row.taxCode.startsWith('MPF')
            ? 'MPF'
            : row.taxCode.startsWith('HMF')
              ? 'HMF'
              : 'declaration',
          name,
          rateType: row.isPercentage ? 'ad_valorem' : 'fixed',
          formula: row.rateFormula || '0',
          minAmount: row.minimumAmount,
          maxAmount: row.maximumAmount,
          transportMode: null,
          declarationType: null,
          thresholdAmount: null,
          appliesWhen: row.conditions ?? null,
          effectiveFrom:
            (row.effectiveDate &&
              new Date(row.effectiveDate).toISOString().slice(0, 10)) ||
            '2000-01-01',
          effectiveTo:
            (row.expirationDate &&
              new Date(row.expirationDate).toISOString().slice(0, 10)) ||
            null,
          sourceCitationId: null,
        });
        if (!dryRun) await feeRepo.save(fee);
        promotedFee++;
        continue;
      }
      if (row.extraRateType?.toUpperCase() === 'POST_CALCULATION') {
        const exists = await taxRepo.findOne({
          where: { jurisdictionCode: 'US', name },
        });
        if (exists) {
          skippedAlreadyPromoted++;
          continue;
        }
        const tax = taxRepo.create({
          jurisdictionCode: 'US',
          memberStateCode: null,
          taxType:
            row.taxCode.toUpperCase().includes('VAT') ||
            row.taxCode.toUpperCase().includes('SALES')
              ? 'sales_tax'
              : 'business_tax',
          name,
          rate: 0,
          baseFormula: row.rateFormula || null,
          collectionPoint: 'border',
          thresholdId: null,
          exemptions: null,
          appliesWhen: row.conditions ?? null,
          effectiveFrom:
            (row.effectiveDate &&
              new Date(row.effectiveDate).toISOString().slice(0, 10)) ||
            '2000-01-01',
          effectiveTo:
            (row.expirationDate &&
              new Date(row.expirationDate).toISOString().slice(0, 10)) ||
            null,
          sourceCitationId: null,
        });
        if (!dryRun) await taxRepo.save(tax);
        promotedTax++;
      }
    }

    process.stdout.write(
      `\npromote-extra-taxes ${dryRun ? '(DRY RUN) ' : ''}done: ` +
        `promotedFee=${promotedFee} promotedTax=${promotedTax} ` +
        `skippedComponentized=${skippedComponentized} ` +
        `skippedAlreadyPromoted=${skippedAlreadyPromoted}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('promote-extra-taxes failed:', err?.stack || err);
  process.exit(1);
});
