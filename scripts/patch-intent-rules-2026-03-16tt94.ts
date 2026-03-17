#!/usr/bin/env ts-node
/**
 * Patch TT94 — 2026-03-16: Fix COTTON_BABY_BLANKET regression, WOOD_DISPLAY_STAND anyOf.
 *
 * Fixes:
 *  1. FIX COTTON_BABY_BLANKET_INTENT — add synthetic fibers to noneOf
 *     "Crochet Acrylic Baby Blanket" → 6301.90 WRONG (expected 6111.30 knitted garment)
 *     ROOT CAUSE: COTTON_BABY_BLANKET_INTENT fires for 'baby blanket' phrase, sets allowChapters:['63'],
 *                 blocking ch.61 (knitted garments) from 6111.30 result.
 *     FIX: Add 'acrylic', 'polyester', 'nylon', 'synthetic' to noneOf so the intent doesn't fire
 *          for synthetic fiber products which belong in ch.61 (knitted) not ch.63 (blankets).
 *
 *  2. FIX WOOD_DISPLAY_STAND_INTENT — add anyOfGroups for context-restricted matching
 *     "Large Wood Stand / Place Card, Business Card, Retail Signage" → still 9504.90 WRONG (expected 4404.20)
 *     ROOT CAUSE: anyOf has 'wood place card', 'place card holder' etc. but query has
 *                 "wood stand" and "place card" separately (not adjacent). No anyOf phrase matches.
 *     FIX: Add 'wood stand' to anyOf + anyOfGroups:[['card','signage','display','retail']]
 *          to only fire when query has BOTH 'wood stand' AND a card/signage/display context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt94.ts
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

    // 1. FIX COTTON_BABY_BLANKET_INTENT — add synthetic fiber tokens to noneOf
    //    "Crochet Acrylic Baby Blanket" exp:6111.30 → was correctly classified before intent,
    //    now gets 6301.90 because COTTON_BABY_BLANKET_INTENT fires and blocks ch.61.
    //    Root cause: 'baby blanket' in anyOf matches "crochet ACRYLIC baby blanket",
    //    allowChapters:['63'] prevents 6111.30 (ch.61) from appearing.
    //    Fix: Add 'acrylic', 'polyester', 'nylon' to noneOf — synthetic fiber baby products
    //         are knitted garments (ch.61), not cotton blankets (ch.63).
    {
      const existing = allRules.find(r => r.id === 'COTTON_BABY_BLANKET_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const syntheticFibers = ['acrylic', 'polyester', 'nylon', 'synthetic fiber', 'fleece blanket'];
        const updatedNoneOf = [...new Set([...currentNoneOf, ...syntheticFibers])];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: updatedNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 537, rule: updated });
        console.log(`COTTON_BABY_BLANKET_INTENT: added synthetic fibers to noneOf: ${JSON.stringify(syntheticFibers)}`);
      } else {
        console.log('COTTON_BABY_BLANKET_INTENT: not found');
      }
    }

    // 2. FIX WOOD_DISPLAY_STAND_INTENT — add anyOfGroups for 'card'/'signage'/'display' context
    //    Current anyOf doesn't match "Large Wood Stand / Place Card, Business Card, Retail Signage"
    //    because the query has "wood stand" and "place card" as non-adjacent tokens.
    //    Fix: Add 'wood stand' to anyOf + anyOfGroups: [['card','signage','display','retail','menu']]
    //    This fires when query has 'wood stand' token AND ('card' OR 'signage' OR 'display' etc.).
    {
      const existing = allRules.find(r => r.id === 'WOOD_DISPLAY_STAND_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        // Add standalone 'wood stand' token (with anyOfGroups to restrict context)
        const newAnyOf = [...new Set([...currentAnyOf, 'wood stand', 'wooden stand'])];
        // anyOfGroups: requires at least one of these to also be present
        // This prevents 'wood stand' alone from matching music stands, speaker stands, etc.
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: newAnyOf,
            noneOf: currentNoneOf,
            anyOfGroups: [
              ['card', 'signage', 'retail', 'display', 'menu', 'sign', 'holder', 'stand card'],
            ],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 536, rule: updated });
        console.log('WOOD_DISPLAY_STAND_INTENT: added wood stand + anyOfGroups for card/signage context');
      } else {
        console.log('WOOD_DISPLAY_STAND_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT94)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT94 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
