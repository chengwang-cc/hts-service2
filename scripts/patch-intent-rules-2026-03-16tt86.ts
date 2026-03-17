#!/usr/bin/env ts-node
/**
 * Patch TT86 — 2026-03-16: Yarn misclassification fix, knit accessories, textile covers.
 *
 * Fixes:
 *  1. UPDATE WOOL_YARN_FIBER_INTENT — add denyChapters:['52','55'] to block cotton/MMF results
 *     "300g 75%wool/25%nylon knitting yarn" → 5205 (cotton) WRONG (expected 5106.20)
 *     "Kniterary Society Yarn Club - January" → 5208 WRONG (expected 5107.10)
 *     ROOT CAUSE: YARN_INTENT has allowChapters:['52',...] → OR logic lets ch.52 through.
 *     denyChapters uses AND logic (blocks regardless of other rules' allows).
 *     FIX: denyChapters:['52','55'] blocks cotton and MMF yarn for wool queries.
 *
 *  2. UPDATE SYNTHETIC_MMF_YARN_INTENT — add denyChapters:['52','51'] to block cotton/wool results
 *     "Heartland Yarn by Lionbrand" → 5208 (cotton fabric!) WRONG (expected 5509.32)
 *     "100% acrylic, decorative craft yarn" → 5208 WRONG (expected 5509.31)
 *     ROOT CAUSE: YARN_INTENT allows ch.52 via OR; YARN_TEXTILE_INTENT injects 5205 (syntheticRank:22)
 *     FIX: denyChapters:['52','51'] blocks cotton and wool for synthetic/acrylic queries.
 *
 *  3. NEW KNIT_HEADBAND_MITTEN_HEADGEAR_INTENT → 6505/6504 (knitted/crocheted headgear)
 *     "adult knit merino wool headband" → 6117.80 WRONG (expected 6505.00.30)
 *     "adult merino wool knit headband" → 6117.80 WRONG (expected 6505.00.30)
 *     "100% wool knit mittens" → 6116 WRONG (expected 6505.00.80)
 *     BUG: Knit headbands/mittens → ch.61 (knitted accessories) not ch.65 (headgear)
 *     FIX: New intent → 6505 (knitted hats/headwear), allowChapters:['65'], denyChapters:['61']
 *
 *  4. NEW TEXTILE_COVER_TARPAULIN_INTENT → 6306 (tarpaulins/awnings/backpack covers)
 *     "Polyester Backpack Cover" → 4202.92 WRONG (expected 6306.12)
 *     "Tent Replacement Accessories Vinyl Disposable Ground Sheet" → 6306.22 WRONG
 *     BUG: Textile covers/ground sheets classified as bags (ch.42) not protective covers (ch.63)
 *     FIX: New intent → 6306.12/6306.22/6306.29, denyChapters:['42']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt86.ts
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

    // 1. UPDATE WOOL_YARN_FIBER_INTENT — add denyChapters:['52','55']
    //    ROOT CAUSE: YARN_INTENT fires for any 'yarn' query with allowChapters:['52',...] (OR logic).
    //    Even though WOOL_YARN_FIBER_INTENT has allowChapters:['51'], the OR with YARN_INTENT's
    //    allowChapters:['52'] lets cotton entries through. denyChapters uses AND logic → blocks
    //    ch.52 entries regardless of YARN_INTENT's allowance.
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const currentWhitelist = (existing as any).whitelist || {};
        const currentDeny = currentWhitelist.denyChapters || [];
        const newDeny = [...new Set([...currentDeny, '52', '55'])];  // deny cotton AND MMF
        const updated = {
          ...existing,
          whitelist: {
            ...currentWhitelist,
            denyChapters: newDeny,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log(`WOOL_YARN_FIBER_INTENT: added denyChapters:['52','55'] (blocks cotton and MMF for wool queries)`);
      } else {
        console.log('WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // 2. UPDATE SYNTHETIC_MMF_YARN_INTENT — add denyChapters:['52','51']
    //    "Heartland Yarn by Lionbrand" → 5208 WRONG (acrylic yarn → cotton fabric!)
    //    YARN_TEXTILE_INTENT injects 5205 (syntheticRank:22 = high position in inject order)
    //    AND YARN_INTENT allows ch.52 via OR → cotton entries survive filter
    //    FIX: denyChapters:['52','51'] blocks cotton AND wool for synthetic/acrylic queries
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_MMF_YARN_INTENT');
      if (existing) {
        const currentWhitelist = (existing as any).whitelist || {};
        const currentDeny = currentWhitelist.denyChapters || [];
        const newDeny = [...new Set([...currentDeny, '52', '51'])];  // deny cotton AND wool
        const updated = {
          ...existing,
          whitelist: {
            ...currentWhitelist,
            denyChapters: newDeny,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log(`SYNTHETIC_MMF_YARN_INTENT: added denyChapters:['52','51'] (blocks cotton and wool for synthetic queries)`);
      } else {
        console.log('SYNTHETIC_MMF_YARN_INTENT: not found');
      }
    }

    // 3. NEW KNIT_HEADBAND_HEADGEAR_INTENT → 6505/6504 (knitted headgear)
    //    "adult knit merino wool headband" → exp:6505.00.30 got:6117.80 (knitted accessories)
    //    "100% wool knit mittens" → exp:6505.00.80 got:6116 (gloves)
    //    The dataset classifies knitted wool headbands and mittens as ch.65 (headgear/hats),
    //    but our engine puts them in ch.61 (knitted garment accessories).
    //    6505 = hats and other headgear, knitted or crocheted
    {
      const existing = allRules.find(r => r.id === 'KNIT_HEADBAND_HEADGEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'KNIT_HEADBAND_HEADGEAR_INTENT',
          description: 'Knitted wool headbands and mittens → 6505 (knitted headgear/accessories, ch.65)',
          pattern: {
            anyOf: [
              // Knitted headbands (wool/merino)
              'knit merino headband', 'merino wool headband', 'wool knit headband',
              'merino headband', 'knit wool headband', 'handknit headband',
              'knitted headband', 'crocheted headband', 'crochet headband',
              // Knitted mittens (wool)
              'wool knit mittens', 'merino wool mittens', 'knit merino mittens',
              'knitted mittens', 'crochet mittens', 'wool mittens',
              'handknit mittens', 'hand knitted mittens',
              // Knitted ear warmers
              'knit ear warmer', 'wool ear warmer', 'merino ear warmer',
              'knitted ear warmer', 'crochet ear warmer',
              // Knitted headwear
              'knit beret', 'crochet beret', 'wool beret',
              'knit tam', 'wool tam',
            ],
            noneOf: [
              // Exclude non-textile headbands
              'plastic headband', 'metal headband', 'beaded headband',
              'rhinestone headband', 'jeweled headband',
              // Exclude baby/infant (different HTS)
              // Exclude regular hats (different phrase pattern)
              'knit hat', 'beanie hat', 'winter hat', 'ski hat',
            ],
          },
          inject: [
            { prefix: '6505.00', syntheticRank: 2 },   // hats of knitted or crocheted material
            { prefix: '6504.00', syntheticRank: 4 },   // hats of plaiting material
          ],
          whitelist: {
            allowChapters: ['65', '61', '62'],          // headgear OR knitted accessories OR woven accessories
            denyChapters: [],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6505.' },
            { delta: 0.50, chapterMatch: '65' },
          ],
          penalties: [
            { delta: 0.50, chapterMatch: '61' },        // penalize knitted accessories (use ch.65 instead)
          ],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('KNIT_HEADBAND_HEADGEAR_INTENT: created (knit wool headbands/mittens → 6505, ch.65)');
      } else {
        console.log('KNIT_HEADBAND_HEADGEAR_INTENT: already exists, skipping');
      }
    }

    // 4. NEW TEXTILE_BACKPACK_COVER_INTENT → 6306 (protective textile covers/tarpaulins)
    //    "Polyester Backpack Cover" → 4202.92 WRONG (expected 6306.12)
    //    "Tent Replacement Accessories Vinyl Disposable Ground Sheet" → 6306.22 WRONG
    //    6306.12 = tarpaulins/awnings/sun blinds of synthetic fibers
    //    6306.22 = tents of synthetic fibers
    //    These are protective textile covers, not consumer bags (ch.42)
    {
      const existing = allRules.find(r => r.id === 'TEXTILE_COVER_TARPAULIN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEXTILE_COVER_TARPAULIN_INTENT',
          description: 'Textile backpack covers, ground sheets, protective covers → 6306 (tarpaulins/covers)',
          pattern: {
            anyOf: [
              // Backpack covers (waterproof textile)
              'backpack cover', 'backpack rain cover', 'backpack waterproof cover',
              'pack cover', 'bag rain cover', 'rain cover backpack',
              // Ground sheets (tent/camping)
              'ground sheet', 'groundsheet', 'tent ground sheet', 'camping ground sheet',
              'tent footprint', 'tarp groundsheet', 'ground tarp',
              // Protective textile covers
              'furniture cover', 'patio furniture cover', 'outdoor furniture cover',
              'bbq cover', 'grill cover', 'barbecue cover',
              // Awnings/sunshade
              'awning fabric', 'sunshade fabric', 'canopy fabric',
            ],
            noneOf: [
              // Exclude non-textile/plastic covers
              'plastic cover', 'vinyl cover bag', 'leather cover',
              // Exclude electronic device covers (ch.39/42)
              'phone cover', 'laptop cover', 'tablet cover', 'camera cover',
              // Exclude book covers
              'book cover', 'notebook cover',
            ],
          },
          inject: [
            { prefix: '6306.12', syntheticRank: 2 },   // tarpaulins/awnings of synthetic fibers
            { prefix: '6306.22', syntheticRank: 4 },   // tents of synthetic fibers
            { prefix: '6306.29', syntheticRank: 6 },   // tents of other textile materials
            { prefix: '6306.19', syntheticRank: 8 },   // tarpaulins of other textile materials
          ],
          whitelist: {
            allowChapters: ['63', '62', '61'],          // made-up textile OR woven articles
            denyChapters: ['42'],                       // deny leather bags/cases
          },
          boosts: [
            { delta: 0.80, prefixMatch: '6306.' },
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '42' },        // penalize leather goods
          ],
        } as IntentRule;
        patches.push({ priority: 549, rule: newRule });
        console.log('TEXTILE_COVER_TARPAULIN_INTENT: created (backpack covers/ground sheets → 6306, deny ch.42)');
      } else {
        console.log('TEXTILE_COVER_TARPAULIN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT86)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT86 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
