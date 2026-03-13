#!/usr/bin/env ts-node
/**
 * Patch FFF — 2026-03-13:
 *
 * Continue improving accuracy after DDD+EEE.
 * Problem: inject at syntheticRank:8 is not strong enough when the WRONG entry
 * already has high natural semantic+lexical scores, or when the CORRECT entry
 * is already in the fused map but ranked too low.
 * Solution: Use BOOSTS mechanism (delta added to existing scores) instead of
 * or in addition to inject for stubborn within-chapter failures.
 *
 * Fixes:
 *
 * 1.  UPDATE BEEF_AIRTIGHT_SAUSAGE_INTENT — add boosts for 1601. prefix
 *     "Other Beef in airtight containers" → expected 1601.00.40.90
 *     Got 1602.50.07.20 (other prepared beef). Both ch.16.
 *     inject@8 fires but 1602.50 has stronger natural scores.
 *     Adding boost delta=0.5 on prefixMatch='1601.' to push 1601. entries up.
 *
 * 2.  UPDATE CIGARETTE_LEAF_TOBACCO_INTENT — add boosts for 2401.10.44 prefix
 *     "Cigarette leaf Tobacco not stemmed..." → expected 2401.10.44.00
 *     Got 2401.30.23.10 (tobacco refuse). Both ch.24.
 *     Other ch.24 rules (AI_CH24_TOBACCO_REFUSE) inject 2401.30@40 which still
 *     beats semantic. Boost 2401.10.44 strongly to override.
 *
 * 3.  UPDATE USED_TIRES_ONLY_INTENT — add boosts for 4012.20 prefix
 *     "Other Used pneumatic tires" → expected 4012.20.45.00
 *     Got 4012.12.80.19 (retreaded). Both ch.40.
 *     AI_CH40_RETREADED_USED_TIRES injects 4012.12@40 and semantic prefers it.
 *     Boost 4012.20 entries up so USED_TIRES rule overcomes the retreaded signal.
 *
 * 4.  UPDATE PROTECTIVE_FOOTWEAR_ANKLE_INTENT — add boosts for 6402.91.42 prefix
 *     "For men Protective active footwear...Covering the ankle" → expected 6402.91.42.30
 *     Got 6406.90.30.30 (parts of footwear). Cross-chapter ch.64→ch.64 within.
 *     inject@8 not enough. Boost 6402.91.42 entries.
 *
 * 5.  UPDATE VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT — add boosts for 6404.19.82
 *     "For men Wither uppers of vegetable fibers..." → expected 6404.19.82.30
 *     Got 6406.90.30.30. Both ch.64.
 *     inject@8 not enough. Boost 6404.19.82 entries.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13fff.ts
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

    // ── 1. UPDATE BEEF_AIRTIGHT_SAUSAGE_INTENT — add boosts ───────────────────
    {
      const existing = allRules.find(r => r.id === 'BEEF_AIRTIGHT_SAUSAGE_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              { delta: 0.5, prefixMatch: '1601.' },
            ],
          },
        });
      } else {
        // Fallback: create from scratch with inject + boosts
        patches.push({
          priority: 660,
          rule: {
            id: 'BEEF_AIRTIGHT_SAUSAGE_INTENT',
            description: 'Beef sausages in airtight containers → 1601.00.40 (ch.16). ' +
              'Anchored by beef + airtight containers phrase. Boosted to override 1602.',
            pattern: {
              anyOf: ['airtight containers', 'airtight container'],
              noneOf: [
                'salmon', 'tuna', 'fish', 'seafood', 'herring', 'mackerel',
                'shrimp', 'prawn', 'lobster', 'crab', 'clam', 'oyster',
                'apricot', 'citrus', 'peach', 'pear', 'fruit', 'cereal',
              ],
              anyOfGroups: [
                ['beef', 'bovine', 'cattle'],
              ],
            },
            whitelist: { allowChapters: ['16'] },
            inject: [{ prefix: '1601.00.40', syntheticRank: 8 }],
            boosts: [
              { delta: 0.5, prefixMatch: '1601.' },
            ],
          },
        });
      }
    }

    // ── 2. UPDATE CIGARETTE_LEAF_TOBACCO_INTENT — add boosts ──────────────────
    {
      const existing = allRules.find(r => r.id === 'CIGARETTE_LEAF_TOBACCO_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              { delta: 0.6, prefixMatch: '2401.10.44' },
              { delta: 0.3, prefixMatch: '2401.10' },
            ],
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'CIGARETTE_LEAF_TOBACCO_INTENT',
            description: 'Cigarette leaf tobacco (unstemmed) → 2401.10.44. ' +
              'Boosted strongly to override 2401.30 (tobacco refuse) which AI_CH24_TOBACCO_REFUSE injects.',
            pattern: {
              anyOf: ['cigarette leaf'],
              noneOf: ['partly stemmed', 'wholly stemmed', 'partly or wholly stemmed'],
            },
            whitelist: { allowChapters: ['24'] },
            inject: [{ prefix: '2401.10.44', syntheticRank: 8 }],
            boosts: [
              { delta: 0.6, prefixMatch: '2401.10.44' },
              { delta: 0.3, prefixMatch: '2401.10' },
            ],
          },
        });
      }
    }

    // ── 3. UPDATE USED_TIRES_ONLY_INTENT — add boosts ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'USED_TIRES_ONLY_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              { delta: 0.5, prefixMatch: '4012.20' },
            ],
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'USED_TIRES_ONLY_INTENT',
            description: 'Used (not retreaded) pneumatic tires → 4012.20. ' +
              'Boosted to override 4012.12 (retreaded) which wins via semantic.',
            pattern: {
              anyOfGroups: [
                ['used'],
                ['tire', 'tires', 'tyre', 'tyres'],
              ],
              noneOf: [
                'retreaded', 'retread', 'recapped', 'recap', 'remolded', 'remould',
                'solid', 'cushion', 'tread only', 'tire tread', 'tire flap',
              ],
            },
            whitelist: { allowChapters: ['40'] },
            inject: [{ prefix: '4012.20', syntheticRank: 8 }],
            boosts: [
              { delta: 0.5, prefixMatch: '4012.20' },
            ],
          },
        });
      }
    }

    // ── 4. UPDATE PROTECTIVE_FOOTWEAR_ANKLE_INTENT — add boosts ───────────────
    {
      const existing = allRules.find(r => r.id === 'PROTECTIVE_FOOTWEAR_ANKLE_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              { delta: 0.5, prefixMatch: '6402.91.42' },
            ],
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'PROTECTIVE_FOOTWEAR_ANKLE_INTENT',
            description: 'Protective active footwear covering ankle → 6402.91.42 (ch.64).',
            pattern: {
              anyOf: ['protective active footwear'],
            },
            whitelist: { allowChapters: ['64'] },
            inject: [{ prefix: '6402.91.42', syntheticRank: 8 }],
            boosts: [
              { delta: 0.5, prefixMatch: '6402.91.42' },
            ],
          },
        });
      }
    }

    // ── 5. UPDATE VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT — add boosts ──────────
    {
      const existing = allRules.find(r => r.id === 'VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              { delta: 0.5, prefixMatch: '6404.19.82' },
            ],
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT',
            description: 'Footwear with vegetable fiber uppers → 6404.19.82 (ch.64).',
            pattern: {
              anyOf: ['uppers of vegetable fibers', 'upper of vegetable fiber', 'vegetable fiber upper'],
            },
            whitelist: { allowChapters: ['64'] },
            inject: [{ prefix: '6404.19.82', syntheticRank: 8 }],
            boosts: [
              { delta: 0.5, prefixMatch: '6404.19.82' },
            ],
          },
        });
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch FFF)...`);
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
    console.log(`\nPatch FFF complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
