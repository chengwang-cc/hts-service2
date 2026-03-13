#!/usr/bin/env ts-node
/**
 * Patch CCCC — 2026-03-13:
 *
 * Root-cause fix for trunks/4202.12 being denied.
 *
 * Fixes:
 *
 * 1.  FIX SHOPPING_BAG_INTENT — noneOf prevents false firing on trunks query
 *     The long trunks eval query contains 'shopping bags' as one of many listed
 *     containers in the HTS path description, causing SHOPPING_BAG_INTENT to fire.
 *     SHOPPING_BAG_INTENT has denyPrefixes=['4202.12'], which DENIES all 4202.12
 *     entries. This is why 4202.12.21 (the expected result) never appears in results.
 *     Fix: add 'trunks', 'suitcases', 'briefcases', 'backpacks', 'knapsacks',
 *     'attache', 'vanity' to noneOf. These tokens indicate a broader container
 *     query, not a shopping bag query — rule should not fire.
 *
 * 2.  ALSO fix TRUNKS whitelist: change allowPrefixes to denyPrefixes approach
 *     to avoid the OR-logic problem (if another rule with allowChapters='42' fires,
 *     it would override the allowPrefixes=['4202.12'] restriction).
 *     Use denyPrefixes for all 4202.xx EXCEPT 4202.12.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13cccc.ts
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
    const allRules = svc.getAllRules() as IntentRule[];

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. FIX SHOPPING_BAG_INTENT ─────────────────────────────────────────────
    // Add noneOf to prevent firing on the long trunks query.
    // The query contains 'shopping bags' as one item in a long list of container
    // types, but the query is actually about trunks/suitcases/briefcases.
    {
      const existing = allRules.find(r => r.id === 'SHOPPING_BAG_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'trunks', 'suitcases', 'briefcases', 'backpacks', 'knapsacks',
          'attache', 'vanity', 'holsters', 'binocular', 'spectacle',
        ];
        patches.push({
          priority: 500, // Keep same priority as existing
          rule: {
            ...existing,
            description: 'Tote/shopping bag → 4202.92. ' +
              'Fixed: long trunks HTS path query contains "shopping bags" as one item, ' +
              'causing rule to fire and deny 4202.12. ' +
              'noneOf=[trunks,suitcases,briefcases,...] prevents false firing.',
            pattern: {
              ...pat,
              noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
            },
          },
        });
        console.log('SHOPPING_BAG_INTENT: added trunks/suitcases/briefcases/backpacks to noneOf');
      }
    }

    // ── 2. FIX TRUNKS — use denyPrefixes instead of allowPrefixes ─────────────
    // allowPrefixes uses OR logic: another rule with allowChapters=['42'] could
    // override it. denyPrefixes uses AND logic: always denies regardless of other rules.
    // Deny all 4202.xx EXCEPT 4202.12.
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 720,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'Uses denyPrefixes (AND logic) to reliably block 4202.3x/4202.2x/4202.9x. ' +
              'allowPrefixes was overridden by other rules with broader allowChapters.',
            whitelist: {
              denyPrefixes: [
                '4202.11', '4202.19',
                '4202.21', '4202.22', '4202.29',
                '4202.31', '4202.32', '4202.39',
                '4202.91', '4202.92', '4202.99',
              ],
            },
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: changed to denyPrefixes whitelist');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch CCCC)...`);
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
    console.log(`\nPatch CCCC complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
