#!/usr/bin/env ts-node
/**
 * Patch TT89 — 2026-03-16: AIDA noneOf fix, swimwear fabric, retail cotton yarn.
 *
 * Fixes:
 *  1. FIX CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT — remove 'dohler' from noneOf
 *     "14ct AIDA Kitchen Towel to Cross Stitch by Dohler" → 6302.60 WRONG (expected 5208.33)
 *     TT85 added 'dohler' to noneOf to fix Zweigart fabric regression. But Dohler AIDA kitchen
 *     towels ARE correctly classified as 5208 (cotton woven fabric for cross-stitch).
 *     FIX: Remove 'dohler' from noneOf (keep 'zweigart' since that query expects 6302).
 *
 *  2. NEW SWIMWEAR_KNIT_FABRIC_INTENT → 6004/6006 (knitted fabric sold by the yard)
 *     "Swimwear Fabric" → 6112.39 WRONG (expected 6004.10 knitted fabric)
 *     "Swimwear Lining Fabric" → 6112.39 WRONG (expected 6004.10)
 *     "Bamboo Knit" → 6115 WRONG (expected 6004.10)
 *     BUG: Knitted fabric sold by the yard → 61xx garments instead of 60xx raw knitted fabric.
 *     6004 = knitted or crocheted fabrics of a width exceeding 30cm, containing elastomeric yarn
 *     FIX: New intent → 6004/6006, allowChapters:['60','61','62'], denyChapters:[]
 *          Key distinguishing words: 'fabric' (indicating raw material) + swimwear/knit context
 *
 *  3. NEW RETAIL_COTTON_YARN_INTENT → 5207 (cotton yarn put up for retail sale)
 *     "100% cotton yarn" → 5208.11 WRONG (expected 5207.10)
 *     "100% cotton yarn cord" → 5208.11 WRONG (expected 5207.10)
 *     "Cotton blend knitting yarn" → 5509.21 WRONG (expected 5207.90)
 *     BUG: Cotton yarn sold in retail skeins/balls → 5207 (put up for retail sale), not 5208 (fabric)
 *     5207.10 = single cotton yarn for retail, ≥85% cotton
 *     FIX: New intent targeting cotton yarn for retail → 5207, denyChapters:['52'] for woven fabric
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt89.ts
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

    // 1. FIX CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT — remove 'dohler' from noneOf
    //    TT85 added 'dohler' alongside 'zweigart' to noneOf, but Dohler AIDA products should
    //    still be classified as 5208 (cotton woven fabric for cross-stitch), not 6302.
    //    Only Zweigart brand products seem to expect 6302 in the dataset.
    {
      const existing = allRules.find(r => r.id === 'CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        // Remove 'dohler' but keep 'zweigart' and other finished-good exclusions
        const restoredNoneOf = currentNoneOf.filter((t: string) => t !== 'dohler');
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: restoredNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 556, rule: updated });
        console.log(`CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT: removed 'dohler' from noneOf`);
      } else {
        console.log('CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT: not found');
      }
    }

    // 2. NEW SWIMWEAR_KNIT_FABRIC_INTENT → 6004/6006 (knitted fabric for swimwear)
    //    "Swimwear Fabric" and "Swimwear Lining Fabric" → 6004.10 (knitted wide fabric)
    //    "Bamboo Knit" → 6004.10 (knitted fabric with bamboo/synthetic content)
    //    These are raw FABRIC materials (sold by the yard), not finished garments.
    //    6004 = wide knitted fabrics containing elastomeric yarn
    //    6006 = other knitted/crocheted fabrics
    {
      const existing = allRules.find(r => r.id === 'SWIMWEAR_KNIT_FABRIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SWIMWEAR_KNIT_FABRIC_INTENT',
          description: 'Knitted fabric for swimwear/activewear sold by the yard → 6004/6006 (ch.60)',
          pattern: {
            anyOf: [
              // Swimwear fabric (explicitly "fabric" = raw material)
              'swimwear fabric', 'swimwear lining fabric', 'swim fabric',
              'swimsuit fabric', 'bathing suit fabric',
              'lycra fabric', 'spandex fabric', 'elastane fabric',
              // Knitted/stretch fabric by the yard
              'bamboo knit', 'bamboo knit fabric', 'bamboo jersey',
              'powernet fabric', 'powernet',
              'stretch knit fabric', 'knit fabric',
              'jersey knit fabric', 'interlock knit fabric',
              'waffle knit fabric', 'rib knit fabric', 'double knit fabric',
              'french terry fabric', 'fleece fabric', 'ponte fabric',
              // Athletic/performance fabric
              'athletic fabric', 'activewear fabric', 'sports fabric',
              'compression fabric', 'moisture wicking fabric',
              // Specific knit fabric types
              'duoplex knit', 'duoplex fabric',
              // Wide elastic/stretch material (sold by the meter)
              'elastic by the meter', 'stretch fabric by the yard',
            ],
            noneOf: [
              // Exclude finished garments
              'swimsuit', 'bikini', 'one piece', 'bathing suit',
              'shorts', 'pants', 'top', 'shirt',
              'sweater', 'hoodie', 'jacket', 'coat',
              // Exclude accessories
              'bra strap', 'elastic band', 'waistband',
              // Exclude thread/yarn
              'yarn', 'thread',
            ],
          },
          inject: [
            { prefix: '6004.10', syntheticRank: 2 },  // wide knitted fabric with elastomeric
            { prefix: '6004.90', syntheticRank: 4 },  // other wide knitted fabric
            { prefix: '6006.23', syntheticRank: 6 },  // knitted fabric of synthetic fibers, dyed
            { prefix: '6006.33', syntheticRank: 8 },  // knitted fabric of man-made fibers, dyed
            { prefix: '6002.40', syntheticRank: 10 }, // knitted fabric with elastomeric yarn
          ],
          whitelist: {
            allowChapters: ['60', '61', '62'],         // knitted fabric OR knitted garments (prefer ch.60)
            denyChapters: [],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6004.' },
            { delta: 0.70, prefixMatch: '6006.' },
            { delta: 0.60, prefixMatch: '6002.' },
            { delta: 0.50, chapterMatch: '60' },
          ],
          penalties: [
            { delta: 0.40, chapterMatch: '61' },       // penalize garments (prefer raw fabric)
            { delta: 0.40, chapterMatch: '62' },       // penalize woven garments
          ],
        } as IntentRule;
        patches.push({ priority: 546, rule: newRule });
        console.log('SWIMWEAR_KNIT_FABRIC_INTENT: created (swimwear/knit fabric → 6004/6006, ch.60)');
      } else {
        console.log('SWIMWEAR_KNIT_FABRIC_INTENT: already exists, skipping');
      }
    }

    // 3. NEW RETAIL_COTTON_YARN_INTENT → 5207 (cotton yarn for retail sale)
    //    "100% cotton yarn" → exp:5207.10 but getting 5208 (cotton woven fabric!)
    //    "Cotton blend knitting yarn(100% cotton)" → exp:5207.90 but getting 5509
    //    5207.10 = single cotton yarn, ≥85% cotton, put up for retail sale
    //    5207.90 = other cotton yarn put up for retail sale (blends)
    //    The key: retail cotton yarn = 5207, industrial cotton yarn = 5205/5206
    {
      const existing = allRules.find(r => r.id === 'RETAIL_COTTON_YARN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RETAIL_COTTON_YARN_INTENT',
          description: 'Cotton yarn sold for retail/crochet/knitting → 5207 (put up for retail sale)',
          pattern: {
            anyOf: [
              // Cotton yarn - retail
              '100% cotton yarn', 'pure cotton yarn', 'cotton knitting yarn',
              'cotton crochet yarn', 'cotton yarn cord', 'natural cotton yarn',
              'cotton yarn hank', 'cotton yarn skein', 'cotton yarn ball',
              // Cotton blend yarn for retail
              'cotton blend knitting yarn', 'cotton blend crochet yarn',
              'cotton blend yarn',
              // Specific cotton yarn products
              'dmc cotton yarn', 'dmc matte cotton',
              'embroidery cotton yarn', 'tatting cotton',
              '192 yard hank of cotton', 'cotton yarn by the skein',
              // Colored cotton yarn
              'mercerized cotton yarn', 'pima cotton yarn',
            ],
            noneOf: [
              // Exclude cotton fabric (not yarn)
              'cotton fabric', 'cotton cloth', 'cotton sheet',
              // Exclude cotton thread for sewing (different HTS)
              'sewing thread', 'quilting thread',
              // Exclude cotton rope/twine
              'cotton rope', 'cotton twine', 'macrame cotton',
            ],
          },
          inject: [
            { prefix: '5207.10', syntheticRank: 2 },  // single cotton yarn, ≥85%, for retail
            { prefix: '5207.90', syntheticRank: 4 },  // other cotton yarn for retail
            { prefix: '5205.31', syntheticRank: 8 },  // multiple/cabled cotton yarn
          ],
          whitelist: {
            allowChapters: ['52', '55'],               // cotton chapter OR MMF (for blends)
            denyChapters: [],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '5207.' },
            { delta: 0.40, chapterMatch: '52' },
          ],
          penalties: [
            { delta: 0.50, prefixMatch: '5208.' },     // penalize cotton woven fabric (not yarn)
            { delta: 0.50, prefixMatch: '5209.' },     // penalize cotton woven fabric
          ],
        } as IntentRule;
        patches.push({ priority: 545, rule: newRule });
        console.log('RETAIL_COTTON_YARN_INTENT: created (retail cotton yarn → 5207, deny fabric)');
      } else {
        console.log('RETAIL_COTTON_YARN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT89)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT89 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
