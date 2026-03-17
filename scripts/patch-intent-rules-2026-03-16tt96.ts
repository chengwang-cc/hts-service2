#!/usr/bin/env ts-node
/**
 * Patch TT96 — 2026-03-16: Atomizer bottles, LED base fix, essential oil face oil regression.
 *
 * Fixes:
 *  1. NEW ATOMIZER_SPRAY_BOTTLE_INTENT → 9616.10 (ch.96 perfume atomizers), deny ch.73
 *     "Wooden Atomizer Spray Bottle - Dark Brown" → 7323.93 WRONG (expected 9616.10)
 *     "10ml EvrAir pressurized decant bottle - Gold" → 7323.93 WRONG (expected 9616.10)
 *     ROOT CAUSE: Atomizer/spray bottles for cosmetics classified as kitchen utensils (7323, ch.73).
 *     9616.10 = scent sprays and similar toilet sprays (perfume atomizers)
 *     FIX: New intent → 9616.10, denyChapters:['73','22']
 *
 *  2. UPDATE LAMP_SHADE_LIGHT_FIXTURE_INTENT — add 'led base' to anyOf
 *     "LED Base sample" → 8539.31 WRONG (expected 9405.21 table/floor lamps)
 *     ROOT CAUSE: 'led base' not in intent anyOf; 'LED' alone routes to ch.85 (electronics).
 *     FIX: Add 'led base', 'lamp base', 'light base' to anyOf
 *
 *  3. FIX ESSENTIAL_OIL_COSMETIC_INTENT — remove 'face oil' from anyOf (regression fix)
 *     "Balsam Fir Face Oil" → 3301.29 (essential oils) WRONG (expected 3401.30 soap/cleanser)
 *     ROOT CAUSE: 'face oil' in anyOf fires intent → routes to 3301.29 (ch.33 essential oils)
 *                 but face oil cleansers are classified as 3401.30 (ch.34 soap/surface-active).
 *     FIX: Remove 'face oil' from anyOf and add to noneOf to prevent misclassification.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt96.ts
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

    // 1. NEW ATOMIZER_SPRAY_BOTTLE_INTENT → 9616.10 (perfume atomizers, ch.96)
    //    "Wooden Atomizer Spray Bottle - Dark Brown" → 7323.93 (table utensils), expected 9616.10
    //    "10ml EvrAir pressurized decant bottle - Gold" → 7323.93, expected 9616.10
    //    Root cause: spray/atomizer bottles for cosmetics end up in kitchen utensils (ch.73).
    //    9616.10 = scent sprays and similar toilet sprays and their mounts/fittings
    {
      const existing = allRules.find(r => r.id === 'ATOMIZER_SPRAY_BOTTLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ATOMIZER_SPRAY_BOTTLE_INTENT',
          description: 'Perfume atomizers, spray bottles for cosmetics → 9616.10 (ch.96), deny ch.73',
          pattern: {
            anyOf: [
              // Atomizer bottles
              'atomizer bottle', 'atomizer spray bottle', 'spray atomizer',
              'perfume atomizer', 'glass atomizer', 'mini atomizer',
              'travel atomizer', 'refillable atomizer',
              // Decant bottles/sprayers
              'decant bottle', 'perfume decant', 'decant atomizer',
              'travel perfume bottle', 'travel perfume atomizer',
              // Other spray/pump bottles for cosmetics
              'cosmetic spray bottle', 'fine mist sprayer',
              // General atomizer terms
              'atomizer', 'scent atomizer',
            ],
            noneOf: [
              // Exclude garden/cleaning sprayers
              'garden sprayer', 'pump sprayer', 'pressure sprayer',
              'spray paint', 'aerosol spray',
              // Exclude nasal/medical sprayers
              'nasal spray', 'throat spray',
            ],
          },
          inject: [
            { prefix: '9616.10', syntheticRank: 2 },  // scent sprays/atomizers and mounts
            { prefix: '9616.20', syntheticRank: 4 },  // powder puffs/powder applicators
          ],
          whitelist: {
            allowChapters: ['96'],                     // misc manufactured articles
            denyChapters: ['73', '22'],                // deny iron/steel articles and beverages
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9616.' },    // boost toilet sprays
            { delta: 0.50, chapterMatch: '96' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '73' },       // strong penalty for iron/steel articles
            { delta: 0.60, chapterMatch: '22' },
          ],
        } as IntentRule;
        patches.push({ priority: 538, rule: newRule });
        console.log('ATOMIZER_SPRAY_BOTTLE_INTENT: created (atomizer bottles → 9616.10, deny ch.73)');
      } else {
        console.log('ATOMIZER_SPRAY_BOTTLE_INTENT: already exists, skipping');
      }
    }

    // 2. UPDATE LAMP_SHADE_LIGHT_FIXTURE_INTENT — add 'led base', 'lamp base', 'light base'
    //    "LED Base sample" → 8539.31 (LED lamps/bulbs), expected 9405.21 (table/floor lamp)
    //    Root cause: 'led base' not in anyOf; bare 'LED' routes to ch.85.
    {
      const existing = allRules.find(r => r.id === 'LAMP_SHADE_LIGHT_FIXTURE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const newPhrases = [
          'led base', 'lamp base', 'light base', 'led lamp base',
          'luminaire base', 'lighting base',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
            noneOf: currentNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 539, rule: updated });
        console.log('LAMP_SHADE_LIGHT_FIXTURE_INTENT: added led base / lamp base phrases');
      } else {
        console.log('LAMP_SHADE_LIGHT_FIXTURE_INTENT: not found');
      }
    }

    // 3. FIX ESSENTIAL_OIL_COSMETIC_INTENT — remove 'face oil' from anyOf, add to noneOf
    //    "Balsam Fir Face Oil" exp:3401.30 (soap/surface-active) → now gets 3301.29 (essential oil)
    //    because 'face oil' in anyOf fires intent → pushes to ch.33.
    //    Face cleansing oils are classified as soap/surface-active products (3401 = ch.34), NOT essential oils.
    {
      const existing = allRules.find(r => r.id === 'ESSENTIAL_OIL_COSMETIC_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        // Remove 'face oil' from anyOf
        const updatedAnyOf = currentAnyOf.filter((p: string) => p !== 'face oil');
        // Add face/cleansing oil terms to noneOf to prevent ch.34 items from triggering
        const updatedNoneOf = [...new Set([
          ...currentNoneOf,
          'face oil', 'facial oil', 'cleansing oil', 'face cleansing oil',
          'face wash oil', 'face serum', 'skin serum',
        ])];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: updatedAnyOf,
            noneOf: updatedNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 539, rule: updated });
        console.log('ESSENTIAL_OIL_COSMETIC_INTENT: removed face oil from anyOf (regression fix)');
      } else {
        console.log('ESSENTIAL_OIL_COSMETIC_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT96)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT96 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
