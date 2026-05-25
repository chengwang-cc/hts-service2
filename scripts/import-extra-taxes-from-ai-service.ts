#!/usr/bin/env ts-node
/**
 * Drain ai-service tariff knowledge into hts-service.
 *
 * For every active HTS row × every well-known origin country, call
 * ai-service `/v2/tariff/formulas` and translate every returned
 * non-base component (section_301 / section_232 / section_122 /
 * post_tax / chapter_99-style additional duty) into a row in
 * `hts_extra_taxes` so the hts-service local resolver can fire them
 * without a network hop.
 *
 * Idempotent: a row is identified by
 *   (jurisdictionCode='US', tax_code, country_code, hts_number)
 * and `tax_code` is a deterministic hash of the formula text.
 *
 * Usage:
 *   npm run import-extras -- --countries CN,DE,MX --chapters 61,62,84 --dry-run
 *   npm run import-extras -- --countries CN,DE --max-rows 2000
 *
 * Env required: TARIFF_FORMULAS_API_URL + TARIFF_FORMULAS_API_KEY
 * (or AI_SERVICE_URL + AI_SERVICE_API_KEY).
 */

import 'reflect-metadata';
import { createHash } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HtsEntity, HtsExtraTaxEntity } from '../src/core';
import {
  AiServiceProxyService,
  AiFormulaRow,
} from '../src/modules/public-api/v1/services/ai-service-proxy.service';

interface CliArgs {
  countries: string[];
  chapters?: string[];
  maxRows?: number;
  batchSize: number;
  dryRun: boolean;
}

const COMPONENT_BUCKETS = new Set([
  'section_301',
  'section_232',
  'section_122',
  'chapter_99',
  'post_tax',
  'mpf',
  'hmf',
  'reciprocal',
]);

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    countries: ['CN', 'DE', 'MX', 'CA', 'KR'],
    batchSize: 20,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--countries' && argv[i + 1]) {
      out.countries = argv[++i].split(',').map((s) => s.trim().toUpperCase());
    } else if (a === '--chapters' && argv[i + 1]) {
      out.chapters = argv[++i].split(',').map((s) => s.trim());
    } else if (a === '--max-rows' && argv[i + 1]) {
      out.maxRows = Number(argv[++i]);
    } else if (a === '--batch-size' && argv[i + 1]) {
      out.batchSize = Number(argv[++i]);
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        `Usage: import-extras [--countries CN,DE,MX] [--chapters 61,62,84]\n` +
          `                    [--max-rows N] [--batch-size 20] [--dry-run]\n`,
      );
      process.exit(0);
    }
  }
  return out;
}

function deterministicTaxCode(tariffType: string, formula: string): string {
  const hash = createHash('sha1').update(`${tariffType}|${formula}`).digest('hex').slice(0, 10);
  return `AISVC_${tariffType.toUpperCase()}_${hash}`;
}

/**
 * User-facing label for a tariff-type key when the upstream didn't supply
 * tariffTypeDescription. `section_301` → `Section 301`,
 * `metal_tariff` → `Metal Tariff`, etc. Mirrors the resolver-side
 * humanizer in tariff-rate-batch.service.ts to keep the two paths in sync.
 */
function humanizeTariffTypeKey(tariffType: string): string {
  const specials: Record<string, string> = {
    base: 'Base (general / MFN) rate',
    section_122: 'Section 122 Tariffs',
    section_201: 'Section 201',
    section_232: 'Section 232',
    section_301: 'Section 301',
    ieepa: 'IEEPA',
    reciprocal: 'Reciprocal tariff',
    metal_tariff: 'Section 232 (Metal)',
    mpf: 'Merchandise Processing Fee',
    hmf: 'Harbor Maintenance Fee',
  };
  const key = (tariffType || '').toLowerCase();
  if (specials[key]) return specials[key];
  return key
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function classifyAsExtra(tariffType: string): {
  rateType: 'ADD_ON' | 'POST_CALCULATION';
  priority: number;
} | null {
  const t = (tariffType || '').toLowerCase();
  if (!COMPONENT_BUCKETS.has(t)) return null;
  if (t === 'base' || t === 'special' || t === 'non_ntr') return null;
  if (t === 'mpf' || t === 'hmf' || t === 'post_tax') {
    return { rateType: 'POST_CALCULATION', priority: 90 };
  }
  return { rateType: 'ADD_ON', priority: 25 };
}

async function main() {
  const args = parseArgs(process.argv);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const htsRepo = app.get<Repository<HtsEntity>>(getRepositoryToken(HtsEntity));
    const extraRepo = app.get<Repository<HtsExtraTaxEntity>>(
      getRepositoryToken(HtsExtraTaxEntity),
    );
    const proxy = app.get(AiServiceProxyService);

    const htsQb = htsRepo
      .createQueryBuilder('hts')
      .select(['hts.htsNumber', 'hts.chapter'])
      .where('hts.isActive = true')
      .andWhere('hts.indent = 2');
    if (args.chapters && args.chapters.length > 0) {
      htsQb.andWhere('hts.chapter IN (:...chapters)', { chapters: args.chapters });
    }
    if (args.maxRows) htsQb.limit(args.maxRows);
    htsQb.orderBy('hts.htsNumber', 'ASC');
    const htsRows = await htsQb.getMany();

    process.stdout.write(
      `Importing extras for ${htsRows.length} HTS × ${args.countries.length} countries = ` +
        `${htsRows.length * args.countries.length} requests\n`,
    );

    // Preload existing (taxCode|countryCode|htsNumber) keys so the inner
    // loop can dedupe via an in-memory Set instead of a DB roundtrip per row.
    const existing = await extraRepo
      .createQueryBuilder('e')
      .select(['e.taxCode', 'e.countryCode', 'e.htsNumber'])
      .where('e.taxCode LIKE :p', { p: 'AISVC_%' })
      .getMany();
    const existingKeys = new Set(
      existing.map((e) => `${e.taxCode}|${e.countryCode}|${e.htsNumber}`),
    );
    process.stdout.write(
      `Preloaded ${existingKeys.size} existing AISVC keys for dedup\n`,
    );

    const stats = {
      requestsMade: 0,
      formulasReceived: 0,
      extraComponentsSkipped: 0,
      insertedRows: 0,
      updatedRows: 0,
      alreadyPresent: 0,
      failedRequests: 0,
    };

    for (const country of args.countries) {
      for (let i = 0; i < htsRows.length; i += args.batchSize) {
        const chunk = htsRows.slice(i, i + args.batchSize);
        let rows: AiFormulaRow[] = [];
        try {
          rows = await proxy.getFormulas(
            chunk.map((h) => ({ htsCode: h.htsNumber, country })),
          );
          stats.requestsMade += chunk.length;
        } catch (e: any) {
          stats.failedRequests += chunk.length;
          process.stderr.write(
            `[${country}] batch ${i} failed: ${e?.message ?? e}\n`,
          );
          continue;
        }

        for (let j = 0; j < chunk.length; j++) {
          const htsNumber = chunk[j].htsNumber;
          const chapter = chunk[j].chapter;
          const aiRow = rows[j];
          if (!aiRow?.formulas) continue;

          for (const f of aiRow.formulas) {
            stats.formulasReceived++;
            const cls = classifyAsExtra(f.tariffType ?? '');
            if (!cls) {
              stats.extraComponentsSkipped++;
              continue;
            }
            const formula = (f.formula || '').trim();
            if (!formula) continue;
            const taxCode = deterministicTaxCode(f.tariffType ?? '', formula);

            const dedupKey = `${taxCode}|${country}|${htsNumber}`;
            if (existingKeys.has(dedupKey)) {
              stats.alreadyPresent++;
              continue;
            }
            existingKeys.add(dedupKey);

            if (args.dryRun) {
              stats.insertedRows++;
              continue;
            }

            try {
              // taxName + description must be user-safe — the public
              // calculator API surfaces them as tariffTypeDescription. Never
              // leak the import provenance here; track that via metadata or
              // a separate audit table.
              const cleanDescription =
                f.tariffTypeDescription || humanizeTariffTypeKey(f.tariffType);
              await extraRepo.save(
                extraRepo.create({
                  taxCode,
                  taxName: cleanDescription,
                  description: cleanDescription,
                  htsNumber,
                  htsChapter: chapter,
                  countryCode: country,
                  extraRateType: cls.rateType,
                  rateText: formula,
                  rateFormula: formula,
                  minimumAmount: null,
                  maximumAmount: null,
                  isPercentage: /\bvalue\b/.test(formula),
                  applyTo: 'VALUE',
                  conditions: null,
                  priority: cls.priority,
                  isActive: true,
                  effectiveDate: null,
                  expirationDate: null,
                  legalReference: `ai-service ${f.tariffType}`,
                  notes: 'Imported by scripts/import-extra-taxes-from-ai-service.ts',
                  metadata: {
                    source: 'AI_SERVICE_IMPORT',
                    importedAt: new Date().toISOString(),
                    aiTariffType: f.tariffType,
                    aiTariffTypeDescription: f.tariffTypeDescription,
                  },
                }),
              );
              stats.insertedRows++;
            } catch (e: any) {
              process.stderr.write(
                `[${country}] save failed for ${htsNumber}/${taxCode}: ${e?.message ?? e}\n`,
              );
            }
          }
        }

        if ((i / args.batchSize) % 5 === 0) {
          process.stdout.write(
            `[${country}] ${i + chunk.length}/${htsRows.length} processed ` +
              `(insert=${stats.insertedRows} dup=${stats.alreadyPresent})\n`,
          );
        }
      }
    }

    process.stdout.write(
      `\nimport-extras ${args.dryRun ? '(DRY) ' : ''}done:\n` +
        `  requestsMade=${stats.requestsMade}\n` +
        `  formulasReceived=${stats.formulasReceived}\n` +
        `  extraComponentsSkipped=${stats.extraComponentsSkipped} (base/special/non_ntr)\n` +
        `  insertedRows=${stats.insertedRows}\n` +
        `  alreadyPresent=${stats.alreadyPresent}\n` +
        `  failedRequests=${stats.failedRequests}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('import-extras failed:', err?.stack || err);
  process.exit(1);
});
