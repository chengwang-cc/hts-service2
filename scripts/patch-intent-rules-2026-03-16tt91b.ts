#!/usr/bin/env ts-node
/**
 * Patch TT91b — 2026-03-16: Fix SILICONE_CRAFT_MOLD_INTENT (wrong routing).
 *
 * BUG: SILICONE_CRAFT_MOLD_INTENT in DB routes to 3924.10 (plastic tableware!) with
 *      denyChapters:['84','83'] blocking ch.84 where 8480 (molds) lives.
 *      This was a previous session's incorrect creation.
 *
 * FIX: Overwrite with correct intent:
 *      - inject: 8480.79 (molds for plastics/rubber) at highest rank
 *      - allowChapters:['84'], denyChapters:['39']
 *      - Expanded anyOf including resin/ring/pottery/glass molds
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt91b.ts
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

    // FIX SILICONE_CRAFT_MOLD_INTENT: overwrite with correct 8480 routing
    // The existing version wrongly routes to 3924.10 (plastic tableware) with denyChapters:['84']
    // blocking the very chapter (84) where molds (8480) live.
    const fixedRule: IntentRule = {
      id: 'SILICONE_CRAFT_MOLD_INTENT',
      description: 'Silicone/resin craft molds, casting molds, pottery molds → 8480 (molds for plastics/glass)',
      pattern: {
        anyOf: [
          // Silicone molds (craft/decorative)
          'silicone mold', 'silicone molds', 'silicone casting mold',
          'resin silicone mold', 'druzy silicone mold',
          'silicone soap mold', 'silicone candle mold',
          'silicone chocolate mold', 'silicone baking mold',
          'silicone cake mold', 'silicone ice mold',
          'silicone epoxy mold', 'silicone resin mold',
          'silicone bread mold',  // keep old phrases
          // Craft/resin casting molds
          'resin mold', 'resin casting mold', 'epoxy mold',
          'casting mold', 'pour mold',
          // Ring/jewelry casting molds
          'ring casting mold', 'ring mold casting', 'ring casting molds',
          'casting ring mold', 'jewelry casting mold',
          // Pottery/ceramic molds
          'pottery mold', 'ceramic mold', 'clay mold',
          'slump mold', 'pottery slump mold', 'plastic slump mold',
          // Glass molds
          'glass mold', 'fusing mold', 'kiln mold',
        ],
        noneOf: [
          // Exclude mold/mildew removal
          'mold removal', 'mold cleaner', 'mold treatment',
          'mold inhibitor', 'anti mold',
          // Exclude injection molding machines (8477)
          'injection molding machine', 'extrusion machine', 'molding machine',
          // Exclude metal mold tooling
          'mold insert', 'cavity mold',
        ],
      },
      inject: [
        { prefix: '8480.79', syntheticRank: 2 },  // molds for rubber/plastics (other)
        { prefix: '8480.71', syntheticRank: 4 },  // injection/compression molds for rubber/plastics
        { prefix: '8480.60', syntheticRank: 6 },  // molds for glass
        { prefix: '8480.41', syntheticRank: 8 },  // injection molds for metals
      ],
      whitelist: {
        allowChapters: ['84'],                     // machinery chapter (where 8480 lives)
        denyChapters: ['39', '73'],                // deny plastic articles and iron/steel
      },
      boosts: [
        { delta: 0.90, prefixMatch: '8480.' },
        { delta: 0.50, chapterMatch: '84' },
      ],
      penalties: [
        { delta: 0.70, chapterMatch: '39' },       // strong penalty for plastic articles
        { delta: 0.50, chapterMatch: '73' },       // penalize iron/steel articles
      ],
    } as IntentRule;

    await svc.upsertRule(fixedRule, 542);
    console.log('✅ SILICONE_CRAFT_MOLD_INTENT: fixed (now routes to 8480.79, allowChapters:84, denyChapters:39)');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
