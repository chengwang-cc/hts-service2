#!/usr/bin/env ts-node
/**
 * Patch TT75 — 2026-03-15: Glass dish phrases, sticker routing fix, fridge magnet edge cases.
 *
 * Fixes:
 *  1. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — add missing phrases
 *     "pyrex 8 cup measuring cup" → 6911 WRONG (expected 7013.37.40) — 'pyrex' alone not in anyOf
 *     "glass dish with lid" → 6912 WRONG — 'glass dish' not in anyOf (only 'glass baking dish')
 *     "Bohemian Vintage Crystal Lidded Bowl" → 6912 WRONG — 'crystal lidded' not in anyOf
 *     FIX: Add 'pyrex', 'glass dish', 'crystal lidded', 'anchor hocking', 'glass lid',
 *          'glass container', 'glass jar with lid', 'glass storage jar', 'glass cooking'
 *
 *  2. UPDATE STICKER_LABEL_INTENT — add 3919.90.10 injection (self-adhesive plastic stickers)
 *     "1.5x2.5 inch sticker" → 4821 (paper label!) WRONG (expected 3919.90.10)
 *     "Label Stickers" → 4821 WRONG (expected 3920.59)
 *     BUG: STICKER_LABEL_INTENT injects 4821 (paper labels) but most stickers are plastic
 *          Self-adhesive plastic stickers = 3919.90.10 (self-adhesive plastic film/sheet)
 *     FIX: Add 3919.90.10 injection (rank 3) alongside 4821 (rank 10), add boost for 3919.
 *
 *  3. NEW FRIDGE_MAGNET_SOUVENIR_INTENT → 8505.11/8505.19 (permanent magnets)
 *     "man resin fridge magn used" → 3907 WRONG (expected 8505.11.00.9)
 *     "Bag of Magnetic Dicks 3D Printed Gag Gift" → 3926 WRONG (expected 8505.19.30.0)
 *     "Cute cat fridge magnet" → expected 8505.xx
 *     BUG: Truncated "fridge magn" doesn't match 'fridge magnet' phrase; "magnetic" + 3D printed
 *          novelty items don't trigger 8505
 *     FIX: New intent with 'fridge magn', 'decorative magnet', 'refrigerator magnet',
 *          'souvenir magnet', 'novelty magnet', etc. → 8505.19, deny ch.39 for magnets
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt75.ts
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

    // 1. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — add missing phrases
    //    "pyrex 8 cup measuring cup" → 6911 WRONG — need 'pyrex' as standalone word
    //    "glass dish with lid" → 6912 WRONG — need 'glass dish'
    //    "Bohemian Vintage Crystal Lidded Bowl" → 6912 WRONG — need 'crystal lidded' or 'crystal lid'
    {
      const existing = allRules.find(r => r.id === 'GLASS_HOUSEHOLD_DRINKWARE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Single-word brand matches (most important for eval)
          'pyrex',              // matches "pyrex 8 cup measuring cup" as a token
          // Missing glass vessel phrases
          'glass dish',         // "glass dish with lid"
          'glass casserole dish', 'glass storage',
          'glass container', 'glass jar',
          'glass lid',          // glassware with lids
          'glass cooking dish', 'glass cooking vessel',
          // Crystal variations
          'crystal lidded', 'crystal lid bowl', 'crystal glass bowl',
          'vintage crystal', 'czech crystal', 'bohemian crystal',
          // More measuring/kitchen
          'glass measuring jug', 'glass jug',
          // Vintage/collectible glass
          'milk glass', 'depression glass', 'carnival glass', 'art glass bowl',
          'vintage glass bowl', 'antique glass bowl',
          // Libbey, Fire-King, etc.
          'fire-king', 'fire king glass', 'jenaer glas', 'borosilicate glass',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 572, rule: updated });
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: added pyrex standalone, glass dish, crystal lidded, etc.');
      } else {
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: not found');
      }
    }

    // 2. UPDATE STICKER_LABEL_INTENT — add 3919.90.10 injection for plastic stickers
    //    "1.5x2.5 inch sticker" → 4821 WRONG (expected 3919.90.10)
    //    Current: inject: [{ prefix: '4821.10', syntheticRank: 22 }]
    //    Fix: Add 3919.90.10 (rank 3) as primary injection, keep 4821.10 (rank 15) as fallback
    {
      const existing = allRules.find(r => r.id === 'STICKER_LABEL_INTENT');
      if (existing) {
        const currentInject = (existing as any).inject || [];
        const updated = {
          ...existing,
          inject: [
            { prefix: '3919.90', syntheticRank: 3 },   // self-adhesive plastic films/stickers
            { prefix: '3919.10', syntheticRank: 8 },   // self-adhesive plastic sheets
            ...currentInject,                            // keep 4821.10 as fallback
          ],
          boosts: [
            { delta: 0.60, prefixMatch: '3919.90' },   // primary: plastic self-adhesive
            { delta: 0.40, prefixMatch: '3919.' },
            ...((existing as any).boosts || []),
          ],
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('STICKER_LABEL_INTENT: added 3919.90.10 injection (plastic stickers) alongside 4821');
      } else {
        console.log('STICKER_LABEL_INTENT: not found');
      }
    }

    // 3. NEW FRIDGE_MAGNET_SOUVENIR_INTENT → 8505.11/8505.19 (permanent magnets)
    //    "man resin fridge magn used" → 3907 WRONG (expected 8505.11.00.9)
    //    "Bag of Magnetic Dicks 3D Printed Gag Gift" → 3926 WRONG (expected 8505.19.30.0)
    //    BUG: 'fridge magn' (truncated) doesn't match 'fridge magnet' phrase;
    //         plastic/resin souvenir magnets don't trigger 8505
    //    8505.11 = permanent magnets of metal; 8505.19 = other permanent magnets (ferrite/ceramic)
    //    FIX: Match fridge/refrigerator magnet variants, souvenir magnets, decorative magnets → 8505
    {
      const existing = allRules.find(r => r.id === 'FRIDGE_MAGNET_SOUVENIR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FRIDGE_MAGNET_SOUVENIR_INTENT',
          description: 'Souvenir/decorative fridge magnets, novelty magnets → 8505 (permanent magnets)',
          pattern: {
            anyOf: [
              // Fridge/refrigerator magnets (including typos/truncations)
              'fridge magnet', 'fridge magnets', 'refrigerator magnet', 'refrigerator magnets',
              'fridge magn',    // truncated form in some listings
              // Souvenir magnets
              'souvenir magnet', 'souvenir magnets', 'novelty magnet', 'novelty magnets',
              'decorative magnet', 'decorative magnets',
              // Collectible/photo magnets
              'photo magnet', 'photo magnets', 'picture magnet',
              'custom magnet', 'custom magnets', 'personalized magnet',
              // City/travel souvenir magnets
              'travel magnet', 'city magnet',
              // Material-based magnet descriptions
              'resin magnet', 'resin magnets', 'acrylic magnet', 'silicone magnet',
              '3d magnet', 'wooden magnet', 'rubber magnet',
            ],
            noneOf: [
              // Exclude functional magnets (industrial)
              'magnetic latch', 'magnetic closure', 'magnetic strip', 'magnetic stripe',
              'magnetic therapy', 'magnetic bracelet',
              // Exclude lashes
              'magnetic lashes', 'magnetic eyelashes',
              // Exclude whiteboards/boards
              'magnetic whiteboard', 'magnetic board', 'magnetic dry erase',
            ],
          },
          inject: [
            { prefix: '8505.19', syntheticRank: 2 },  // permanent magnets (other materials)
            { prefix: '8505.11', syntheticRank: 5 },  // permanent magnets of metal
            { prefix: '8505.20', syntheticRank: 10 }, // electromagnetic couplings
          ],
          whitelist: {
            denyChapters: ['39', '69', '61', '62'], // deny plastic/ceramic/textile
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8505.' },
            { delta: 0.50, chapterMatch: '85' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '39' }, // penalize plastic articles
            { delta: 0.60, chapterMatch: '69' }, // penalize ceramics
          ],
        } as IntentRule;
        patches.push({ priority: 569, rule: newRule });
        console.log('FRIDGE_MAGNET_SOUVENIR_INTENT: created (fridge/souvenir magnets → 8505.19, deny ch.39)');
      } else {
        console.log('FRIDGE_MAGNET_SOUVENIR_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT75)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT75 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
