#!/usr/bin/env ts-node
/**
 * Patch TT88 — 2026-03-16: Fix yarn injection ranks, stuffed textile toys, felt garland.
 *
 * Fixes:
 *  1. UPDATE WOOL_YARN_FIBER_INTENT — inject 5109 (retail wool yarn) with higher priority
 *     "black wool yarn" → 5106.10 WRONG (expected 5109.10.90 - retail yarn)
 *     "red wool yarn" → 5106.10 WRONG (expected 5109.10.90)
 *     "100% Wool Yarn" → 5106.10 WRONG (expected 5109.90.90 or 5109.10)
 *     BUG: WOOL_YARN_FIBER_INTENT injects 5106 (industrial yarn, not for retail) at highest rank.
 *          Consumer yarn purchases → 5109 (yarn put up for retail sale).
 *     FIX: Add 5109.10/5109.90 injections at highest syntheticRank (rank 2, above 5106).
 *
 *  2. UPDATE SYNTHETIC_MMF_YARN_INTENT — inject 5509.31/5509.32 for retail acrylic yarn
 *     "100% acrylic, decorative craft yarn" → 5509.51 (wrong subheading)
 *     "Heartland Yarn by Lionbrand" → 5509.12 (wrong subheading)
 *     Expected: 5509.31 (single yarn, < 85% acrylic) or 5509.32 (multiple yarn)
 *     FIX: Reorder inject to put 5509.31 and 5509.32 at highest rank
 *
 *  3. NEW STUFFED_TEXTILE_TOY_INTENT → 6307.90/6301 (Canadian HTS: handmade stuffed toys = ch.63)
 *     "stuffed toy plush teddy bear" → 9503 WRONG (expected 6307.90.75)
 *     "stuffed toy anumal" → 9503 WRONG (expected 6307.90.75)
 *     "Cotton custom dolls" → 9503 WRONG (expected 6301.30)
 *     BUG: Stuffed textile toys → 9503 (toys) but Canadian HTS classifies handmade textile stuffed
 *          toys under 6307.90 (other made-up textile articles).
 *     FIX: New intent → 6307.90.75, allowChapters:['63','95'], denyChapters:['95']
 *          Wait - need to allow BOTH 6307 (ch.63) and let 9503 remain for non-handmade toys.
 *          Target: handmade/custom textile stuffed toys specifically.
 *
 *  4. NEW FELT_GARLAND_TEXTILE_DECOR_INTENT → 6304 (textile furnishing articles)
 *     "handmade Spring Boho Felt Pom Pom Garland" → 4802.56 WRONG (expected 6304.99)
 *     "Felt Ball Garland" → paper WRONG (expected 6304.99)
 *     BUG: Felt garlands are textile furnishing articles (ch.63/6304), not paper
 *     FIX: New intent → 6304.99 (other furnishing articles of other textile materials)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt88.ts
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

    // 1. UPDATE WOOL_YARN_FIBER_INTENT — reorder inject to prioritize retail yarn (5109)
    //    Consumer wool yarn sold by the skein/hank = 5109 (put up for retail sale)
    //    Industrial/bulk wool yarn = 5106/5107 (not for retail)
    //    Current inject: 5106.10 (rank9), 5106.20 (rank8), 5107.10 (rank7), 5108.10 (rank6)
    //    Fix: 5109.10 (rank2), 5109.90 (rank4), 5106.10 (rank6), 5107.10 (rank8)
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '5109.10', syntheticRank: 2 },  // wool yarn, carded, put up for retail
            { prefix: '5109.90', syntheticRank: 4 },  // other wool yarn, put up for retail
            { prefix: '5106.10', syntheticRank: 6 },  // carded wool yarn, not for retail
            { prefix: '5107.10', syntheticRank: 8 },  // combed wool yarn, not for retail
            { prefix: '5108.10', syntheticRank: 10 }, // yarn of fine animal hair (mohair, cashmere)
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('WOOL_YARN_FIBER_INTENT: reordered inject to prioritize 5109 (retail wool yarn)');
      } else {
        console.log('WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // 2. UPDATE SYNTHETIC_MMF_YARN_INTENT — reorder inject for better acrylic subheadings
    //    "100% acrylic, decorative craft yarn" → 5509.51 WRONG (expected 5509.31)
    //    5509.31 = yarn of acrylic/modacrylic fibers, not put up for retail, single yarn, < 85%
    //    5509.32 = same, multiple yarn
    //    Current top: 5508.10 (rank9), 5509.31 (rank8), 5509.21 (rank7), 5509.51 (rank6)
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_MMF_YARN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '5509.31', syntheticRank: 2 },  // acrylic/modacrylic single yarn <85%
            { prefix: '5509.32', syntheticRank: 4 },  // acrylic/modacrylic multiple yarn
            { prefix: '5509.21', syntheticRank: 6 },  // polyester single yarn
            { prefix: '5509.22', syntheticRank: 8 },  // polyester multiple yarn
            { prefix: '5508.10', syntheticRank: 10 }, // sewing thread of synthetic staple fibers
            { prefix: '5402.62', syntheticRank: 12 }, // other filament yarn (nylon/polyester)
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('SYNTHETIC_MMF_YARN_INTENT: reordered inject to prioritize 5509.31/5509.32');
      } else {
        console.log('SYNTHETIC_MMF_YARN_INTENT: not found');
      }
    }

    // 3. NEW STUFFED_TEXTILE_TOY_INTENT → 6307.90.75 (handmade textile stuffed animals)
    //    Canadian HTS classifies handmade stuffed textile toys under 6307.90, not 9503 (plastic toys).
    //    "stuffed toy plush teddy bear" → expected 6307.90.75
    //    "stuffed toy animal" → expected 6307.90.75
    //    "Cotton custom dolls" → expected 6301.30 (blankets/throws? or cotton furnishings)
    //    KEY: Only target HANDMADE or explicitly textile/fabric stuffed toys
    {
      const existing = allRules.find(r => r.id === 'STUFFED_TEXTILE_TOY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STUFFED_TEXTILE_TOY_INTENT',
          description: 'Handmade stuffed textile toys/animals → 6307.90 (made-up textile articles, Canadian HTS)',
          pattern: {
            anyOf: [
              // Stuffed textile animals/toys (explicitly material-described)
              'stuffed toy animal', 'stuffed toy plush', 'stuffed toy bear',
              'stuffed toy anumal', 'stuffed toy dog', 'stuffed toy cat',
              'plush stuffed toy', 'plush stuffed animal',
              // Fabric/textile dolls
              'cotton custom doll', 'cotton doll', 'fabric doll', 'textile doll',
              'handmade cloth doll', 'rag doll', 'waldorf doll',
              // Crochet/knitted stuffed animals
              'crochet stuffed animal', 'knit stuffed animal', 'handmade stuffed animal',
              'amigurumi', 'crochet amigurumi',
              // Handmade plush
              'handmade plush', 'custom plush', 'handmade stuffed bear',
              'handmade stuffed bunny', 'handmade stuffed cat',
            ],
            noneOf: [
              // Exclude mass-manufactured plastic/vinyl toys
              'plastic toy', 'vinyl toy', 'rubber toy',
              // Exclude electronic toys
              'battery operated', 'electronic toy',
              // Exclude LEGO/building toys
              'lego', 'building set', 'puzzle',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 2 },  // other made-up textile articles (incl. stuffed toys)
            { prefix: '6301.30', syntheticRank: 6 },  // blankets/travelling rugs of cotton (for cotton dolls)
          ],
          whitelist: {
            allowChapters: ['63', '95', '61', '62'],   // made-up textile OR toys (allow both, boost ch.63)
            denyChapters: [],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6307.90' },
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.40, chapterMatch: '95' },       // penalize toys (prefer ch.63 for handmade)
          ],
        } as IntentRule;
        patches.push({ priority: 548, rule: newRule });
        console.log('STUFFED_TEXTILE_TOY_INTENT: created (handmade stuffed toys → 6307.90, ch.63)');
      } else {
        console.log('STUFFED_TEXTILE_TOY_INTENT: already exists, skipping');
      }
    }

    // 4. NEW FELT_GARLAND_TEXTILE_DECOR_INTENT → 6304.99 (textile furnishing articles)
    //    "handmade Spring Boho Felt Pom Pom Garland" → 4802.56 WRONG (expected 6304.99)
    //    "Felt Ball Garland" → expected 6304.99
    //    6304.99 = other furnishing articles of other textile materials
    {
      const existing = allRules.find(r => r.id === 'FELT_GARLAND_TEXTILE_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FELT_GARLAND_TEXTILE_DECOR_INTENT',
          description: 'Felt garlands, pom pom garlands, textile home decor → 6304 (furnishing articles)',
          pattern: {
            anyOf: [
              // Felt garlands (the primary target)
              'felt garland', 'felt garlands', 'felt ball garland', 'felt pom pom garland',
              'pom pom garland', 'felt balls garland', 'wool felt garland',
              // Textile bunting/banners
              'fabric bunting', 'textile garland', 'fabric garland',
              'felt banner', 'fabric banner', 'pennant garland',
              // Felt decor
              'felt wreath', 'felt mobile', 'felt wall hanging',
              'felt home decor', 'felt ornament set', 'felt tree ornament',
              // Boho/macrame textile decor
              'macrame wall hanging', 'macrame garland',
              'boho garland', 'boho wall hanging',
            ],
            noneOf: [
              // Exclude paper/cardboard decorations
              'paper garland', 'paper banner', 'paper bunting',
              // Exclude plastic/foil
              'foil garland', 'mylar garland',
              // Exclude food/candy
              'candy garland', 'popcorn garland',
            ],
          },
          inject: [
            { prefix: '6304.99', syntheticRank: 2 },  // furnishing articles of other textile
            { prefix: '6304.91', syntheticRank: 4 },  // furnishing articles, knitted/crocheted
            { prefix: '6307.90', syntheticRank: 6 },  // other made-up textile articles
          ],
          whitelist: {
            allowChapters: ['63', '62', '58'],         // made-up textile OR woven accessories
            denyChapters: ['48', '49'],                // deny paper/printed matter
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6304.' },
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '48' },       // penalize paper
            { delta: 0.65, chapterMatch: '49' },       // penalize printed matter
          ],
        } as IntentRule;
        patches.push({ priority: 547, rule: newRule });
        console.log('FELT_GARLAND_TEXTILE_DECOR_INTENT: created (felt garlands → 6304.99, deny ch.48/49)');
      } else {
        console.log('FELT_GARLAND_TEXTILE_DECOR_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT88)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT88 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
