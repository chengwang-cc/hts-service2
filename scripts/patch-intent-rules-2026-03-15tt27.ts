#!/usr/bin/env ts-node
/**
 * Patch TT27 — 2026-03-15: Plastic tableware + wool sweaters + wool scarves + hair clips + paint rollers.
 * Current: ~32.18% (after TT25; TT26 pending eval)
 *
 * Targets:
 *  1. PLASTIC_KITCHEN_TABLEWARE_INTENT → 3924.10 (plastic tableware, dispensers, shakers)
 *     "Plastic bottle dispenser, set of 3" → 3924.10; "Plastic cheese shaker" → 3924.10; 12 entries
 *  2. WOOL_KNIT_SWEATER_INTENT → 6110.11 (wool/cashmere/merino sweaters, pullovers)
 *     "Vintage COOGI Sweater Mens Multicolor Knit" → 6110.11; "Wool men's sweater beige" → 6110.11; 11 entries
 *  3. WOOL_SCARF_SHAWL_INTENT → 6117.10 (wool knit scarves, shawls, mufflers)
 *     "knitted scarf of wool for women" → 6117.10; "Red Merino Cashmere Skinny Scarf" → 6117.10; 10 entries
 *  4. HAIR_CLIP_SLIDE_BARRETTE_INTENT → 9615.11 (hair clips, barrettes, hair slides)
 *     "2 pack hair clips" → 9615.11; "Gold Color Hair Clip" → 9615.11; 11 entries
 *  5. PAINT_ROLLER_BRUSH_INTENT → 9603.40 (paint rollers, microfiber rollers, roller refills)
 *     "Microfiber Roller Refills (pack of 2)" → 9603.40; "Staalmeester Microfelt Roller" → 9603.40; 11 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt27.ts
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

    // 1. PLASTIC_KITCHEN_TABLEWARE_INTENT → 3924.10 (plastic tableware, dispensers, kitchen articles)
    //    "Plastic bottle dispenser, set of 3" → 3924.10.xx
    //    "Plastic cheese shaker" → 3924.10.xx
    //    3924.10 = tableware and kitchenware of plastics
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_KITCHEN_TABLEWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_KITCHEN_TABLEWARE_INTENT',
          description: 'Plastic tableware, dispensers, shakers, kitchen articles → ch.39 (3924.10)',
          pattern: {
            anyOf: [
              'plastic dispenser', 'plastic bottle dispenser', 'condiment dispenser',
              'plastic shaker', 'cheese shaker', 'spice shaker', 'salt shaker plastic',
              'plastic cup', 'plastic plate', 'plastic bowl', 'plastic mug',
              'plastic kitchen set', 'plastic tableware set', 'plastic serving set',
              'plastic pitcher', 'plastic jug', 'plastic tumbler',
              'plastic food container', 'plastic storage container kitchen',
              'plastic colander', 'plastic strainer', 'plastic funnel',
              'squeeze bottle', 'sauce dispenser', 'condiment bottle',
            ],
            noneOf: ['stainless', 'ceramic', 'glass', 'silicone', 'bamboo', 'wood'],
          },
          inject: [{ prefix: '3924.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '3924.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PLASTIC_KITCHEN_TABLEWARE_INTENT: created (plastic tableware/dispensers → 3924.10)');
      }
    }

    // 2. WOOL_KNIT_SWEATER_INTENT → 6110.11 (wool/cashmere/merino knit sweaters, pullovers)
    //    "Vintage COOGI Sweater Mens Medium Multicolor Knit" → 6110.11.00.30
    //    "Wool men's sweater beige" → 6110.11.00.30
    //    6110.11 = sweaters, pullovers, sweatshirts of wool or fine animal hair (knit)
    //    NOTE: COTTON_HOODIE_SWEATSHIRT_INTENT → 6110.20 handles cotton; this is wool/cashmere
    {
      const existing = allRules.find(r => r.id === 'WOOL_KNIT_SWEATER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOL_KNIT_SWEATER_INTENT',
          description: 'Wool/cashmere/merino knit sweaters, pullovers → ch.61 (6110.11)',
          pattern: {
            anyOf: [
              'wool sweater', 'wool pullover', 'wool knit sweater', 'woolen sweater',
              'wool crewneck', 'wool turtleneck', 'wool cardigan',
              'merino sweater', 'merino wool sweater', 'merino pullover', 'merino knit',
              'cashmere sweater', 'cashmere pullover', 'cashmere knit', 'cashmere cardigan',
              'lambswool sweater', 'shetland sweater', 'fair isle sweater',
              'coogi sweater', 'vintage wool sweater', 'vintage knit sweater',
              'angora sweater', 'mohair sweater', 'alpaca sweater', 'alpaca pullover',
              'knitwear wool', 'hand knit sweater', 'hand-knit sweater',
            ],
            noneOf: ['cotton sweater', 'polyester sweater', 'acrylic sweater', 'nylon sweater',
                     'synthetic sweater', 'fleece', 'fleece pullover'],
          },
          inject: [{ prefix: '6110.11', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6110.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOOL_KNIT_SWEATER_INTENT: created (wool/cashmere sweaters → 6110.11)');
      }
    }

    // 3. WOOL_SCARF_SHAWL_INTENT → 6117.10 (wool knit scarves, shawls, mufflers, wraps)
    //    "knitted scarf of wool for women" → 6117.10.00.10
    //    "Red Merino Cashmere Skinny Scarf: Minimalist Knit Neckwear" → 6117.10.00.10
    //    6117.10 = shawls, scarves, mufflers, mantillas, veils of knit textile
    {
      const existing = allRules.find(r => r.id === 'WOOL_SCARF_SHAWL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOL_SCARF_SHAWL_INTENT',
          description: 'Wool/cashmere knit scarves, shawls, mufflers, wraps → ch.61 (6117.10)',
          pattern: {
            anyOf: [
              'wool scarf', 'wool scarves', 'knit scarf', 'knitted scarf', 'woven scarf',
              'merino scarf', 'merino wool scarf', 'cashmere scarf', 'cashmere wrap',
              'wool shawl', 'knit shawl', 'wool wrap', 'knit wrap',
              'wool muffler', 'neck muffler', 'neck warmer wool', 'cowl neck wool',
              'alpaca scarf', 'alpaca shawl', 'lambswool scarf',
              'mohair scarf', 'angora scarf', 'pashmina scarf',
              'scarf wool', 'muffler wool',
            ],
            noneOf: ['cotton scarf', 'polyester scarf', 'silk scarf', 'chiffon scarf',
                     'synthetic scarf', 'nylon scarf'],
          },
          inject: [{ prefix: '6117.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6117.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOOL_SCARF_SHAWL_INTENT: created (wool knit scarves/shawls → 6117.10)');
      }
    }

    // 4. HAIR_CLIP_SLIDE_BARRETTE_INTENT → 9615.11 (hard rubber/plastic hair clips, barrettes, slides)
    //    "2 pack hair clips" → 9615.11.00.10
    //    "Gold Color Hair Clip" → 9615.11.00.10
    //    9615.11 = combs, hair slides and the like — of hard rubber or plastics
    {
      const existing = allRules.find(r => r.id === 'HAIR_CLIP_SLIDE_BARRETTE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HAIR_CLIP_SLIDE_BARRETTE_INTENT',
          description: 'Hair clips, barrettes, hair slides, claw clips → ch.96 (9615.11)',
          pattern: {
            anyOf: [
              'hair clip', 'hair clips', 'barrette', 'barrettes', 'hair barrette',
              'hair slide', 'hair slides', 'hair clamp', 'hair claw', 'claw clip',
              'claw hair clip', 'hair clasp', 'snap clip', 'alligator clip hair',
              'crocodile clip hair', 'french barrette', 'metal hair clip', 'gold hair clip',
              'silver hair clip', 'rhinestone clip', 'crystal hair clip',
              'duck bill clip', 'beak clip', 'sectioning clip',
            ],
            noneOf: ['hair tie', 'scrunchie', 'hair band', 'hair bow', 'hair pin', 'bobby pin',
                     'butterfly clip' ],
          },
          inject: [{ prefix: '9615.11', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9615.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('HAIR_CLIP_SLIDE_BARRETTE_INTENT: created (hair clips/barrettes → 9615.11)');
      }
    }

    // 5. PAINT_ROLLER_BRUSH_INTENT → 9603.40 (paint rollers, microfiber rollers, roller refills)
    //    "Microfiber Roller Refills (pack of 2)" → 9603.40.xx
    //    "Staalmeester Microfelt Roller - 10cm 10-Pack MR02" → 9603.40.xx
    //    9603.40 = paint, distemper, varnish or similar brushes; paint pads and rollers
    {
      const existing = allRules.find(r => r.id === 'PAINT_ROLLER_BRUSH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAINT_ROLLER_BRUSH_INTENT',
          description: 'Paint rollers, microfiber rollers, roller refills, paint pads → ch.96 (9603.40)',
          pattern: {
            anyOf: [
              'paint roller', 'roller refill', 'microfiber roller', 'paint roller refill',
              'roller cover', 'roller nap', 'foam roller paint', 'paint pad',
              'mohair roller', 'velvet roller', 'paint roller cover',
              'paint brush', 'paint brushes', 'artists brush', 'wall brush paint',
              'roller sleeve', 'mini roller', 'trim roller',
              'staalmeester roller', 'staalmeester brush',
            ],
            noneOf: ['foam roller massage', 'foam roller stretching', 'foam roller exercise',
                     'hair roller', 'curling roller', 'lint roller', 'printer roller'],
          },
          inject: [{ prefix: '9603.40', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9603.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PAINT_ROLLER_BRUSH_INTENT: created (paint rollers/brushes → 9603.40)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT27)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT27 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
