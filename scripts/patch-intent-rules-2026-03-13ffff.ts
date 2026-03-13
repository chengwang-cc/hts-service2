#!/usr/bin/env ts-node
/**
 * Patch FFFF — 2026-03-13:
 *
 * Fix BACKPACK_INTENT falsely blocking trunks query.
 *
 * Root cause:
 *   The long trunks HTS path description enumerates many container types:
 *   "trunks, suitcases, ..., knapsacks and backpacks, handbags, shopping bags..."
 *   BACKPACK_INTENT fires because 'knapsacks' and 'backpacks' appear as tokens.
 *   BACKPACK_INTENT has denyPrefixes=['4202.12'], which DENIES all 4202.12 entries
 *   (including 4202.12.21, the expected answer).
 *   This deny is the final blocker: TRUNKS rule's allowChapters=['42'] cannot
 *   override a deny from another fired rule.
 *
 * Fix:
 *   Add 'trunks', 'suitcases', 'briefcases', 'attache', 'vanity', 'holsters'
 *   to BACKPACK_INTENT's noneOf. When the query is about the broad container
 *   category (HTS path enumeration), these terms indicate it's NOT a backpack query.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ffff.ts
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

    // ── FIX BACKPACK_INTENT ────────────────────────────────────────────────────
    // Problem: long trunks HTS path lists "knapsacks and backpacks" among many
    // container types, triggering BACKPACK_INTENT. Its denyPrefixes=['4202.12']
    // then blocks ALL 4202.12 entries (the expected answer is 4202.12.21).
    // Solution: add trunks/suitcases/briefcases/attache/vanity/holsters to noneOf
    // so BACKPACK_INTENT does NOT fire on the broad container enumeration query.
    {
      const existing = allRules.find(r => r.id === 'BACKPACK_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'trunks', 'suitcases', 'briefcases', 'attache', 'vanity',
          'holsters', 'handbags', 'wallets', 'purses', 'spectacle',
        ];
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: 'Backpack/rucksack/knapsack → 4202.92 (ch.42). ' +
              'Fixed: long trunks HTS path query enumerates "knapsacks and backpacks" ' +
              'as part of a broad container list, causing rule to fire and deny 4202.12. ' +
              'noneOf=[trunks,suitcases,briefcases,...] prevents false firing.',
            pattern: {
              ...pat,
              noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
            },
          },
        });
        console.log('BACKPACK_INTENT: added trunks/suitcases/briefcases/attache/vanity to noneOf');
      } else {
        console.log('WARNING: BACKPACK_INTENT not found in cache');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch FFFF)...`);
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
    console.log(`\nPatch FFFF complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
