#!/usr/bin/env ts-node
/**
 * Patch TT83b — 2026-03-16: Fix ZIPPER_INTENT regression.
 *
 * Regression from TT83:
 *  "Handmade whale zipper pouch" → 0106.12 (live whales!) REGRESSION
 *  TT83 added 'zipper pouch' to ZIPPER_INTENT noneOf, so the intent no longer fires for
 *  "whale zipper pouch". Without ZIPPER_INTENT, "whale" semantic dominates → live animal (0106).
 *
 *  Fix: Revert ZIPPER_INTENT noneOf back to empty (remove the TT83 noneOf additions).
 *  The expected code 5801.26 for "quilted zipper pouch" might be a dataset quality issue;
 *  it's better to get 9607 (zipper) than 0106 (live animals) for whale pouches.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt83b.ts
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

    // Revert ZIPPER_INTENT noneOf — remove TT83's additions
    // TT83 added 'zipper pouch', 'handmade zipper', etc. to noneOf, causing
    // "handmade whale zipper pouch" → 0106.12 (live whales) when ZIPPER_INTENT didn't fire.
    {
      const existing = allRules.find(r => r.id === 'ZIPPER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [],  // restore to original empty noneOf
          },
        } as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 500);
        console.log('✅ ZIPPER_INTENT: reverted noneOf to empty (removes TT83 regression)');
      } else {
        console.log('❌ ZIPPER_INTENT: not found');
      }
    }

    console.log('\nTT83b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
