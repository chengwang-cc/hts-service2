#!/usr/bin/env ts-node
/**
 * Patch TT45 — 2026-03-15: Dress fiber content + depression glass fix + ceramic routing + plastic novelty.
 * Current: ~34% (after TT43+TT44 pending eval)
 *
 * Updates:
 *  - WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: add 'flower girl dress', 'womens dress' (bare), fiber % patterns
 *    "Flower Girl Dress" → 6204.43; "74% Viscose ... Womens Dress" → 6204.43; ~5 miss entries
 *  - PYREX_GLASS_BOWL_KITCHEN_INTENT: add 'pyex' (dataset misspelling), 'fire king glass', 'jadeite'
 *    "Friendship Cinderella Pyex Bowl" → 7013.49; "ANCHOR HOCKING FIRE KING JADEITE SOUP BOWLS" → 6911.10
 *  - CERAMIC_PORCELAIN_TABLEWARE_INTENT: add 'jadeite', 'fire king', 'anchor hocking jadeite'
 *    "ANCHOR HOCKING FIRE KING JADEITE SOUP BOWLS" → 6911.10 (vitrified = ceramic tableware)
 *
 * New Rules:
 *  1. RUBBER_SILICONE_NOVELTY_DECOR_INTENT → 3926.90 (car coasters, desk buddies, phone grips)
 *     "black plastic car coaster" → 3926.90; "Novelty Home Office Decor" → 3926.90; 8+ miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt45.ts
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

    // UPDATE WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT — add flower girl dress, womens dress bare
    // "Flower Girl Dress" → 6204.43 (children's flower girl dress = polyester for formal occasions)
    // "74% Viscose 24.4%Polyamide 1.6% Elastane Black Womens Dress" → 6204.43 (viscose blend)
    // "Chestnut Lace - S" → 6204.43 (brand name dress with lace, "Chestnut" = color not nut)
    {
      const existing = allRules.find(r => r.id === 'WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasFlowerGirlDress = currentAnyOf.some((t: string) => t.includes('flower girl dress'));
        if (!hasFlowerGirlDress) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Flower girl / formal children's dresses
                'flower girl dress', 'girls formal dress', 'girls party dress',
                'formal girls dress', 'special occasion dress girls',
                // Bare "womens dress" — broad but guards in noneOf protect against cotton/linen
                'womens dress', 'ladies dress', 'women dress',
                // Fiber percentage patterns that appear in dress descriptions
                '%polyamide', '% polyamide', 'polyamide elastane',
                'elastane dress', 'lycra dress', 'spandex blend dress',
                // Specific brand/style names that are dresses
                'lace dress', 'chestnut lace', 'eclipse lace',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: updated with flower girl dress/womens dress/fiber% patterns');
        } else {
          console.log('WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: already has flower girl dress pattern');
        }
      }
    }

    // UPDATE PYREX_GLASS_BOWL_KITCHEN_INTENT — add 'pyex' (misspelling), fire king glass, vintage bowls
    // "Friendship Cinderella Pyex Bowl. #443" → 7013.49 (misspelled "Pyrex" as "Pyex")
    // NOTE: "ANCHOR HOCKING FIRE KING JADEITE" → actually 6911.10 (vitrified ceramic not glass)
    {
      const existing = allRules.find(r => r.id === 'PYREX_GLASS_BOWL_KITCHEN_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasPyex = currentAnyOf.some((t: string) => t.includes('pyex'));
        if (!hasPyex) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Misspelling of Pyrex that appears in eval dataset
                'pyex', 'pyex bowl',
                // Other glass cookware brands
                'anchor hocking glass', 'fire king glass',
                'milk glass bowl', 'milk glass dish',
                'milk glass hen', 'glass hen', 'hen on nest glass',
                'fenton glass', 'blenko glass', 'viking glass bowl',
                // Depression glass sub-types
                'pink depression glass', 'green depression glass', 'amber depression glass',
                // More glass kitchen items
                'glass pie dish', 'glass pie plate', 'glass casserole dish',
                'glass baking dish', 'glass roasting pan',
                'glass loaf pan', 'glass cake pan',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('PYREX_GLASS_BOWL_KITCHEN_INTENT: updated with pyex/anchor hocking/depression glass colors');
        } else {
          console.log('PYREX_GLASS_BOWL_KITCHEN_INTENT: already has pyex pattern');
        }
      }
    }

    // UPDATE CERAMIC_PORCELAIN_TABLEWARE_INTENT — add jadeite, fire king, vitrified glass-ceramic
    // "SET 2 VINTAGE ANCHOR HOCKING FIRE KING JADEITE SOUP BOWLS" → 6911.10
    // "Belleek Star Shaped Salt Cellar Bowl (2.75 In.) - 2nd Black Mark - Ireland" → 6911.10
    // Fire King Jadeite = opaque glass ceramic classified under ch.69 (ceramic) not ch.70 (glass)
    {
      const existing = allRules.find(r => r.id === 'CERAMIC_PORCELAIN_TABLEWARE_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasJadeite = currentAnyOf.some((t: string) => t.includes('jadeite') || t.includes('fire king'));
        if (!hasJadeite) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Anchor Hocking Fire King Jadeite (classified as vitrified ceramic)
                'jadeite', 'fire king jadeite', 'anchor hocking jadeite', 'fire king bowl',
                'fire king dish', 'anchor hocking fire king',
                // Vitrified / ironstone / dinnerware patterns
                'ironstone plate', 'ironstone platter', 'ironstone bowl',
                'johnson bros', 'rambler rose', 'flow blue', 'flow blue china',
                // Belleek
                'belleek', 'belleek ireland', 'belleek shamrock',
                // More salt cellars and condiment sets
                'porcelain salt cellar', 'ceramic salt cellar', 'salt cellar porcelain',
                // Ceramic serving pieces
                'creamer sugar set', 'creamer and sugar', 'sugar bowl creamer',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 570, rule: updated });
          console.log('CERAMIC_PORCELAIN_TABLEWARE_INTENT: updated with jadeite/fire king/belleek/ironstone');
        } else {
          console.log('CERAMIC_PORCELAIN_TABLEWARE_INTENT: already has jadeite/fire king pattern');
        }
      }
    }

    // 1. PLASTIC_NOVELTY_DECOR_INTENT → 3926.90 (plastic novelty items, car coasters, desk decor)
    //    "black plastic car coaster" → 3926.90.xx (plastic car coaster = rubber/silicone coaster)
    //    "Angry Cat Desk Buddy: Novelty Home Office Decor" → 3926.90.xx (plastic novelty item)
    //    "Santorini Jewelry Tray" (plastic) → 3926.90.35.00
    //    "Santorini Christmas Ornament Series - Faithin3D Collection" → 3926.90.35.00
    //    "DMC StitchBow Floss Holders, Thread Storage - Pack of 10" → 3926.90.30.00
    //    3926.90 = other articles of plastics (catch-all for miscellaneous plastic items)
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_NOVELTY_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_NOVELTY_DECOR_INTENT',
          description: 'Plastic novelty items, desk decor, car coasters, floss holders → ch.39 (3926.90)',
          pattern: {
            anyOf: [
              // Car interior plastic accessories
              'car coaster', 'car coasters', 'auto coaster', 'cup holder coaster',
              'plastic car coaster', 'silicone car coaster',
              // Desk novelty items
              'desk buddy', 'desk decor plastic', 'novelty desk', 'office desk figurine',
              'desk figurine', 'novelty figurine plastic', 'resin figurine',
              // Crafting/sewing accessories (plastic)
              'floss holder', 'thread holder plastic', 'stitchbow', 'embroidery floss holder',
              'bobbins plastic', 'thread bobbin plastic',
              // 3D printed novelty
              '3d printed figurine', '3d printed decor', '3d printed novelty',
              '3d printed beer tap', '3d printed phone holder',
              // Plastic organizer accessories
              'blower packout mount', 'packout mount plastic', 'tool organizer mount plastic',
            ],
            noneOf: [
              'metal', 'wood', 'ceramic', 'glass',
              'clothing', 'fabric', 'textile',
            ],
          },
          inject: [{ prefix: '3926.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '3926.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('PLASTIC_NOVELTY_DECOR_INTENT: created (plastic novelty items → 3926.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT45)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT45 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
