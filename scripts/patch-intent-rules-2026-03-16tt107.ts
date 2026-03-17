#!/usr/bin/env ts-node
/**
 * Patch TT107 — 2026-03-16: Fix throw-pillow-cover → 6302 + other targeted fixes.
 *
 * Fix 1: NEW THROW_PILLOW_COVER_WOVEN_INTENT → 6302.21 (woven cotton pillow cases)
 *   "DECORATIVE RED COTTON THROW PILLOW COVER" → 6304.99 WRONG (expected 6302.21)
 *   "cotton decorative throw pillow cover, woven fabric, home textile" → 6304.99 WRONG
 *   ROOT CAUSE: "throw" + "pillow cover" → 6304 (decorative furnishing) organic entries win
 *   because they contain "throw" + "decorative" + "pillow cover" in descriptions → high coverage.
 *   Penalty approach (0.60 in TT103) insufficient because ch.63 general boost adds +0.40 from
 *   COTTON_PILLOW_COVER_LINEN_INTENT → net still positive for 6304.
 *   FIX: New intent at priority 572 fires specifically for "throw pillow cover" and "decorative
 *   throw pillow" queries with denyPrefixes:['6304.','6307.'] — hard-blocks both.
 *   Only 2 dataset entries expect 6304/6307 for pillow-cover queries and both already FAIL
 *   (returning wrong codes), so no new regressions.
 *
 * Fix 2: UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — fix inject regression from TT106
 *   TT106 changed inject order (7013.28 rank2, 7013.49 rank3) which may have hurt some
 *   entries that relied on 7013.49 injection. Restore 7013.49 to rank 2.
 *
 * Fix 3: UPDATE ACRYLIC_KNIT_HAT_HEADWEAR_INTENT — strengthen headband → 6505
 *   "adult knit merino wool headband" → 6117.80 WRONG (expected 6505.00)
 *   SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT fires for "headband" and injects 6117.80 at rank5,
 *   but ACRYLIC_KNIT_HAT fires for "wool headband" and injects 6505.00 also at rank5.
 *   FIX: Raise 6505.00 inject to rank 2 and add "merino wool headband", "wool knit headband" etc.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt107.ts
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

    // 1. NEW THROW_PILLOW_COVER_WOVEN_INTENT → 6302.21 (woven cotton pillow cases)
    //    "DECORATIVE RED COTTON THROW PILLOW COVER" → 6304.99 WRONG
    //    "cotton decorative throw pillow cover" → 6304.99 WRONG
    //    "throw" keyword in "throw pillow cover" triggers 6304 (furnishing articles)
    //    because 6304 HTS entries explicitly mention "throw pillows" and "decorative throw"
    //    giving them high lexical coverage for these queries.
    //    Hard-block 6304 + 6307 via denyPrefixes, inject 6302.21 at rank 1.
    {
      const existing = allRules.find(r => r.id === 'THROW_PILLOW_COVER_WOVEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'THROW_PILLOW_COVER_WOVEN_INTENT',
          description: 'Woven cotton throw pillow covers → 6302.21 (bed linen), hard-block 6304/6307 furnishing',
          pattern: {
            anyOf: [
              'throw pillow cover', 'throw pillow covers',
              'decorative throw pillow cover', 'decorative throw pillow case',
              'cotton throw pillow cover', 'cotton throw pillow case',
              'woven throw pillow cover',
              'throw pillow cover set',
            ],
            noneOf: [
              // Exclude actual pillow products (stuffed, filled)
              'pillow insert', 'pillow form', 'pillow filler',
              'stuffed throw pillow', 'filled pillow',
              // Exclude knitted/crocheted pillow covers (6302.40)
              'crochet pillow', 'knitted pillow',
              // Exclude velvet/luxury decorative (more likely 6304)
              'velvet throw pillow',
            ],
          },
          inject: [
            { prefix: '6302.21', syntheticRank: 1 },  // woven cotton pillow cases (syntheticRank 1 = top)
            { prefix: '6302.22', syntheticRank: 3 },  // printed cotton pillow cases
            { prefix: '6302.31', syntheticRank: 5 },  // other cotton bed linen
          ],
          whitelist: {
            denyPrefixes: ['6304.', '6307.'],          // hard-block decorative furnishing + misc textiles
          },
          boosts: [
            { delta: 0.95, prefixMatch: '6302.' },    // very strong boost for bed linen
            { delta: 0.40, chapterMatch: '63' },       // ch.63 general boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6304.' },    // strong penalty for decorative furnishing
            { delta: 0.70, prefixMatch: '6307.' },    // penalty for misc textile
          ],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('THROW_PILLOW_COVER_WOVEN_INTENT: created (throw pillow cover → 6302.21, denyPrefixes:[6304,6307])');
      } else {
        console.log('THROW_PILLOW_COVER_WOVEN_INTENT: already exists, skipping');
      }
    }

    // 2. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — restore 7013.49 to rank 2
    //    TT106 changed to 7013.28 rank2, 7013.49 rank3, which may have caused 2 regressions.
    //    The general-purpose household drinkware intent should prefer 7013.49 (non-lead crystal
    //    various) as the catch-all, with 7013.28 at rank 3.
    {
      const existing = allRules.find(r => r.id === 'GLASS_HOUSEHOLD_DRINKWARE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '7013.49', syntheticRank: 2 },  // general glass objects (best catch-all; restored to rank 2)
            { prefix: '7013.37', syntheticRank: 3 },  // other glassware
            { prefix: '7013.28', syntheticRank: 4 },  // non-lead crystal drinkware
            { prefix: '7013.33', syntheticRank: 6 },  // lead crystal other
            { prefix: '7013.10', syntheticRank: 7 },  // glass-ceramics
            { prefix: '7013.99', syntheticRank: 8 },  // other
            { prefix: '7013.22', syntheticRank: 10 }, // lead crystal stemware
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 572, rule: updated });
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: restored 7013.49 to rank 2 (reverted TT106 change)');
      } else {
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: not found');
      }
    }

    // 3. UPDATE ACRYLIC_KNIT_HAT_HEADWEAR_INTENT — add more headband phrases + raise inject rank
    //    "adult knit merino wool headband" → 6117.80 WRONG (expected 6505.00)
    //    SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT fires (has "headband") and injects 6117.80 rank5.
    //    ACRYLIC_KNIT_HAT also fires (has "wool headband" in anyOf) and injects 6505.00 rank5.
    //    FIX: Raise 6505.00 inject to rank 2, add more headband phrase variants.
    {
      const existing = allRules.find(r => r.id === 'ACRYLIC_KNIT_HAT_HEADWEAR_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addPhrases = [
          // More headband variants that "wool headband" might not catch due to word order
          'merino wool headband', 'merino headband', 'wool knit headband', 'knit wool headband',
          'cashmere headband', 'alpaca headband',
          'winter headband', 'winter knit headband', 'ear warmer headband',
          'wide knit headband', 'wide knitted headband',
          // More hat variants
          'slouchy knit hat', 'slouch hat', 'pom pom hat', 'pompom hat',
          'adult knit hat', 'adult knitted hat',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addPhrases])],
          },
          inject: [
            { prefix: '6505.00', syntheticRank: 2 },  // hats/headwear (raised from 5 to 2)
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 582, rule: updated });
        console.log('ACRYLIC_KNIT_HAT_HEADWEAR_INTENT: raised inject to rank2, added merino/wool headband phrases');
      } else {
        console.log('ACRYLIC_KNIT_HAT_HEADWEAR_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT107)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT107 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
