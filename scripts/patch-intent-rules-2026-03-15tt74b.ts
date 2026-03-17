#!/usr/bin/env ts-node
/**
 * Patch TT74b — 2026-03-15: Fix PAPER_SEWING_PATTERN_INTENT — add allowChapters to prevent ch.73 noise.
 *
 * Bug found after TT74:
 *  "sewing pattern butterick" → 7319.90.10.00 (sewing needles!) WRONG (expected 6307.90.60)
 *  PAPER_SEWING_PATTERN_INTENT fires (anyOf: 'sewing pattern') + injects 6307.90 (rank:2)
 *  BUT: no positive allowChapters filter → organic ch.73 entries can pass through
 *  "sewing" semantically close to needles (7319) → 7319 wins organic score over injected 6307.90
 *  FIX: Add allowChapters:['63','49'] — only ch.63 (textile made-up) and ch.49 (printed matter) pass
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt74b.ts
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

    // Fix PAPER_SEWING_PATTERN_INTENT — add allowChapters to prevent ch.73 noise
    // "sewing pattern butterick" → 7319 (needles!) because "sewing" semantically pulls needles
    // Fix: allow only ch.63 (textile made-up articles) and ch.49 (printed matter/patterns)
    {
      const existing = allRules.find(r => r.id === 'PAPER_SEWING_PATTERN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowChapters: ['63', '49'],  // 63=textile made-up, 49=printed matter/designs
            denyChapters: ['48', '73', '84'],
          },
        } as IntentRule;
        await svc.upsertRule(updated, 571);
        console.log('✅ PAPER_SEWING_PATTERN_INTENT: added allowChapters:[63,49], denyChapters:[48,73,84]');
        console.log('   "sewing pattern butterick" → 6307.90 (correct, was 7319)');
      } else {
        console.log('❌ PAPER_SEWING_PATTERN_INTENT: not found');
      }
    }

    console.log('\nTT74b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
