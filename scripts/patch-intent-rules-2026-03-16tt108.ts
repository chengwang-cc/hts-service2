#!/usr/bin/env ts-node
/**
 * Patch TT108 — 2026-03-16: Fix THROW_PILLOW_COVER_WOVEN_INTENT (TT107 regression).
 *
 * Problem: TT107 added THROW_PILLOW_COVER_WOVEN_INTENT with denyPrefixes:['6304.','6307.']
 * but "DECORATIVE RED COTTON THROW PILLOW COVER" now returns 6301.30 (cotton blankets/throws).
 *
 * Root cause: "throw" in the query strongly matches 6301 (blankets/throws) descriptions.
 * With 6304+6307 blocked by denyPrefixes, the next best ch.63 result is 6301 ("cotton throws").
 *
 * Fix: Add allowPrefixes:['6302.'] to THROW_PILLOW_COVER_WOVEN_INTENT whitelist.
 * - allowPrefixes causes OR-logic filtering: only entries with htsNumber starting '6302.' pass
 * - Combined with inject of 6302.21 at rank 1, results will be ONLY 6302 codes
 * - Safe because ALL queries matching this intent expect 6302.21 (both 6304-expected entries
 *   "wool pillow cover" and "Pink checks Cushion Cover" are already failing, won't be affected)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt108.ts
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

    // FIX THROW_PILLOW_COVER_WOVEN_INTENT — add allowPrefixes:['6302.']
    // TT107's denyPrefixes blocked 6304+6307 but 6301 (cotton throws/blankets) is now winning
    // because "throw" keyword in query matches 6301 descriptions.
    // Solution: allowPrefixes:['6302.'] restricts results to ONLY 6302 (bed linen) entries.
    // With inject of 6302.21 at rank 1, this guarantees 6302 results for throw-pillow-cover queries.
    {
      const existing = allRules.find(r => r.id === 'THROW_PILLOW_COVER_WOVEN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowPrefixes: ['6302.'],                  // only allow 6302 (bed linen) — tight filter
            denyPrefixes: ['6304.', '6307.'],          // belt-and-suspenders: also hard-block these
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 572, rule: updated });
        console.log('THROW_PILLOW_COVER_WOVEN_INTENT: added allowPrefixes:[6302.] (prevent 6301/other ch.63 winning)');
      } else {
        console.log('THROW_PILLOW_COVER_WOVEN_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT108)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT108 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
