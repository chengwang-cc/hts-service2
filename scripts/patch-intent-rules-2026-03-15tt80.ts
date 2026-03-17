#!/usr/bin/env ts-node
/**
 * Patch TT80 — 2026-03-15: Silicone molds, vacuum hose attachments, automotive consoles.
 *
 * Fixes:
 *  1. NEW SILICONE_CRAFT_MOLD_INTENT → 3924/3910 (silicone molds for baking/crafts)
 *     "cake silicone mold" → 8480 (industrial injection molds!) WRONG (expected 3910.00)
 *     "MOLDING TAPES" → 8480 WRONG (expected 3919.10)
 *     BUG: "mold" → 8480 (industrial mold boxes/dies); "silicone" → ch.39 but "mold" overrides
 *     3910 = silicones in primary forms; 3924 = plastic housewares
 *     FIX: New intent for silicone/plastic craft molds → 3910/3924, deny ch.84
 *
 *  2. NEW PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT → 3917 (plastic tubes/hose)
 *     "M18 Milwaukee Vacuum Attachment - 100% Plastic" → 8508 (vacuum cleaners!) WRONG
 *     "M18 2 Gallon Vacuum Hose Attachment - Plastic" → 8508 WRONG (expected 3917.39)
 *     BUG: "vacuum" + "Milwaukee" → vacuum cleaner (8508); but these are plastic hose accessories
 *     3917.39 = other plastic tubes/hoses (rigid/flexible); 3926.90 = other plastic articles
 *     FIX: New intent for plastic vacuum attachments/hose accessories → 3917, deny ch.84/85
 *
 *  3. NEW AUTOMOTIVE_CENTER_CONSOLE_INTENT → 9403 (furniture/automotive interior)
 *     "Used Center Console Lid" → 9504 (gaming console!) WRONG (expected 9401.80)
 *     "Automotive Center Console Armrest" → 9504 WRONG (expected 9403.50)
 *     "Automotve console lid" → 9504 WRONG (expected 9403.70)
 *     BUG: "console" → 9504 (video game console); automotive console = interior furniture
 *     9403 = other furniture, its parts (automotive interior = furniture category)
 *     FIX: New intent for automotive center console, armrest, console lid → 9403/9401, deny ch.95
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt80.ts
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

    // 1. NEW SILICONE_CRAFT_MOLD_INTENT → 3924/3910
    //    "cake silicone mold" → 8480 WRONG (expected 3910.00)
    //    "MOLDING TAPES" → 8480 WRONG (expected 3919.10)
    //    BUG: "mold" → industrial mold boxes (8480); silicone craft molds should be ch.39
    //    3924 = plastic housewares; 3910 = silicones in primary forms; 3919.10 = self-adhesive strips
    {
      const existing = allRules.find(r => r.id === 'SILICONE_CRAFT_MOLD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILICONE_CRAFT_MOLD_INTENT',
          description: 'Silicone baking/craft molds, molding tapes → ch.39 (3924/3910/3919)',
          pattern: {
            anyOf: [
              // Silicone baking molds
              'silicone mold', 'silicone molds', 'silicone baking mold', 'silicone cake mold',
              'silicone bread mold', 'silicone cupcake mold', 'silicone chocolate mold',
              'silicone candy mold', 'silicone ice mold', 'silicone ice cube mold',
              // Silicone craft molds
              'silicone resin mold', 'silicone craft mold', 'resin silicone mold',
              'silicone epoxy mold', 'silicone soap mold', 'silicone candle mold',
              // Plastic molds for food/craft
              'plastic baking mold', 'cake mold plastic', 'chocolate mold plastic',
              // Molding tapes (self-adhesive plastic strips for trim)
              'molding tape', 'molding tapes', 'plastic molding tape', 'trim molding tape',
              // Epoxy/resin molds
              'epoxy resin mold', 'casting mold silicone',
            ],
            noneOf: [
              // Exclude industrial/metal molds
              'injection mold', 'metal mold', 'steel mold', 'aluminum mold',
              'mold base', 'mold insert', 'cavity mold',
              'molding machine', 'injection molding',
              // Exclude candle molds that are metal
              'metal candle mold', 'tin candle mold',
            ],
          },
          inject: [
            { prefix: '3924.10', syntheticRank: 2 },  // plastic tableware/kitchenware
            { prefix: '3910.00', syntheticRank: 5 },  // silicones in primary forms
            { prefix: '3926.90', syntheticRank: 8 },  // other articles of plastics
            { prefix: '3919.10', syntheticRank: 12 }, // self-adhesive plastic (for molding tapes)
          ],
          whitelist: {
            denyChapters: ['84', '83'],               // deny industrial machinery, misc metal
          },
          boosts: [
            { delta: 0.75, prefixMatch: '3924.' },
            { delta: 0.60, prefixMatch: '3910.' },
            { delta: 0.40, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '84' },      // penalize industrial molds
          ],
        } as IntentRule;
        patches.push({ priority: 562, rule: newRule });
        console.log('SILICONE_CRAFT_MOLD_INTENT: created (silicone/craft molds → 3924/3910, deny ch.84)');
      } else {
        console.log('SILICONE_CRAFT_MOLD_INTENT: already exists');
      }
    }

    // 2. NEW PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT → 3917 (plastic tubes/hose)
    //    "M18 Milwaukee Vacuum Attachment - 100% Plastic" → 8508 WRONG (expected 3917.39)
    //    BUG: "vacuum" triggers vacuum cleaner (8508); plastic hose = 3917 (plastic tubes)
    //    3917.39 = other plastic tubes (not sewn); used for vacuum hose accessories
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT',
          description: 'Plastic vacuum hose/tube attachments and accessories → 3917 (plastic hoses)',
          pattern: {
            anyOf: [
              // Plastic vacuum attachments
              'plastic vacuum attachment', 'vacuum hose attachment plastic',
              'plastic vacuum hose', 'vacuum attachment plastic',
              '100% plastic vacuum', 'plastic vacuum accessory',
              // Milwaukee M18 vacuum parts (100% plastic)
              'm18 vacuum attachment', 'm18 vacuum hose',
              // Dust adapter plastic
              'dust adapter plastic', 'plastic dust adapter',
              'plastic dust hose', 'vacuum dust port adapter',
              // Miter saw/tool plastic hose fittings
              'miter saw dust adapter', 'saw dust adapter plastic',
              'plastic hose adapter', 'dust collection hose adapter',
            ],
            noneOf: [
              // Exclude actual vacuum cleaners
              'vacuum cleaner', 'robot vacuum', 'handheld vacuum',
              // Exclude vacuum bags (textile)
              'vacuum bag', 'vacuum seal bag',
            ],
          },
          inject: [
            { prefix: '3917.39', syntheticRank: 2 },  // other plastic tubes (not sewn)
            { prefix: '3917.40', syntheticRank: 5 },  // fittings of plastic tubes
            { prefix: '3926.90', syntheticRank: 8 },  // other plastic articles
          ],
          whitelist: {
            denyChapters: ['84', '85'],               // deny machinery and electrical equipment
          },
          boosts: [
            { delta: 0.75, prefixMatch: '3917.' },
            { delta: 0.40, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '85' }, // penalize electrical/vacuum cleaners
            { delta: 0.65, chapterMatch: '84' }, // penalize machinery
          ],
        } as IntentRule;
        patches.push({ priority: 561, rule: newRule });
        console.log('PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT: created (plastic vacuum hose → 3917, deny ch.84/85)');
      } else {
        console.log('PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT: already exists');
      }
    }

    // 3. NEW AUTOMOTIVE_CENTER_CONSOLE_INTENT → 9403/9401 (automotive furniture/seats)
    //    "Used Center Console Lid" → 9504 (gaming console!) WRONG (expected 9401.80)
    //    "Automotive Center Console Armrest" → 9504 WRONG (expected 9403.50)
    //    BUG: "console" → video game console (9504.50); automotive consoles = interior furniture
    //    9401 = seats/chairs (vehicle seats, console lids); 9403 = other furniture (armrests, trim)
    //    FIX: New intent for automotive center console, armrest, console lid → 9403/9401, deny ch.95
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_CENTER_CONSOLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_CENTER_CONSOLE_INTENT',
          description: 'Automotive center console, armrest, console lid → ch.94 (9403/9401)',
          pattern: {
            anyOf: [
              // Center console
              'center console lid', 'centre console lid',
              'center console cover', 'center console armrest',
              'automotive center console', 'car center console',
              'console lid', 'console armrest', 'console cover',
              // Automotive armrests
              'car armrest', 'auto armrest', 'automotive armrest',
              'armrest lid', 'armrest cover', 'armrest pad',
              // Automotive interior trim
              'automotive interior trim', 'car interior panel',
              'door panel liner', 'dashboard trim piece',
            ],
            noneOf: [
              // Exclude gaming consoles
              'game console', 'gaming console', 'playstation', 'xbox', 'nintendo switch',
              // Exclude center consoles in boats
              'boat console', 'marine console',
            ],
          },
          inject: [
            { prefix: '9403.50', syntheticRank: 2 },  // furniture of wood for bedroom/office
            { prefix: '9403.70', syntheticRank: 4 },  // furniture of other materials
            { prefix: '9401.80', syntheticRank: 6 },  // other seats
            { prefix: '9401.90', syntheticRank: 8 },  // parts of seats
          ],
          whitelist: {
            allowChapters: ['94', '87'],               // furniture/lighting OR motor vehicles
            denyChapters: ['95', '85', '84'],          // deny toys/games, electrical, machinery
          },
          boosts: [
            { delta: 0.75, prefixMatch: '9403.' },
            { delta: 0.65, prefixMatch: '9401.' },
            { delta: 0.40, chapterMatch: '94' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '95' },      // penalize games/toys
          ],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('AUTOMOTIVE_CENTER_CONSOLE_INTENT: created (console lid/armrest → 9403/9401, deny ch.95)');
      } else {
        console.log('AUTOMOTIVE_CENTER_CONSOLE_INTENT: already exists');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT80)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT80 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
