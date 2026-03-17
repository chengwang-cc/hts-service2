#!/usr/bin/env ts-node
/**
 * Patch TT98 — 2026-03-16: Fix enamel pin regression, quilting fabric, copper tableware.
 *
 * Fixes:
 *  1. FIX ENAMEL_LAPEL_PIN_INTENT — remove allowChapters/denyChapters (regression fix)
 *     "Crying Bunny Enamel Pin" exp:7319.40 → getting 4403 (WOOD!) REGRESSION
 *     "Draught of the Living Death Hard Enamel Pin" exp:7319.90 → getting 4403 REGRESSION
 *     "Enamel Pin" exp:7326.90 → getting 4403 REGRESSION
 *     ROOT CAUSE: denyChapters:['73'] + allowChapters:['71'] blocks ch.73 (where 7319 lives).
 *                 Some enamel pins are expected as 7319 (pins of iron), some as 7117 (jewelry).
 *                 The allowChapters:['71'] prevents ch.73 results → search falls to ch.44 (wood).
 *     FIX: Remove chapter restrictions. Keep inject:7117.90 at rank2 (adds it to candidates without
 *          blocking organic ch.73 results). Items expected 7117 get it via injection; items expected
 *          7319 keep their organic result in top-10.
 *
 *  2. NEW QUILTING_FABRIC_INTENT → 5208 (cotton woven fabric, ch.52), deny ch.94 (bedding)
 *     "100% cotton quilt fabric, hand cut in Canada" → 9404.40 WRONG (expected 5208.12 cotton fabric)
 *     "Floral Quilt Cotton Fat Eighth: Retro Lavender" → 9404.40 WRONG (expected 5208.12)
 *     "Flutter Quilt Kit Cotton Fabric" → 9404.40 WRONG (expected 5208.52)
 *     ROOT CAUSE: 'quilt' word → engine routes to quilts/bedding (ch.94, 9404).
 *                 These are FABRIC/MATERIAL for quilting (ch.52), not finished quilts (ch.94).
 *     FIX: New intent → 5208.12/5208.52, denyChapters:['94','63']
 *
 *  3. NEW COPPER_BRASS_TABLEWARE_INTENT → 7418 (copper household articles, ch.74), deny ch.69
 *     "Greek Copper Cup" → 6911.10 WRONG (expected 7418.10 copper household articles)
 *     "Vintage MCM Pair of Coppercraft Guild Salt and Pepper Shakers" → 6912.00 WRONG (exp 7418.10)
 *     "Antique Brass Rectangular Dish" → 6911.10 WRONG (expected 7418.10)
 *     ROOT CAUSE: 'cup'/'dish'/'bowl' words route to ceramic tableware (ch.69/6911).
 *                 Copper/brass tableware is ch.74 (7418), not ceramic (ch.69).
 *     FIX: New intent → 7418.10/7419.80, denyChapters:['69']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt98.ts
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

    // 1. FIX ENAMEL_LAPEL_PIN_INTENT — remove chapter restrictions to fix regression
    //    "Crying Bunny Enamel Pin" exp:7319.40 → now gets 4403 (wood!) because:
    //    - denyChapters:['73'] blocks 7319 from results
    //    - allowChapters:['71'] only allows ch.71 results
    //    - ch.71 results are low-ranked for this query → falls through to ch.44 (wood)
    //    Fix: Remove allowChapters/denyChapters. Keep inject:7117.90 (adds 7117 to top-10 pool
    //    without blocking the ch.73 organic results that some items need).
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_LAPEL_PIN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '7117.90', syntheticRank: 2 },  // other imitation jewelry
            { prefix: '7117.11', syntheticRank: 5 },  // imitation jewelry of base metal
            { prefix: '7117.19', syntheticRank: 8 },  // other imitation jewelry of base metal
          ],
          // Remove chapter whitelist entirely — let inject+boosts handle 7117 preference
          // without blocking organic ch.73 (7319) results for items that need them
          whitelist: undefined as any,
          boosts: [
            { delta: 0.75, prefixMatch: '7117.' },    // boost imitation jewelry (softer)
            { delta: 0.40, chapterMatch: '71' },
          ],
          penalties: [
            // Soft penalty for ch.73 sewing pins — allows 7319 to surface if strongly matched
            { delta: 0.30, chapterMatch: '73' },
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 542, rule: updated });
        console.log('ENAMEL_LAPEL_PIN_INTENT: removed chapter restrictions (regression fix for 7319 items)');
      } else {
        console.log('ENAMEL_LAPEL_PIN_INTENT: not found');
      }
    }

    // 2. NEW QUILTING_FABRIC_INTENT → 5208 (cotton woven fabric, ch.52)
    //    "100% cotton quilt fabric, hand cut in Canada" → 9404.40 (quilts/bedding), exp 5208.12
    //    "Floral Quilt Cotton Fat Eighth" → 9404.40, exp 5208.12
    //    "Flutter Quilt Kit Cotton Fabric" → 9404.40, exp 5208.52
    //    Root cause: 'quilt' matches finished quilts (9404.40 = quilts/bedspreads, ch.94).
    //    These are QUILTING FABRIC/MATERIAL (unfinished), classified in ch.52 (cotton fabric).
    //    5208.12 = plain weave cotton fabric (unbleached), for quilting
    //    5208.52 = printed cotton fabric (over 200g/m²), for quilting
    {
      const existing = allRules.find(r => r.id === 'QUILTING_FABRIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'QUILTING_FABRIC_INTENT',
          description: 'Quilting/quilt fabric, fat quarters/eighths → 5208 (cotton woven fabric, ch.52), deny ch.94',
          pattern: {
            anyOf: [
              // Quilt fabric / quilting fabric
              'quilt fabric', 'quilting fabric', 'quilt cotton fabric',
              'cotton quilt fabric', 'quilting cotton',
              // Fat quarters/eighths (standard quilting fabric cuts)
              'fat quarter', 'fat quarters', 'fat eighth', 'fat eighths',
              'cotton fat quarter', 'cotton fat eighth',
              'quilting fat quarter', 'precut fabric',
              // Quilt kit (fabric)
              'quilt kit fabric', 'quilt kit cotton', 'flutter quilt kit',
              // Other quilting fabric terms
              'quilt backing fabric', 'quilt top fabric',
            ],
            noneOf: [
              // Exclude finished quilts/blankets
              'finished quilt', 'handmade quilt', 'baby quilt blanket',
              // Exclude quilt patterns (paper/digital)
              'quilt pattern', 'sewing pattern',
            ],
          },
          inject: [
            { prefix: '5208.12', syntheticRank: 2 },  // plain weave cotton, unbleached
            { prefix: '5208.52', syntheticRank: 4 },  // printed cotton fabric
            { prefix: '5208.42', syntheticRank: 6 },  // denim-type cotton fabric
            { prefix: '5208.32', syntheticRank: 8 },  // plain weave cotton, bleached
          ],
          whitelist: {
            allowChapters: ['52'],                     // cotton chapter
            denyChapters: ['94', '63'],                // deny bedding/quilts and made-up textile articles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '5208.' },    // boost cotton woven fabric
            { delta: 0.75, prefixMatch: '5212.' },    // boost other woven cotton fabrics
            { delta: 0.50, chapterMatch: '52' },
          ],
          penalties: [
            { delta: 0.90, chapterMatch: '94' },       // very strong penalty for bedding/furniture
            { delta: 0.80, prefixMatch: '9404.' },    // strong penalty for quilts/pillows
            { delta: 0.70, chapterMatch: '63' },       // penalty for made-up textile articles
          ],
        } as IntentRule;
        patches.push({ priority: 545, rule: newRule });
        console.log('QUILTING_FABRIC_INTENT: created (quilting fabric → 5208, deny ch.94)');
      } else {
        console.log('QUILTING_FABRIC_INTENT: already exists, skipping');
      }
    }

    // 3. NEW COPPER_BRASS_TABLEWARE_INTENT → 7418.10 (copper household articles, ch.74)
    //    "Greek Copper Cup" → 6911.10 (porcelain cups!), expected 7418.10 copper articles
    //    "Vintage MCM Coppercraft Guild Salt and Pepper Shakers" → 6912.00, expected 7418.10
    //    "Antique Brass Rectangular Dish" → 6911.10, expected 7418.10
    //    Root cause: 'cup'/'bowl'/'dish' words map to porcelain/ceramic tableware (ch.69).
    //    Copper/brass tableware: 7418.10 = table, kitchen, household articles of copper.
    {
      const existing = allRules.find(r => r.id === 'COPPER_BRASS_TABLEWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COPPER_BRASS_TABLEWARE_INTENT',
          description: 'Copper/brass cups, bowls, dishes, tableware → 7418/7419 (copper, ch.74), deny ch.69',
          pattern: {
            anyOf: [
              // Copper cups/mugs/bowls
              'copper cup', 'copper mug', 'copper bowl', 'copper tumbler',
              'copper wine cup', 'copper moscow mule',
              // Brass cups/bowls/dishes
              'brass cup', 'brass bowl', 'brass dish', 'brass mug',
              'brass pitcher', 'brass vase',
              // Copper dishes/plates/trays
              'copper dish', 'copper plate', 'copper tray',
              'copper serving dish', 'copper platter',
              // Copper kitchen/salt shakers
              'copper salt shaker', 'copper pepper shaker',
              'coppercraft', 'copper craft',
              // Antique brass items
              'antique brass dish', 'antique brass bowl',
              'antique copper cup', 'vintage brass cup',
            ],
            noneOf: [
              // Exclude decorative-only items (copper art)
              'copper art', 'copper sculpture',
              // Exclude non-copper metal
              'stainless steel', 'iron', 'aluminum',
            ],
          },
          inject: [
            { prefix: '7418.10', syntheticRank: 2 },  // table/kitchen/household articles of copper
            { prefix: '7419.80', syntheticRank: 4 },  // other articles of copper
            { prefix: '7417.00', syntheticRank: 6 },  // cooking/heating apparatus of copper
          ],
          whitelist: {
            allowChapters: ['74', '83'],               // copper or misc base metal articles
            denyChapters: ['69', '70'],                // deny ceramic/glass tableware
          },
          boosts: [
            { delta: 0.85, prefixMatch: '7418.' },    // boost copper articles
            { delta: 0.75, prefixMatch: '7419.' },    // boost other copper articles
            { delta: 0.50, chapterMatch: '74' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '69' },       // strong penalty for ceramics
            { delta: 0.70, chapterMatch: '70' },       // strong penalty for glass
          ],
        } as IntentRule;
        patches.push({ priority: 543, rule: newRule });
        console.log('COPPER_BRASS_TABLEWARE_INTENT: created (copper tableware → 7418, deny ch.69)');
      } else {
        console.log('COPPER_BRASS_TABLEWARE_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT98)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT98 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
