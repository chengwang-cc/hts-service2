#!/usr/bin/env ts-node
/**
 * Patch TT109 — 2026-03-16: Fix THROW_PILLOW_COVER_WOVEN_INTENT empty results.
 *
 * Problem: TT108 added allowPrefixes:['6302.'] which is causing EMPTY results for
 * "DECORATIVE RED COTTON THROW PILLOW COVER" because the many other pillow intents
 * that fire simultaneously have conflicting allowChapters, and the interaction with
 * allowPrefixes is preventing 6302 entries from surviving the whitelist filter.
 *
 * Fix: Replace allowPrefixes approach with lexicalFilter.stripTokens approach:
 *   1. Strip "throw", "decorative", "red" from lexical search tokens
 *      - Removes words that strongly match 6304 ("decorative furnishing throw")
 *      - Removes words that match 6301 ("cotton throw/blanket")
 *      - Leaves "cotton", "pillow", "cover" for lexical → strongly matches 6302
 *   2. Keep denyPrefixes for 6304, 6307, 6301 (belt-and-suspenders)
 *   3. Remove allowPrefixes (was causing empty results)
 *   4. Strong inject at rank 1 + boost for 6302
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt109.ts
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

    // FIX THROW_PILLOW_COVER_WOVEN_INTENT:
    // Remove allowPrefixes (was causing empty results).
    // Add lexicalFilter.stripTokens to remove "throw", "decorative", "red" from lexical query.
    // These words cause 6304 ("decorative throw pillow covers") and 6301 ("cotton throws/blankets")
    // to have high lexical coverage. After stripping, lexical query = "cotton pillow cover" which
    // strongly matches 6302 (pillow cases/bed linen) entries.
    // Also extend denyPrefixes to include 6301 (cotton throws).
    {
      const existing = allRules.find(r => r.id === 'THROW_PILLOW_COVER_WOVEN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          lexicalFilter: {
            stripTokens: ['throw', 'decorative', 'red', 'blue', 'green', 'yellow', 'white', 'black'],
            // Strip color words + "throw" + "decorative" — these match furnishing/throw articles
            // Remaining for lexical: "cotton", "pillow", "cover" → matches 6302 bed linen
          },
          whitelist: {
            denyPrefixes: ['6304.', '6307.', '6301.'],  // block decorative furnishing, misc textiles, blankets/throws
            // NO allowPrefixes — that was causing empty results
          },
          boosts: [
            { delta: 0.95, prefixMatch: '6302.' },    // very strong boost for bed linen
            { delta: 0.60, chapterMatch: '63' },       // general ch.63 boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6304.' },    // strong penalty (redundant with denyPrefixes)
            { delta: 0.80, prefixMatch: '6301.' },    // penalty for blankets/throws
            { delta: 0.70, prefixMatch: '6307.' },    // penalty for misc textiles
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 572, rule: updated });
        console.log('THROW_PILLOW_COVER_WOVEN_INTENT: removed allowPrefixes, added lexicalFilter stripTokens, denyPrefixes += 6301');
      } else {
        console.log('THROW_PILLOW_COVER_WOVEN_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT109)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT109 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
