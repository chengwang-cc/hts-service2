#!/usr/bin/env ts-node
/**
 * Patch TT64 — 2026-03-15: Fix EMPTYs from TT62/TT63 caused by over-aggressive denyChapters.
 * Current: 35.12% (1765/5025), EMPTY: 24 (up from 21)
 *
 * Fixes:
 *  1. UPDATE SLATE_STONE_PRODUCT_INTENT — remove denyChapters: ['84'] causing EMPTY
 *     "slate coasters set" → EMPTY (deny ch.84 removes 8471 but no 6815 survives threshold)
 *     FIX: Remove denyChapters, rely on inject + boost to win over 8471 organically
 *  2. UPDATE CARVED_NATURAL_SHELL_BONE_INTENT — remove denyChapters & denyPrefixes causing EMPTY
 *     "bone tablet weaving cards set" → EMPTY (deny ch.84 removes 8471, nothing else survives)
 *     FIX: Remove denyChapters: ['71', '84'], remove denyPrefixes: ['7113', '7117.90']
 *     Just rely on inject with high syntheticRank + boost
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt64.ts
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

    // 1. UPDATE SLATE_STONE_PRODUCT_INTENT — remove denyChapters: ['84']
    //    "slate coasters set" → EMPTY because:
    //    1. Rule matches "slate set" and "slate coasters"
    //    2. denyChapters: ['84'] removes 8471.30 (computers) — the only organic result
    //    3. Injected 6815.99 doesn't survive 0.35 threshold → EMPTY
    //    FIX: Remove denyChapters, keep inject + boost
    {
      const existing = allRules.find(r => r.id === 'SLATE_STONE_PRODUCT_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            // Removed denyChapters: ['84'] — was causing EMPTY
            // Rely on inject + strong boost instead
          },
          inject: [
            { prefix: '6815.99', syntheticRank: 5 },
            { prefix: '6802.29', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.70, prefixMatch: '6815.' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: updated });
        console.log('SLATE_STONE_PRODUCT_INTENT: removed denyChapters[84] (was causing EMPTY)');
      } else {
        console.log('SLATE_STONE_PRODUCT_INTENT: not found');
      }
    }

    // 2. UPDATE CARVED_NATURAL_SHELL_BONE_INTENT — remove denyChapters + denyPrefixes
    //    "bone tablet weaving cards set" → EMPTY because:
    //    1. Rule matches "bone tablet weaving"
    //    2. denyChapters: ['71', '84'] removes 8471 (computers) — only organic result
    //    3. Injected 9601.90 doesn't survive threshold → EMPTY
    //    FIX: Remove denyChapters and denyPrefixes; use high syntheticRank + strong boost
    {
      const existing = allRules.find(r => r.id === 'CARVED_NATURAL_SHELL_BONE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            // Removed denyChapters: ['71', '84'] and denyPrefixes — were causing EMPTY
            // Without deny, the boost might not win, but at least no EMPTY
          },
          inject: [
            { prefix: '9601.90', syntheticRank: 5 },
            { prefix: '9601.10', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.70, prefixMatch: '9601.' }],
        } as IntentRule;
        patches.push({ priority: 584, rule: updated });
        console.log('CARVED_NATURAL_SHELL_BONE_INTENT: removed denyChapters/denyPrefixes (was causing EMPTY)');
      } else {
        console.log('CARVED_NATURAL_SHELL_BONE_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT64)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT64 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
