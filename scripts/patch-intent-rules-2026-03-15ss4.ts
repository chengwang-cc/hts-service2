#!/usr/bin/env ts-node
/**
 * Patch SS4 — 2026-03-15: Remove whitelist from GARMENT_KNIT_MMF_JACKET_INTENT.
 * v1 block: "Men's Insulated Polyester Jacket" → ch.63 (worn clothing) was blocked by [61,62].
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as IntentRule[];
    const e = allRules.find(r => r.id === 'GARMENT_KNIT_MMF_JACKET_INTENT');
    if (e) {
      const { whitelist, ...rest } = e as any;
      await svc.upsertRule(rest, (e as any).priority ?? 550);
      console.log('GARMENT_KNIT_MMF_JACKET_INTENT: removed whitelist ✅');
    } else {
      console.log('GARMENT_KNIT_MMF_JACKET_INTENT: not found');
    }
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}
patch().catch(err => { console.error(err); process.exit(1); });
