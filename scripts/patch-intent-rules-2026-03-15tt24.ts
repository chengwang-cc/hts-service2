#!/usr/bin/env ts-node
/**
 * Patch TT24 — 2026-03-15: Pillow covers + toys + stainless steel + elastic hair ties + inline skates.
 * Current: ~31.98% (after TT22; TT23 pending eval)
 *
 * Targets:
 *  1. Fix: SCRUNCHIE_TEXTILE_HEADBAND_INTENT — add noneOf for 'elastic hair tie' (conflict with 6217.10)
 *  2. ELASTIC_HAIR_TIE_WOVEN_INTENT → 6217.10 (elastic hair ties, bulk hair tie packs)
 *     "100 elastic hair tie" → 6217.10.00.00; "100% elastic hair tie" → 6217.10.00.00; 13 entries
 *  3. COTTON_PILLOW_COVER_BED_INTENT → 6302.21 (cotton pillow covers, pillowcases, throw covers)
 *     "cotton decorative throw pillow cover" → 6302.21.00.40; 14 entries
 *  4. PLUSH_STUFFED_TOY_INTENT → 9503.00 (stuffed toys, plush animals, crochet/knit toys, plastic toys)
 *     "100% polyester crochet toy" → 9503.00.00.90; "toy plastic small tiger" → 9503.00.00.30; 14 entries
 *  5. STAINLESS_STEEL_KITCHEN_INTENT → 7323.93 (stainless steel water bottles, containers, kitchen articles)
 *     "100% Stainless Steel Water Bottle" → 7323.93.00.30; 14 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt24.ts
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

    const addNoneOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. Fix SCRUNCHIE_TEXTILE_HEADBAND_INTENT: add noneOf for elastic hair ties
    //    "100 elastic hair tie" → expected 6217.10.00.00, NOT 6117.80
    //    Elastic/rubber hair ties (bulk packs) = woven accessories → 6217.10
    //    Fabric/satin/cloth scrunchies/hair ties = knit accessories → 6117.80
    {
      const e = allRules.find(r => r.id === 'SCRUNCHIE_TEXTILE_HEADBAND_INTENT');
      if (e) {
        const newPat = addNoneOf(e,
          'elastic hair tie', '100 elastic hair tie', 'bulk hair tie',
          'rubber band hair', 'elastic ponytail', 'elastic ponytail holder',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: newPat } });
        console.log('SCRUNCHIE_TEXTILE_HEADBAND_INTENT: added noneOf for elastic hair ties');
      }
    }

    // 2. ELASTIC_HAIR_TIE_WOVEN_INTENT → 6217.10 (elastic hair ties, bulk packs, ponytail holders)
    //    "100 elastic hair tie" → 6217.10.00.00; "100% elastic hair tie" → 6217.10.00.00
    //    6217.10 = other made-up woven clothing accessories (elastic bands, woven ties)
    //    NOTE: SCRUNCHIE_TEXTILE_HEADBAND_INTENT handles fabric hair ties → 6117.80 (knit)
    {
      const existing = allRules.find(r => r.id === 'ELASTIC_HAIR_TIE_WOVEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ELASTIC_HAIR_TIE_WOVEN_INTENT',
          description: 'Elastic hair ties, bulk hair tie packs, ponytail holders → ch.62 (6217.10)',
          pattern: {
            anyOf: [
              'elastic hair tie', 'elastic hair ties', '100 elastic hair tie', '100% elastic hair tie',
              'bulk hair tie', 'hair tie pack', 'hair tie set', 'hair tie bundle',
              'elastic ponytail holder', 'elastic ponytail', 'rubber hair tie', 'rubber hair band',
              'hair elastic', 'hair elastics', 'wrist hair tie', 'no crease hair tie',
              'pack hair ties', 'set hair ties', 'coil hair tie', 'spiral hair tie',
            ],
            noneOf: ['scrunchie', 'satin hair tie', 'fabric hair tie', 'cloth hair tie',
                     'velvet hair tie', 'silk hair tie', 'crochet hair tie'],
          },
          inject: [{ prefix: '6217.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6217.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('ELASTIC_HAIR_TIE_WOVEN_INTENT: created (elastic hair ties → 6217.10)');
      }
    }

    // 3. COTTON_PILLOW_COVER_BED_INTENT → 6302.21 (cotton pillow covers, pillowcases, bed linen)
    //    "cotton decorative throw pillow cover, woven fabric" → 6302.21.00.40
    //    "DECORATIVE RED COTTON THROW PILLOW COVER" → 6302.21.00.40
    //    6302 = bed linen, table linen; 6302.21 = cotton bed linen (printed/plain pillowcases)
    {
      const existing = allRules.find(r => r.id === 'COTTON_PILLOW_COVER_BED_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_PILLOW_COVER_BED_INTENT',
          description: 'Cotton pillow covers, pillowcases, throw pillow covers, bed linen → ch.63 (6302.21)',
          pattern: {
            anyOf: [
              'pillow cover', 'pillow covers', 'throw pillow cover', 'throw pillow covers',
              'decorative pillow cover', 'pillowcase', 'pillowcases', 'pillow case',
              'cushion cover', 'cushion covers', 'pillow sham', 'bed pillow cover',
              'cotton pillow cover', 'cotton pillowcase', 'cotton cushion cover',
              'linen pillow cover', 'linen pillowcase',
            ],
            noneOf: ['pillow insert', 'pillow stuffing', 'pillow form', 'feather pillow', 'foam pillow'],
          },
          inject: [{ prefix: '6302.21', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6302.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_PILLOW_COVER_BED_INTENT: created (cotton pillow covers → 6302.21)');
      }
    }

    // 4. PLUSH_STUFFED_TOY_INTENT → 9503.00 (stuffed animals, plush toys, crochet/knit toys)
    //    "100% polyester crochet toy" → 9503.00.00.90; "toy plastic small tiger" → 9503.00.00.30
    //    Also covers amigurumi, stuffed dolls, soft toys, knit toys
    //    9503.00 = tricycles, scooters, dolls, toy animals, toy miniatures, etc.
    {
      const existing = allRules.find(r => r.id === 'PLUSH_STUFFED_TOY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLUSH_STUFFED_TOY_INTENT',
          description: 'Stuffed toys, plush animals, crochet/knit toys, plastic toy figures → ch.95 (9503.00)',
          pattern: {
            anyOf: [
              'stuffed animal', 'stuffed toy', 'stuffed bear', 'stuffed rabbit', 'stuffed dog',
              'plush toy', 'plush animal', 'plush bear', 'plush rabbit', 'plush cat', 'plush dog',
              'plush figure', 'plush doll', 'soft toy',
              'crochet toy', 'crochet animal', 'knit toy', 'knit animal', 'knitted toy',
              'amigurumi', 'amigurumi toy', 'amigurumi doll', 'amigurumi animal',
              'toy tiger', 'toy bear', 'toy rabbit', 'toy cat', 'toy dog',
              'plastic toy', 'plastic toy figure', 'toy figure', 'toy animal',
              'miniature toy', 'toy dinosaur', 'toy elephant',
            ],
            noneOf: ['board game', 'card game', 'puzzle', 'lego', 'action figure collector',
                     'dog toy', 'cat toy', 'pet toy'],
          },
          inject: [{ prefix: '9503.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9503' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PLUSH_STUFFED_TOY_INTENT: created (stuffed/plush/crochet toys → 9503.00)');
      }
    }

    // 5. STAINLESS_STEEL_KITCHEN_INTENT → 7323.93 (stainless steel kitchen/household articles)
    //    "100% Stainless Steel Water Bottle" → 7323.93.00.30
    //    "50% Stainless Steel 50% Plastic Storage Container" → 7323.93.00.80
    //    7323.93 = kitchen or household articles of stainless steel (pots, trays, water bottles, storage)
    //    NOTE: hasWaterBottleIntent already filters ch.73 results; this reinforces the correct sub-heading
    {
      const existing = allRules.find(r => r.id === 'STAINLESS_STEEL_KITCHEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STAINLESS_STEEL_KITCHEN_INTENT',
          description: 'Stainless steel water bottles, containers, kitchen articles → ch.73 (7323.93)',
          pattern: {
            anyOf: [
              'stainless steel water bottle', 'stainless water bottle', 'steel water bottle',
              'stainless steel bottle', 'stainless steel thermos', 'stainless steel flask',
              'stainless steel tumbler', 'stainless steel cup', 'stainless steel mug',
              'stainless steel bowl', 'stainless steel container', 'stainless steel storage',
              'stainless steel pot', 'stainless steel pan', 'stainless steel tray',
              'stainless steel plate', 'stainless steel colander', 'stainless steel strainer',
              'vacuum insulated bottle', 'hydro flask', 'insulated water bottle',
              'reusable water bottle stainless', 'metal water bottle',
            ],
            noneOf: ['plastic bottle', 'glass bottle', 'ceramic mug', 'enamel mug'],
          },
          inject: [{ prefix: '7323.93', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7323.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('STAINLESS_STEEL_KITCHEN_INTENT: created (stainless steel water bottles → 7323.93)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT24)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT24 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
