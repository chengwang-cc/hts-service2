#!/usr/bin/env ts-node
/**
 * Patch TT15b — 2026-03-15: EMERGENCY REVERT of TT15 GLASS changes.
 * TT15 caused 338 EMPTY results by adding overly broad anyOf to GLASS_DRINKWARE_BEER_MUG_INTENT
 * (which has allowChapters: ['70'] whitelist) and changing GLASSWARE_DRINKING_INTENT boost.
 *
 * This patch:
 *  1. Revert GLASS_DRINKWARE_BEER_MUG_INTENT: restore original narrow anyOf (only specific glass types)
 *  2. Revert GLASSWARE_DRINKING_INTENT: restore original inject ranks and chapterMatch boost
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt15b.ts
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

    // 1. REVERT GLASS_DRINKWARE_BEER_MUG_INTENT: restore original tight anyOf
    //    Must NOT have generic terms like 'glassware set', '16 oz glass', 'oz glass set', 'NHL glass'
    //    because the whitelist allowChapters: ['70'] blocks non-glass products
    {
      const e = allRules.find(r => r.id === 'GLASS_DRINKWARE_BEER_MUG_INTENT');
      if (e) {
        const safePattern = {
          anyOf: [
            // Original safe terms only - very specific glass drinkware
            'glass beer mug', 'glass beer mugs', 'glass tumbler', 'glass tumblers',
            'glass drinking mug', 'glass pub mug', 'beer glass mug',
            'set of drinking glasses', 'glass drinking glasses', 'drinking glasses glass',
            'glass highball', 'glass lowball', 'glass shot glass',
            // New safe additions - must be very specific to glass drinkware
            'lowball glasses', 'vintage lowball glasses',
            'retro glass tumbler', 'vintage glass tumbler',
            'vintage drinking glass', 'vintage drinking glasses set',
            'beer glass set', 'frosted beer glass', 'pint glass set',
          ],
          noneOf: ['ceramic mug', 'stainless mug', 'insulated mug', 'travel mug', 'plastic mug'],
        };
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, pattern: safePattern } });
        console.log('GLASS_DRINKWARE_BEER_MUG_INTENT: REVERTED to safe narrow anyOf');
      }
    }

    // 2. REVERT GLASSWARE_DRINKING_INTENT: restore original inject ranks and chapterMatch boost
    {
      const e = allRules.find(r => r.id === 'GLASSWARE_DRINKING_INTENT');
      if (e) {
        const origInject = [
          { prefix: '7013.22', syntheticRank: 22 },
          { prefix: '7013.37', syntheticRank: 25 },
          { prefix: '7013.28', syntheticRank: 28 },
        ];
        const origBoosts = [{ delta: 0.75, chapterMatch: '70' }];
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: origInject, boosts: origBoosts } });
        console.log('GLASSWARE_DRINKING_INTENT: REVERTED to original inject ranks and chapterMatch boost');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT15b revert)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT15b complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
