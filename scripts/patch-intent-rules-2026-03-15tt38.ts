#!/usr/bin/env ts-node
/**
 * Patch TT38 — 2026-03-15: Fix base-metal jewelry noneOf regression + windbreaker + glass bowls + sewing patterns + glasses cases.
 * Current: ~33.21% (after TT37)
 *
 * Fixes:
 *  - BASE_METAL_IMITATION_JEWELRY_INTENT regression: noneOf included bare 'gold' which blocks
 *    valid PVD/gold-plated queries like "18K Gold PVD ring". Fix: remove 'gold'/'14k' from noneOf,
 *    use more specific exclusions.
 *
 * New Rules:
 *  1. WINDBREAKER_JACKET_OUTERWEAR_INTENT → 6201.40 (windbreakers, rain jackets, zip-up jackets)
 *     "kid polyester rain jacket" → 6201.40; "Mens Windbreaker Jacket" → 6201.40; 20 miss entries
 *  2. PYREX_GLASS_BOWL_KITCHEN_INTENT → 7013.49 (Pyrex bowls, glass mixing bowls, crystal bowls)
 *     "PYREX BOWLS" → 7013.49; "glass salt cellar" → 7013.49; 12 miss entries
 *  3. SEWING_PATTERN_FLAG_TEXTILE_MISC_INTENT → 6307.90 (sewing patterns, polyester flags, shoelaces)
 *     "Butterick 3255 sewing pattern" → 6307.90; "Printed Polyester Flag" → 6307.90; 8+ entries
 *  4. EYEGLASS_SUNGLASSES_CASE_POUCH_INTENT → 4202.92 (glasses cases, velvet jewelry pouches)
 *     "Cotton Fabric Sunglasses Case" → 4202.92; "Handmade Soft Padded Glasses Case" → 4202.92; 8+ entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt38.ts
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

    // FIX: BASE_METAL_IMITATION_JEWELRY_INTENT noneOf regression
    // noneOf: ['gold'] was blocking valid queries like "18K Gold PVD Sun Signet Ring" (expected 7117.19)
    // and '14k' was blocking "14K Gold Filled Ring #6" (expected 7117.19 ring blank/core)
    // Fix: remove bare 'gold' and '14k' tokens; use specific exclusions for solid/precious jewelry
    {
      const existing = allRules.find(r => r.id === 'BASE_METAL_IMITATION_JEWELRY_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing.pattern as any),
            noneOf: [
              // Only exclude clearly precious/fine jewelry — not PVD/plated items
              'solid gold', 'pure gold', 'karat solid', '10k solid', '14k solid', '18k solid',
              'sterling silver', 'fine jewelry', 'precious metal',
              // Exclude non-metal imitation jewelry (those go to 7117.90)
              'plastic', 'acrylic', 'resin', 'wood bead rosary', 'fabric jewelry',
            ],
          },
        } as IntentRule;
        patches.push({ priority: 565, rule: updated });
        console.log('BASE_METAL_IMITATION_JEWELRY_INTENT: fixed noneOf (removed bare "gold"/"14k" tokens)');
      }
    }

    // 1. WINDBREAKER_JACKET_OUTERWEAR_INTENT → 6201.40 (anoraks, windbreakers, rain jackets)
    //    "kid polyester rain jacket" → 6201.40.20.20
    //    "Mens Windbreaker Jacket" → 6201.40.20.20
    //    "used nylon windbreaker men" → 6201.40.20.20
    //    "Duke Blue Devils Windbreaker Light Jacket Size Small NCAA" → 6201.40.20.20
    //    "Forcefield Hi Vis Safety Puffer Jacket - Lime" → 6201.40.20.20
    //    "jacket 100% polyester used" → 6201.40.20.20
    //    "Mens Full Zip Polyester Jacket Bangladesh" → 6201.40.10.10
    //    6201.40 = anoraks, ski-jackets, windbreakers and similar articles of man-made fibres
    //    NOTE: HTS 6201 covers outerwear (anoraks, windbreakers, rain jackets, puffer jackets)
    //    NOTE: distinct from 4203.10 (leather jackets) and 6201.12 (cotton coats)
    {
      const existing = allRules.find(r => r.id === 'WINDBREAKER_JACKET_OUTERWEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WINDBREAKER_JACKET_OUTERWEAR_INTENT',
          description: 'Windbreakers, rain jackets, puffer jackets, zip-up outerwear → ch.62 (6201.40)',
          pattern: {
            anyOf: [
              'windbreaker', 'wind breaker', 'windbreaker jacket',
              'rain jacket', 'rain coat', 'raincoat',
              'anorak', 'ski jacket', 'snow jacket',
              'puffer jacket', 'puffer coat', 'puffy jacket',
              'hi vis jacket', 'high visibility jacket', 'reflective jacket', 'safety jacket',
              'water resistant jacket', 'waterproof jacket', 'water repellent jacket',
              'light jacket', 'lightweight jacket',
              'zip up jacket', 'full zip jacket', 'zip jacket',
              'polyester jacket', 'nylon jacket', 'fleece jacket',
              'track jacket', 'shell jacket', 'softshell jacket',
            ],
            noneOf: [
              'leather jacket', 'suede jacket', 'fur jacket', 'shearling jacket',
              'blazer', 'sport coat', 'suit jacket', 'dress jacket',
              'denim jacket', 'jean jacket',
              'hoodie', 'sweatshirt', 'cardigan',
            ],
          },
          inject: [{ prefix: '6201.40', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6201.4' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('WINDBREAKER_JACKET_OUTERWEAR_INTENT: created (windbreakers/rain jackets → 6201.40)');
      }
    }

    // 2. PYREX_GLASS_BOWL_KITCHEN_INTENT → 7013.49 (glass mixing bowls, Pyrex, crystal bowls, candy dishes)
    //    "PYREX BOWLS" → 7013.49.10.00
    //    "Friendship Cinderella Pyex Bowl. #443" → 7013.49.10.00
    //    "glass salt cellar" → 7013.49.20.10
    //    "Glass Oval Relish~Candy Tray" → 7013.49.20.10
    //    "Glass mixing bowl" → 7013.49.10.00
    //    "Crystal Bowls" → 7013.49.20.90
    //    "Vintage Pink Depression Glass Bowl" → 7013.49.20.10
    //    "Vtg Corning Ware 4 Quart Glass Open Baking Pan" → 7013.49.10.00
    //    7013.49 = other glassware for table/kitchen/toilet use (bowls, dishes, trays, etc.)
    //    NOTE: GLASS_DRINKING_MUG_TUMBLER_INTENT → 7013.37 handles drinking tumblers
    //    NOTE: GLASS_JAR_BOTTLE_DECANTER_INTENT → 7010.90 handles bottles/jars
    {
      const existing = allRules.find(r => r.id === 'PYREX_GLASS_BOWL_KITCHEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PYREX_GLASS_BOWL_KITCHEN_INTENT',
          description: 'Pyrex/glass bowls, mixing bowls, crystal bowls, glass candy dishes → ch.70 (7013.49)',
          pattern: {
            anyOf: [
              'pyrex bowl', 'pyrex bowls', 'pyrex glass bowl', 'pyrex dish', 'pyrex baking',
              'corning ware', 'corelle bowl', 'corning glass', 'glass baking pan', 'glass baking dish',
              'glass mixing bowl', 'glass bowl', 'glass bowls', 'mixing bowl glass',
              'crystal bowl', 'crystal dish', 'crystal serving bowl', 'crystal candy dish',
              'depression glass', 'depression glass bowl', 'depression glass dish',
              'glass candy dish', 'candy dish glass', 'glass relish tray', 'glass relish dish',
              'glass serving platter', 'glass pedestal bowl', 'glass serving bowl',
              'glass salt cellar', 'salt cellar glass', 'glass salt dish',
              'glass trinket dish', 'glass trinket bowl', 'glass jewelry dish',
              'vintage glass bowl', 'vintage crystal', 'vintage pyrex',
              'glass hen on nest', 'glass hen nest dish',
              'glass candle holder', 'glass votive holder', 'glass tulip candle',
              'glass knife rest', 'crystal knife rest',
            ],
            noneOf: [
              'glass mug', 'glass tumbler', 'drinking glass', 'beer glass', 'wine glass',
              'glass bottle', 'glass jar', 'glass decanter',
              'ceramic bowl', 'porcelain bowl', 'plastic bowl', 'stainless bowl', 'metal bowl',
            ],
          },
          inject: [{ prefix: '7013.49', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7013.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PYREX_GLASS_BOWL_KITCHEN_INTENT: created (Pyrex/glass bowls → 7013.49)');
      }
    }

    // 3. SEWING_PATTERN_FLAG_TEXTILE_MISC_INTENT → 6307.90 (sewing patterns, flags, shoelaces)
    //    "Sewing Pattern (Butterick 3255)" → 6307.90.30.30
    //    "McCall's Sewing Pattern number 826" → 6307.90.30.30
    //    "Sewing Pattern (Simplicity 5993)" → 6307.90.30.30
    //    "Printed Polyester Flag" → 6307.90.98.10
    //    "Personalized Pennant Flag" → 6307.90.98.10
    //    "Double-Sided Flag (Medicine Wheel)" → 6307.90.98.10
    //    "Avalon Green Dress Shoelace - Neon (Length: 27"/69cm)" → 6307.90.30.30
    //    6307.90 = other made up textile articles (sewing patterns, flags, labels, shoelaces, etc.)
    //    NOTE: Very diverse HTS code — targeting clear sub-types only
    {
      const existing = allRules.find(r => r.id === 'SEWING_PATTERN_FLAG_TEXTILE_MISC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SEWING_PATTERN_FLAG_TEXTILE_MISC_INTENT',
          description: 'Sewing patterns, polyester flags, pennants, dress shoelaces → ch.63 (6307.90)',
          pattern: {
            anyOf: [
              'sewing pattern', 'dress pattern', 'knitting pattern', 'crochet pattern',
              'butterick pattern', 'mccall pattern', "mccall's", 'simplicity pattern', 'vogue pattern',
              'sewing pattern #', 'pattern number',
              'polyester flag', 'pennant flag', 'pennant banner', 'fabric flag',
              'personalized flag', 'custom flag', 'printed flag', 'woven flag',
              'double sided flag', 'single sided flag',
              'dress shoelace', 'dress laces', 'shoelace pair',
              'woven lanyard', 'custom lanyard',
              'embroidered tag', 'woven patch', 'embroidered patch',
            ],
            noneOf: [
              'metal flag', 'vinyl flag', 'paper flag',
              'rubber shoelace', 'silicone shoelace',
            ],
          },
          inject: [{ prefix: '6307.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6307.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SEWING_PATTERN_FLAG_TEXTILE_MISC_INTENT: created (sewing patterns/flags/shoelaces → 6307.90)');
      }
    }

    // 4. EYEGLASS_SUNGLASSES_CASE_POUCH_INTENT → 4202.92 (glasses cases, velvet pouches, padded cases)
    //    "Cotton Fabric Sunglasses Case" → 4202.92.08.05
    //    "faux leather eyeglass case, soft-sided, non-rigid, for optical glasses" → 4202.92.08.05
    //    "Handmade Soft Padded Glasses Case | Korean Style Eyeglass Pouch" → 4202.92.08.05
    //    "Personalized Birth Flower Velvet Jewelry Box: Navy Travel Case" → 4202.92.39.00
    //    "Personalized Velvet Travel Jewelry Box" → 4202.92.39.00
    //    "Velvet pouch for rings - White" → 4202.92.39.00
    //    "passport cover" → 4202.92.45.00
    //    4202.92 = trunks, suitcases, vanity cases, spectacle cases, camera cases, and similar containers
    //    of other materials (plastic, textile, leather)
    {
      const existing = allRules.find(r => r.id === 'EYEGLASS_SUNGLASSES_CASE_POUCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'EYEGLASS_SUNGLASSES_CASE_POUCH_INTENT',
          description: 'Glasses cases, eyeglass pouches, velvet jewelry pouches, passport covers → ch.42 (4202.92)',
          pattern: {
            anyOf: [
              'eyeglass case', 'eyeglasses case', 'glasses case', 'spectacle case',
              'sunglasses case', 'sunglasses pouch', 'sunglass case',
              'optical glasses case', 'soft eyeglass case', 'padded glasses case',
              'eyeglass pouch', 'glasses pouch', 'eyeglass holder', 'glasses sleeve',
              'velvet jewelry pouch', 'velvet ring pouch', 'velvet pouch jewelry',
              'velvet jewelry box travel', 'travel jewelry box', 'jewelry travel case',
              'passport cover', 'passport holder', 'passport wallet',
              'velvet pouch rings', 'velvet pouch earrings', 'velvet gift pouch',
              'kindle sleeve', 'tablet sleeve padded', 'ipad sleeve padded',
              'camera carrying case', 'camera case padded',
            ],
            noneOf: [
              'phone case', 'laptop case', 'briefcase', 'backpack', 'tote bag',
              'sunglasses only', 'glasses only',
            ],
          },
          inject: [{ prefix: '4202.92', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4202.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('EYEGLASS_SUNGLASSES_CASE_POUCH_INTENT: created (glasses cases/velvet pouches → 4202.92)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT38)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT38 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
