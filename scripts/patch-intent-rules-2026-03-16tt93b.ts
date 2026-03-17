#!/usr/bin/env ts-node
/**
 * Patch TT93b — 2026-03-16: Fix WOOD_DISPLAY_STAND_INTENT (wrong routing).
 *
 * BUG: WOOD_DISPLAY_STAND_INTENT in DB has:
 *      - allowChapters:['44','94','83'] — ch.83 is misc base metals (wrong), ch.94 included
 *      - inject: undefined (no injection!)
 *      - No denyChapters for ch.92 (musical instruments)
 *      "Large Wood Stand / Place Card" still goes to 9209.92 (keyboard instrument parts)
 *      because the intent has no inject to push toward 4404/4421 and no deny for ch.92.
 *
 * FIX: Overwrite with correct intent:
 *      - inject: 4404.20 at rank1, 4421.99 at rank3
 *      - allowChapters: ['44']
 *      - denyChapters: ['92', '95']
 *      - Add 'Place Card', 'Business Card', and 'Retail Signage' specific phrases
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt93b.ts
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

    const fixedRule: IntentRule = {
      id: 'WOOD_DISPLAY_STAND_INTENT',
      description: 'Wood display/place card stands → 4404/4421 (wood articles, ch.44), deny ch.92 music',
      pattern: {
        anyOf: [
          // Place card / table number holders
          'wood place card', 'wooden place card', 'place card holder',
          'wood place card stand', 'wooden place card holder',
          'wood card stand', 'place card stand wood',
          // Business card holders
          'wood card holder', 'business card holder wood',
          'wood business card holder', 'wooden business card stand',
          // Signage / retail display stands
          'wood sign holder', 'wood display stand',
          'wood menu holder', 'wood menu stand',
          'retail wood stand', 'laser cut wood stand',
          'wood sign stand', 'wood retail signage',
          // Recipe / misc card holders
          'recipe card holder wood', 'wood recipe holder',
          'wood card display', 'wood number stand',
          // The specific query patterns causing regression
          'place card business card retail signage',
          'wood stand place card',
        ],
        noneOf: [
          // Exclude non-wood stands
          'metal stand', 'acrylic stand', 'plastic stand',
          // Exclude music stands
          'music stand', 'music stand accessory', 'sheet music stand',
          // Exclude large furniture
          'speaker stand', 'tv stand', 'monitor stand',
        ],
      },
      inject: [
        { prefix: '4404.20', syntheticRank: 1 },  // wood hoopwood; stakes (simple wood display sticks)
        { prefix: '4421.99', syntheticRank: 3 },  // other articles of wood NES
        { prefix: '4420.19', syntheticRank: 5 },  // decorative articles of wood
        { prefix: '4415.10', syntheticRank: 8 },  // wooden packing/display cases
      ],
      whitelist: {
        allowChapters: ['44'],                     // wood and articles of wood
        denyChapters: ['92', '95'],                // deny musical instruments and toys
      },
      boosts: [
        { delta: 0.85, prefixMatch: '4404.' },
        { delta: 0.75, prefixMatch: '4421.' },
        { delta: 0.40, chapterMatch: '44' },
      ],
      penalties: [
        { delta: 0.90, chapterMatch: '92' },       // very strong penalty for musical instruments
        { delta: 0.60, chapterMatch: '95' },       // penalize toys
        { delta: 0.60, chapterMatch: '83' },       // penalize base metal tools
      ],
    } as IntentRule;

    await svc.upsertRule(fixedRule, 536);
    console.log('✅ WOOD_DISPLAY_STAND_INTENT: fixed (now inject 4404.20, denyChapters:92)');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
