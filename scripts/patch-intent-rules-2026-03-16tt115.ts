#!/usr/bin/env ts-node
/**
 * Patch TT115 — 2026-03-16: Fix fishing tackle + festive article intents.
 *
 * Fix 1: UPDATE FISHING_LURE_TACKLE_INTENT — inject 9507.20 (fish hooks/lures) not 9507.90
 *   "Fishing Lures made with plastics" → 9507.90 WRONG (expected 9507.20.80.00)
 *   "Deps Sakamata Shad - 5"" → 0302.89 (fresh fish!) WRONG (expected 9507.20.80.00)
 *   Root cause: inject was 9507.90 rank 5 (misc tackle); lures/artificial baits are 9507.20.
 *   Also missing allowChapters:['95'] so fish (ch.03) entries win for lure product names like "Shad".
 *   Fix: inject 9507.20 rank 1 + allowChapters:['95'] (block ch.03 fish codes).
 *
 * Fix 2: UPDATE FISHING_LINE_INTENT — inject 9507.10 (rod parts) not 9507.90
 *   "tapered shock leader, 15-60lbs blue" → 3204 (dye blue!) WRONG (expected 9507.10.00.80)
 *   "tapered shock leader, 15-60lbs orange" → 0805 (oranges!) WRONG (expected 9507.10.00.80)
 *   Root cause: "shock leader" not in anyOf; inject was 9507.90 rank 22 (very weak).
 *   9507.10.00.80 is "Parts and accessories" of fishing rods — US HTS classifies leaders there.
 *   Color words ("blue","orange") trigger dye/fruit codes without allowChapters.
 *   Fix: add shock leader phrases; inject 9507.10 rank 1; keep allowChapters:['95'].
 *
 * Fix 3: NEW CHRISTMAS_STOCKING_DECORATION_INTENT → 9505.10.50.20
 *   "christmas stockings" → 6115.10.30.00 (hosiery) WRONG (expected 9505.10.50.20)
 *   Root cause: CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT only injects 9505.10 at rank 5 — too weak.
 *   "stocking" triggers hosiery chapter scoring; intent boost doesn't overcome it.
 *   Fix: dedicated high-priority intent injecting 9505.10.50 at rank 1 with denyChapters hosiery.
 *
 * Fix 4: NEW CAKE_CUPCAKE_TOPPER_FESTIVE_INTENT → 9505.90.40.00
 *   "3 sets of Cupcake Toppers Sports Set" → 9506.69 (sports equipment) WRONG (expected 9505.90.40.00)
 *   "3 sets of Golf Personalized Face Cupcake Toppers" → 4421.91.93 (bamboo golf tees!) WRONG
 *   "36 Toppers - 6 Faces" → 3605 (matches) WRONG
 *   Root cause: no dedicated intent; "cupcake toppers" + "golf" → bamboo golf tees.
 *   9505.90.40.00 = candy/festive articles (includes cake decorations/toppers).
 *   Fix: new intent with allowChapters:['95'] to force festive chapter.
 *
 * Fix 5: NEW FOAM_LATEX_COSTUME_MASK_INTENT → 9505.90.60.00
 *   "Bear Nose - foam latex prosthetic mask" → 8483 (gears/pulleys) WRONG
 *   "Big-Lipped Chin - foam latex prosthetic mask" → 3926.90 (plastic articles) WRONG
 *   "Chicken Beak - foam latex prosthetic mask" → 0207 (chicken!) WRONG
 *   Root cause: no intent; body part names trigger anatomy/food codes.
 *   9505.90.60.00 = "Tinsel, artificial hair, other articles for amusements" (costume accessories).
 *   Fix: new intent with allowChapters:['95'] to block wrong chapters.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt115.ts
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

    // 1. UPDATE FISHING_LURE_TACKLE_INTENT — inject 9507.20 rank 1, add allowChapters:['95']
    //    Artificial baits and lures are 9507.20, not 9507.90 (misc tackle).
    //    Without allowChapters, lure names like "Shad" (a fish species) trigger 0302 (fresh fish).
    {
      const existing = allRules.find(r => r.id === 'FISHING_LURE_TACKLE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '9507.20', syntheticRank: 1 },   // artificial baits/lures (correct code)
            { prefix: '9507.90', syntheticRank: 10 },  // other fishing tackle (fallback)
          ],
          whitelist: {
            ...(existing as any).whitelist,
            allowChapters: ['95'],   // block fish (ch.03) and other wrong chapters
          },
          boosts: [
            { delta: 0.95, prefixMatch: '9507.20' },  // very strong boost for artificial lures
            { delta: 0.50, prefixMatch: '9507.' },     // general fishing tackle boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '0302.' },  // strong penalty for fresh fish
            { delta: 0.90, prefixMatch: '0301.' },  // live fish
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 565, rule: updated });
        console.log('FISHING_LURE_TACKLE_INTENT: inject→9507.20 rank1, added allowChapters:[95]');
      } else {
        console.log('FISHING_LURE_TACKLE_INTENT: not found');
      }
    }

    // 2. UPDATE FISHING_LINE_INTENT — add shock leaders, inject 9507.10 rank 1
    //    "tapered shock leader" not in anyOf; inject 9507.90 rank 22 too weak.
    //    US HTS: 9507.10.00.80 = "Parts and accessories" (fishing rod accessories, incl. leaders).
    //    Color words in query ("blue","orange") trigger dye/citrus without allowChapters.
    {
      const existing = allRules.find(r => r.id === 'FISHING_LINE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addAnyOf = [
          'shock leader', 'tapered shock leader', 'tapered leader',
          'fishing leader', 'monofilament leader', 'fluorocarbon leader',
          'leader line', 'fishing trace',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
          inject: [
            { prefix: '9507.10', syntheticRank: 1 },   // rod parts/accessories (leaders)
            { prefix: '9507.90', syntheticRank: 8 },   // other fishing tackle (lines)
          ],
          boosts: [
            { delta: 0.95, prefixMatch: '9507.10' },  // strong boost for rod accessories
            { delta: 0.60, prefixMatch: '9507.90' },  // moderate boost for misc tackle
          ],
          // allowChapters: ['95'] already present — keep it (blocks dye/fruit codes)
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 520, rule: updated });
        console.log('FISHING_LINE_INTENT: added shock leader phrases, inject→9507.10 rank1');
      } else {
        console.log('FISHING_LINE_INTENT: not found');
      }
    }

    // 3. NEW CHRISTMAS_STOCKING_DECORATION_INTENT → 9505.10.50.20
    //    "christmas stockings" matches CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT which only
    //    injects 9505.10 at rank 5 — too weak to beat hosiery codes for "stocking".
    //    Fix: high-priority intent injecting 9505.10.50 at rank 1 + deny hosiery chapters.
    {
      const existing = allRules.find(r => r.id === 'CHRISTMAS_STOCKING_DECORATION_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CHRISTMAS_STOCKING_DECORATION_INTENT',
          description: 'Christmas stockings (decorations) → 9505.10.50.20, deny hosiery',
          pattern: {
            anyOf: [
              'christmas stocking', 'christmas stockings',
              'holiday stocking', 'holiday stockings',
              'xmas stocking', 'xmas stockings',
              'christmas hang stocking', 'mantle stocking',
            ],
            noneOf: [
              // Exclude yarn/pattern items (expected yarn codes not decoration codes)
              'christmas stocking pattern', 'pdf pattern', 'knitting pattern',
              'crochet pattern', 'stocking yarn',
            ],
          },
          inject: [
            { prefix: '9505.10.50', syntheticRank: 1 },  // Christmas decorations (stockings)
            { prefix: '9505.10', syntheticRank: 5 },      // general Christmas decorations
          ],
          whitelist: {
            allowChapters: ['95'],     // positive filter: only festive articles
            denyChapters: ['61', '64'],  // hard-block hosiery (knit + made-up articles)
          },
          boosts: [
            { delta: 0.95, prefixMatch: '9505.10.50' },  // very strong boost
            { delta: 0.60, prefixMatch: '9505.10' },      // moderate boost for Christmas decor
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6115.' },  // strong penalty for hosiery
          ],
        } as IntentRule;
        patches.push({ priority: 571, rule: newRule });
        console.log('CHRISTMAS_STOCKING_DECORATION_INTENT: created (→9505.10.50, denyChapters:[61,64])');
      } else {
        console.log('CHRISTMAS_STOCKING_DECORATION_INTENT: already exists, skipping');
      }
    }

    // 4. NEW CAKE_CUPCAKE_TOPPER_FESTIVE_INTENT → 9505.90.40.00
    //    Cake/cupcake toppers are festive articles (9505.90.40).
    //    "cupcake toppers" + "golf" → bamboo golf tees (4421.91.93) because "golf" = golf tees.
    //    "Toppers" alone → matches (3605) due to unrelated word scoring.
    //    9505.90.40.00 = candy baskets, pinatas, festive articles used at parties/events.
    {
      const existing = allRules.find(r => r.id === 'CAKE_CUPCAKE_TOPPER_FESTIVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CAKE_CUPCAKE_TOPPER_FESTIVE_INTENT',
          description: 'Cake/cupcake toppers → 9505.90.40.00 (festive articles/party decorations)',
          pattern: {
            anyOf: [
              'cake topper', 'cake toppers',
              'cupcake topper', 'cupcake toppers',
              'birthday cake topper', 'birthday cake toppers',
              'wedding cake topper', 'wedding cake toppers',
              'graduation cake topper', 'baby shower cake topper',
              'custom cake topper', 'personalized cake topper',
            ],
            noneOf: [
              // Exclude stoppers (different product)
              'wine stopper', 'bottle stopper', 'door stopper', 'chair stopper',
              // Exclude tree toppers (different festive intent)
              'tree topper', 'christmas tree topper', 'star topper',
            ],
          },
          inject: [
            { prefix: '9505.90.40', syntheticRank: 1 },  // festive articles/party decorations
            { prefix: '9505.90.20', syntheticRank: 5 },  // confetti/streamers (cardstock toppers)
          ],
          whitelist: {
            allowChapters: ['95'],   // only festive chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '9505.90.40' },  // very strong boost
            { delta: 0.60, prefixMatch: '9505.90' },      // moderate boost for festive
          ],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('CAKE_CUPCAKE_TOPPER_FESTIVE_INTENT: created (cake topper → 9505.90.40, allowChapters:[95])');
      } else {
        console.log('CAKE_CUPCAKE_TOPPER_FESTIVE_INTENT: already exists, skipping');
      }
    }

    // 5. NEW FOAM_LATEX_COSTUME_MASK_INTENT → 9505.90.60.00
    //    "Bear Nose - foam latex prosthetic mask" → 8483.20 (gears) WRONG
    //    "Big-Lipped Chin - foam latex prosthetic mask" → 3926.90 (plastic) WRONG
    //    "Chicken Beak - foam latex prosthetic mask" → 0207 (chicken!) WRONG
    //    Body part names trigger anatomy/food/mechanical codes.
    //    9505.90.60.00 = "Tinsel, artificial hair, and other festive articles" — costume items.
    {
      const existing = allRules.find(r => r.id === 'FOAM_LATEX_COSTUME_MASK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FOAM_LATEX_COSTUME_MASK_INTENT',
          description: 'Foam latex prosthetic masks/costume accessories → 9505.90.60.00 (festive)',
          pattern: {
            anyOf: [
              'foam latex prosthetic', 'foam latex prosthetic mask',
              'latex prosthetic mask', 'latex prosthetic nose',
              'latex prosthetic chin', 'latex prosthetic beak',
              'foam latex mask', 'foam prosthetic mask',
              'foam latex nose', 'foam latex chin', 'foam latex beak',
              'foam latex ear', 'foam latex forehead',
              'costume prosthetic', 'theatrical prosthetic',
              'prosthetic mask', 'costume mask foam',
            ],
            noneOf: [
              // Medical prosthetics
              'medical prosthetic', 'dental prosthetic', 'surgical prosthetic',
            ],
          },
          inject: [
            { prefix: '9505.90.60', syntheticRank: 1 },  // other festive articles (costume accessories)
            { prefix: '9505.90', syntheticRank: 5 },     // general festive
          ],
          whitelist: {
            allowChapters: ['95'],   // block anatomy/food/plastic chapters
          },
          boosts: [
            { delta: 0.95, prefixMatch: '9505.90.60' },  // very strong boost
            { delta: 0.60, prefixMatch: '9505.90' },      // moderate boost for festive
          ],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('FOAM_LATEX_COSTUME_MASK_INTENT: created (foam latex → 9505.90.60, allowChapters:[95])');
      } else {
        console.log('FOAM_LATEX_COSTUME_MASK_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT115)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT115 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
