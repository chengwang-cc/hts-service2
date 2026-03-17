#!/usr/bin/env ts-node
/**
 * Patch TT97 — 2026-03-16: Plastic canvas, car emblems, antique artworks, plastic bottles,
 *                           silicone mold food-context regression fix.
 *
 * Fixes:
 *  1. NEW PLASTIC_CANVAS_CRAFT_INTENT → 3921.19 (plastic plates/sheets), deny ch.58 (textiles)
 *     "1 unit Sheet Plastic Canvas 13" x 10"" → 5805 WRONG (expected 3921.19 plastic mesh sheet)
 *     "2/Pk 14ct Plastic Canvas 8.25" x 11"" → 5805 WRONG (expected 3921.19)
 *     ROOT CAUSE: "canvas" maps to needlepoint/tapestry canvas (ch.58 = 5805) despite being plastic.
 *     FIX: New intent → 3921.19, denyChapters:['58','63']
 *
 *  2. NEW CAR_EMBLEM_BADGE_INTENT → 3926.90 (plastic articles), deny ch.58 (embroidery badges)
 *     "Audi A5 Rings Emblem 5PC Set Badges" → 5810 WRONG (expected 3926.90 plastic appliques)
 *     "Audi A4 Rings Emblem 5PC Set Badges" → 5810 WRONG (expected 3926.90)
 *     ROOT CAUSE: 'emblem' + 'badge' matching textile embroidery badges (5810).
 *     FIX: New intent → 3926.90, denyChapters:['58']
 *
 *  3. FIX SILICONE_CRAFT_MOLD_INTENT — add food/baking terms to noneOf
 *     "cake silicone mold" → 8480.79 WRONG (expected 3910.00 silicone primary form)
 *     ROOT CAUSE: 'silicone mold' substring matches, denyChapters:['39'] blocks correct 3910 result.
 *     FIX: Add 'cake', 'baking', 'bread', 'food', 'cooking', 'chocolate', 'ice' to noneOf
 *          to prevent food-context silicone mold queries from triggering the industrial mold intent.
 *
 *  4. NEW ANTIQUE_ORIGINAL_PRINT_INTENT → 9702 (original engravings/prints), deny ch.49
 *     "Antique (1852) hand coloured lithograph" → 4906 WRONG (expected 9702.10 original print)
 *     "antique print, paper material, depicting historical scene, original" → 4901 WRONG (exp 9702.10)
 *     ROOT CAUSE: Antique original lithographs/prints classified as modern printed matter (ch.49).
 *     9702.10 = original engravings, prints, and lithographs
 *     FIX: New intent → 9702.10/9702.90, denyChapters:['49']
 *
 *  5. NEW PLASTIC_BOTTLE_CONTAINER_INTENT → 3923 (plastic containers), deny ch.73
 *     "plastic spray bottle" → 7323.93 WRONG (expected 3923.30 plastic container/bottle)
 *     "plastic packer bottle" → 7323.93 WRONG (expected 3923.30)
 *     "Holy Water Wide Mouth 32 oz Nalgene Water Bottle" → 7323.93 WRONG (expected 3923.30)
 *     ROOT CAUSE: Plastic bottles classified as household utensils of iron (ch.73).
 *     FIX: New intent → 3923.30/3922.90, denyChapters:['73']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt97.ts
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

    // 1. NEW PLASTIC_CANVAS_CRAFT_INTENT → 3921.19 (plastic plates/sheets, ch.39)
    //    "1 unit Sheet Plastic Canvas 13" x 10"" → 5805 (tapestry canvas!), expected 3921.19
    //    "2/Pk 14ct Plastic Canvas" → 5805, expected 3921.19
    //    Root cause: 'canvas' maps to textile/needlepoint canvas (ch.58) despite being plastic mesh.
    //    3921.19 = other plates, sheets, film of plastics (including plastic mesh/screen)
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_CANVAS_CRAFT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_CANVAS_CRAFT_INTENT',
          description: 'Plastic canvas sheets for needlepoint/crafts → 3921.19 (plastic sheets, ch.39), deny ch.58',
          pattern: {
            anyOf: [
              // Plastic canvas sheets (needlepoint craft supply)
              'plastic canvas', 'plastic canvas sheet', 'plastic canvas sheets',
              '14ct plastic canvas', '18ct plastic canvas', '7ct plastic canvas',
              '10ct plastic canvas', 'plastic needlepoint canvas',
              // General mesh/screen plastic sheet
              'plastic mesh sheet', 'plastic screen sheet',
            ],
            noneOf: [
              // Exclude actual textile canvas
              'cotton canvas', 'linen canvas', 'woven canvas',
              // Exclude canvas bags/products
              'canvas bag', 'canvas tote',
            ],
          },
          inject: [
            { prefix: '3921.19', syntheticRank: 2 },  // other plastic plates/sheets/film
            { prefix: '3921.90', syntheticRank: 4 },  // other plastic plates (cellular)
            { prefix: '3920.59', syntheticRank: 6 },  // other plastic film/sheet (non-cellular)
          ],
          whitelist: {
            allowChapters: ['39'],                     // plastics chapter
            denyChapters: ['58', '63'],                // deny textiles and made-up articles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '3921.' },    // boost plastic plates/sheets
            { delta: 0.50, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '58' },       // strong penalty for tapestry/canvas textiles
            { delta: 0.70, prefixMatch: '5805.' },    // strong penalty for tapestry
          ],
        } as IntentRule;
        patches.push({ priority: 544, rule: newRule });
        console.log('PLASTIC_CANVAS_CRAFT_INTENT: created (plastic canvas → 3921.19, deny ch.58)');
      } else {
        console.log('PLASTIC_CANVAS_CRAFT_INTENT: already exists, skipping');
      }
    }

    // 2. NEW CAR_EMBLEM_BADGE_INTENT → 3926.90 (plastic appliques/badges, ch.39)
    //    "Audi A5 Rings Emblem 5PC Set Badges for Front Rear Trunk Gloss Bl" → 5810 WRONG
    //    "Audi A4 Rings Emblem 5PC Set Badges" → 5810.92 (embroidery badges), expected 3926.90.21
    //    Root cause: 'emblem'/'badge' matching textile embroidery badges (ch.58, 5810).
    //    3926.90.21 = plastic appliques (adhesive car emblems/badges)
    {
      const existing = allRules.find(r => r.id === 'CAR_EMBLEM_BADGE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CAR_EMBLEM_BADGE_INTENT',
          description: 'Car emblems, vehicle badges, plastic appliques → 3926.90 (plastic, ch.39), deny ch.58',
          pattern: {
            anyOf: [
              // Car emblems and badges
              'car emblem', 'car emblems', 'auto emblem', 'vehicle emblem',
              'car badge', 'car badges', 'auto badge',
              // Specific vehicle brand emblem patterns
              'rings emblem', 'trunk emblem', 'hood emblem', 'grille emblem',
              // Decal/adhesive badge patterns
              'gloss black emblem', 'chrome emblem', 'matte emblem',
              'emblem badge set', 'emblem set',
              // Plastic badge/applique
              'plastic emblem', 'plastic badge',
            ],
            noneOf: [
              // Exclude non-vehicle emblems
              'school badge', 'police badge', 'military badge',
              // Exclude textile/fabric badges
              'embroidered badge', 'fabric badge', 'woven badge',
            ],
          },
          inject: [
            { prefix: '3926.90', syntheticRank: 2 },  // other articles of plastics (appliques)
            { prefix: '3926.20', syntheticRank: 4 },  // articles of apparel/accessories of plastic
          ],
          whitelist: {
            allowChapters: ['39', '83'],               // plastics or base metal articles
            denyChapters: ['58', '68'],                // deny textile emblems and ceramic/stone
          },
          boosts: [
            { delta: 0.85, prefixMatch: '3926.' },    // boost plastic articles
            { delta: 0.50, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '58' },       // strong penalty for textiles
            { delta: 0.70, prefixMatch: '5810.' },    // strong penalty for embroidery
          ],
        } as IntentRule;
        patches.push({ priority: 543, rule: newRule });
        console.log('CAR_EMBLEM_BADGE_INTENT: created (car emblems → 3926.90, deny ch.58)');
      } else {
        console.log('CAR_EMBLEM_BADGE_INTENT: already exists, skipping');
      }
    }

    // 3. FIX SILICONE_CRAFT_MOLD_INTENT — add food/baking context to noneOf
    //    "cake silicone mold" exp:3910.00 → gets 8480.79 because 'silicone mold' substring fires intent
    //    and denyChapters:['39'] blocks ch.39 results (3910).
    //    Food/baking silicone molds are not industrial manufacturing molds (8480) — they belong
    //    in ch.39 (3910 silicone material or 3924/3926 plastic articles).
    {
      const existing = allRules.find(r => r.id === 'SILICONE_CRAFT_MOLD_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const foodTerms = [
          // Food/baking context — these should NOT trigger industrial mold routing
          'cake', 'baking', 'bread', 'food', 'cooking',
          'chocolate', 'ice', 'candy', 'dessert', 'pastry',
        ];
        const updatedNoneOf = [...new Set([...currentNoneOf, ...foodTerms])];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: updatedNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 541, rule: updated });
        console.log(`SILICONE_CRAFT_MOLD_INTENT: added food terms to noneOf: ${JSON.stringify(foodTerms)}`);
      } else {
        console.log('SILICONE_CRAFT_MOLD_INTENT: not found');
      }
    }

    // 4. NEW ANTIQUE_ORIGINAL_PRINT_INTENT → 9702 (original prints/engravings, ch.97)
    //    "Antique (1852) hand coloured lithograph" → 4906 WRONG, expected 9702.10 (original print)
    //    "antique print, paper material, depicting historical scene, original" → 4901 WRONG, exp 9702.10
    //    Root cause: Antique/original lithographs and engravings classified as modern printed matter.
    //    9702.10 = original engravings, prints, and lithographs (one-of-a-kind artistic prints)
    {
      const existing = allRules.find(r => r.id === 'ANTIQUE_ORIGINAL_PRINT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ANTIQUE_ORIGINAL_PRINT_INTENT',
          description: 'Original/antique engravings, lithographs, prints → 9702 (original artworks, ch.97)',
          pattern: {
            anyOf: [
              // Antique/original lithographs
              'hand coloured lithograph', 'hand colored lithograph',
              'antique lithograph', 'original lithograph',
              // Antique engravings/prints
              'antique engraving', 'original engraving',
              'antique print original', 'original print antique',
              'hand coloured print', 'hand colored print',
              // Antique with historical context
              'antique print paper', 'historical scene original',
              'depicting historical scene',
              // Specific descriptors for originals
              'hand coloured', 'hand colored antique',
            ],
            noneOf: [
              // Exclude modern reproduction prints
              'reproduction print', 'digital print', 'giclee',
              'poster print', 'art poster',
            ],
          },
          inject: [
            { prefix: '9702.10', syntheticRank: 2 },  // original engravings/prints/lithographs
            { prefix: '9702.90', syntheticRank: 4 },  // other original artworks
            { prefix: '9701.21', syntheticRank: 6 },  // paintings/drawings of any kind
          ],
          whitelist: {
            allowChapters: ['97'],                     // works of art chapter
            denyChapters: ['49', '48'],                // deny printed matter and paper
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9702.' },    // boost original prints
            { delta: 0.75, prefixMatch: '9701.' },    // boost paintings/drawings
            { delta: 0.50, chapterMatch: '97' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '49' },       // strong penalty for printed matter
            { delta: 0.70, chapterMatch: '48' },
          ],
        } as IntentRule;
        patches.push({ priority: 542, rule: newRule });
        console.log('ANTIQUE_ORIGINAL_PRINT_INTENT: created (antique lithographs → 9702, deny ch.49)');
      } else {
        console.log('ANTIQUE_ORIGINAL_PRINT_INTENT: already exists, skipping');
      }
    }

    // 5. NEW PLASTIC_BOTTLE_CONTAINER_INTENT → 3923 (plastic containers, ch.39), deny ch.73
    //    "plastic spray bottle" → 7323.93 WRONG (expected 3923.30 plastic containers)
    //    "plastic packer bottle" → 7323.93 WRONG (expected 3923.30)
    //    "Holy Water Wide Mouth 32 oz Nalgene Water Bottle" → 7323.93 WRONG (expected 3923.30)
    //    Root cause: plastic bottles classified as household utensils of iron/steel (ch.73).
    //    3923.30 = carboys, bottles, flasks of plastics (plastic containers)
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_BOTTLE_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_BOTTLE_CONTAINER_INTENT',
          description: 'Plastic bottles/containers → 3923.30 (plastic containers, ch.39), deny ch.73',
          pattern: {
            anyOf: [
              // Plastic bottles
              'plastic spray bottle', 'plastic spray bottles',
              'plastic bottle', 'plastic bottles',
              'plastic packer bottle', 'plastic packer bottles',
              'hdpe bottle', 'hdpe bottles', 'hdpe container',
              'pet plastic bottle', 'plastic water bottle',
              'plastic squeeze bottle', 'plastic dispensing bottle',
              // Nalgene/brand plastic bottles
              'nalgene water bottle', 'nalgene bottle',
              'wide mouth plastic bottle', 'wide mouth bottle',
              // Plastic flasks/containers
              'plastic flask', 'plastic container bottle',
            ],
            noneOf: [
              // Exclude glass bottles (ch.70)
              'glass bottle', 'glass flask',
              // Exclude metal bottles
              'stainless steel bottle', 'metal bottle', 'aluminum bottle',
              // Exclude cosmetic dispensers (already have atomizer intent)
              'atomizer', 'perfume bottle',
              // Exclude food/beverage content (not the container)
              'mineral water', 'beer bottle', 'wine bottle',
            ],
          },
          inject: [
            { prefix: '3923.30', syntheticRank: 2 },  // carboys/bottles of plastics
            { prefix: '3922.90', syntheticRank: 4 },  // other sanitary/toilet articles of plastics
            { prefix: '3923.50', syntheticRank: 6 },  // stoppers, lids, caps of plastics
          ],
          whitelist: {
            allowChapters: ['39'],                     // plastics chapter
            denyChapters: ['73', '74', '76'],          // deny iron/steel, copper, aluminum utensils
          },
          boosts: [
            { delta: 0.85, prefixMatch: '3923.' },    // boost plastic containers
            { delta: 0.50, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '73' },       // strong penalty for iron/steel utensils
            { delta: 0.70, prefixMatch: '7323.' },    // strong penalty for iron kitchen utensils
          ],
        } as IntentRule;
        patches.push({ priority: 540, rule: newRule });
        console.log('PLASTIC_BOTTLE_CONTAINER_INTENT: created (plastic bottles → 3923.30, deny ch.73)');
      } else {
        console.log('PLASTIC_BOTTLE_CONTAINER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT97)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT97 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
