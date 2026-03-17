#!/usr/bin/env ts-node
/**
 * Patch TT12 — 2026-03-15: Glass drinkware/candle holders vs ceramic.
 * Current: 30.41% (1528/5025)
 *
 * Fixes:
 *  1. GLASS_DRINKWARE_BEER_MUG_INTENT: glass beer mug/tumbler → 7013.37 (not ceramic 6912)
 *  2. GLASS_CANDLE_HOLDER_INTENT: glass candle holder → 7013.49 (not ceramic 6911)
 *  3. CHRISTMAS_SHAPES_WOOD_INTENT: add "christmas shapes" patterns
 *  4. PLATED_JEWELRY_HYPHEN_FIX: update gold-plated pattern with hyphen variant
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt12.ts
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

    // 1. GLASS_DRINKWARE_BEER_MUG_INTENT — glass beer mugs/tumblers → 7013.37
    //    "16oz glass beer mug" → getting 6912 (ceramic), expected 7013.37
    //    "tumblers set of 10" → getting 6912 (ceramic), expected 7013.28
    {
      const existing = allRules.find(r => r.id === 'GLASS_DRINKWARE_BEER_MUG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_DRINKWARE_BEER_MUG_INTENT',
          description: 'Glass beer mugs, tumblers, drinking glasses → ch.70 (7013.37)',
          pattern: {
            anyOf: [
              'glass beer mug', 'glass beer mugs', 'glass tumbler', 'glass tumblers',
              'glass drinking mug', 'glass pub mug', 'beer glass mug',
              'set of drinking glasses', 'glass drinking glasses', 'drinking glasses glass',
              'glass highball', 'glass lowball', 'glass shot glass',
            ],
            noneOf: ['ceramic mug', 'stainless mug', 'insulated mug', 'travel mug', 'plastic mug'],
          },
          inject: [
            { prefix: '7013.37', syntheticRank: 4 },
            { prefix: '7013.28', syntheticRank: 5 },
          ],
          whitelist: { allowChapters: ['70'] },
          boosts: [
            { delta: 0.65, prefixMatch: '7013.3' },
            { delta: 0.55, prefixMatch: '7013.2' },
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GLASS_DRINKWARE_BEER_MUG_INTENT: created (glass beer mug → 7013.37)');
      }
    }

    // 2. GLASS_CANDLE_HOLDER_VOTIVE_INTENT — glass candle holders → 7013.49
    //    "Handmade Glass Tulip Candle Holder" → getting 6911 (ceramic), expected 7013.49
    //    "glass candle holder" → same issue
    {
      const existing = allRules.find(r => r.id === 'GLASS_CANDLE_HOLDER_VOTIVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_CANDLE_HOLDER_VOTIVE_INTENT',
          description: 'Glass candle holders, votives, candlestick holders → ch.70 (7013.49)',
          pattern: {
            anyOf: [
              'glass candle holder', 'glass candle holders', 'glass votive holder',
              'glass tulip candle', 'glass tealight holder', 'glass hurricane',
              'handmade glass candle', 'blown glass candle holder',
            ],
            noneOf: ['ceramic candle', 'metal candle', 'concrete candle', 'wooden candle holder'],
          },
          inject: [{ prefix: '7013.49', syntheticRank: 4 }],
          whitelist: { allowChapters: ['70'] },
          boosts: [{ delta: 0.65, prefixMatch: '7013.4' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GLASS_CANDLE_HOLDER_VOTIVE_INTENT: created (glass candle holder → 7013.49)');
      }
    }

    // 3. Update WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT: add "christmas shapes" pattern
    {
      const e = allRules.find(r => r.id === 'WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT');
      if (e) {
        const pat = (e.pattern as any) ?? {};
        const updated = {
          ...pat,
          anyOf: [...new Set([...(pat.anyOf ?? []),
            'christmas shapes', 'christmas shape', 'wood poinsettia', 'wood christmas',
            '3d wood christmas', 'wood holiday shape', 'christmas wood shape cutout',
          ])],
        };
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: updated } });
        console.log('WOOD_CHRISTMAS_ORNAMENT_FRAME_INTENT: added christmas shapes patterns');
      }
    }

    // 4. GOLD_FILLED_CLAD_JEWELRY_INTENT: add gold-plated (hyphenated) variant
    {
      const e = allRules.find(r => r.id === 'GOLD_FILLED_CLAD_JEWELRY_INTENT');
      if (e) {
        const pat = (e.pattern as any) ?? {};
        const updated = {
          ...pat,
          anyOf: [...new Set([...(pat.anyOf ?? []),
            'gold-plated necklace', 'gold plated necklace set', '18k gold-plated',
            '14k gold-plated', 'gold plated ring', 'gold plated earrings',
            'gold plated bracelet set',
          ])],
        };
        patches.push({ priority: (e as any).priority ?? 570, rule: { ...e, pattern: updated } });
        console.log('GOLD_FILLED_CLAD_JEWELRY_INTENT: added gold-plated hyphenated variants');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT12)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT12 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
