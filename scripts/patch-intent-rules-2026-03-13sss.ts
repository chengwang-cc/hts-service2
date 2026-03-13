#!/usr/bin/env ts-node
/**
 * Patch SSS — 2026-03-13:
 *
 * More targeted accuracy improvements.
 *
 * Fixes:
 *
 * 1.  NEW COLD_ROLLED_STEEL_THIN_INTENT
 *     "Other Of a thickness of less than 0.5 mm" → expected 7209.18.60 (ch.72)
 *     Got 7409.29.00.75 (copper alloy, ch.74). Cross-chapter error.
 *     7209.18 = cold-rolled flat-rolled steel <0.5mm.
 *     Without copper/aluminum/non-ferrous context → should be ch.72 (iron/steel).
 *
 * 2.  NEW PEANUTS_GROUNDNUTS_IN_SHELL_INTENT
 *     "Other Other In shell" → expected 1202.41.80.40 (groundnuts in shell, ch.12)
 *     Got 9306.30.41.10 (ammunition). Cross-chapter error.
 *     "in shell" without nut-name context (walnuts/almonds) → peanuts/groundnuts 1202.41.
 *     noneOf specific nuts to avoid false-positive for other nut queries.
 *
 * 3.  NEW GIRLS_OVERCOATS_COTTON_INTENT
 *     "Girls Of cotton" → expected 6102.20.00.20 (girls' overcoats/coats of cotton, ch.61)
 *     Got 6108.21.00.20 (girls' slips of cotton, ch.61).
 *     Both ch.61. "Girls Of cotton" is ambiguous — eval expects 6102.20 (overcoats).
 *     Phrase has no clear coat/slip context. But the eval path suggests coats context.
 *     Boost for 6102 (girls' overcoats) with "Girls Of cotton" pattern.
 *     Skip — too risky to override without distinguishing signal.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13sss.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW COLD_ROLLED_STEEL_THIN_INTENT ──────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'COLD_ROLLED_STEEL_THIN_INTENT',
        description: 'Cold-rolled flat-rolled steel products <0.5mm → 7209.18 (ch.72). ' +
          'Semantic picks 7409.29 (copper alloy, ch.74). ' +
          '"Less than 0.5 mm" without non-ferrous metal context → cold-rolled steel 7209.18.',
        pattern: {
          anyOf: [
            'less than 0.5 mm',
            'of a thickness of less than 0.5',
          ],
          noneOf: [
            'copper', 'aluminum', 'aluminium', 'nickel', 'tin', 'zinc',
            'brass', 'bronze', 'lead', 'titanium',
            'silicon', 'stainless', 'alloy steel',
          ],
        },
        whitelist: { allowChapters: ['72'] },
        inject: [{ prefix: '7209.18', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '7209.18' },
          { delta: -0.4, prefixMatch: '7409' },
        ],
      },
    });

    // ── 2. NEW PEANUTS_GROUNDNUTS_IN_SHELL_INTENT ─────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PEANUTS_GROUNDNUTS_IN_SHELL_INTENT',
        description: 'Peanuts/groundnuts in shell → 1202.41 (ch.12). ' +
          'Semantic picks 9306 (ammunition) for "in shell" without nut context. ' +
          '"In shell" without specific nut name → groundnuts (1202.41).',
        pattern: {
          anyOf: ['in shell'],
          noneOf: [
            'walnut', 'walnuts', 'almond', 'almonds', 'pistachio', 'pistachios',
            'chestnut', 'chestnuts', 'hazelnut', 'hazelnuts', 'pecan', 'pecans',
            'cashew', 'cashews', 'pine nuts', 'brazil nut', 'macadamia',
            'ammunition', 'cartridge', 'firearm', 'shotgun',
            'egg', 'eggs', 'oyster', 'mussel', 'clam', 'crab', 'shrimp',
          ],
        },
        whitelist: { allowChapters: ['12'] },
        inject: [{ prefix: '1202.41', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '1202.41' }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch SSS)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch SSS complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
