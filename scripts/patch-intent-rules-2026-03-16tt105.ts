#!/usr/bin/env ts-node
/**
 * Patch TT105 — 2026-03-16: Revert COTTON_PILLOW_COVER_BED_INTENT to TT103 state.
 *
 * Problem: TT104 replaced the penalty approach with denyPrefixes:['6304.'] hard-block,
 * causing a regression: 38.53% → 38.47% (-3 hits, +1 empty).
 *
 * Root cause of TT104 regression:
 *   - TT104 removed { chapterMatch: '63' } boost (delta: 0.40) from boosts list.
 *   - This hurt ch.63 entries OTHER than 6302 (e.g., 6307.90-expected items) that relied
 *     on the general ch.63 boost to pass hit@10.
 *   - 3 entries that expected ch.63 codes (possibly 6307.90) lost their 0.40 boost and
 *     fell below threshold.
 *   - The hard-block of 6304 via denyPrefixes also introduced instability.
 *
 * Fix: Revert to TT103 state:
 *   - inject: [6302.21 rank2, 6302.22 rank4, 6302.31 rank6]
 *   - boosts: [0.75 for 6302., 0.40 ch.63]
 *   - penalties: [0.60 for 6304., 0.70 for 9404., 0.40 for 6307.]
 *   - whitelist: removed (no denyPrefixes)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt105.ts
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

    // REVERT COTTON_PILLOW_COVER_BED_INTENT to TT103 state.
    // TT104 removed ch.63 general boost and replaced penalties with denyPrefixes hard-block.
    // This hurt 3 entries that expected ch.63 codes (e.g. 6307.90) and relied on the +0.40 boost.
    // Restoring TT103 state: penalty-based approach with ch.63 general boost kept.
    {
      const existing = allRules.find(r => r.id === 'COTTON_PILLOW_COVER_BED_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '6302.21', syntheticRank: 2 },   // woven cotton pillow cases
            { prefix: '6302.22', syntheticRank: 4 },   // printed cotton pillow cases
            { prefix: '6302.31', syntheticRank: 6 },   // other cotton bed linen
          ],
          whitelist: undefined as any,                  // no hard-block (TT103 had no whitelist)
          boosts: [
            { delta: 0.75, prefixMatch: '6302.' },      // boost bed linen
            { delta: 0.40, chapterMatch: '63' },         // general ch.63 boost (RESTORED from TT104 removal)
          ],
          penalties: [
            { delta: 0.60, prefixMatch: '6304.' },      // penalty for decorative furnishing articles
            { delta: 0.70, prefixMatch: '9404.' },      // penalty for mattresses/quilts
            { delta: 0.40, prefixMatch: '6307.' },      // penalty for misc textile articles
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 565, rule: updated });
        console.log('COTTON_PILLOW_COVER_BED_INTENT: reverted to TT103 state (penalty approach, ch.63 boost restored)');
      } else {
        console.log('COTTON_PILLOW_COVER_BED_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT105)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT105 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
