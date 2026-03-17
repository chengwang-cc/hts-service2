#!/usr/bin/env ts-node
/**
 * Patch TT10 — 2026-03-15: Wood items + plated jewelry fix.
 * Current: 30.25% (1520/5025)
 *
 * Fixes:
 *  1. PLATED_JEWELRY_INTENT: add noneOf for 'gold filled'/'gold plated'
 *     so gold-plated jewelry → 7113.20 not 7117 (imitation)
 *  2. WOOD_KITCHEN_UTENSIL_SCOOP_INTENT: wooden coffee scoop/salad bowl → 4419.19
 *  3. WOOD_CRAFT_PROFILE_SHAPE_INTENT: small craft wood pieces → 4409.29
 *  4. WOODEN_TOOL_HANDLE_INTENT: fiber beating stick, extruder handle → 4417.00
 *  5. WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT: wood ornament frames → 4414.90
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt10.ts
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

    // 1. PLATED_JEWELRY_INTENT: add noneOf for gold-filled/gold-plated
    //    "18K Gold-Plated Necklace Set" → getting 7117 (imitation) due to penalty on 7113
    //    Expected: 7113.20 (base metal clad with precious metal)
    //    Fix: add 'gold plated', 'gold filled' to noneOf so these don't trigger the penalty
    {
      const e = allRules.find(r => r.id === 'PLATED_JEWELRY_INTENT');
      if (e) {
        const pat = (e.pattern as any) ?? {};
        const updated = {
          ...pat,
          noneOf: [...new Set([
            ...(pat.noneOf ?? []),
            'gold plated', 'gold filled', 'gold-plated', 'gold-filled',
            '14k gold', '18k gold', '10k gold',
          ])],
        };
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: updated } });
        console.log('PLATED_JEWELRY_INTENT: added gold plated/filled to noneOf');
      }
    }

    // 2. WOOD_KITCHEN_UTENSIL_SCOOP_INTENT — wood coffee scoops/spoons/bowls → 4419.19
    //    "Handcrafted Walnut Wood Coffee Scoop" → getting 0901.90 (coffee), expected 4419.19
    //    "walnut salad bowl" → getting 6912 (ceramic), expected 4419.19.90
    {
      const existing = allRules.find(r => r.id === 'WOOD_KITCHEN_UTENSIL_SCOOP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_KITCHEN_UTENSIL_SCOOP_INTENT',
          description: 'Wooden kitchen utensils (scoops, bowls, spoons) → ch.44 (4419.19)',
          pattern: {
            anyOf: [
              'wood coffee scoop', 'wooden coffee scoop', 'walnut coffee scoop',
              'wood salad bowl', 'walnut salad bowl', 'wooden salad bowl',
              'wood serving bowl', 'walnut serving bowl',
              'wood coffee spoon', 'wooden spoon wood', 'walnut spoon',
              'wood measuring scoop', 'handcrafted wood scoop',
            ],
            noneOf: ['ceramic', 'porcelain', 'stainless', 'metal', 'plastic'],
          },
          inject: [{ prefix: '4419.19', syntheticRank: 4 }],
          whitelist: { allowChapters: ['44'] },
          boosts: [{ delta: 0.65, prefixMatch: '4419.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('WOOD_KITCHEN_UTENSIL_SCOOP_INTENT: created (walnut scoop → 4419.19)');
      }
    }

    // 3. WOOD_CRAFT_PROFILE_SHAPE_INTENT — small craft wood pieces/shapes → 4409.29
    //    "set of 12 small craft wood pieces" → getting 4407.19 (sawn timber)
    //    "wooden darning disc" → getting 8519.81 (audio player!)
    //    4409.29 = wood continuously shaped along face or edge
    {
      const existing = allRules.find(r => r.id === 'WOOD_CRAFT_PROFILE_SHAPE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_CRAFT_PROFILE_SHAPE_INTENT',
          description: 'Small craft wood pieces, shaped wood blanks → ch.44 (4409.29)',
          pattern: {
            anyOf: [
              'craft wood pieces', 'small craft wood', 'wood craft pieces', 'wood craft set',
              'wooden darning', 'darning disc', 'wooden disc', 'wood disc',
              'wood furniture moulding', 'wooden moulding', 'wood profile piece',
            ],
          },
          inject: [{ prefix: '4409.29', syntheticRank: 4 }],
          whitelist: { allowChapters: ['44'] },
          boosts: [{ delta: 0.55, prefixMatch: '4409.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOOD_CRAFT_PROFILE_SHAPE_INTENT: created (craft wood pieces → 4409.29)');
      }
    }

    // 4. WOODEN_TOOL_HANDLE_INTENT — wooden tool handles/sticks → 4417.00
    //    "Fiber beating stick" → getting 5503.20 (synthetic fiber), expected 4417.00.80
    //    "extruder handle" → expected 4417.00
    //    4417.00 = wooden tools, tool bodies/handles, wooden brooms/brushes handles
    {
      const existing = allRules.find(r => r.id === 'WOODEN_TOOL_HANDLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_TOOL_HANDLE_INTENT',
          description: 'Wooden tool handles, beating sticks, wooden tools → ch.44 (4417.00)',
          pattern: {
            anyOf: [
              'fiber beating stick', 'beating stick wood', 'beating stick',
              'wooden tool handle', 'wood tool handle', 'wooden handle',
              'extruder handle wood', 'wooden rolling pin', 'wood rolling pin',
              'clay texture roller wood', 'pottery roller wood',
            ],
            noneOf: ['stainless handle', 'metal handle', 'plastic handle', 'rubber handle'],
          },
          inject: [{ prefix: '4417.00', syntheticRank: 4 }],
          whitelist: { allowChapters: ['44'] },
          boosts: [{ delta: 0.60, prefixMatch: '4417.0' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOODEN_TOOL_HANDLE_INTENT: created (beating stick → 4417.00)');
      }
    }

    // 5. WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT — wooden Christmas ornaments/frames → 4414.90
    //    "2023 Christmas Shapes - Poinsettia" → getting 0602.90 (live plants!), expected 4414.90
    //    4414.90 = wooden frames for pictures/decorations (parts of frames)
    {
      const existing = allRules.find(r => r.id === 'WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT',
          description: 'Wooden Christmas ornament shapes, wood frames → ch.44 (4414.90)',
          pattern: {
            anyOf: [
              'wood christmas shapes', 'wooden christmas shape', 'christmas shape wood',
              'wooden christmas ornament', 'wood ornament shape', 'laser cut wood christmas',
              'christmas wood cutout', 'wood frame ornament', 'custom photo wood',
            ],
          },
          inject: [{ prefix: '4414.90', syntheticRank: 4 }],
          boosts: [{ delta: 0.60, prefixMatch: '4414.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT: created (wood christmas shape → 4414.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT10)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT10 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
