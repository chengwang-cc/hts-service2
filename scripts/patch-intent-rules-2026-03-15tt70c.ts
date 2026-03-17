#!/usr/bin/env ts-node
/**
 * Patch TT70c — 2026-03-15: Fix spiritual candle allowChapters to allow 3307 through
 *
 * Fix:
 *  UPDATE SPIRITUAL_RITUAL_CANDLE_INTENT — add allowChapters:['33','34']
 *  BUG: CANDLE_INTENT has allowPrefixes:['3406.'] (positive filter). In OR logic,
 *       entries must pass AT LEAST ONE rule's positive filter. With SPIRITUAL having
 *       no positive filter, only CANDLE_INTENT's filter applies → 3307.30 (ch.33) blocked.
 *  FIX: Add allowChapters:['33','34'] to SPIRITUAL_RITUAL_CANDLE_INTENT.
 *       Now 3307.30.50 (ch.33) passes SPIRITUAL's allowChapters:['33'] filter → ALLOWED.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt70c.ts
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

    // FIX SPIRITUAL_RITUAL_CANDLE_INTENT — add allowChapters:['33','34']
    {
      const existing = allRules.find(r => r.id === 'SPIRITUAL_RITUAL_CANDLE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowChapters: ['33', '34'], // ch.33=perfumery/3307, ch.34=candles/3406
          },
          boosts: [
            { delta: 0.90, prefixMatch: '3307.30' },
          ],
        } as IntentRule;
        await svc.upsertRule(updated, 582);
        console.log('✅ SPIRITUAL_RITUAL_CANDLE_INTENT: added allowChapters:[33,34] (3307.30 now passes OR filter)');
      }
    }

    // Also fix RITUAL_BATH_SPIRITUAL_WASH_INTENT — needs allowChapters too
    {
      const existing = allRules.find(r => r.id === 'RITUAL_BATH_SPIRITUAL_WASH_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowChapters: ['33', '34', '39'], // ch.33=perfumery, ch.34=soaps, ch.39=plastic packaging
          },
          boosts: [
            { delta: 0.65, prefixMatch: '3307.30' },
          ],
        } as IntentRule;
        await svc.upsertRule(updated, 578);
        console.log('✅ RITUAL_BATH_SPIRITUAL_WASH_INTENT: added allowChapters:[33,34,39]');
      }
    }

    console.log('TT70c complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
