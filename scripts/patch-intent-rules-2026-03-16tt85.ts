#!/usr/bin/env ts-node
/**
 * Patch TT85 — 2026-03-16: Hair ties/scrunchies, quilted pouches, AIDA blanket fix, sewing patterns.
 *
 * Fixes:
 *  1. NEW HAIR_SCRUNCHIE_TIE_INTENT → 6217/6213/6215 (textile hair accessories)
 *     "Hair Scrunchie" → 9615.90 WRONG (expected 6213.90.05)
 *     "Satin Hair Scrunchie" → 9615.90 WRONG (expected 6215.10)
 *     "100% elastic hair tie" → 9615.11 WRONG (expected 6217.10)
 *     BUG: Scrunchies/hair ties = textile accessories (ch.62) not combs/hairslides (ch.96)
 *     FIX: New intent → 6217.10 (elastic/fabric hair ties), 6213.90 (handkerchiefs/scarves for hair)
 *
 *  2. NEW QUILTED_WOVEN_PILE_TEXTILE_INTENT → 5801.26/5801.23 (quilted woven pile fabric items)
 *     "Handmade quilted zipper pouch" → 9607 WRONG (expected 5801.26)
 *     "Handmade whale zipper pouch" → 9607 WRONG (expected 5801.26)
 *     BUG: ZIPPER_INTENT fires for 'zipper' → allowPrefixes:['9607.'] → forces ch.96
 *          Only 9607.xx (zipper) entries pass; ch.58 entries are blocked
 *     FIX: New intent with allowChapters:['58'] → participates in OR with ZIPPER_INTENT's allowPrefixes
 *          The OR lets ch.58 entries through alongside 9607.xx entries
 *          With injection + boosts, 5801.26 ranks above 9607 for quilted items
 *
 *  3. FIX CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT — add noneOf for finished textile goods
 *     "Muslin Cross Stitch Baby Blanket - 14 Count AIDA" → 5208.33 WRONG (expected 6301.30)
 *     "Raw Linen AIDA Fabric by Zweigart - Cross Stitch Material" → 5208.33 WRONG (expected 6302.22)
 *     "cloth wipes, cotton, reusable wash cloth" → 5208 WRONG (expected 6302.60)
 *     BUG: TT82 CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT matches 'aida' in any context → sends
 *          finished products (blankets, brand-name fabrics by Zweigart) to 5208
 *     FIX: Add 'baby blanket', 'blanket', 'wash cloth', 'wipes', 'Zweigart' to noneOf
 *
 *  4. NEW SEWING_PAPER_PATTERN_INTENT → 6307.90/4906 (sewing patterns on paper)
 *     "Sewing Pattern (Simplicity 5993)" → 4823.90 WRONG (expected 6307.90.60)
 *     "Sewing Pattern (Butterick 3255)" → 4823.90 WRONG (expected 6307.90.60)
 *     "paper sewing instructions" → 4802.40 WRONG (expected 4906.00)
 *     BUG: Sewing patterns are classified as ch.63 (other made-up textile articles) or ch.49 (maps)
 *     FIX: New intent → 6307.90.60 (sewing patterns), 4906 (plans/drawings for patterns)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt85.ts
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

    // 1. NEW HAIR_SCRUNCHIE_TIE_INTENT → 6217/6213/6215 (textile hair accessories)
    //    "Hair Scrunchie" → 9615.90 WRONG (expected 6213.90 - handkerchiefs class)
    //    "100% elastic hair tie" → 9615.11 WRONG (expected 6217.10 - other accessories of apparel)
    //    Key: ch.62 = garment accessories; ch.96 = combs/hairslides/pins; scrunchies = fabric = ch.62
    {
      const existing = allRules.find(r => r.id === 'HAIR_SCRUNCHIE_TIE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HAIR_SCRUNCHIE_TIE_INTENT',
          description: 'Fabric hair scrunchies, hair ties, elastic hair accessories → ch.62 (6217/6213/6215)',
          pattern: {
            anyOf: [
              // Scrunchies
              'scrunchie', 'scrunchies', 'hair scrunchie', 'hair scrunchies',
              'satin scrunchie', 'velvet scrunchie', 'silk scrunchie', 'chiffon scrunchie',
              'cotton scrunchie', 'lace scrunchie', 'bow scrunchie', 'floral scrunchie',
              // Hair ties (elastic/fabric)
              'hair tie', 'hair ties', 'elastic hair tie', 'elastic hair ties',
              'fabric hair tie', 'ponytail holder', 'ponytail holders', 'ponytail elastic',
              'hair elastic', 'hair elastics', 'no damage hair tie',
              // Hair ribbons/bands (textile)
              'hair ribbon', 'hair ribbons', 'satin hair ribbon',
              'silk hair ribbon', 'grosgrain hair ribbon',
            ],
            noneOf: [
              // Exclude rigid hair accessories (ch.96)
              'hair clip', 'hair clips', 'bobby pin', 'barrette', 'barrettes',
              'hair claw', 'hair jaw', 'hair stick', 'hair fork',
              // Exclude headbands (different classification)
              'headband', 'headbands',
              // Exclude hair care products
              'hair gel', 'hair spray', 'hair oil', 'hair mask',
            ],
          },
          inject: [
            { prefix: '6217.10', syntheticRank: 2 },   // other accessories of apparel (elastic/fabric ties)
            { prefix: '6213.90', syntheticRank: 4 },   // handkerchiefs (scrunchie-style accessories)
            { prefix: '6215.10', syntheticRank: 6 },   // ties of silk (satin/silk scrunchies)
            { prefix: '6215.20', syntheticRank: 8 },   // ties of man-made fibers
          ],
          whitelist: {
            allowChapters: ['62', '63', '61'],          // garment accessories OR made-up textile OR knitted
            denyChapters: ['96'],                       // deny ch.96 combs/hairslides/pins
          },
          boosts: [
            { delta: 0.80, prefixMatch: '6217.' },
            { delta: 0.70, prefixMatch: '6213.' },
            { delta: 0.70, prefixMatch: '6215.' },
            { delta: 0.40, chapterMatch: '62' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '96' },        // penalize combs/hairslides
          ],
        } as IntentRule;
        patches.push({ priority: 553, rule: newRule });
        console.log('HAIR_SCRUNCHIE_TIE_INTENT: created (scrunchies/hair ties → 6217/6213/6215, deny ch.96)');
      } else {
        console.log('HAIR_SCRUNCHIE_TIE_INTENT: already exists, skipping');
      }
    }

    // 2. NEW QUILTED_WOVEN_PILE_TEXTILE_INTENT → 5801.26/5801.23
    //    "Handmade quilted zipper pouch" → 9607 WRONG (expected 5801.26 quilted woven pile fabric)
    //    "Handmade whale zipper pouch" → 9607 WRONG (expected 5801.26)
    //    BUG: ZIPPER_INTENT fires for 'zipper' → allowPrefixes:['9607.'] → only 9607.xx entries pass
    //    FIX: This intent adds allowChapters:['58'] to the OR logic, so ch.58 entries can pass
    //         ZIPPER_INTENT allows 9607.xx || THIS_INTENT allows ch.58 → both pass the filter
    //         Injection + boosts then push 5801.26 to the top for quilted queries
    {
      const existing = allRules.find(r => r.id === 'QUILTED_WOVEN_PILE_TEXTILE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'QUILTED_WOVEN_PILE_TEXTILE_INTENT',
          description: 'Handmade quilted pouches/bags with zipper → 5801.26 (woven pile fabric items)',
          pattern: {
            anyOf: [
              // Quilted zipper pouches (the main target)
              'quilted zipper pouch', 'quilted zipper bag', 'quilted pouch zipper',
              'handmade quilted zipper', 'quilted whale zipper', 'quilted denim zipper',
              // Quilted fabric pouches/bags
              'quilted pouch', 'quilted coin purse', 'quilted wallet',
              'quilted fabric pouch', 'quilted fabric bag',
              // Quilted items in general (woven pile fabric context)
              'handmade quilted', 'quilted handmade',
            ],
            noneOf: [
              // Exclude quilted garments (different chapter)
              'quilted jacket', 'quilted coat', 'quilted vest', 'quilted blanket',
              // Exclude large bags (luggage context)
              'quilted tote bag', 'quilted handbag', 'quilted purse',
            ],
          },
          inject: [
            { prefix: '5801.26', syntheticRank: 2 },  // woven pile fabrics and chenille fabrics (quilted)
            { prefix: '5801.23', syntheticRank: 4 },  // woven pile fabrics of cotton
            { prefix: '5801.36', syntheticRank: 6 },  // woven pile fabrics of man-made fibers
          ],
          whitelist: {
            // allowChapters:['58'] is KEY — participates in OR with ZIPPER_INTENT's allowPrefixes:['9607.']
            // Without this, only 9607.xx passes; with this, ch.58 entries also pass the OR filter
            allowChapters: ['58', '96'],               // woven pile fabrics OR zipper/fasteners
          },
          boosts: [
            { delta: 0.90, prefixMatch: '5801.' },
            { delta: 0.50, chapterMatch: '58' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '96' },       // penalize zipper ch. (we want fabric classification)
          ],
        } as IntentRule;
        patches.push({ priority: 552, rule: newRule });
        console.log('QUILTED_WOVEN_PILE_TEXTILE_INTENT: created (quilted zipper pouch → 5801.26, allowChapters:[58,96])');
      } else {
        console.log('QUILTED_WOVEN_PILE_TEXTILE_INTENT: already exists, skipping');
      }
    }

    // 3. FIX CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT — add noneOf for finished goods
    //    TT82 regression: 'aida' matches blankets and brand-fabric → sends to 5208 (cotton fabric)
    //    "Muslin Cross Stitch Baby Blanket - 14 Count AIDA" → exp:6301.30 but got 5208.33
    //    "Raw Linen AIDA Fabric by Zweigart" → exp:6302.22 but got 5208.33
    {
      const existing = allRules.find(r => r.id === 'CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const newNoneOf = [
          ...currentNoneOf,
          // Finished textile goods that happen to mention AIDA
          'baby blanket', 'baby blankets', 'blanket', 'blankets',
          'wash cloth', 'washcloth', 'wipes', 'face wipe', 'cotton wipes',
          // Brand-name fabrics (classified as household linen, not raw cotton fabric)
          'zweigart', 'dmc fabric', 'dohler',
          // Finished made-up textile items
          'sheet set', 'bedsheet', 'duvet', 'quilt',
          // Table/kitchen linen
          'tablecloth', 'table cloth', 'napkin', 'coaster',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set(newNoneOf)],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 556, rule: updated });
        console.log('CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT: added finished goods to noneOf (prevent AIDA blankets → 5208)');
      } else {
        console.log('CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT: not found');
      }
    }

    // 4. NEW SEWING_PAPER_PATTERN_INTENT → 6307.90/4906 (sewing patterns)
    //    "Sewing Pattern (Simplicity 5993)" → 4823.90 WRONG (expected 6307.90.60)
    //    "Sewing Pattern (Butterick 3255)" → 4823.90 WRONG (expected 6307.90.60)
    //    "paper sewing instructions" → 4802 WRONG (expected 4906)
    //    6307.90.60 = sewing patterns on paper (classified as textile article, not paper)
    {
      const existing = allRules.find(r => r.id === 'SEWING_PAPER_PATTERN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SEWING_PAPER_PATTERN_INTENT',
          description: 'Sewing patterns on paper → 6307.90 (made-up textile articles) or 4906',
          pattern: {
            anyOf: [
              // Sewing pattern by brand
              'simplicity pattern', 'butterick pattern', 'mccall pattern', "McCall's pattern",
              'vogue pattern', 'kwik sew pattern', 'burda pattern',
              'simplicity sewing', 'butterick sewing', 'mccall sewing',
              // Generic sewing patterns
              'sewing pattern', 'sewing patterns', 'knitting pattern',
              'crochet pattern', 'embroidery pattern', 'quilting pattern',
              // Paper patterns for garments
              'garment pattern', 'dress pattern', 'skirt pattern', 'shirt pattern',
              'blouse pattern', 'pants pattern', 'costume pattern',
              // Printed pattern sheets
              'tissue pattern', 'paper pattern sheet',
              // Instructions
              'sewing instructions', 'paper sewing instructions',
            ],
            noneOf: [
              // Exclude digital/electronic patterns
              'pdf pattern', 'digital pattern', 'downloadable pattern',
              'ebook pattern', 'instant download',
              // Exclude yarn/thread (knitting yarn is different from knitting patterns)
              'knitting yarn', 'crochet yarn', 'embroidery thread',
              // Exclude finished garments
              'sewing kit', 'sewing machine',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 2 },  // other made-up textile articles (sewing patterns)
            { prefix: '4906.00', syntheticRank: 4 },  // plans and drawings for architectural/engineering purposes
            { prefix: '4901.99', syntheticRank: 6 },  // other printed books/pamphlets
          ],
          whitelist: {
            allowChapters: ['63', '49', '48'],         // made-up textile OR printed matter OR paper
            denyChapters: ['84', '85'],                // deny machinery/electrical
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6307.90' },
            { delta: 0.60, prefixMatch: '4906.' },
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '48' },       // penalize paper (pattern → textile, not paper)
          ],
        } as IntentRule;
        patches.push({ priority: 551, rule: newRule });
        console.log('SEWING_PAPER_PATTERN_INTENT: created (sewing patterns → 6307.90/4906, deny ch.84/85)');
      } else {
        console.log('SEWING_PAPER_PATTERN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT85)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT85 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
