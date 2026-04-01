#!/usr/bin/env ts-node
/**
 * Patch TT139 — 2026-03-31: Fix enamel pin classification (7117 jewelry → 7319 iron/steel pins)
 *
 * Problem: "Crying Bunny Enamel Pin", "Hard Enamel Pin" etc. return 7117.90 (imitation jewelry)
 * instead of 7319.x (iron/steel pins). The correct HTS for collectible enamel pin badges is 7319.
 *
 * Root cause:
 * 1. HARD_ENAMEL_PIN_INTENT (which has denyChapters:["71"]) is DISABLED.
 * 2. LAPEL_PIN_BROOCH_INTENT fires on "enamel pin", injects 7117, and boosts ch.71 by +0.5.
 * 3. Without the denyChapters:["71"] from HARD_ENAMEL_PIN_INTENT, ch.71 dominates.
 *
 * Fix:
 * 1. Re-enable HARD_ENAMEL_PIN_INTENT.
 * 2. Upgrade its inject syntheticRanks from 20/22 to 3/5 (competitive scores).
 * 3. Add boost delta:0.6 for 7319 prefix so injected pins rank above jewelry.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-31tt139.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LookupIntentRuleEntity } from '../src/modules/lookup/entities/lookup-intent-rule.entity';
import { Repository } from 'typeorm';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const repo = app.get<Repository<LookupIntentRuleEntity>>(
      getRepositoryToken(LookupIntentRuleEntity),
      { strict: false },
    );

    // Re-enable HARD_ENAMEL_PIN_INTENT and upgrade its inject/boost configuration.
    // Previous state: enabled=false, syntheticRank=20/22, no boosts.
    // New state: enabled=true, syntheticRank=3/5, boost 7319 by +0.6.
    const updatedRule: IntentRule = {
      id: 'HARD_ENAMEL_PIN_INTENT',
      description: 'Hard/soft enamel pin badges → 7319 iron/steel pins (deny ch.71 jewelry)',
      pattern: {
        anyOf: [
          'enamel pin',
          'hard enamel pin',
          'soft enamel pin',
          'lapel pin',
          'enamel pins',
          'enamel badge',
          'pin badge',
        ],
      },
      inject: [
        { prefix: '7319.40', syntheticRank: 3 },
        { prefix: '7319.90', syntheticRank: 5 },
        { prefix: '7326.90', syntheticRank: 8 },
      ],
      whitelist: {
        denyChapters: ['71'],
      },
      boosts: [
        { delta: 0.6, prefixMatch: '7319.40' },
        { delta: 0.5, prefixMatch: '7319.90' },
        { delta: 0.3, prefixMatch: '7319.' },
      ],
    } as IntentRule;

    // Use upsert to update the rule (will reload cache after)
    await svc.upsertRule(updatedRule, 10);

    // Also explicitly enable it (upsertRule sets enabled:true)
    console.log('HARD_ENAMEL_PIN_INTENT: re-enabled with upgraded inject/boost');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
