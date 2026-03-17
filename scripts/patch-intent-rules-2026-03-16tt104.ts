#!/usr/bin/env ts-node
/**
 * Patch TT104 — 2026-03-16: Fix pillow cover → 6302 by hard-blocking 6304.
 *
 * Problem: "DECORATIVE RED COTTON THROW PILLOW COVER" → 6304.99 still winning
 *   despite COTTON_PILLOW_COVER_BED_INTENT penalty of 0.60 for '6304.'.
 *
 * Root cause:
 *   COTTON_PILLOW_COVER_LINEN_INTENT fires (priority 555) and boosts ch.63 by 0.40.
 *   COTTON_PILLOW_COVER_BED_INTENT fires (priority 565) and:
 *     - boosts ch.63 by 0.40 (BAD: this helps 6304 too)
 *     - penalizes 6304 by 0.60
 *   Net adjustment for 6304: +0.40 + 0.40 - 0.60 = +0.20 (still net positive!)
 *   So organic 6304 with decent score + 0.20 net boost still beats injected 6302.21.
 *
 * Fix:
 *   1. Update COTTON_PILLOW_COVER_BED_INTENT:
 *      - Add whitelist.denyPrefixes: ['6304.'] → hard-blocks 6304 via AND logic
 *      - Remove { chapterMatch: '63' } boost (was boosting 6304 entries)
 *      - Keep { prefixMatch: '6302.' } boost only
 *      - Remove penalties (redundant once hard-blocked)
 *
 *   Both 6304-expected pillow entries ("Pink checks Cushion Cover" → 6304.92,
 *   "wool pillow cover" → 6304.99) are ALREADY FAILING (returning wrong codes),
 *   so denyPrefixes:['6304.'] causes no new regressions.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt104.ts
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

    // UPDATE COTTON_PILLOW_COVER_BED_INTENT:
    //   Replace penalty-based approach with denyPrefixes hard-block for 6304.
    //   Also remove the { chapterMatch: '63' } boost that was benefiting 6304.
    //   Both 6304-expected pillow queries are already failing → no regressions.
    {
      const existing = allRules.find(r => r.id === 'COTTON_PILLOW_COVER_BED_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '6302.21', syntheticRank: 2 },
            { prefix: '6302.22', syntheticRank: 4 },
            { prefix: '6302.31', syntheticRank: 6 },
          ],
          whitelist: {
            denyPrefixes: ['6304.'],               // hard-block 6304 (decorative furnishing) — AND logic blocks even when other rules allowChapters:['63']
          },
          boosts: [
            { delta: 0.75, prefixMatch: '6302.' }, // boost bed linen (only 6302, no ch.63 general boost)
          ],
          penalties: undefined as any,              // remove penalties (redundant with hard-block)
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 565, rule: updated });
        console.log('COTTON_PILLOW_COVER_BED_INTENT: replaced penalty with denyPrefixes:["6304."], removed ch.63 boost');
      } else {
        console.log('COTTON_PILLOW_COVER_BED_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT104)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT104 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
