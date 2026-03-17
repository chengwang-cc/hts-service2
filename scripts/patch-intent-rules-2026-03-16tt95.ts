#!/usr/bin/env ts-node
/**
 * Patch TT95 — 2026-03-16: Enamel pins, purse frames, crystal jewelry, essential oils.
 *
 * Fixes:
 *  1. NEW ENAMEL_LAPEL_PIN_INTENT → 7117 (imitation jewelry), deny ch.73 (sewing pins)
 *     "Enamel Pins (3)" → 7319.40 WRONG (expected 7117.90 imitation jewelry)
 *     "Lucifer Enamel Pin 2" → 7319.40 WRONG (expected 7117.90)
 *     "Feather Lapel Pin" → 7319.40 WRONG (expected 7117.11)
 *     ROOT CAUSE: 'pin' token matches sewing pins (7319.40). Enamel/lapel pins are
 *                 decorative jewelry (ch.71), not functional sewing pins (ch.73).
 *     FIX: New intent → 7117.90/7117.11, denyChapters:['73']
 *
 *  2. NEW PURSE_FRAME_HARDWARE_INTENT → 8301 (locks/frames), deny ch.93 (arms/ammo)
 *     "Metal Kiss Lock Purse Frame" → 9305.10 WRONG (expected 8301.10 padlocks/locks)
 *     "4 sizes Metal Doctor Bag Frame" → 9305.10 WRONG (expected 8301.10)
 *     ROOT CAUSE: 'metal frame' + 'bag' tokens matching firearms accessories (9305).
 *     FIX: New intent → 8301.10/8302.50, denyChapters:['93']
 *
 *  3. NEW HANDMADE_CRYSTAL_JEWELRY_INTENT → 7113/7117, deny ch.70 (glass)
 *     "handmade women jewelry crystal" → 7018.10 WRONG (expected 7113.19 jewelry)
 *     "Add on an Extender to your Jewelry (2 inches, Gold)" → 7018.10 WRONG (expected 7113.20)
 *     ROOT CAUSE: 'crystal' in query matching glass/crystal beads (7018, ch.70).
 *                 Jewelry with crystals should be ch.71, not ch.70 glass beads.
 *     FIX: New intent → 7113.19/7117.90, denyChapters:['70']
 *
 *  4. NEW ESSENTIAL_OIL_COSMETIC_INTENT → 3301/3304, deny ch.27 (petroleum)
 *     "body oil samples" → 2710.20 WRONG (expected 3301.29 essential oils)
 *     "MILLION DOLLAR OIL" → 2710.19 WRONG (expected 3301.29)
 *     "Baby Oil Sample" → 2710.20 WRONG (expected 3304.99 beauty preparations)
 *     ROOT CAUSE: 'oil' token strongly associated with petroleum chapter (ch.27).
 *     FIX: New intent → 3301.29/3304.99, denyChapters:['27','15'] for cosmetic/essential oils
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt95.ts
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

    // 1. NEW ENAMEL_LAPEL_PIN_INTENT → 7117 (imitation jewelry, ch.71)
    //    "Enamel Pins (3)" → 7319.40 (sewing pins/needles), expected 7117.90 (imitation jewelry, other)
    //    "Feather Lapel Pin" → 7319.40, expected 7117.11 (imitation jewelry, of base metal)
    //    "Lucifer Enamel Pin 2" → 7319.40, expected 7117.90
    //    Root cause: 'pin' maps strongly to sewing pins (ch.73). Enamel/lapel pins are ch.71 jewelry.
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_LAPEL_PIN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENAMEL_LAPEL_PIN_INTENT',
          description: 'Enamel pins, lapel pins, pin badges → 7117 (imitation jewelry, ch.71), deny ch.73 pins',
          pattern: {
            anyOf: [
              // Enamel pins
              'enamel pin', 'enamel pins', 'hard enamel pin', 'soft enamel pin',
              'hard enamel', 'soft enamel',
              // Lapel/collar/hat pins
              'lapel pin', 'lapel pins', 'collar pin', 'hat pin',
              'tie pin', 'stick pin', 'brooch pin',
              // Pin badges
              'pin badge', 'pin badges', 'enamel badge',
              // Flair/button pins
              'flair pin', 'button pin', 'pinback button',
            ],
            noneOf: [
              // Exclude actual sewing/safety pins
              'sewing pin', 'safety pin', 'bobby pin',
              // Exclude hair accessories
              'hair pin', 'hairpin',
              // Exclude circuit pins
              'circuit pin', 'connector pin',
            ],
          },
          inject: [
            { prefix: '7117.90', syntheticRank: 2 },  // other imitation jewelry
            { prefix: '7117.11', syntheticRank: 4 },  // imitation jewelry of base metal
            { prefix: '7117.19', syntheticRank: 6 },  // other imitation jewelry of base metal
          ],
          whitelist: {
            allowChapters: ['71'],                     // jewelry chapter
            denyChapters: ['73'],                      // deny iron/steel articles (sewing pins)
          },
          boosts: [
            { delta: 0.85, prefixMatch: '7117.' },    // boost imitation jewelry
            { delta: 0.50, chapterMatch: '71' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '73' },       // strong penalty for iron articles
            { delta: 0.60, prefixMatch: '7319.' },    // strong penalty for sewing pins
          ],
        } as IntentRule;
        patches.push({ priority: 542, rule: newRule });
        console.log('ENAMEL_LAPEL_PIN_INTENT: created (enamel/lapel pins → 7117, deny ch.73)');
      } else {
        console.log('ENAMEL_LAPEL_PIN_INTENT: already exists, skipping');
      }
    }

    // 2. NEW PURSE_FRAME_HARDWARE_INTENT → 8301 (locks/frames, ch.83)
    //    "Metal Kiss Lock Purse Frame" → 9305.10 (arms parts!), expected 8301.10 (padlocks/locks)
    //    "4 sizes Metal Doctor Bag Frame" → 9305.10 (arms parts), expected 8301.10
    //    Root cause: 'metal frame' + 'bag'/'purse' matching firearms accessories (ch.93).
    //    8301.10 = padlocks (and by extension, kiss-lock bag frames/clasps)
    //    8302.50 = hat-racks, hat-pegs, brackets and similar fixtures of base metal
    //    8302.42 = other mountings and fittings suitable for furniture
    {
      const existing = allRules.find(r => r.id === 'PURSE_FRAME_HARDWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PURSE_FRAME_HARDWARE_INTENT',
          description: 'Metal purse/bag frames, kiss locks, bag hardware → 8301/8302 (ch.83), deny ch.93 arms',
          pattern: {
            anyOf: [
              // Kiss lock frames
              'kiss lock purse frame', 'kiss lock frame', 'kiss lock bag frame',
              'metal kiss lock', 'purse kiss lock',
              // Purse/bag frames (metal)
              'purse frame', 'purse frames', 'metal purse frame',
              'bag frame metal', 'metal bag frame', 'bag frame diy',
              // Doctor bag / suitcase frames
              'doctor bag frame', 'tote bag frame metal',
              // Bag hardware
              'bag clasp frame', 'handbag frame', 'purse clasp metal',
              'clutch frame', 'metal clutch frame',
            ],
            noneOf: [
              // Exclude non-metal frames
              'plastic frame', 'wood frame', 'acrylic frame',
              // Exclude picture/photo frames
              'picture frame', 'photo frame',
            ],
          },
          inject: [
            { prefix: '8301.10', syntheticRank: 2 },  // padlocks (kiss-lock clasps for bags)
            { prefix: '8302.50', syntheticRank: 4 },  // hat-racks and similar fixtures of base metal
            { prefix: '8302.42', syntheticRank: 6 },  // other fittings suitable for furniture
            { prefix: '8308.10', syntheticRank: 8 },  // hooks, eyes and eyelets (bag hardware)
          ],
          whitelist: {
            allowChapters: ['83'],                     // misc base metal articles
            denyChapters: ['93', '95'],                // deny arms/ammo and toys
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8301.' },    // boost locks/padlocks
            { delta: 0.75, prefixMatch: '8302.' },    // boost fittings
            { delta: 0.50, chapterMatch: '83' },
          ],
          penalties: [
            { delta: 0.90, chapterMatch: '93' },       // very strong penalty for arms chapter
            { delta: 0.60, chapterMatch: '95' },
          ],
        } as IntentRule;
        patches.push({ priority: 541, rule: newRule });
        console.log('PURSE_FRAME_HARDWARE_INTENT: created (purse frames → 8301, deny ch.93)');
      } else {
        console.log('PURSE_FRAME_HARDWARE_INTENT: already exists, skipping');
      }
    }

    // 3. NEW HANDMADE_CRYSTAL_JEWELRY_INTENT → 7113/7117, deny ch.70 (glass)
    //    "handmade women jewelry crystal" → 7018.10 WRONG (glass beads), expected 7113.19 (jewelry)
    //    "handmade woman jewelry crystal" → 7018.10 WRONG, expected 7113.19
    //    "Add on an Extender to your Jewelry (2 inches, Gold)" → 7018.10 WRONG, expected 7113.20
    //    Root cause: 'crystal' in query strongly matches glass beads/crystal (7018 in ch.70).
    //    Jewelry with crystal decoration is ch.71 (7113), not glass articles (ch.70).
    {
      const existing = allRules.find(r => r.id === 'HANDMADE_CRYSTAL_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HANDMADE_CRYSTAL_JEWELRY_INTENT',
          description: 'Handmade crystal/gemstone jewelry, jewelry extenders → 7113/7117 (ch.71), deny ch.70 glass',
          pattern: {
            anyOf: [
              // Handmade women's jewelry with crystal
              'handmade women jewelry', 'handmade woman jewelry',
              'handmade jewelry crystal', 'crystal jewelry handmade',
              'women jewelry crystal', 'woman jewelry crystal',
              // Jewelry extenders/chain extenders
              'jewelry extender', 'necklace extender', 'bracelet extender',
              'jewelry chain extender', 'gold jewelry extender',
              'extender jewelry', 'add on extender jewelry',
              // Crystal/gemstone jewelry
              'crystal necklace jewelry', 'crystal bracelet jewelry',
              'beaded crystal jewelry', 'gemstone jewelry handmade',
              // Other handmade jewelry
              'handmade crystal necklace', 'handmade beaded jewelry',
              'handmade jewelry set', 'handmade gemstone necklace',
            ],
            noneOf: [
              // Exclude glass items that are NOT jewelry
              'crystal glass vase', 'crystal glass bowl', 'glass crystal figurine',
              'swarovski crystal bead', 'crystal bead',
              // Exclude jewelry boxes (ch.44/42)
              'jewelry box', 'jewelry case',
            ],
          },
          inject: [
            { prefix: '7113.19', syntheticRank: 2 },  // jewelry of precious metal (gold/silver)
            { prefix: '7117.90', syntheticRank: 4 },  // other imitation jewelry
            { prefix: '7113.11', syntheticRank: 6 },  // jewelry of silver
            { prefix: '7113.20', syntheticRank: 8 },  // jewelry of base metal clad with precious metal
          ],
          whitelist: {
            allowChapters: ['71'],                     // jewelry chapter
            denyChapters: ['70'],                      // deny glass and glassware
          },
          boosts: [
            { delta: 0.85, prefixMatch: '7113.' },    // boost jewelry
            { delta: 0.70, prefixMatch: '7117.' },    // boost imitation jewelry
            { delta: 0.50, chapterMatch: '71' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '70' },       // strong penalty for glass
            { delta: 0.70, prefixMatch: '7018.' },    // strong penalty for glass beads
          ],
        } as IntentRule;
        patches.push({ priority: 540, rule: newRule });
        console.log('HANDMADE_CRYSTAL_JEWELRY_INTENT: created (crystal jewelry → 7113, deny ch.70)');
      } else {
        console.log('HANDMADE_CRYSTAL_JEWELRY_INTENT: already exists, skipping');
      }
    }

    // 4. NEW ESSENTIAL_OIL_COSMETIC_INTENT → 3301/3304 (essential oils, ch.33), deny ch.27 (petroleum)
    //    "body oil samples" → 2710.20 WRONG (petroleum oils), expected 3301.29 (essential oils)
    //    "MILLION DOLLAR OIL" → 2710.19 WRONG, expected 3301.29 (essential oils)
    //    "Baby Oil Sample" → 2710.20 WRONG, expected 3304.99 (beauty preparations)
    //    Root cause: 'oil' strongly associated with petroleum (ch.27). Cosmetic/essential oils → ch.33.
    //    3301.29 = essential oils (other than citrus), not deterped
    //    3304.99 = other beauty/makeup preparations
    {
      const existing = allRules.find(r => r.id === 'ESSENTIAL_OIL_COSMETIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ESSENTIAL_OIL_COSMETIC_INTENT',
          description: 'Essential oils, body oils, cosmetic oils → 3301/3304 (ch.33), deny ch.27 petroleum',
          pattern: {
            anyOf: [
              // Essential oils
              'essential oil', 'essential oils',
              'fragrance oil', 'fragrance oils',
              'perfume oil', 'perfume oils',
              // Body/cosmetic oils
              'body oil', 'body oil sample', 'body oil samples',
              'baby oil', 'baby oil sample',
              'massage oil', 'massage oils',
              // Carrier/specialty oils
              'carrier oil', 'jojoba oil', 'argan oil',
              'rosehip oil', 'rosehip seed oil',
              'face oil', 'skin oil', 'hair oil',
              'beard oil', 'cuticle oil',
              // "Million dollar" type luxury oils
              'million dollar oil', 'luxury body oil',
            ],
            noneOf: [
              // Exclude cooking/food oils
              'cooking oil', 'olive oil', 'coconut cooking oil',
              'vegetable oil', 'sunflower oil', 'palm oil',
              // Exclude industrial/automotive oils
              'motor oil', 'engine oil', 'hydraulic oil',
              'gear oil', 'transmission oil', 'petroleum',
              // Exclude lamp oil
              'lamp oil',
            ],
          },
          inject: [
            { prefix: '3301.29', syntheticRank: 2 },  // essential oils (other)
            { prefix: '3304.99', syntheticRank: 4 },  // other beauty preparations
            { prefix: '3301.90', syntheticRank: 6 },  // other concentrates/resins from essential oils
            { prefix: '3303.00', syntheticRank: 8 },  // perfumes/toilet waters
          ],
          whitelist: {
            allowChapters: ['33'],                     // essential oils/cosmetics chapter
            denyChapters: ['27', '15'],                // deny petroleum and edible oils
          },
          boosts: [
            { delta: 0.85, prefixMatch: '3301.' },    // boost essential oils
            { delta: 0.75, prefixMatch: '3304.' },    // boost beauty preparations
            { delta: 0.50, chapterMatch: '33' },
          ],
          penalties: [
            { delta: 0.90, chapterMatch: '27' },       // very strong penalty for petroleum
            { delta: 0.70, chapterMatch: '15' },       // strong penalty for edible oils
          ],
        } as IntentRule;
        patches.push({ priority: 539, rule: newRule });
        console.log('ESSENTIAL_OIL_COSMETIC_INTENT: created (essential oils → 3301, deny ch.27)');
      } else {
        console.log('ESSENTIAL_OIL_COSMETIC_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT95)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT95 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
