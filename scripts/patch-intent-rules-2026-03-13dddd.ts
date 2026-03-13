#!/usr/bin/env ts-node
/**
 * Patch DDDD — 2026-03-13:
 *
 * Fix AI_CH59_COATED_FABRIC_PVC_PU falsely blocking trunks query.
 *
 * Fixes:
 *
 * 1.  FIX AI_CH59_COATED_FABRIC_PVC_PU — false firing on trunks query
 *     Query has tokens 'covered' (from "wholly or mainly covered with") and
 *     'textile' (from "of textile materials"), which satisfies the anyOfGroups.
 *     This rule has allowChapters=['59','39'], blocking ALL ch.42 entries
 *     (including 4202.12.21 which is the expected answer).
 *     Fix: add 'trunks', 'suitcases', 'briefcases', 'holsters', 'handbags',
 *     'backpacks', 'attache' to noneOf. These tokens indicate a luggage/container
 *     query, not a coated fabric (PVC/PU) query — rule should NOT fire.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13dddd.ts
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

    // ── 1. FIX AI_CH59_COATED_FABRIC_PVC_PU ──────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH59_COATED_FABRIC_PVC_PU') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'trunks', 'suitcases', 'briefcases', 'holsters', 'handbags',
          'backpacks', 'attache', 'satchels', 'knapsacks', 'wallets', 'purses',
        ];
        patches.push({
          priority: 630, // Keep same priority
          rule: {
            ...existing,
            description: 'PVC/PU coated fabric → ch.59 (ch.39). ' +
              'Fixed: long trunks HTS path query has "covered" + "textile" tokens, ' +
              'causing false fire. Added luggage/container terms to noneOf: ' +
              'trunks, suitcases, briefcases, holsters, handbags, backpacks, etc.',
            pattern: {
              ...pat,
              noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
            },
          },
        });
        console.log('AI_CH59_COATED_FABRIC_PVC_PU: added trunks/suitcases/briefcases/holsters to noneOf');
      } else {
        console.log('WARNING: AI_CH59_COATED_FABRIC_PVC_PU not found in cache');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch DDDD)...`);
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
    console.log(`\nPatch DDDD complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
