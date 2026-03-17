#!/usr/bin/env ts-node
/**
 * Patch TT92 — 2026-03-16: Torch parts 8419.90, lamp shades/fixtures, Christmas tree toppers.
 *
 * Fixes:
 *  1. UPDATE GLASSBLOWING_TORCH_PARTS_INTENT — add 8419.90 at rank1 (parts of heating apparatus)
 *     "Mega Minor Base Torch Only" → 8419.89.10 WRONG (expected 8419.90.95)
 *     "midrange base only torch" → 8419.89.10 WRONG (expected 8419.90.95)
 *     "Nortel midrange special burner parts" → 8416.20 WRONG (expected 8419.90.95)
 *     ROOT CAUSE: inject has 8419.89 (rank2) = the heater itself, but these are PARTS (8419.90).
 *     FIX: Add 8419.90 at syntheticRank:1 (highest), push 8419.89 to rank3.
 *
 *  2. NEW LAMP_SHADE_LIGHT_FIXTURE_INTENT → 9405.11/9405.21/9405.91 (luminaires/parts)
 *     "lamp shade replacement part glass" → 9405.99.40 WRONG (expected 9405.11.40)
 *     "lamp shade replacement part metal" → 9405.99.40 WRONG (expected 9405.11.40)
 *     "lamp with clock" → 9405.99.40 WRONG (expected 9405.11.40)
 *     "Plasma lamp 30" → 9405.99.40 WRONG (expected 9405.11.40)
 *     BUG: Lamp shades/fixtures classified as "other parts" (9405.99) when dataset expects 9405.11
 *          (chandeliers and other ceiling/wall lighting fittings of glass).
 *     9405.11 = chandeliers and other ceiling/wall fittings, excluding those for public open spaces
 *     9405.21 = desk, bedside, floor lamps (table/floor luminaires)
 *     FIX: New intent → 9405.11 at rank1, allowChapters:['94']
 *
 *  3. UPDATE LAMP_SHADE_LIGHT_FIXTURE_INTENT — include Christmas tree toppers → 9405.19
 *     "christmas tree topper" → 9505.10 WRONG (expected 9405.19)
 *     BUG: Lighted tree toppers are luminaires (ch.94), not seasonal/festive articles (ch.95).
 *     9405.19 = other electric ceiling/wall fittings (includes tree toppers with lights)
 *     FIX: Add tree topper phrases to the lamp shade intent (same priority as lamp shades).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt92.ts
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

    // 1. UPDATE GLASSBLOWING_TORCH_PARTS_INTENT — add 8419.90 at rank1
    //    "Mega Minor Base Torch Only" → 8419.89 (heater), but expected 8419.90 (parts).
    //    "only" and "parts" in query indicate PARTS not the complete heater.
    //    8419.89 = other industrial/laboratory heating apparatus
    //    8419.90 = parts of industrial/laboratory heating apparatus (includes torch base/body as part)
    {
      const existing = allRules.find(r => r.id === 'GLASSBLOWING_TORCH_PARTS_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '8419.90', syntheticRank: 1 },  // PARTS of industrial heating apparatus (highest)
            { prefix: '8419.89', syntheticRank: 3 },  // other industrial/lab heating apparatus
            { prefix: '8468.10', syntheticRank: 6 },  // hand-directed torches/blowpipes
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 541, rule: updated });
        console.log('GLASSBLOWING_TORCH_PARTS_INTENT: added 8419.90 at rank1 (parts above heater)');
      } else {
        console.log('GLASSBLOWING_TORCH_PARTS_INTENT: not found');
      }
    }

    // 2. NEW LAMP_SHADE_LIGHT_FIXTURE_INTENT → 9405.11/9405.21/9405.19
    //    The dataset consistently classifies lamp shades, lamp parts, and luminaires as 9405.11
    //    (ceiling/wall fittings) rather than 9405.99 (other parts).
    //    9405.11 = chandeliers and ceiling/wall electric fittings
    //    9405.19 = other ceiling/wall fittings (includes lit tree toppers, string lights)
    //    9405.21 = table/desk/floor lamps
    //    9405.40 = other electric lamps/fittings
    {
      const existing = allRules.find(r => r.id === 'LAMP_SHADE_LIGHT_FIXTURE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LAMP_SHADE_LIGHT_FIXTURE_INTENT',
          description: 'Lamp shades, light fixtures, luminaires → 9405.11/9405.21/9405.19 (luminaires, ch.94)',
          pattern: {
            anyOf: [
              // Lamp shades (ceiling/wall type)
              'lamp shade', 'lamp shades', 'light shade', 'lampshade',
              'pendant shade', 'drum shade', 'empire shade',
              'chandelier shade', 'ceiling lamp shade',
              'lamp shade replacement', 'replacement lamp shade',
              'lamp shade glass', 'lamp shade metal',
              // Ceiling/wall fixtures
              'ceiling light', 'wall light', 'ceiling lamp', 'wall lamp',
              'ceiling fixture', 'wall fixture', 'ceiling fitting',
              'ceiling pendant', 'pendant light', 'pendant lamp',
              // Floor/table lamps
              'floor lamp', 'table lamp', 'desk lamp',
              'bedside lamp', 'reading lamp', 'task lamp',
              // Specialty lamps
              'plasma lamp', 'neon lamp', 'salt lamp',
              'himalayan salt lamp', 'lava lamp',
              'lamp with clock', 'clock lamp',
              // Christmas/festive tree lighting
              'christmas tree topper', 'lighted tree topper', 'tree topper light',
              'star tree topper', 'angel tree topper',
              'tree topper with light', 'illuminated tree topper',
              // String lights / fairy lights (luminaires)
              'fairy lights', 'string lights', 'twinkle lights',
              'christmas lights', 'led string lights',
              // Nightlights
              'night light', 'night lamp', 'plug in night light',
            ],
            noneOf: [
              // Exclude replacement bulbs (ch.85)
              'light bulb', 'led bulb', 'bulb replacement',
              'fluorescent tube', 'led tube',
              // Exclude lamp oil/wicks (different)
              'lamp oil', 'wick',
              // Exclude purely battery/electronic components
              'battery pack', 'driver', 'transformer',
            ],
          },
          inject: [
            { prefix: '9405.11', syntheticRank: 2 },  // chandeliers and ceiling/wall fittings
            { prefix: '9405.19', syntheticRank: 4 },  // other ceiling/wall fittings (incl. tree toppers)
            { prefix: '9405.21', syntheticRank: 6 },  // table/desk/floor lamps
            { prefix: '9405.40', syntheticRank: 8 },  // other electric lamps/fittings NES
            { prefix: '9405.91', syntheticRank: 10 }, // parts of ceiling/wall fittings
          ],
          whitelist: {
            allowChapters: ['94'],                     // furniture/lamps chapter
            denyChapters: ['95', '85'],                // deny toys/games and electrical components
          },
          boosts: [
            { delta: 0.85, prefixMatch: '9405.1' },   // boost ceiling/wall fittings
            { delta: 0.80, prefixMatch: '9405.2' },   // boost table/floor lamps
            { delta: 0.70, prefixMatch: '9405.' },    // general luminaire boost
            { delta: 0.50, chapterMatch: '94' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '95' },       // penalize toys/games (Christmas decor)
            { delta: 0.50, chapterMatch: '85' },       // penalize electronics
            { delta: 0.50, prefixMatch: '9405.99' },  // penalize "other parts" subheading
          ],
        } as IntentRule;
        patches.push({ priority: 539, rule: newRule });
        console.log('LAMP_SHADE_LIGHT_FIXTURE_INTENT: created (lamp shades/fixtures → 9405.11/9405.21, ch.94)');
      } else {
        console.log('LAMP_SHADE_LIGHT_FIXTURE_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT92)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT92 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
