#!/usr/bin/env ts-node
/**
 * Patch TT90 — 2026-03-16: Felt garland 5602 fix, fridge magnets, wool inject 5106.20, cotton swabs, stretch lace.
 *
 * Fixes:
 *  1. UPDATE FELT_GARLAND_TEXTILE_DECOR_INTENT — inject 5602.10 at highest rank, add allowChapters:['56']
 *     "5' Felt Ball Garland" → 6304.99 WRONG (expected 5602.10.90 - nonwoven felt)
 *     "Handmade St. Patrick's Day Felt Garland" → 6304.99 WRONG (expected 5602.10.90)
 *     "Hand stitched custom name felt garland" → 6304.99 WRONG (expected 5602.10.90)
 *     BUG: FELT_GARLAND_TEXTILE_DECOR_INTENT routes to 6304 (furnishing articles) but dataset
 *          classifies felt garlands/felt products as 5602 (nonwoven felt fabric).
 *     FIX: Add inject 5602.10 at rank 1 (highest), allowChapters:['56'], boost 5602.
 *
 *  2. NEW DECORATIVE_FRIDGE_MAGNET_INTENT → 8505.19/8505.11 (permanent magnets)
 *     "Arizona vintage fridge plastic magn" → 3926.90 WRONG (expected 8505.11.00)
 *     "Bag of Magnetic Dicks | 3D Printed Gag Gift" → 3926.90 WRONG (expected 8505.19.30)
 *     BUG: Decorative/novelty magnets classified as plastic articles (3926) not permanent magnets (8505)
 *     8505.11 = permanent magnets of metal; 8505.19 = other permanent magnets (ferrite, fridge magnets)
 *     FIX: New intent → 8505.19/8505.11, allowChapters:['85']
 *
 *  3. UPDATE WOOL_YARN_FIBER_INTENT — add 5106.20 (combed wool, >85%) to inject
 *     "300g 75%wool/25%nylon knitting yarn" → 5205.26 WRONG (expected 5106.20)
 *     "100g 75%wool/25%nylon knitting yarn" → 5205.26 WRONG (expected 5106.20)
 *     BUG: inject has 5106.10 (carded wool yarn, rank6) but expected is 5106.20 (combed wool yarn).
 *          5106.10 = carded wool yarn, ≥85%; 5106.20 = combed wool yarn, ≥85%
 *     FIX: Add 5106.20 to inject at rank 5 (between 5109.90 and 5106.10)
 *
 *  4. NEW COTTON_SWAB_WADDING_INTENT → 5601.21/5601.29 (cotton wadding/swabs)
 *     "DNA test kit (cotton swab)" → 6302.40 WRONG (expected 5601.21)
 *     "cotton swab" type items → 5601 (wadding, wicks, textile flock)
 *     5601.21 = cotton wadding; 5601.29 = other wadding of textile materials
 *     FIX: New intent → 5601.21/5601.29, allowChapters:['56']
 *
 *  5. UPDATE SWIMWEAR_KNIT_FABRIC_INTENT — add stretch lace phrases → 6002/6006
 *     "stretch lace fabric" → 5804 WRONG (expected 6002/6006 knitted fabric)
 *     "guipure stretch lace" → 5804 WRONG
 *     BUG: Stretch/elastic lace classified as woven lace (5804) not knitted fabric (6002/6006)
 *     FIX: Add stretch lace phrases to SWIMWEAR_KNIT_FABRIC_INTENT anyOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt90.ts
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

    // 1. UPDATE FELT_GARLAND_TEXTILE_DECOR_INTENT — inject 5602.10 at highest rank, add ch.56
    //    Dataset classifies felt garlands as 5602 (nonwoven felt), not 6304 (furnishing articles).
    //    5602.10 = needleloom felt and stitch-bonded fibre fabrics (includes felt balls/garlands)
    //    5602.21/5602.29/5602.90 = other felt products
    {
      const existing = allRules.find(r => r.id === 'FELT_GARLAND_TEXTILE_DECOR_INTENT');
      if (existing) {
        const currentWhitelist = (existing as any).whitelist || {};
        const currentAllow = currentWhitelist.allowChapters || [];
        const currentBoosts = (existing as any).boosts || [];
        const updated = {
          ...existing,
          inject: [
            { prefix: '5602.10', syntheticRank: 1 },  // needleloom felt (felt balls/garlands)
            { prefix: '5602.90', syntheticRank: 3 },  // other felt
            { prefix: '6304.99', syntheticRank: 5 },  // furnishing articles of other textile
            { prefix: '6304.91', syntheticRank: 7 },  // furnishing articles, knitted/crocheted
            { prefix: '6307.90', syntheticRank: 9 },  // other made-up textile articles
          ],
          whitelist: {
            ...currentWhitelist,
            allowChapters: [...new Set([...currentAllow, '56', '63', '62', '58'])],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '5602.' },    // strong boost for nonwoven felt
            { delta: 0.85, prefixMatch: '6304.' },
            { delta: 0.40, chapterMatch: '63' },
            { delta: 0.35, chapterMatch: '56' },
          ],
          penalties: [
            ...(existing as any).penalties || [],
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 547, rule: updated });
        console.log('FELT_GARLAND_TEXTILE_DECOR_INTENT: added 5602.10 inject at rank1, allowChapters:56');
      } else {
        console.log('FELT_GARLAND_TEXTILE_DECOR_INTENT: not found');
      }
    }

    // 2. NEW DECORATIVE_FRIDGE_MAGNET_INTENT → 8505.19/8505.11 (permanent magnets)
    //    "Arizona vintage fridge plastic magn" → 3926.90 WRONG (expected 8505.11.00)
    //    "Bag of Magnetic Dicks | 3D Printed Gag Gift" → 3926.90 WRONG (expected 8505.19.30)
    //    8505.11 = permanent magnets of metal
    //    8505.19 = other permanent magnets (incl. ferrite/ceramic fridge magnets)
    {
      const existing = allRules.find(r => r.id === 'DECORATIVE_FRIDGE_MAGNET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DECORATIVE_FRIDGE_MAGNET_INTENT',
          description: 'Decorative/novelty/fridge magnets → 8505.19/8505.11 (permanent magnets, ch.85)',
          pattern: {
            anyOf: [
              // Fridge magnets
              'fridge magnet', 'fridge magnets', 'refrigerator magnet', 'refrigerator magnets',
              'fridge plastic magn', 'magnetic fridge', 'magnet fridge',
              // Souvenir/decorative magnets
              'souvenir magnet', 'souvenir magnets', 'decorative magnet', 'decorative magnets',
              'novelty magnet', 'novelty magnets',
              // Magnetic novelties
              'magnetic souvenir', 'magnetic novelty',
              // Photo magnets
              'photo magnet', 'photo magnets', 'picture magnet',
              // Specific magnet types (as noun, implying the product itself)
              'magnet souvenir',
            ],
            noneOf: [
              // Exclude magnetic accessories/tools
              'magnetic strip', 'magnetic tape', 'magnetic closure', 'magnetic clasp',
              'magnetic therapy', 'magnetic bracelet',
              // Exclude magnetic boards/surfaces
              'magnetic board', 'magnetic whiteboard', 'dry erase',
              // Exclude magnetic bags/accessories
              'magnetic bag', 'magnetic purse',
              // Exclude electronic magnetic components
              'electromagnet', 'magnetic coil', 'motor magnet',
            ],
          },
          inject: [
            { prefix: '8505.19', syntheticRank: 2 },  // other permanent magnets (ferrite fridge magnets)
            { prefix: '8505.11', syntheticRank: 4 },  // permanent magnets of metal
            { prefix: '8505.90', syntheticRank: 6 },  // parts of electromagnets/permanent magnets
          ],
          whitelist: {
            allowChapters: ['85'],                     // electromagnetic/electrical equipment only
            denyChapters: ['39', '42'],                // deny plastic articles and bags
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8505.1' },
            { delta: 0.50, chapterMatch: '85' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '39' },       // penalize plastic articles
            { delta: 0.60, chapterMatch: '42' },       // penalize leather goods
          ],
        } as IntentRule;
        patches.push({ priority: 544, rule: newRule });
        console.log('DECORATIVE_FRIDGE_MAGNET_INTENT: created (fridge/decorative magnets → 8505.19, ch.85)');
      } else {
        console.log('DECORATIVE_FRIDGE_MAGNET_INTENT: already exists, skipping');
      }
    }

    // 3. UPDATE WOOL_YARN_FIBER_INTENT — add 5106.20 (combed wool yarn, ≥85%) to inject
    //    "300g 75%wool/25%nylon knitting yarn" → 5205.26 WRONG (expected 5106.20)
    //    Current inject has 5106.10 (carded) but NOT 5106.20 (combed).
    //    5106.10 = carded wool yarn (wool that has been carded, ≥85% wool)
    //    5106.20 = combed wool yarn (worsted-process, ≥85% wool)
    //    Most commercial "knitting yarn" is combed (worsted), so 5106.20 is the better match.
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '5109.10', syntheticRank: 2 },  // wool yarn, carded, put up for retail
            { prefix: '5109.90', syntheticRank: 4 },  // other wool yarn, put up for retail
            { prefix: '5106.20', syntheticRank: 5 },  // combed wool yarn, ≥85%, not for retail
            { prefix: '5106.10', syntheticRank: 6 },  // carded wool yarn, ≥85%, not for retail
            { prefix: '5107.10', syntheticRank: 8 },  // combed wool yarn, <85% wool
            { prefix: '5108.10', syntheticRank: 10 }, // yarn of fine animal hair (mohair, cashmere)
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('WOOL_YARN_FIBER_INTENT: added 5106.20 (combed wool yarn) to inject at rank5');
      } else {
        console.log('WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // 4. NEW COTTON_SWAB_WADDING_INTENT → 5601.21/5601.29 (cotton wadding/swabs)
    //    "DNA test kit (cotton swab)" → 6302.40 WRONG (expected 5601.21)
    //    5601.21 = cotton wadding (includes cotton swabs/balls/pads)
    //    5601.29 = wadding of other textile materials
    {
      const existing = allRules.find(r => r.id === 'COTTON_SWAB_WADDING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_SWAB_WADDING_INTENT',
          description: 'Cotton swabs, cotton balls, cotton pads, wadding products → 5601.21 (cotton wadding)',
          pattern: {
            anyOf: [
              // Cotton swabs (including DNA/medical swabs)
              'cotton swab', 'cotton swabs', 'dna swab', 'dna test kit cotton',
              'swab kit', 'cotton tipped swab', 'medical cotton swab',
              // Cotton balls/pads
              'cotton ball', 'cotton balls', 'cotton pad', 'cotton pads',
              'cotton round', 'cotton rounds', 'cotton disc', 'cotton discs',
              // Cotton wool/wadding
              'cotton wool', 'cotton wadding', 'cosmetic cotton',
              'cotton wipe', 'cotton wipes', 'cotton makeup pad',
              // Fiberfill/stuffing
              'polyester fiberfill', 'pillow stuffing', 'toy stuffing',
              'craft stuffing', 'fiberfill stuffing',
            ],
            noneOf: [
              // Exclude cotton fabric/yarn
              'cotton fabric', 'cotton yarn', 'cotton thread', 'cotton cloth',
              // Exclude electronic/digital
              'digital', 'electronic', 'battery',
              // Exclude makeup (cosmetic products)
              'makeup remover pad',  // these are cosmetic products, not raw textile
            ],
          },
          inject: [
            { prefix: '5601.21', syntheticRank: 2 },  // cotton wadding (incl. swabs/balls/pads)
            { prefix: '5601.29', syntheticRank: 4 },  // wadding of other textile materials
            { prefix: '5601.22', syntheticRank: 6 },  // man-made fiber wadding
          ],
          whitelist: {
            allowChapters: ['56'],                     // wadding, felt, nonwovens
            denyChapters: ['63'],                      // deny made-up textile articles (towels etc)
          },
          boosts: [
            { delta: 0.85, prefixMatch: '5601.' },
            { delta: 0.40, chapterMatch: '56' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '63' },       // penalize household textiles
            { delta: 0.60, chapterMatch: '62' },       // penalize woven garments
          ],
        } as IntentRule;
        patches.push({ priority: 543, rule: newRule });
        console.log('COTTON_SWAB_WADDING_INTENT: created (cotton swabs/balls/wadding → 5601.21, ch.56)');
      } else {
        console.log('COTTON_SWAB_WADDING_INTENT: already exists, skipping');
      }
    }

    // 5. UPDATE SWIMWEAR_KNIT_FABRIC_INTENT — add stretch lace phrases → 6002/6006
    //    "stretch lace fabric" → 5804 WRONG (expected 6002/6006 knitted fabric)
    //    "guipure stretch lace" → 5804 WRONG (stretch lace is knitted, not woven lace)
    //    5804 = tulles, lacemaking (woven/mechanically produced lace)
    //    6002 = knitted or crocheted fabrics of a width ≤30 cm (incl. elastic/stretch lace)
    //    6006 = other knitted or crocheted fabrics
    {
      const existing = allRules.find(r => r.id === 'SWIMWEAR_KNIT_FABRIC_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const stretchLacePhrases = [
          // Stretch lace (knitted, elastic)
          'stretch lace', 'stretch lace fabric', 'elastic lace',
          'lycra lace', 'spandex lace', 'knit lace',
          'stretch lace trim', 'lingerie lace fabric',
          // Guipure stretch
          'guipure stretch', 'guipure stretch lace',
          // Mesh/net stretch fabrics
          'stretch mesh', 'stretch mesh fabric', 'athletic mesh',
          'compression mesh', 'stretch net fabric',
          // Tulle stretch
          'stretch tulle', 'knit tulle',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...stretchLacePhrases])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 546, rule: updated });
        console.log('SWIMWEAR_KNIT_FABRIC_INTENT: added stretch lace/elastic lace phrases → 6002/6006');
      } else {
        console.log('SWIMWEAR_KNIT_FABRIC_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT90)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT90 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
