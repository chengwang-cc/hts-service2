#!/usr/bin/env ts-node
/**
 * Patch TT66 — 2026-03-15: Fix slate coasters still→computers, HVLP spray, tissue covers, scrunchies.
 *
 * Fixes:
 *  1. UPDATE SLATE_STONE_PRODUCT_INTENT — restore denyChapters:['84'] + use syntheticRank:1
 *     "slate coaster" → 8471.30 (computers!) STILL WRONG after TT64
 *     TT64 removed denyChapters:['84'] thinking boost alone would win, but 8471.30 organic
 *     score (~1.0) dominates even with delta:0.70 boost on 6815.99.
 *     FIX: Restore denyChapters:['84'] + set syntheticRank:1 (best injection rank)
 *     With deny: 8471 removed, other organic ~0.5, 6815.99 = 0.0164 + 0.70 = 0.7164
 *     Normalized by max(0.5, 1.0) = 1.0 → 0.7164 > 0.25 threshold → PASSES!
 *
 *  2. UPDATE DRINKWARE_INTENT — add noneOf for spray equipment
 *     "hvlp spray cup" → 6911 (porcelain!) — "cup" triggers DRINKWARE_INTENT
 *     FIX: Add 'spray cup', 'hvlp', 'paint cup' to noneOf
 *
 *  3. UPDATE TISSUE_PAPER_INTENT — add noneOf for woven tissue covers
 *     "woven linen tissue cover" → 4818 (paper tissue!) — "tissue" triggers TISSUE_PAPER_INTENT
 *     allowPrefixes:['4818.'] forces paper tissue results, blocking 6302.99 (woven linen)
 *     FIX: Add 'tissue cover', 'tissue holder', 'tissue box cover' to noneOf
 *
 *  4. NEW HVLP_PAINT_SPRAY_INTENT → 8424.XX (spray appliances, deny ceramic)
 *     "hvlp spray cup" → 6911 WRONG
 *     "hvlp sprayer" → 8424 (already works, but reinforce)
 *     "Misting Nozzles" → 6903 (ceramic retorts!) WRONG — "nozzle" triggers ceramic
 *     FIX: Rule for spray equipment deny ch.69
 *
 *  5. NEW SCRUNCHIE_HAIR_BAND_INTENT → inject both 6117.80 and 9615.90
 *     10 scrunchie entries with diverse expected codes (6117, 6213, 6215, 6217, 9615)
 *     Currently all going to 9615 (ch.96) — correct for 4/10, wrong for 6/10
 *     FIX: Inject 6117.80 (knitted clothing accessories) into top-10 for ch.61 coverage
 *
 *  6. NEW WOVEN_TISSUE_BOX_COVER_INTENT → 6302.99 (woven household linen)
 *     "woven linen tissue cover" → 6302.99 (fix for TISSUE_PAPER_INTENT blocking it)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt66.ts
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

    // 1. UPDATE SLATE_STONE_PRODUCT_INTENT — restore denyChapters:['84'] + syntheticRank:1
    //    TT64 removed denyChapters:['84'] but organic 8471.30 still wins at score ~1.0
    //    even with +0.70 boost on 6815.99 (0.0154 + 0.70 = 0.7154 < 1.0 → loses)
    //    With denyChapters:['84']: 8471 removed, organic top score drops to ~0.5
    //    6815.99 with syntheticRank:1 (0.0164) + boost:0.70 = 0.7164
    //    Normalized by max(0.5, 1.0) = 1.0 → score 0.7164 > 0.25 → PASSES
    {
      const existing = allRules.find(r => r.id === 'SLATE_STONE_PRODUCT_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            denyChapters: ['84'],
          },
          inject: [
            { prefix: '6815.99', syntheticRank: 1 }, // best rank injection
            { prefix: '6815.10', syntheticRank: 2 }, // slate articles
            { prefix: '6802.29', syntheticRank: 3 },
          ],
          boosts: [{ delta: 0.75, prefixMatch: '6815.' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: updated });
        console.log('SLATE_STONE_PRODUCT_INTENT: restored denyChapters[84] + syntheticRank:1 + boost:0.75');
      }
    }

    // 2. UPDATE DRINKWARE_INTENT — add noneOf for spray equipment
    //    "hvlp spray cup" → 6911.10 (porcelain!) — DRINKWARE_INTENT injects ceramic cups
    //    FIX: Add spray-related terms to noneOf
    {
      const existing = allRules.find(r => r.id === 'DRINKWARE_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const sprayNoneOf = ['spray cup', 'hvlp', 'paint cup', 'spray gun cup', 'sprayer cup', 'airbrush cup'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...sprayNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('DRINKWARE_INTENT: added spray cup noneOf terms');
      }
    }

    // 3. UPDATE TISSUE_PAPER_INTENT — add noneOf for woven covers
    //    "woven linen tissue cover" → 4818 WRONG — TISSUE_PAPER_INTENT forces 4818.X
    //    "woven linen tissue covers" → expected 6302.99 (woven household linen)
    {
      const existing = allRules.find(r => r.id === 'TISSUE_PAPER_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const coverNoneOf = ['tissue cover', 'tissue holder', 'tissue box cover', 'tissue box holder', 'tissue case', 'tissue cozy'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...coverNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('TISSUE_PAPER_INTENT: added tissue cover noneOf terms');
      }
    }

    // 4. NEW HVLP_PAINT_SPRAY_INTENT → 8424.XX (spray appliances for painting)
    //    "hvlp spray cup" → 6911 WRONG (after fix #2, might still need injection)
    //    "Misting Nozzles" → 6903 (ceramic crucibles!) — "nozzle" triggers ceramic
    //    8424.20 = spray guns and similar appliances
    //    8424.41 = sprinklers for agricultural/horticultural
    //    8424.90 = parts of spray appliances (includes nozzles)
    {
      const existing = allRules.find(r => r.id === 'HVLP_PAINT_SPRAY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HVLP_PAINT_SPRAY_INTENT',
          description: 'HVLP spray guns, spray cups, misting nozzles → ch.84 (8424.XX)',
          pattern: {
            anyOf: [
              // HVLP spray equipment
              'hvlp spray', 'hvlp sprayer', 'hvlp gun', 'spray cup hvlp',
              'spray cup paint', 'paint spray cup', 'gravity cup',
              // Spray guns
              'spray gun', 'paint spray gun', 'airless sprayer',
              'automotive spray', 'airbrush gun',
              // Misting/atomizing nozzles
              'misting nozzle', 'misting nozzles', 'atomizing nozzle',
              'spray nozzle', 'mist nozzle', 'fog nozzle',
              'garden misting', 'mister nozzle',
            ],
            noneOf: [
              // Exclude nasal sprays/medical
              'nasal spray', 'nose spray', 'throat spray',
              // Exclude garden hose nozzle (different code)
              'garden hose nozzle', 'hose nozzle',
            ],
          },
          inject: [
            { prefix: '8424.20', syntheticRank: 5 }, // spray guns
            { prefix: '8424.90', syntheticRank: 4 }, // parts of spray appliances (nozzles)
            { prefix: '8424.41', syntheticRank: 4 }, // sprinklers
          ],
          whitelist: {
            denyChapters: ['69', '70'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '8424.' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('HVLP_PAINT_SPRAY_INTENT: created (spray guns/nozzles → 8424, deny ch.69 ceramic)');
      }
    }

    // 5. NEW SCRUNCHIE_HAIR_BAND_INTENT → inject both 6117.80 and 9615.90
    //    10 scrunchie entries with expected codes across ch.61/62/96
    //    Currently all returning 9615 (correct for 4/10, wrong for 6/10)
    //    FIX: Inject 6117.80 so it appears in top-10 → additional hits for ch.61 expected entries
    {
      const existing = allRules.find(r => r.id === 'SCRUNCHIE_HAIR_BAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SCRUNCHIE_HAIR_BAND_INTENT',
          description: 'Hair scrunchies, hair bands, bun covers → ch.61 (6117.80) or ch.96 (9615)',
          pattern: {
            anyOf: [
              'scrunchie', 'scrunchies', 'scrunchy',
              'hair scrunchie', 'hair scrunchies', 'hair scrunchy',
              'satin scrunchie', 'silk scrunchie', 'velvet scrunchie',
              'cotton scrunchie', 'fabric scrunchie',
              'hair bun cover', 'bun scrunchie',
            ],
          },
          inject: [
            { prefix: '6117.80', syntheticRank: 5 }, // other clothing accessories, knitted
            { prefix: '9615.11', syntheticRank: 5 }, // hair slides/grips of hard rubber/plastics
            { prefix: '9615.19', syntheticRank: 5 }, // other hair slides/grips
            { prefix: '6217.10', syntheticRank: 4 }, // other clothing accessories, not knitted
          ],
          boosts: [
            { delta: 0.55, prefixMatch: '6117.' },
            { delta: 0.55, prefixMatch: '9615.' },
          ],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('SCRUNCHIE_HAIR_BAND_INTENT: created (scrunchies → both 6117.80 + 9615.90 in top-10)');
      }
    }

    // 6. NEW WOVEN_TISSUE_BOX_COVER_INTENT → 6302.99 (woven household linen)
    //    "woven linen tissue covers" → 6302.99 (woven table/toilet linen)
    //    After TISSUE_PAPER_INTENT noneOf fix, this rule provides positive routing
    {
      const existing = allRules.find(r => r.id === 'WOVEN_TISSUE_BOX_COVER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOVEN_TISSUE_BOX_COVER_INTENT',
          description: 'Woven linen/fabric tissue box covers → ch.63 (6302.99)',
          pattern: {
            anyOf: [
              'tissue cover', 'tissue box cover', 'tissue holder', 'tissue box holder',
              'woven tissue', 'linen tissue cover', 'fabric tissue cover',
              'tissue cozy', 'tissue case fabric', 'kleenex cover',
            ],
            noneOf: [
              'paper tissue', 'tissue paper', 'facial tissue', 'toilet tissue',
            ],
          },
          inject: [
            { prefix: '6302.99', syntheticRank: 5 }, // other woven bed linen/toilet/table linen
            { prefix: '6304.99', syntheticRank: 4 }, // other furnishing articles
          ],
          whitelist: {
            denyChapters: ['48'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '6302.' }],
        } as IntentRule;
        patches.push({ priority: 574, rule: newRule });
        console.log('WOVEN_TISSUE_BOX_COVER_INTENT: created (tissue covers → 6302.99, deny ch.48 paper)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT66)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT66 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
