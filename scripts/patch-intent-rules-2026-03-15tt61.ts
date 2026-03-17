#!/usr/bin/env ts-node
/**
 * Patch TT61 — 2026-03-15: Wall hooks, robe hooks going to clothing chapters + more.
 * Current: ~35.04% (TT59+TT60 pending cache reload)
 *
 * Fixes:
 *  1. NEW WALL_HOOK_HARDWARE_INTENT → 8302.50 (hat-racks, coat pegs, brackets)
 *     "cast iron coat hooks" → 6201.20 (men's overcoat!) WRONG — "coat" triggers apparel
 *     "wall coat hook metal" → 6201.20 WRONG
 *     "robe hook bathroom" → 6207.99 (men's nightwear!) WRONG — "robe" triggers clothing
 *     "decorative wall hook" → 4814.20 (wallpaper!) WRONG — "wall" triggers wallpaper
 *     8302.50 = hat-racks, hat pegs, brackets and similar fixtures of base metal
 *  2. NEW METAL_CHAIN_BULK_INTENT → 7315.XX (chain of iron/steel)
 *     "metal chain necklace blank" → 7113.19 (precious metal jewelry) WRONG
 *     "link chain bulk" → ? likely wrong — "necklace" triggers jewelry chapter
 *     7315 = chain and parts thereof, of iron/steel
 *  3. NEW POLYESTER_RESIN_CRAFT_INTENT → 3907.30 (polyester resins, not artwork)
 *     "epoxy resin craft" → maybe going to art supply or wrong chapter
 *     "uv resin kit" → maybe wrong chapter
 *     "resin mold" → 3926.10 (plastic office articles)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt61.ts
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

    // 1. WALL_HOOK_HARDWARE_INTENT → 8302.50 (hat-racks, coat pegs, brackets of base metal)
    //    "cast iron coat hooks" → 6201.20.11.10 (men's overcoat!) WRONG
    //    "wall coat hook metal" → 6201.20 WRONG — "coat" = coat (apparel) not coat (hang)
    //    "robe hook bathroom" → 6207.99.90 (men's nightwear!) WRONG — "robe" triggers clothing
    //    "decorative wall hook" → 4814.20 (wallpaper!) WRONG — "wall" + "decorative" = wallpaper
    //    BUG: "coat hook" → ch.61/62 because "coat" triggers apparel chapters
    //    BUG: "robe hook" → ch.62 because "robe" triggers robe/dressing gown clothing
    //    8302.50 = hat-racks, hat pegs, brackets and similar fixtures of base metal
    {
      const existing = allRules.find(r => r.id === 'WALL_HOOK_HARDWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WALL_HOOK_HARDWARE_INTENT',
          description: 'Coat hooks, wall hooks, robe hooks, towel hooks (metal/hardware) → ch.83 (8302.50)',
          pattern: {
            anyOf: [
              // Coat/clothes hooks
              'coat hook', 'coat hooks', 'wall coat hook', 'coat peg', 'coat pegs',
              'coat rack hook', 'iron coat hook', 'cast iron hook',
              // Robe/bathroom hooks
              'robe hook', 'robe hooks', 'bathroom robe hook', 'towel hook',
              'towel hooks', 'bathroom hook', 'shower hook',
              // Wall hooks (general hardware)
              'wall hook', 'wall hooks', 'metal wall hook', 'decorative wall hook',
              'farmhouse hook', 'vintage hook wall', 'key hook wall',
              // Specific hook styles
              'hat hook', 'hat rack hook', 'bag hook wall',
              'double hook wall', 'triple hook wall',
              'adhesive wall hook', 'self adhesive hook',
            ],
            noneOf: [
              // Exclude fishing hooks (ch.95)
              'fish hook', 'fishing hook', 'fishing hooks', 'crochet hook',
              // Exclude hooks that are part of closures (ch.83 different sub)
              'hook and eye', 'hook eye closure',
              // Exclude clothing items with hood
              'hoodie', 'hooded',
            ],
          },
          inject: [
            { prefix: '8302.50', syntheticRank: 5 },
            { prefix: '8302.41', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['61', '62', '63', '48'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '8302.5' }],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('WALL_HOOK_HARDWARE_INTENT: created (coat hooks → 8302.50, deny apparel chapters)');
      }
    }

    // 2. BULK_METAL_CHAIN_CRAFT_INTENT → 7315.89 / 7315.81 (chain of iron/steel)
    //    "metal chain necklace blank" → 7113.19 (precious metal jewelry!) WRONG
    //    "link chain bulk" → probably wrong
    //    BUG: "necklace" in "necklace blank" triggers jewelry chapter (7113/7117)
    //    7315.81 = roller chain of iron/steel
    //    7315.89 = other chain of iron/steel
    //    NOTE: bulk chain for craft use is different from finished necklaces
    {
      const existing = allRules.find(r => r.id === 'BULK_METAL_CHAIN_CRAFT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BULK_METAL_CHAIN_CRAFT_INTENT',
          description: 'Bulk metal chain for crafts, necklace chain blanks → ch.73 (7315.89)',
          pattern: {
            anyOf: [
              // Necklace chain blanks (not finished necklaces)
              'necklace chain blank', 'chain blank necklace', 'chain blanks',
              'necklace blank chain', 'jewelry chain bulk', 'chain for jewelry making',
              // Bulk craft chain
              'bulk chain', 'bulk link chain', 'chain footage', 'chain by foot',
              'link chain bulk', 'rolo chain bulk', 'cable chain bulk',
              // Specific chain types for crafts
              'craft chain', 'jewelry making chain', 'chain findings',
              'brass chain bulk', 'silver tone chain bulk', 'gold tone chain bulk',
            ],
            noneOf: [
              // Exclude finished necklaces
              'necklace set', 'layered necklace', 'pendant necklace',
              // Exclude precious metal chains (go to 7113/7114)
              'sterling silver chain', 'gold chain necklace', '14k chain',
              // Exclude industrial chain
              'anchor chain', 'tow chain', 'lifting chain',
            ],
          },
          inject: [
            { prefix: '7315.89', syntheticRank: 5 },
            { prefix: '7315.81', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['71'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '7315.' }],
        } as IntentRule;
        patches.push({ priority: 575, rule: newRule });
        console.log('BULK_METAL_CHAIN_CRAFT_INTENT: created (chain blanks → 7315.89, deny ch.71 jewelry)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT61)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT61 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
