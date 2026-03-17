#!/usr/bin/env ts-node
/**
 * Patch TT75b — 2026-03-15: Fix PAPER_SEWING_PATTERN_INTENT — remove strict allowChapters.
 *
 * Bug found after TT74b:
 *  PAPER_SEWING_PATTERN_INTENT has allowChapters:['63','49'] + denyChapters:['48','73','84']
 *  → 7 new EMPTY results (EMPTY went from 18 to 25):
 *    - "sewing patterns made of paper" → EMPTY (expected ch.48 = paper/stationery)
 *    - "Rare Butterick 3461 70s Sewing Pattern..." → EMPTY (expected ch.48)
 *    - "Sewing Pattern (Simplicity 1715)" → EMPTY (expected ch.63 = 6307.90)
 *    - etc.
 *  BUG: allowChapters:['63','49'] blocks all ch.48 results; when no ch.63/49 in pool → EMPTY
 *       Also denyChapters:['48'] blocks the correct answers for ch.48 queries
 *  FIX: Remove allowChapters entirely, keep only denyChapters for clearly wrong chapters
 *       (remove ch.48 from denyChapters since some sewing patterns ARE expected in ch.48)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt75b.ts
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

    // Fix PAPER_SEWING_PATTERN_INTENT — relax to denyChapters only
    // allowChapters:['63','49'] was causing empty results for ch.48 and ch.63 sewing patterns
    // New: only deny clearly wrong chapters (not ch.48 which has some correct sewing pattern codes)
    {
      const existing = allRules.find(r => r.id === 'PAPER_SEWING_PATTERN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            // No allowChapters — allow organic results from any chapter
            // Only deny obviously wrong chapters like machinery and sewing equipment
            denyChapters: ['84', '73', '85'],  // deny machinery, iron/steel articles, electrical
          },
        } as IntentRule;
        await svc.upsertRule(updated, 571);
        console.log('✅ PAPER_SEWING_PATTERN_INTENT: removed allowChapters, relaxed to denyChapters:[84,73,85]');
        console.log('   ch.48 (paper patterns) and ch.63 (textile patterns) now both allowed');
      } else {
        console.log('❌ PAPER_SEWING_PATTERN_INTENT: not found');
      }
    }

    console.log('\nTT75b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
