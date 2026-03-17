#!/usr/bin/env ts-node
/**
 * Patch TT11 — 2026-03-15: Fix WOODEN_TOOL_HANDLE_INTENT v1 blocks.
 *  "Plastic Shoehorn wooden handle" → ch.39 blocked by ch.44 whitelist
 *  "biotensor rod w/wooden handle" → ch.74 blocked by ch.44 whitelist
 *  Fix: add 'plastic' and 'rod' and 'shoehorn' to noneOf
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

    const e = allRules.find(r => r.id === 'WOODEN_TOOL_HANDLE_INTENT');
    if (e) {
      const pat = (e.pattern as any) ?? {};
      const updated = {
        ...pat,
        noneOf: [...new Set([
          ...(pat.noneOf ?? []),
          'plastic', 'shoehorn', 'biotensor', 'rod with', 'rod w/', 'rod w ',
          'metal rod', 'copper', 'brass', 'steel',
        ])],
      };
      await svc.upsertRule({ ...e, pattern: updated } as IntentRule, (e as any).priority ?? 565);
      console.log('WOODEN_TOOL_HANDLE_INTENT: added plastic/shoehorn/rod to noneOf ✅');
    }

    console.log(`\nPatch TT11 complete`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
