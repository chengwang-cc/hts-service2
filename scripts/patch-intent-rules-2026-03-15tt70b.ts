#!/usr/bin/env ts-node
/**
 * Patch TT70b — 2026-03-15: Follow-up fixes for TT70 (EMPTY candles, diffuser ordering)
 *
 * Fixes:
 *  1. UPDATE SPIRITUAL_RITUAL_CANDLE_INTENT — remove denyChapters:['34'] to prevent EMPTY
 *     "3 Pack Money Candles" → EMPTY (deny ch.34 removes all organic ch.34 → fused empty → inject blocked)
 *     FIX: Remove denyChapters, increase boost to 0.90 so injection beats organic ch.34
 *
 *  2. UPDATE DIFFUSER_INTENT — reorder inject to prioritize 3307.49 over 8479.89
 *     "Diffuser Cedar Mood" → still 8479.89 because DIFFUSER_INTENT injects 8479 at rank:22 (higher)
 *     FIX: Change 3307.49 to rank:5 (higher priority), keep 8479.89 at rank:22
 *
 *  3. UPDATE INCENSE_AROMATHERAPY_INTENT — add air freshener/wax melt to noneOf
 *     "Glade Electric Wax Melt Warmer" → 3307.41 (incense!) because INCENSE matches 'air freshener'
 *     FIX: Add 'air freshener', 'wax melt', 'wax warmer' to noneOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt70b.ts
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

    // 1. UPDATE SPIRITUAL_RITUAL_CANDLE_INTENT — remove denyChapters to prevent EMPTY
    //    "3 Pack Money Candles" → EMPTY because:
    //    - Organic search returns only ch.34 entries
    //    - denyChapters:['34'] removes them all → fused.size=0 → return [] before injection
    //    FIX: Remove denyChapters, use very strong boost (0.90) for 3307.30 to beat organic ch.34
    {
      const existing = allRules.find(r => r.id === 'SPIRITUAL_RITUAL_CANDLE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {}, // Remove denyChapters:['34'] — was causing EMPTY
          boosts: [
            { delta: 0.90, prefixMatch: '3307.30' }, // Strong boost: 0.016 + 0.90 = 0.916 > organic ~0.5-0.7
          ],
        } as IntentRule;
        patches.push({ priority: 582, rule: updated });
        console.log('SPIRITUAL_RITUAL_CANDLE_INTENT: removed denyChapters, boost increased to 0.90');
      }
    }

    // 2. UPDATE DIFFUSER_INTENT — reorder inject: 3307.49 rank:5 (higher) vs 8479.89 rank:22
    //    "Diffuser Cedar Mood" → 8479.89 because DIFFUSER_INTENT inject order: 8479.89 rank:22 > 3307.49 rank:26
    //    (Lower syntheticRank number = higher priority/base score)
    //    FIX: Make 3307.49 at rank:5 (much higher priority) and add boost for it
    {
      const existing = allRules.find(r => r.id === 'DIFFUSER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '3307.49', syntheticRank: 5 },  // non-electric diffusers (room fresheners)
            { prefix: '8479.89', syntheticRank: 22 }, // electric ultrasonic diffusers
            { prefix: '3307.41', syntheticRank: 20 }, // incense aromatherapy (related)
          ],
          boosts: [
            { delta: 0.60, prefixMatch: '3307.4' }, // boost both 3307.41 and 3307.49
          ],
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('DIFFUSER_INTENT: reordered inject (3307.49 rank:5, 8479.89 rank:22), added boost');
      }
    }

    // 3. UPDATE INCENSE_AROMATHERAPY_INTENT — add wax melt / air freshener to noneOf
    //    "Glade Electric Wax Melt Warmer Air Freshener" → 3307.41 (incense)
    //    INCENSE_AROMATHERAPY_INTENT has 'air freshener' in anyOf → fires and injects 3307.41
    //    FIX: Add air freshener/wax melt terms to noneOf so this rule doesn't fire for them
    {
      const existing = allRules.find(r => r.id === 'INCENSE_AROMATHERAPY_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const freshenerNoneOf = [
          'air freshener', 'wax melt', 'wax melt warmer', 'wax warmer', 'wax cube',
          'car freshener', 'car air freshener', 'car air diffuser', 'car diffuser',
          'reed diffuser', 'room freshener', 'room deodorizer',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...freshenerNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('INCENSE_AROMATHERAPY_INTENT: added wax melt/air freshener to noneOf');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT70b)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT70b complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
