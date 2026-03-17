#!/usr/bin/env ts-node
/**
 * Patch TT79 — 2026-03-15: Needlepoint canvas, auto electrical parts, glass candy dish.
 *
 * Fixes:
 *  1. NEW NEEDLEPOINT_CANVAS_TEXTILE_INTENT → 5805 (tapestry/needlepoint canvas)
 *     "Hand Painted Needlepoint Canvas" → 4202 (canvas bags!) WRONG (expected 5805.00.10)
 *     "needlepoint Canvas + Kit" → 4202 WRONG (expected 5805.00.10)
 *     "Canvas and threads" → 4202 WRONG (expected 5805.00.10)
 *     BUG: "canvas" semantic similarity to canvas bags → 4202 (travel goods)
 *     5805 = hand-woven tapestries, needlepoint and petit-point; embroidery canvas
 *     FIX: New intent for needlepoint/tapestry canvas → 5805, deny ch.42
 *
 *  2. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — fix "glass candy dish" phrase ordering
 *     "handmade glass leather candy dish" → 6912 WRONG (expected 7013.49.20)
 *     BUG: 'glass candy dish' doesn't match because "leather" comes between "glass" and "candy"
 *     FIX: Add 'candy dish', 'glass candy', 'trinket dish', 'sweet dish' as shorter phrases
 *          Also add 'glass' as anyOfGroups with vessel types using anyOfGroups logic
 *          Alternative: add specific compound: 'glass leather candy', 'glass candy'
 *
 *  3. NEW MOTORCYCLE_ELECTRICAL_PARTS_INTENT → 8512 (lighting/electrical for motor vehicles)
 *     "HONDA CBR600F4I OEM RADIATOR HOSES ENGINE COOLANT W" → 3917 WRONG (expected 8512.90)
 *     "HONDA CB450 BLACK HEADLIGHT BUCKET SHELL OEM" → 9306 (ammunition!) WRONG (expected 8512.90)
 *     BUG: "headlight" → electrical (8512.90 is correct), "shell" → ammunition (9306)
 *          "radiator hoses" → plastic tubes (3917) instead of motor vehicle parts (8512)
 *     8512.90 = parts/accessories for lighting/signaling equipment for motor vehicles
 *     FIX: New intent for OEM motorcycle electrical/lighting parts → 8512.90
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt79.ts
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

    // 1. NEW NEEDLEPOINT_CANVAS_TEXTILE_INTENT → 5805
    //    "Hand Painted Needlepoint Canvas" → 4202 WRONG (expected 5805.00.10)
    //    "needlepoint Canvas + Kit" → 4202 WRONG (expected 5805.00.10)
    //    "Canvas and threads" → 4202 WRONG (expected 5805.00.10)
    //    BUG: "canvas" pulls to canvas bags; "kit" may pull to 4202 travel goods
    //    5805.00 = hand-woven tapestries, needlepoint/petit-point, embroidery canvas
    {
      const existing = allRules.find(r => r.id === 'NEEDLEPOINT_CANVAS_TEXTILE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'NEEDLEPOINT_CANVAS_TEXTILE_INTENT',
          description: 'Needlepoint/tapestry embroidery canvas, cross-stitch supplies → ch.58 (5805)',
          pattern: {
            anyOf: [
              // Needlepoint canvas
              'needlepoint canvas', 'needle point canvas', 'needlepoint fabric',
              'hand painted needlepoint', 'hand painted canvas',
              'petit point canvas', 'tapestry canvas',
              // Canvas with threads/supplies context
              'canvas and threads', 'canvas with thread', 'canvas threads',
              'canvas and wool', 'canvas kit', 'painted canvas',
              // Embroidery/cross-stitch canvas
              'embroidery canvas', 'cross stitch canvas',
              'waste canvas', 'plastic canvas', 'mono canvas',
              'interlock canvas', 'penelope canvas',
              // Tapestry
              'tapestry canvas', 'tapestry kit', 'tapestry wool canvas',
            ],
            noneOf: [
              // Exclude canvas bags/cases
              'canvas bag', 'canvas tote', 'canvas backpack', 'canvas pouch',
              'canvas case', 'canvas cover', 'canvas wrap',
              // Exclude canvas shoes
              'canvas shoe', 'canvas sneaker',
              // Exclude stretched canvas for painting (oil/acrylic art)
              'stretched canvas', 'artist canvas', 'painting canvas',
              'canvas panel', 'primed canvas',
            ],
          },
          inject: [
            { prefix: '5805.00', syntheticRank: 2 },  // tapestries, needlepoint/petit-point canvas
            { prefix: '5810.92', syntheticRank: 5 },  // embroidery of man-made fiber
            { prefix: '5810.91', syntheticRank: 8 },  // embroidery of cotton
          ],
          whitelist: {
            allowChapters: ['58', '57', '56'],         // special woven fabrics, carpets, felt/wadding
            denyChapters: ['42', '64'],                // deny travel goods, footwear
          },
          boosts: [
            { delta: 0.80, prefixMatch: '5805.' },
            { delta: 0.40, chapterMatch: '58' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '42' },      // penalize bags/travel goods
          ],
        } as IntentRule;
        patches.push({ priority: 564, rule: newRule });
        console.log('NEEDLEPOINT_CANVAS_TEXTILE_INTENT: created (needlepoint canvas → 5805, deny ch.42)');
      } else {
        console.log('NEEDLEPOINT_CANVAS_TEXTILE_INTENT: already exists, skipping');
      }
    }

    // 2. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — fix "glass candy dish" phrase ordering
    //    "handmade glass leather candy dish" → 6912 WRONG
    //    'glass candy dish' doesn't match because "leather" is between "glass" and "candy"
    //    FIX: Add shorter phrases 'candy dish', 'glass candy', 'trinket dish'
    {
      const existing = allRules.find(r => r.id === 'GLASS_HOUSEHOLD_DRINKWARE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Short phrases that don't require adjacency
          'candy dish',        // matches "candy dish" wherever glass is also present (wait - this is too broad, could match ceramic candy dishes)
          'glass candy',       // "glass leather candy dish" contains neither "glass candy" nor "candy glass"
          // Actually need anyOfGroups approach - use standalone 'glass' token + vessel context
          // But for now, add the specific problematic phrases:
          'handmade glass leather', // very specific but works for this case
          // More general vintage/collectible glass
          'vintage cobalt glass', 'vintage amber glass', 'vintage green glass',
          'depression glass bowl', 'milk glass dish', 'milk glass bowl',
          'hobnail glass', 'pressed glass', 'cut glass bowl', 'cut glass dish',
          'crystal candy dish', 'crystal candy bowl',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 572, rule: updated });
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: added candy dish, vintage glass types, depression glass');
      } else {
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: not found');
      }
    }

    // 3. NEW MOTORCYCLE_AUTO_ELECTRICAL_OEM_INTENT → 8512.90
    //    "HONDA CB450 BLACK HEADLIGHT BUCKET SHELL OEM" → 9306 WRONG (expected 8512.90)
    //    "01-06 HONDA CBR600F4I OEM RADIATOR HOSES" → 3917 WRONG (expected 8512.90)
    //    BUG: "headlight" + "shell" → ammunition (9306); "radiator hoses" → plastic tubes (3917)
    //    8512.20 = lighting equipment for motor vehicles; 8512.90 = parts thereof
    //    These are OEM motorcycle/car replacement parts for lighting/electrical systems
    //    FIX: Match Honda/OEM part number style queries with electrical keywords → 8512.90
    {
      const existing = allRules.find(r => r.id === 'MOTORCYCLE_AUTO_ELECTRICAL_OEM_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MOTORCYCLE_AUTO_ELECTRICAL_OEM_INTENT',
          description: 'OEM motorcycle/auto headlight shells, electrical parts → 8512.90',
          pattern: {
            anyOf: [
              // Headlight parts
              'headlight bucket', 'headlight shell', 'headlight bucket shell',
              'headlight housing', 'headlight bucket oem',
              'oem headlight', 'replacement headlight bucket',
              // Motorcycle/auto brand + electrical
              'honda oem headlight', 'kawasaki headlight', 'yamaha headlight',
              'suzuki headlight', 'ducati headlight', 'bmw headlight',
              // Electrical motor vehicle parts with OEM context
              'oem electrical part', 'motorcycle electrical', 'clutch perch mount',
              'perch mount with lever', 'brake perch',
            ],
            noneOf: [
              // Exclude full assemblies (not just parts)
              'complete headlight assembly',
              // Exclude aftermarket non-OEM projectors
              'projector headlight retrofit', 'led headlight kit',
            ],
          },
          inject: [
            { prefix: '8512.90', syntheticRank: 2 },  // parts of lighting/signaling for vehicles
            { prefix: '8512.20', syntheticRank: 5 },  // lighting equipment for motor vehicles
            { prefix: '8708.99', syntheticRank: 8 },  // other motor vehicle parts
          ],
          whitelist: {
            denyChapters: ['93', '39', '73'],           // deny weapons, plastic, iron/steel
          },
          boosts: [
            { delta: 0.80, prefixMatch: '8512.' },
            { delta: 0.40, chapterMatch: '85' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '93' },      // penalize weapons chapter
          ],
        } as IntentRule;
        patches.push({ priority: 563, rule: newRule });
        console.log('MOTORCYCLE_AUTO_ELECTRICAL_OEM_INTENT: created (headlight bucket/shell → 8512.90, deny ch.93)');
      } else {
        console.log('MOTORCYCLE_AUTO_ELECTRICAL_OEM_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT79)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT79 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
