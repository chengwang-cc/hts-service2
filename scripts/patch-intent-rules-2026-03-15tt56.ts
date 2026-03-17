#!/usr/bin/env ts-node
/**
 * Patch TT56 — 2026-03-15: Fix remaining ch.48 gaps after TT54 analysis.
 *
 * Fixes:
 *  1. UPDATE MASKING_WASHI_TAPE_PAPER_INTENT: add 4811.90 to inject
 *     "Decorative Washi Tapes" → expected 4811.90.80.20 — our rule only injected 4811.41/4811.49
 *     4811.90 = paper/board coated with surface treatment (washi tape may be this)
 *  2. UPDATE PAPER_CUP_DISPOSABLE_INTENT: add "drink coasters" and paper drink-related terms
 *     "trivia drink coasters" → 2202 (beverages!) — "drink" triggers beverage, rule didn't match
 *     "paper drink coaster" should match but "trivia drink coasters" doesn't have "paper" or "cardboard"
 *  3. NEW PAPER_NAPKIN_TISSUE_INTENT → 4818.30 (paper napkins, table napkins)
 *     "Luncheon Paper Napkins" → expected 4818.30 (tissue paper napkins)
 *     "Axlings Sweden Koksruta Paper Napkins" → 4818.30
 *     Currently going to... let me check
 *  4. NEW RECORD_SLEEVE_PAPER_INTENT → 4819.50 (paper bags/pouches)
 *     "record picture sleeve" → 4202 (luggage!) WRONG
 *     "Record Album Sleeve" → 8523 (recording media!) WRONG
 *     4819.50 = paper bags, cartons and sacks — record sleeves are paper pouches
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt56.ts
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

    // 1. UPDATE MASKING_WASHI_TAPE_PAPER_INTENT — add 4811.90 injection
    //    "Decorative Washi Tapes" → expected 4811.90.80.20 not 4811.41
    //    4811.90 = paper and paperboard, otherwise coated/impregnated (includes washi tape)
    {
      const existing = allRules.find(r => r.id === 'MASKING_WASHI_TAPE_PAPER_INTENT');
      if (existing) {
        const currentInject = (existing as any).inject || [];
        const has4811_90 = currentInject.some((i: any) => i.prefix === '4811.90');
        if (!has4811_90) {
          const updated = {
            ...existing,
            inject: [
              ...currentInject,
              { prefix: '4811.90', syntheticRank: 5 },
            ],
          } as IntentRule;
          patches.push({ priority: 570, rule: updated });
          console.log('MASKING_WASHI_TAPE_PAPER_INTENT: added 4811.90 to inject (washi tape)');
        } else {
          console.log('MASKING_WASHI_TAPE_PAPER_INTENT: already has 4811.90');
        }
      } else {
        console.log('MASKING_WASHI_TAPE_PAPER_INTENT: not found (apply TT54 first)');
      }
    }

    // 2. UPDATE PAPER_CUP_DISPOSABLE_INTENT — add "drink coasters" and "trivia coasters"
    //    "trivia drink coasters" → 2202.99 (beverages!) — "drink" triggers beverage
    //    The rule's whitelist denyChapters: ['69', '22', '20'] should block this,
    //    but only if the pattern matches first. Need to add matching phrases.
    {
      const existing = allRules.find(r => r.id === 'PAPER_CUP_DISPOSABLE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const hasDrinkCoasters = currentAnyOf.includes('drink coasters');
        if (!hasDrinkCoasters) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing as any).pattern,
              anyOf: [
                ...currentAnyOf,
                // Drink coasters (paper/board coasters)
                'drink coasters', 'drink coaster', 'trivia coasters', 'trivia coaster',
                'party coasters', 'paper drink coasters',
                // Air fryer parchment/trays
                'parchment paper tray', 'baking paper tray', 'paper baking liner',
                // Paper plates for parties
                'party paper plates', 'party paper cups',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 572, rule: updated });
          console.log('PAPER_CUP_DISPOSABLE_INTENT: added drink coasters + parchment terms');
        } else {
          console.log('PAPER_CUP_DISPOSABLE_INTENT: already has drink coasters');
        }
      } else {
        console.log('PAPER_CUP_DISPOSABLE_INTENT: not found (apply TT54 first)');
      }
    }

    // 3. PAPER_NAPKIN_TISSUE_DISPOSABLE_INTENT → 4818.30 (paper napkins for table use)
    //    "Luncheon Paper Napkins" → expected 4818.30.00.00
    //    "Axlings Sweden Koksruta Paper Napkins" → 4818.30
    //    "Paper napkins" vs textile napkins (6302.51) - paper version is 4818.30
    //    4818.30 = paper napkins (toilet/facial tissue, hand towels, napkins)
    {
      const existing = allRules.find(r => r.id === 'PAPER_NAPKIN_TISSUE_DISPOSABLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_NAPKIN_TISSUE_DISPOSABLE_INTENT',
          description: 'Disposable paper napkins, paper towels, facial tissue → ch.48 (4818.30)',
          pattern: {
            anyOf: [
              // Paper napkins
              'paper napkin', 'paper napkins', 'luncheon paper napkin', 'cocktail napkin',
              'dinner paper napkin', 'beverage napkin', 'luncheon napkin paper',
              // Paper towels
              'paper towel', 'paper towels', 'kitchen paper towel', 'paper hand towel',
              // Facial/tissue paper
              'facial tissue', 'facial tissues', 'tissue paper box',
              // Specific brand style
              'printed paper napkin', 'decorative paper napkin', 'holiday paper napkin',
            ],
            noneOf: [
              // Exclude cloth/textile napkins (ch.63)
              'cloth napkin', 'cotton napkin', 'fabric napkin', 'linen napkin',
              // Exclude wrapping tissue paper
              'wrapping tissue', 'gift tissue',
            ],
          },
          inject: [
            { prefix: '4818.30', syntheticRank: 5 },
            { prefix: '4818.90', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['63'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '4818.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PAPER_NAPKIN_TISSUE_DISPOSABLE_INTENT: created (paper napkins → 4818.30)');
      }
    }

    // 4. RECORD_SLEEVE_PAPER_INTENT → 4819.50 (paper bags/pouches/envelopes)
    //    "record picture sleeve" → 4202.11 (travel bags!) WRONG
    //    "Record Album Sleeve" → 8523.80 (recording media!) WRONG
    //    4819.50 = paper bags, cartons and sacks (paper record sleeves = paper bags)
    //    Note: "album sleeve" = paper/cardboard sleeve that holds vinyl record
    {
      const existing = allRules.find(r => r.id === 'RECORD_SLEEVE_PAPER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RECORD_SLEEVE_PAPER_INTENT',
          description: 'Paper record/album sleeves (LP, 45rpm, cassette sleeves) → ch.48 (4819.50)',
          pattern: {
            anyOf: [
              // Record sleeves (paper/cardboard)
              'record sleeve', 'record sleeves', 'record picture sleeve',
              'album sleeve', 'vinyl sleeve', 'lp sleeve', 'lp sleeves',
              '45 sleeve', '45rpm sleeve', '12 inch sleeve',
              'record cover sleeve', 'outer sleeve record', 'paper record sleeve',
              // Cassette/media sleeves
              'cassette sleeve', 'cassette sleeves', 'cd sleeve', 'cd sleeves',
              'paper cd sleeve', 'paper sleeve',
            ],
            noneOf: [
              'vinyl record', 'vinyl lp', 'cassette tape', 'cd music',
            ],
          },
          inject: [
            { prefix: '4819.50', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['42', '85'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '4819.5' }],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('RECORD_SLEEVE_PAPER_INTENT: created (record/album sleeves → 4819.50)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT56)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT56 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
