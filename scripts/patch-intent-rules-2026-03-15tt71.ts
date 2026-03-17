#!/usr/bin/env ts-node
/**
 * Patch TT71 — 2026-03-15: Fix license plate frames, polymer clay, diamond painting wax.
 *
 * Fixes:
 *  1. NEW LICENSE_PLATE_FRAME_PLASTIC_INTENT → 3920.63 (plastic plates/sheets for license plates)
 *     "License plate frame" → 6912 (ceramic!) WRONG (expected 3920.63 plastic)
 *     "License plate frames" → 6912 WRONG
 *     BUG: "frame" triggers ceramic/glassware; "license plate" not in any plastic rule
 *     3920.63 = plates/sheets/strips of polycarbonate (used for license plate frames)
 *     FIX: New intent targeting license plate frames/holders → 3920.63, deny ch.69
 *
 *  2. NEW POLYMER_CLAY_CRAFT_INTENT → 3407.00 (modeling clay, dough products of plastics)
 *     "Polymer Clay Decorative Fridge Magnets" → 8505 (magnets!) WRONG (expected 3407.00.20)
 *     "Cat Figurine" → 6912 (ceramic) WRONG (expected 3407.00.20 plastic)
 *     "Capybara clay jewelry dish" → 6912 WRONG (expected 3407.00.40)
 *     BUG: "clay" triggers ceramic chapter (ch.69); polymer clay is ch.34 (plastics)
 *     3407.00.20 = of plastics (oven-bake/air-dry polymer clay: Fimo, Sculpey, etc.)
 *     3407.00.40 = of other materials (blended clays, mineral+polymer)
 *     FIX: New intent for polymer clay items, deny ch.69 ceramics
 *
 *  3. NEW DIAMOND_PAINTING_WAX_INTENT → 3404.90.51 (craft wax for diamond art)
 *     "Diamond Painting Wax" → 8207/9602 WRONG (expected 3404.90.51)
 *     "mixed wax shapes adhesive wax diamond painting" → 3506 (adhesive!) WRONG
 *     BUG: "diamond painting wax" contains "diamond" triggering gems, "wax" alone → 2712 (petroleum)
 *     3404.90.51 = other wax preparations (includes scented craft wax for diamond art)
 *     FIX: New intent for diamond painting wax tools → 3404.90, deny ch.27/95/96
 *
 *  4. NEW HOCKEY_SPORT_WAX_INTENT → 3404.20 (artificial waxes for sports)
 *     "Hockey wax" → 2712.90 (petroleum wax) WRONG (expected 3404.20)
 *     BUG: "wax" alone triggers petroleum chapter (2712)
 *     3404.20 = artificial waxes of silicone (includes wax for hockey sticks, ski poles)
 *     FIX: New intent for sport/equipment wax → 3404.20, deny ch.27
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt71.ts
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

    // 1. NEW LICENSE_PLATE_FRAME_PLASTIC_INTENT → 3920.63 (polycarbonate plastic)
    {
      const existing = allRules.find(r => r.id === 'LICENSE_PLATE_FRAME_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LICENSE_PLATE_FRAME_PLASTIC_INTENT',
          description: 'License/licence plate frames, holders → ch.39 (3920.63 plastic plates/sheets)',
          pattern: {
            anyOf: [
              'license plate frame', 'license plate frames', 'license plate holder',
              'license plate cover', 'license plate surround', 'license plate bracket',
              'licence plate frame', 'licence plate frames', 'licence plate holder',
              'number plate frame', 'number plate holder', 'number plate cover',
              'car plate frame', 'vehicle plate frame', 'auto license plate frame',
            ],
            noneOf: [
              'aluminum', 'aluminium', 'metal', 'stainless', // metal plate frames might be different chapter
              'illuminated', 'led', 'light up', // electric frame = different chapter
            ],
          },
          inject: [
            { prefix: '3920.63', syntheticRank: 1 }, // polycarbonate plates/sheets
            { prefix: '3920.10', syntheticRank: 2 }, // plastic plates/sheets of polymers
            { prefix: '3920.99', syntheticRank: 3 }, // other plastic plates/sheets
          ],
          whitelist: {
            allowChapters: ['39', '73', '83', '94'], // plastic, metal, hardware, furniture parts
          },
          boosts: [
            { delta: 0.70, prefixMatch: '3920.6' },
          ],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('LICENSE_PLATE_FRAME_PLASTIC_INTENT: created (license plate frames → 3920.63, allow ch.39/73/83)');
      }
    }

    // 2. NEW POLYMER_CLAY_CRAFT_INTENT → 3407.00 (modeling clay/dough of plastics)
    //    "Polymer Clay Fridge Magnets" → 8505 WRONG; clay figurines → 6912 WRONG
    //    Polymer clay (Fimo, Sculpey, air-dry clay) = 3407 (dough/paste/modelling material of plastics)
    {
      const existing = allRules.find(r => r.id === 'POLYMER_CLAY_CRAFT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'POLYMER_CLAY_CRAFT_INTENT',
          description: 'Polymer clay figurines, clay sculptures, clay dishes → ch.34 (3407.00)',
          pattern: {
            anyOf: [
              // Explicit polymer clay terms
              'polymer clay', 'fimo clay', 'sculpey clay', 'air dry clay', 'oven bake clay',
              'polymer clay charm', 'polymer clay figurine', 'polymer clay jewelry',
              'polymer clay earring', 'polymer clay bead', 'polymer clay magnet',
              'polymer clay ring', 'polymer clay pendant',
              // Clay figurines / sculptures
              'clay figurine', 'clay sculpture', 'clay figure', 'clay statue',
              'handmade clay figurine', 'sculpted clay', 'clay sculpted',
              // Clay dishes / bowls (jewelry dishes, trinket dishes)
              'clay jewelry dish', 'clay trinket dish', 'clay ring dish',
              'clay catch all dish', 'clay spoon rest', 'clay dish handmade',
              // Clay magnets
              'clay fridge magnet', 'clay magnet', 'handmade clay magnet',
            ],
            noneOf: [
              // Exclude actual fired ceramics
              'ceramic', 'porcelain', 'earthenware', 'stoneware', 'terracotta',
              'kiln fired', 'kiln-fired', 'glazed', 'fired', 'bisque',
              // Exclude cosmetic clay masks
              'clay mask', 'mud mask', 'face clay', 'clay face mask',
              // Exclude bentonite/mineral clays (ch.25)
              'bentonite', 'kaolin', 'healing clay', 'french green clay',
            ],
          },
          inject: [
            { prefix: '3407.00.20', syntheticRank: 1 }, // modeling clay of plastics
            { prefix: '3407.00.40', syntheticRank: 2 }, // modeling clay of other materials
          ],
          whitelist: {
            allowChapters: ['34', '39', '71', '96', '85'], // clay, plastic, jewelry, misc, magnets
          },
          boosts: [
            { delta: 0.80, prefixMatch: '3407.' },
          ],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('POLYMER_CLAY_CRAFT_INTENT: created (polymer clay items → 3407.00, deny ceramics)');
      }
    }

    // 3. NEW DIAMOND_PAINTING_WAX_INTENT → 3404.90.51 (craft wax preparations)
    //    "Diamond Painting Wax" → 8207 WRONG; "mixed wax shapes diamond painting" → 3506 WRONG
    //    Diamond painting wax = sticky wax used to pick up resin "diamond" pieces → 3404.90 (wax prep)
    {
      const existing = allRules.find(r => r.id === 'DIAMOND_PAINTING_WAX_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DIAMOND_PAINTING_WAX_INTENT',
          description: 'Diamond painting wax, drill wax, craft adhesive wax → ch.34 (3404.90.51)',
          pattern: {
            anyOf: [
              'diamond painting wax', 'drill wax diamond', 'diamond art wax',
              'diamond drill wax', 'wax for diamond painting', 'diamond painting drill wax',
              'mixed wax shapes diamond', 'scented wax diamond painting',
              // General craft wax
              'craft wax', 'adhesive wax craft', 'wax adhesive tool',
              // Diamond painting tools with wax
              'diamond dotz wax', '5d diamond painting wax',
            ],
            noneOf: [
              // Exclude actual diamonds/gemstones
              'diamond ring', 'diamond necklace', 'diamond earring',
              // Exclude candles
              'candle', 'wax melt',
              // Exclude petroleum/paraffin
              'paraffin', 'beeswax candle',
            ],
          },
          inject: [
            { prefix: '3404.90.51', syntheticRank: 1 }, // other wax preparations (scented craft wax)
            { prefix: '3404.90.10', syntheticRank: 2 }, // other wax preparations
            { prefix: '3404.20', syntheticRank: 3 },    // artificial waxes of silicone
          ],
          whitelist: {
            allowChapters: ['34', '96', '95'], // wax preps, miscellaneous, crafts
          },
          boosts: [
            { delta: 0.75, prefixMatch: '3404.' },
          ],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('DIAMOND_PAINTING_WAX_INTENT: created (diamond painting wax → 3404.90.51)');
      }
    }

    // 4. NEW HOCKEY_SPORT_EQUIPMENT_WAX_INTENT → 3404.20 (artificial waxes)
    //    "Hockey wax" → 2712.90 (petroleum wax!) WRONG (expected 3404.20)
    //    Hockey wax = silicone-based wax for stick tape, blade, grip tape → 3404.20
    {
      const existing = allRules.find(r => r.id === 'HOCKEY_SPORT_EQUIPMENT_WAX_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HOCKEY_SPORT_EQUIPMENT_WAX_INTENT',
          description: 'Hockey wax, ski wax, sport equipment wax → ch.34 (3404.20 artificial wax)',
          pattern: {
            anyOf: [
              'hockey wax', 'hockey stick wax', 'stick wax hockey',
              'ski wax', 'snowboard wax', 'surfboard wax', 'bodyboard wax',
              'sport wax', 'equipment wax', 'tape wax hockey',
              // Other non-petroleum waxes for equipment
              'cork wax', 'grip wax',
            ],
            noneOf: [
              'petroleum', 'paraffin wax', 'candle wax', 'wax melt',
            ],
          },
          inject: [
            { prefix: '3404.20', syntheticRank: 1 }, // artificial waxes of silicone
            { prefix: '3404.90.51', syntheticRank: 2 }, // other wax preparations
            { prefix: '3405.20', syntheticRank: 3 }, // waxes for footwear/leather
          ],
          whitelist: {
            denyChapters: ['27'], // deny petroleum products
          },
          boosts: [
            { delta: 0.70, prefixMatch: '3404.' },
          ],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('HOCKEY_SPORT_EQUIPMENT_WAX_INTENT: created (hockey/ski wax → 3404.20, deny ch.27 petroleum)');
      }
    }

    // 5. UPDATE AI_CH69_CERAMIC_MISC_HOUSEHOLD — add 'license plate' to noneOf
    //    "License plate frame" → 6912 because AI_CH69 matches 'frame' token
    {
      const existing = allRules.find(r => r.id === 'AI_CH69_CERAMIC_MISC_HOUSEHOLD');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const plasticNoneOf = ['license plate', 'licence plate', 'number plate', 'license plate frame'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...plasticNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('AI_CH69_CERAMIC_MISC_HOUSEHOLD: added license plate to noneOf');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT71)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT71 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
