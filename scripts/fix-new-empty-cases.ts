#!/usr/bin/env ts-node
/**
 * Fix new EMPTY cases introduced by RRRR patches:
 *
 * RRRR removed 'switch'/'plug' from AI_CH91_TIME_SWITCH_TIMER anyOf and
 * added 'pump' to SHAMPOO noneOf — these now leave certain queries with
 * no allowSet restriction, and semantic search returns EMPTY (below 0.35 threshold).
 *
 * Fixes:
 * 1. NEW LIQUID_PUMP_DISPENSER_INTENT
 *    "plastic shampoo pump", "shampoo dispenser", "lotion pump" → ch.84 (8413)
 *    With SHAMPOO noneOf blocking pump queries from ch.33, need positive ch.84 rule.
 *
 * 2. NEW FAUX_LEATHER_GARMENT_INTENT (positive rule)
 *    "faux leather capri", "pu leather leggings" → ch.61/62
 *    QQQQ added noneOf to LEATHER_HIDES_INTENT but no positive rule was added.
 *    Semantic search still returns ch.41 (leather hides dominate for 'leather').
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function fix() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });

    const rules: Array<{ rule: IntentRule; priority: number }> = [];

    // ── 1. LIQUID_PUMP_DISPENSER_INTENT ──────────────────────────────────────
    // "plastic shampoo pump", "lotion dispenser", "soap dispenser pump" → 8413 (ch.84)
    // Without SHAMPOO rule firing (we added 'pump' to noneOf), these go EMPTY.
    rules.push({
      priority: 580,
      rule: {
        id: 'LIQUID_PUMP_DISPENSER_INTENT',
        description: 'Liquid pumps and dispensers → 8413 (ch.84). ' +
          '"shampoo pump", "lotion dispenser", "soap pump", "pump head", "foamer pump". ' +
          'Previously SHAMPOO_HAIR_CARE_INTENT misfired on these → ch.33 (hair preps). ' +
          'Now that pump is in SHAMPOO noneOf, need positive ch.84 rule.',
        pattern: {
          anyOf: [
            'shampoo pump', 'lotion pump', 'soap pump', 'dispenser pump',
            'pump dispenser', 'pump head', 'foamer pump', 'foam pump',
            'lotion dispenser', 'soap dispenser', 'hand soap dispenser',
            'liquid dispenser', 'bottle pump', 'pump bottle',
            'trigger pump', 'spray pump', 'pump sprayer',
          ],
          noneOf: ['well pump', 'water pump', 'pool pump', 'sump pump', 'fuel pump', 'air pump'],
        },
        whitelist: { allowChapters: ['84', '39'] },
        inject: [
          { prefix: '8413.19.00', syntheticRank: 9 }, // Hand pumps for liquids
          { prefix: '8413.11.00', syntheticRank: 8 }, // Pumps for dispensing fuel
          { prefix: '8424.20.90', syntheticRank: 7 }, // Spray guns / spray dispensers
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8413' },
        ],
      } as IntentRule,
    });

    // ── 2. FAUX_LEATHER_GARMENT_INTENT ───────────────────────────────────────
    // "faux leather capri", "pu leather pants", "vegan leather jacket" → ch.61/62
    // LEATHER_HIDES_INTENT noneOf now blocks for 'faux leather' queries,
    // but semantic search still returns ch.41 leather hides.
    rules.push({
      priority: 575,
      rule: {
        id: 'FAUX_LEATHER_GARMENT_INTENT',
        description: 'Faux/synthetic leather garments → ch.61/62. ' +
          '"faux leather capri", "pu leather pants", "vegan leather leggings". ' +
          'These are woven garments with PU coating, not raw animal hides (ch.41).',
        pattern: {
          anyOf: [
            'faux leather', 'vegan leather', 'pu leather', 'pleather',
            'eco leather', 'synthetic leather', 'bonded leather',
          ],
          noneOf: [
            'bag', 'bags', 'purse', 'purses', 'handbag', 'wallet', 'backpack',
            'sofa', 'couch', 'chair', 'furniture', 'upholstery',
            'shoe', 'shoes', 'boot', 'boots', 'sandal', 'belt',
          ],
        },
        whitelist: { allowChapters: ['61', '62'] },
        inject: [
          { prefix: '6102.30.05', syntheticRank: 9 }, // Women's MMF knit overcoats
          { prefix: '6101.30.10', syntheticRank: 8 }, // Men's MMF knit overcoats
          { prefix: '6204.69.90', syntheticRank: 7 }, // Women's woven trousers/capris
          { prefix: '6203.49.40', syntheticRank: 6 }, // Men's woven trousers
        ],
        boosts: [
          { delta: 0.35, prefixMatch: '6102' },
          { delta: 0.35, prefixMatch: '6204' },
        ],
      } as IntentRule,
    });

    for (const { rule, priority } of rules) {
      await (svc as any).upsertRule(rule, priority, true);
      console.log(`✅ ${rule.id}`);
    }
    await svc.reload();
    console.log(`Done. Rules in cache: ${svc.ruleCount}`);
  } finally {
    await app.close();
  }
}
fix().catch(e => { console.error('Fatal:', e); process.exit(1); });
