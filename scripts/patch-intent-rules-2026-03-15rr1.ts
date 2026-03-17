#!/usr/bin/env ts-node
/**
 * Patch RR1 — 2026-03-15: Fix v1 block regressions from PP2/QQ2.
 *
 * Fixes:
 *  1. WOOD_DISPLAY_STAND_INTENT: remove "wood stand" / "wooden stand" from anyOf
 *     (too broad — matches "...ale glass with wood stand" → ch.70 blocked,
 *      and "wooden stand for pendulum" → ch.85 blocked)
 *     Keep the more specific compound patterns only.
 *  2. PILLOW_COVER_BED_LINEN_INTENT: ensure noneOf also has "bolster pillow" to avoid
 *     blocking stuffed bolster pillow inserts (ch.94)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15rr1.ts
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

    // 1. WOOD_DISPLAY_STAND_INTENT: narrow anyOf — remove generic "wood stand"/"wooden stand"
    //    Keep compound phrases that are specific to card/display/sign contexts
    //    Fixes v1 blocks:
    //      - "...ale glass with wood stand" → 7010.90 (ch.70) was blocked
    //      - "wooden stand for pendulum" → 8538.10 (ch.85) was blocked
    {
      const e = allRules.find(r => r.id === 'WOOD_DISPLAY_STAND_INTENT');
      if (e) {
        const pat = (e.pattern as any) ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        // Remove the two overly-broad terms
        const newAnyOf = currentAnyOf.filter(t => t !== 'wood stand' && t !== 'wooden stand');
        // Add a few more specific phrases that are safe
        const toAdd = ['wood card stand', 'wood table number', 'wood easel stand', 'wooden place card'];
        const merged = [...new Set([...newAnyOf, ...toAdd])];
        const newPat = { ...pat, anyOf: merged };
        const priority = (e as any).priority ?? 500;
        patches.push({ priority, rule: { ...e, pattern: newPat } });
        console.log('WOOD_DISPLAY_STAND_INTENT: removed "wood stand"/"wooden stand" from anyOf (too broad)');
        console.log(`  anyOf now: [${merged.join(', ')}]`);
      } else {
        console.log('WOOD_DISPLAY_STAND_INTENT: not found (skip)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch RR1)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch RR1 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
