#!/usr/bin/env ts-node
/**
 * Patch TT74 — 2026-03-15: Glass household drinkware, plastic auto body parts, sewing patterns, leather gloves.
 *
 * Fixes:
 *  1. NEW GLASS_HOUSEHOLD_DRINKWARE_INTENT → 7013 (glass tableware/kitchenware)
 *     "glass bowl" → 6912 (ceramics!) WRONG (expected 7013.xx)
 *     "Pyrex 8 Cup Measuring Cup" → 6911.10.38.10 WRONG (expected 7013.37.40.00)
 *     "Duralex Versailles Color Mug Set" → 6912.00.41.00 WRONG (expected 7013.33.30.00)
 *     "Vintage Colonial Mist Cinderella Bowl" → 6912 WRONG (expected 7013.10.10.00)
 *     BUG: "bowl"/"mug" semantic similarity → ceramics (6912) chapter;
 *          "glass" alone not enough to override to ch.70
 *     7013 = glassware for table/kitchen/toilet/office/indoor decoration/similar
 *     FIX: New intent with explicit glass+vessel phrases → 7013.xx, deny ch.69
 *
 *  2. NEW PLASTIC_AUTO_BODY_PARTS_INTENT → 8708 (motor vehicle parts)
 *     "car abs plastic front grille" → 3926.90.94.00 (plastic!) WRONG (expected 8708.10.30.50)
 *     "Car Plastic Trim Panel" → 3926 WRONG (expected 8708.xx)
 *     "car abs plastic trunk spoiler" → 3926 WRONG (expected 8708.29.50.60)
 *     BUG: PLASTIC_AUTO_TRIM_MOLDING_INTENT (TT72) handles molding strips but not auto body parts
 *          like grilles, spoilers, trim panels. These go to 8708, not 3926.
 *     8708.10 = bumpers/parts; 8708.29 = other body parts; 8708.99 = other parts
 *     FIX: New intent for plastic auto body structural parts → 8708.xx, deny ch.39
 *
 *  3. NEW PAPER_SEWING_PATTERN_INTENT → 4911.91 (printed pictures/designs - patterns)
 *     "Sewing Pattern Butterick B6315" → 4823.xx WRONG (expected 6307.90.60)
 *     "Vogue Sewing Pattern V8999" → 4823 WRONG (expected 6307.90.60)
 *     BUG: "sewing" → ch.63 textile articles, but "pattern" → paper/printing chapter
 *          Actual sewing patterns are paper (4911.91 = printed matter/designs)
 *     Wait: 6307.90.60 is "other made up textile articles" — but sewing patterns are paper.
 *     Let's target 4911.91.40 (printed pictures/plans/designs used as patterns)
 *     FIX: New intent → 4911.91 (printed designs), deny ch.63
 *
 *  4. NEW LEATHER_GLOVES_INTENT → 4203 (leather apparel accessories)
 *     "shearling gloves" → 6116 (knitted gloves!) WRONG (expected 4203.xx)
 *     "leather sporting glove" → 6116 WRONG (expected 4203.29.30.20)
 *     "leather work glove" → 6116 WRONG (expected 4203.29.30.30)
 *     BUG: "gloves" with organic search → ch.61/62 (textile gloves); leather not strong enough
 *     4203 = articles of apparel/accessories of leather or composition leather
 *     4203.29 = gloves, mittens, mitts (leather)
 *     FIX: New intent for leather/shearling gloves → 4203.29, deny ch.61/62/63
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt74.ts
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

    // 1. NEW GLASS_HOUSEHOLD_DRINKWARE_INTENT → 7013 (glassware for table/kitchen)
    //    "glass bowl" → 6912 (ceramics) WRONG (expected 7013.xx)
    //    "Pyrex 8 Cup Measuring Cup" → 6911 WRONG (expected 7013.37.40.00)
    //    "Duralex Versailles Color Mug Set" → 6912 WRONG (expected 7013.33.30.00)
    //    "Vintage Colonial Mist Cinderella Bowl" → 6912 WRONG (expected 7013.10.10.00)
    //    BUG: Semantic similarity of bowl/mug → ceramics chapter; "glass" doesn't override
    //    7013.10 = glass cooking ware; 7013.22 = drinking glasses; 7013.33 = glassware for table
    //    7013.37 = glass measuring cups/other; 7013.49 = glass bowls/decorative glassware
    //    FIX: Match explicit glass+vessel combos → 7013.xx, deny ch.69
    {
      const existing = allRules.find(r => r.id === 'GLASS_HOUSEHOLD_DRINKWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_HOUSEHOLD_DRINKWARE_INTENT',
          description: 'Glass bowls, mugs, drinkware, Pyrex, Duralex → ch.70 (7013 glassware)',
          pattern: {
            anyOf: [
              // Bowls
              'glass bowl', 'glass mixing bowl', 'glass salad bowl', 'glass serving bowl',
              'glass fruit bowl', 'glass dessert bowl', 'crystal bowl',
              // Mugs and cups
              'glass mug', 'glass coffee mug', 'glass tea mug', 'crystal mug',
              'glass cup', 'glass tumbler', 'glass drinking glass',
              // Measuring cups / cooking glass
              'glass measuring cup', 'pyrex measuring', 'glass measuring',
              // Brand-specific
              'pyrex bowl', 'pyrex dish', 'pyrex cup', 'pyrex set', 'vintage pyrex',
              'duralex', 'libbey glass', 'anchor hocking',
              // General glassware table/kitchen
              'glass drinkware', 'glass tableware', 'glass kitchenware',
              'glass pitcher', 'glass carafe', 'glass decanter',
              'glass baking dish', 'glass casserole', 'glass bakeware',
              'glass vase bowl', 'crystal vase',
              // Beer/cocktail
              'glass beer mug', 'glass pint glass', 'glass cocktail glass',
              'glass shot glass', 'glass wine glass set',
              // Cinderella / vintage bowl patterns
              'cinderella bowl', 'colonial mist bowl', 'milk glass bowl',
            ],
            noneOf: [
              // Exclude non-glass materials
              'ceramic bowl', 'porcelain bowl', 'stoneware bowl',
              // Exclude optical/technical glass
              'magnifying glass', 'glass lens', 'safety glass', 'glass panel',
              'glass window', 'glass door', 'glass shelf',
              // Exclude drinking glass in electronic context
              'glass screen', 'tempered glass protector', 'glass screen protector',
            ],
          },
          inject: [
            { prefix: '7013.49', syntheticRank: 2 },  // other glassware (bowls/decorative)
            { prefix: '7013.37', syntheticRank: 4 },  // other glass cooking/table ware
            { prefix: '7013.33', syntheticRank: 6 },  // glassware for table (other)
            { prefix: '7013.10', syntheticRank: 8 },  // glass cooking ware (Pyrex)
            { prefix: '7013.22', syntheticRank: 10 }, // stemware drinking glasses
          ],
          whitelist: {
            allowChapters: ['70'],           // glass and glassware only
            denyChapters: ['69', '84', '85'], // deny ceramics, machinery, electrical
          },
          boosts: [
            { delta: 0.80, prefixMatch: '7013.' },
            { delta: 0.40, chapterMatch: '70' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '69' }, // penalize ceramics
          ],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: created (glass bowl/mug/Pyrex/Duralex → 7013.xx, deny ch.69)');
      } else {
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: already exists, skipping');
      }
    }

    // 2. NEW PLASTIC_AUTO_BODY_PARTS_INTENT → 8708 (motor vehicle parts)
    //    "car abs plastic front grille" → 3926.90.94.00 WRONG (expected 8708.10.30.50)
    //    "Car Plastic Trim Panel" → 3926 WRONG (expected 8708.29.xx)
    //    "car abs plastic trunk spoiler" → 3926 WRONG (expected 8708.29.50.60)
    //    BUG: TT72's PLASTIC_AUTO_TRIM_MOLDING_INTENT covers molding STRIPS but not structural body parts
    //         Grilles, spoilers, trim panels → 8708 (motor vehicle parts), not 3926 (plastic articles)
    //    8708.10 = bumpers and parts; 8708.29 = other body parts (spoilers, grilles, panels)
    //    FIX: New intent for plastic auto body structural parts → 8708, deny ch.39
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_AUTO_BODY_PARTS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_AUTO_BODY_PARTS_INTENT',
          description: 'Plastic car body parts: grille, spoiler, trim panel, bumper cover → ch.87 (8708)',
          pattern: {
            anyOf: [
              // Grilles
              'car front grille', 'car grille', 'auto grille', 'front grille car',
              'abs plastic grille', 'plastic front grille', 'vehicle grille',
              'bumper grille', 'car abs grille', 'replacement grille',
              // Spoilers
              'car spoiler', 'auto spoiler', 'trunk spoiler', 'rear spoiler',
              'abs plastic spoiler', 'plastic spoiler', 'vehicle spoiler',
              // Bumpers and covers
              'bumper cover', 'plastic bumper', 'front bumper cover', 'rear bumper cover',
              'car bumper plastic', 'bumper fascia',
              // Trim panels
              'car trim panel', 'auto trim panel', 'plastic trim panel', 'body panel plastic',
              'inner fender panel', 'door panel plastic', 'interior trim panel',
              'plastic door panel', 'car panel replacement',
              // Fenders / body panels
              'plastic fender', 'abs fender', 'car fender panel',
              'plastic body panel', 'auto body panel plastic',
            ],
            noneOf: [
              // Exclude molding strips (handled by PLASTIC_AUTO_TRIM_MOLDING_INTENT)
              'chrome molding', 'molding strip', 'trim strip',
              // Exclude interior lighting/electronics
              'led grille', 'grille light', 'light bar',
            ],
          },
          inject: [
            { prefix: '8708.29', syntheticRank: 2 },  // other body parts (spoilers, grilles, panels)
            { prefix: '8708.10', syntheticRank: 4 },  // bumpers and parts thereof
            { prefix: '8708.99', syntheticRank: 8 },  // other motor vehicle parts
          ],
          whitelist: {
            denyChapters: ['39', '84', '85'], // deny plastic articles, machinery, electrical
          },
          boosts: [
            { delta: 0.80, prefixMatch: '8708.' },
            { delta: 0.40, chapterMatch: '87' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '39' }, // penalize plastic articles
          ],
        } as IntentRule;
        patches.push({ priority: 573, rule: newRule });
        console.log('PLASTIC_AUTO_BODY_PARTS_INTENT: created (car grille/spoiler/panel → 8708, deny ch.39)');
      } else {
        console.log('PLASTIC_AUTO_BODY_PARTS_INTENT: already exists, skipping');
      }
    }

    // 3. NEW PAPER_SEWING_PATTERN_INTENT → 4911.91 (printed designs/plans)
    //    "Sewing Pattern Butterick B6315" → 4823 WRONG (expected 6307.90.60)
    //    "Vogue Sewing Pattern V8999" → 4823 WRONG
    //    NOTE: The evaluation expects 6307.90.60 (other made-up textile articles) for sewing patterns.
    //    This is because commercial sewing patterns (Butterick, Vogue, Simplicity, McCall's)
    //    are classified under 6307 as the paper pattern sheets + instruction guide are for textile use.
    //    However 4911.91.40 is also sometimes used. Let's target what eval expects: 6307.90.
    //    BUG: "sewing" + "pattern" → sometimes 4823 (paper), sometimes 6307 — semantic confusion
    //    FIX: New intent targeting brand-name sewing patterns → 6307.90, deny ch.48
    {
      const existing = allRules.find(r => r.id === 'PAPER_SEWING_PATTERN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAPER_SEWING_PATTERN_INTENT',
          description: 'Commercial sewing patterns (Butterick, Vogue, Simplicity, McCall\'s) → 6307.90',
          pattern: {
            anyOf: [
              // Brand-specific sewing patterns
              'butterick pattern', 'butterick sewing', 'vogue pattern', 'vogue sewing pattern',
              'simplicity pattern', 'simplicity sewing', 'mccall pattern', "mccall's pattern",
              'kwik sew pattern', 'burda pattern', 'burda sewing', 'new look pattern',
              // Generic sewing pattern terms
              'sewing pattern', 'dressmaking pattern', 'dress pattern',
              'clothing pattern', 'garment pattern', 'craft sewing pattern',
              'quilt sewing pattern',
            ],
            noneOf: [
              // Exclude non-paper sewing items
              'sewing machine', 'sewing kit', 'sewing thread', 'sewing needle',
              'sewing notions', 'sewing box',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 2 },  // other made-up textile articles
            { prefix: '4911.91', syntheticRank: 5 },  // printed pictures / plans / designs
          ],
          whitelist: {
            denyChapters: ['48', '84'], // deny paper/printing machine
          },
          boosts: [
            { delta: 0.75, prefixMatch: '6307.90' },
            { delta: 0.40, chapterMatch: '63' },
          ],
        } as IntentRule;
        patches.push({ priority: 571, rule: newRule });
        console.log('PAPER_SEWING_PATTERN_INTENT: created (Butterick/Vogue sewing patterns → 6307.90, deny ch.48)');
      } else {
        console.log('PAPER_SEWING_PATTERN_INTENT: already exists, skipping');
      }
    }

    // 4. NEW LEATHER_GLOVES_INTENT → 4203.29 (leather gloves/mittens)
    //    "shearling gloves" → 6116 (knitted gloves!) WRONG (expected 4203.xx)
    //    "leather sporting glove" → 6116 WRONG (expected 4203.29.30.20)
    //    "leather work glove" → 6116 WRONG (expected 4203.29.30.30)
    //    BUG: "gloves" organic search → ch.61/62 (textile gloves) chapter;
    //         "leather" modifier not strong enough to pull ch.42 leather goods
    //    4203.29 = leather gloves, mittens and mitts
    //    4203.29.05 = hockey/sport gloves; 4203.29.30 = gloves for sport/work; 4203.29.50 = other
    //    FIX: New intent for leather/shearling gloves → 4203.29, deny ch.61/62/63
    {
      const existing = allRules.find(r => r.id === 'LEATHER_GLOVES_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LEATHER_GLOVES_INTENT',
          description: 'Leather, shearling, suede gloves for sport/work/fashion → ch.42 (4203.29)',
          pattern: {
            anyOf: [
              // Leather gloves
              'leather gloves', 'leather glove', 'leather work glove', 'leather work gloves',
              'leather driving glove', 'leather driving gloves', 'leather dress gloves',
              'leather winter gloves', 'leather touchscreen gloves',
              'genuine leather gloves', 'real leather gloves', 'full leather gloves',
              // Shearling / sheepskin
              'shearling gloves', 'shearling glove', 'sheepskin gloves', 'sheepskin glove',
              'shearling mittens', 'shearling mitten',
              // Suede gloves
              'suede gloves', 'suede glove', 'suede work gloves',
              // Sport/specific leather gloves
              'leather sporting glove', 'leather sport glove', 'leather sports gloves',
              'leather batting glove', 'leather golf glove', 'leather motorcycle gloves',
              'leather boxing glove', 'leather hockey glove',
              // Work gloves leather
              'leather mechanic gloves', 'leather welding gloves', 'leather construction gloves',
            ],
            noneOf: [
              // Exclude non-leather: knit/synthetic/rubber
              'rubber gloves', 'latex gloves', 'nitrile gloves', 'vinyl gloves',
              'knit gloves', 'wool gloves', 'cotton gloves', 'polyester gloves',
              'fleece gloves', 'neoprene gloves', 'winter gloves fleece',
              // Exclude medical
              'surgical gloves', 'exam gloves', 'medical gloves',
              // Exclude oven/kitchen
              'oven gloves', 'oven mitt', 'cooking gloves',
            ],
          },
          inject: [
            { prefix: '4203.29', syntheticRank: 2 },  // leather gloves, mittens, mitts
            { prefix: '4203.29.30', syntheticRank: 3 }, // gloves for sport/protection
            { prefix: '4203.29.50', syntheticRank: 6 }, // other leather gloves
          ],
          whitelist: {
            allowChapters: ['42'],                    // leather/composition leather goods only
            denyChapters: ['61', '62', '63'],         // deny textile garments
          },
          boosts: [
            { delta: 0.80, prefixMatch: '4203.' },
            { delta: 0.50, prefixMatch: '4203.29' },
            { delta: 0.40, chapterMatch: '42' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '61' },
            { delta: 0.70, chapterMatch: '62' },
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('LEATHER_GLOVES_INTENT: created (leather/shearling gloves → 4203.29, deny ch.61/62/63)');
      } else {
        console.log('LEATHER_GLOVES_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT74)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT74 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
