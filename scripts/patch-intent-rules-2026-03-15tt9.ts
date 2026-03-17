#!/usr/bin/env ts-node
/**
 * Patch TT9 — 2026-03-15: Fix v1 block for COMPUTER_RAM_MEMORY_INTENT.
 * "Transcend 4GB DDR3 RAM" → 8542.32 (ch.85) is blocked by allowChapters: ['84'].
 * Fix: remove whitelist (keep inject/boost only) — let both ch.84 and ch.85 coexist.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt9.ts
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

    // Remove whitelist from COMPUTER_RAM_MEMORY_INTENT
    {
      const e = allRules.find(r => r.id === 'COMPUTER_RAM_MEMORY_INTENT');
      if (e) {
        const updated = { ...e, whitelist: undefined } as IntentRule;
        await svc.upsertRule(updated, (e as any).priority ?? 570);
        console.log('COMPUTER_RAM_MEMORY_INTENT: removed whitelist ✅');
      }
    }

    console.log(`\nPatch TT9 complete`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
