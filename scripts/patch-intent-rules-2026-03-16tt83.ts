#!/usr/bin/env ts-node
/**
 * Patch TT83 — 2026-03-16: Wool yarn blends, acrylic yarn brands, board game overlays, zipper pouches.
 *
 * Fixes:
 *  1. UPDATE WOOL_YARN_FIBER_INTENT — add wool blend percentage patterns
 *     "300g 75%wool/25%nylon knitting yarn" → 5205 (cotton) WRONG (expected 5106)
 *     BUG: 'wool yarn' doesn't match "75%wool/25%nylon knitting yarn" (non-adjacent)
 *     FIX: Add 'wool/nylon yarn', 'wool blend yarn', '%wool' style patterns
 *
 *  2. UPDATE SYNTHETIC_MMF_YARN_INTENT — add brand name variations
 *     "Heartland Yarn by Lionbrand" → 5208 cotton WRONG (expected 5509 acrylic)
 *     BUG: 'lion brand' doesn't match "lionbrand" (no space variant)
 *     FIX: Add 'lionbrand', 'lion brand yarn', 'lionbrand yarn' etc.
 *
 *  3. UPDATE BOARD_GAME_PLASTIC_INSERT_INTENT — add broader overlay patterns
 *     "4 Overlays WITHOUT BACKBOARDS for Clans of Caledonia player board" → 8405 WRONG
 *     BUG: 'board overlays' doesn't match because "BACKBOARDS" precedes the context
 *     FIX: Add simpler phrases, context-free 'overlays' with game terms
 *
 *  4. UPDATE ZIPPER_INTENT — add noneOf for fabric/textile pouch context
 *     "Handmade quilted zipper pouch" → 9607 WRONG (expected 5801.26)
 *     BUG: 'zipper' triggers ZIPPER_INTENT with allowPrefixes:['9607.'] → blocks all non-9607
 *     FIX: Add 'zipper pouch', 'zipper bag', 'zipper case' to ZIPPER_INTENT noneOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt83.ts
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

    // 1. UPDATE WOOL_YARN_FIBER_INTENT — add wool blend percentage patterns
    //    "300g 75%wool/25%nylon knitting yarn" → 5205 WRONG (expected 5106)
    //    BUG: "75%wool/25%nylon knitting yarn" doesn't contain "wool yarn" adjacent
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Wool blend percentage patterns
          'wool/nylon yarn', 'wool nylon yarn', 'wool nylon knitting',
          'wool/acrylic yarn', 'wool acrylic yarn', 'wool acrylic blend yarn',
          'wool/polyester yarn', 'wool polyester blend',
          // Percentage-based wool patterns
          '75%wool', '80%wool', '70%wool', '60%wool', '50%wool',
          '75% wool', '80% wool', '70% wool', '50% wool',
          // General blend wool
          'wool blend yarn', 'wool blend knitting', 'blended wool yarn',
          // Superwash wool
          'superwash merino yarn', 'superwash wool yarn',
          'sw merino', 'sw wool',
          // Additional merino patterns
          'merino blend yarn', 'merino nylon yarn', 'merino wool nylon',
          // Lace weight wool
          'lace weight wool', 'fingering weight wool', 'dk weight wool',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('WOOL_YARN_FIBER_INTENT: added wool blend, percentage patterns');
      } else {
        console.log('WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // 2. UPDATE SYNTHETIC_MMF_YARN_INTENT — add brand name variations
    //    "Heartland Yarn by Lionbrand" → 5208 WRONG (expected 5509)
    //    BUG: 'lion brand' (with space) doesn't match "lionbrand" (no space)
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_MMF_YARN_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // LionBrand brand variations
          'lionbrand', 'lionbrand yarn', 'lionbrand wool',
          'lion brand heartland', 'heartland yarn', 'lion brand yarn',
          // More yarn brand names (acrylic/synthetic)
          'paintbox yarn', 'scheepjes yarn', 'drops yarn', 'drops design',
          'paintbox simply dk', 'hayfield yarn', 'james brett',
          // Acrylic yarn specific descriptions
          '100% acrylic yarn', 'pure acrylic yarn',
          'acrylic weight yarn', 'washable acrylic',
          // Synthetic fiber percentages
          '100% polyester yarn', '100% nylon yarn',
          '100% acrylic knitting', '100% acrylic crochet',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('SYNTHETIC_MMF_YARN_INTENT: added lionbrand, brand name variations, 100% acrylic patterns');
      } else {
        console.log('SYNTHETIC_MMF_YARN_INTENT: not found');
      }
    }

    // 3. UPDATE BOARD_GAME_PLASTIC_INSERT_INTENT — add broader overlay patterns
    //    "4 Overlays WITHOUT BACKBOARDS for Clans of Caledonia player board" → 8405 WRONG
    //    BUG: 'board overlays' doesn't match because "BACKBOARDS" != "board overlays"
    //    FIX: Add standalone context patterns and game-specific phrases
    {
      const existing = allRules.find(r => r.id === 'BOARD_GAME_PLASTIC_INSERT_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Standalone overlay in game context
          'overlays without backboards', 'overlays backboards',
          'caledonia overlay', 'caledonia overlays', 'caledonia player',
          // Common board game names with overlays
          'terraforming mars overlay', 'wingspan overlay', 'agricola overlay',
          'everdell overlay', 'pandemic overlay', 'gloomhaven overlay',
          // Dashboard inserts for popular games
          'game dashboard insert', 'game dashboard overlay',
          // Player components
          'player component overlay', 'resource track overlay',
          'player mat overlay', 'player mat insert',
          // Any overlay + player board
          'overlay player board', 'overlays player board',
          'without backboards', 'with backboards insert',
          // Acrylic game components
          'acrylic game component', 'acrylic player mat',
          'acrylic token set', 'acrylic resource token',
          // Plastic game inserts/organizers
          'plastic game organizer', 'plastic game insert', 'game box organizer plastic',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 557, rule: updated });
        console.log('BOARD_GAME_PLASTIC_INSERT_INTENT: added broader overlay patterns, game names');
      } else {
        console.log('BOARD_GAME_PLASTIC_INSERT_INTENT: not found');
      }
    }

    // 4. UPDATE ZIPPER_INTENT — add noneOf for fabric/textile pouch context
    //    "Handmade quilted zipper pouch" → 9607 WRONG (expected 5801.26 woven pile fabric)
    //    BUG: 'zipper' triggers ZIPPER_INTENT with allowPrefixes:['9607.'] → forces ch.96 result
    //    FIX: When zipper = part of a fabric bag/pouch, ZIPPER_INTENT should not fire
    {
      const existing = allRules.find(r => r.id === 'ZIPPER_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const newNoneOf = [
          ...currentNoneOf,
          // Fabric/textile bags with zipper (the item IS a bag/pouch, zipper is incidental)
          'zipper pouch', 'zipper bag', 'zipper tote',
          'quilted zipper', 'fabric zipper bag', 'zipper wallet',
          'zipper pencil', 'zipper coin', 'zipper make up',
          'zipper makeup pouch', 'zipper cosmetic bag',
          // Handmade/craft textile items with zipper
          'handmade zipper', 'sewn zipper pouch', 'knit zipper',
          'zipper case fabric', 'fabric zipper case',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set(newNoneOf)],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('ZIPPER_INTENT: added fabric/textile pouch context to noneOf');
      } else {
        console.log('ZIPPER_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT83)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT83 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
