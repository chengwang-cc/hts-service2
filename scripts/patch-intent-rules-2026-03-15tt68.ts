#!/usr/bin/env ts-node
/**
 * Patch TT68 — 2026-03-15: Fix TABLET/SLATE conflict (EMPTY), sticker injections, 6803 for slate.
 *
 * Fixes:
 *  1. UPDATE TABLET_COMPUTER_INTENT — add noneOf for slate stone product terms
 *     "slate coaster" / "Set of 4 Slate Coasters" / "Personalized Slate Trophy" → EMPTY
 *     BUG: TABLET_COMPUTER_INTENT has "slate" in anyOf + allowPrefixes:["8471."]
 *     When SLATE_STONE_PRODUCT_INTENT (denyChapters:['84']) fires simultaneously,
 *     all entries fail: 8471.xx denied by SLATE, 6815.xx blocked by TABLET allowPrefixes
 *     FIX: Add 'slate coaster', 'slate coasters', 'slate trivet', etc. to TABLET noneOf
 *     → TABLET won't fire for slate products → SLATE_STONE_PRODUCT_INTENT takes over
 *
 *  2. UPDATE SLATE_STONE_PRODUCT_INTENT — add 6803.00 to inject
 *     "Set of 4 Slate Coasters" → expected 6803.00.50.00 (roofing slate)
 *     "Personalized Slate Trophy" → expected 6803.00.50.00
 *     FIX: Inject 6803.00 (slates and tiles of natural slate) in addition to 6815.99
 *
 *  3. UPDATE VINYL_STICKER_DECAL_INTENT — add "sticker"/"stickers" to anyOf, stronger boost
 *     "Jason Todd...stickers" → 4821 WRONG (expected 3919.10)
 *     "1.5x2.5 inch sticker" → 4821 WRONG (expected 3919.90)
 *     BUG: VINYL_STICKER_DECAL_INTENT anyOf has "sticker pack", "sticker sheet" but NOT
 *     bare "sticker" or "stickers" — generic sticker queries don't trigger injection
 *     FIX: Add "sticker", "stickers" to anyOf; increase syntheticRank to 1/2, boost to 0.70
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt68.ts
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

    // 1. UPDATE TABLET_COMPUTER_INTENT — add noneOf for slate stone products
    //    BUG: "slate" in anyOf fires for slate coasters/trophies.
    //    With allowPrefixes:["8471."], ONLY 8471.xx entries pass positive filter.
    //    SLATE_STONE_PRODUCT_INTENT denyChapters:["84"] denies 8471.xx.
    //    Result: all entries fail both filters → EMPTY.
    //    FIX: Add slate product terms to noneOf → TABLET won't fire → SLATE handles it.
    {
      const existing = allRules.find(r => r.id === 'TABLET_COMPUTER_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const slateNoneOf = [
          'slate coaster', 'slate coasters', 'slate trivet', 'slate plaque',
          'slate sign', 'slate trophy', 'slate board', 'slate stone',
          'slate serving board', 'slate cheese board', 'natural slate',
          'real slate', 'engraved slate', 'personalized slate',
          'quartzite coaster', 'limestone coaster', 'sandstone coaster',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...slateNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('TABLET_COMPUTER_INTENT: added slate product noneOf (prevents EMPTY for slate coasters)');
      } else {
        console.log('TABLET_COMPUTER_INTENT: not found');
      }
    }

    // 2. UPDATE SLATE_STONE_PRODUCT_INTENT — add 6803.00 to inject
    //    "Set of 4 Slate Coasters" → expected 6803.00.50.00 (roofing/floor/wall slate)
    //    "Personalized Slate Trophy" → expected 6803.00.50.00
    //    Current inject: [6815.99, 6815.10, 6802.29] — doesn't cover 6803
    //    6803.00 = worked slate and articles of slate (roofing, flooring, wall tiles)
    {
      const existing = allRules.find(r => r.id === 'SLATE_STONE_PRODUCT_INTENT');
      if (existing) {
        const currentInject = (existing as any).inject || [];
        // Check if 6803.00 is already injected
        if (!currentInject.some((i: any) => i.prefix === '6803.00')) {
          const updated = {
            ...existing,
            inject: [
              ...currentInject,
              { prefix: '6803.00', syntheticRank: 3 },
            ],
          } as IntentRule;
          patches.push({ priority: 0, rule: updated });
          console.log('SLATE_STONE_PRODUCT_INTENT: added 6803.00 inject (slate trophies/coasters → 6803)');
        } else {
          console.log('SLATE_STONE_PRODUCT_INTENT: 6803.00 already injected');
        }
      } else {
        console.log('SLATE_STONE_PRODUCT_INTENT: not found');
      }
    }

    // 3. UPDATE VINYL_STICKER_DECAL_INTENT — add bare "sticker"/"stickers" to anyOf
    //    "Jason Todd/Red Hood and his Dog Stickers" → 4821 (expected 3919.10) WRONG
    //    "1.5x2.5 inch sticker" → 4821 (expected 3919.90) WRONG
    //    "Anne of Green Gables Handmade original art stickers" → 4821 (expected 3919.90) WRONG
    //    BUG: anyOf has "sticker pack", "sticker sheet" but NOT bare "sticker"/"stickers"
    //    So queries with just "sticker" or "stickers" don't trigger 3919 injection
    //    FIX: Add "sticker", "stickers" to anyOf; strengthen injection (syntheticRank:1/2)
    {
      const existing = allRules.find(r => r.id === 'VINYL_STICKER_DECAL_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        // Add bare sticker terms
        const newAnyOf = [...new Set([...currentAnyOf, 'sticker', 'stickers', 'sticker set'])];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: newAnyOf,
            noneOf: [...new Set([...currentNoneOf,
              // Don't route nail stickers to self-adhesive plastic
              'nail sticker', 'nail art sticker', 'gel nail sticker',
              // Don't route gel/polish products
              'gel sticker',
            ])],
          },
          inject: [
            { prefix: '3919.10', syntheticRank: 1 }, // self-adhesive sheets in rolls
            { prefix: '3919.90', syntheticRank: 2 }, // other self-adhesive plastic
          ],
          boosts: [{ delta: 0.70, prefixMatch: '3919.' }],
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('VINYL_STICKER_DECAL_INTENT: added "sticker"/"stickers" to anyOf, boosted injection');
      } else {
        console.log('VINYL_STICKER_DECAL_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT68)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT68 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
