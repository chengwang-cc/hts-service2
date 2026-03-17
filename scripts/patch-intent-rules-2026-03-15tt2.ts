#!/usr/bin/env ts-node
/**
 * Patch TT2 — 2026-03-15: Fix v1 block for DOG_GROOMING_CLIPPER_INTENT.
 * "Dog grooming scissors" (ch.82) is blocked by DOG_GROOMING_CLIPPER_INTENT whitelist.
 * Fix: add 'scissors' to noneOf so scissors route normally.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt2.ts
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

    // DOG_GROOMING_CLIPPER_INTENT: add 'scissors' to noneOf
    // "Dog grooming scissors" → ch.82, blocked by allowChapters: ['85']
    {
      const e = allRules.find(r => r.id === 'DOG_GROOMING_CLIPPER_INTENT');
      if (e) {
        const pat = (e.pattern as any) ?? {};
        const updated = {
          ...pat,
          noneOf: [...new Set([...(pat.noneOf ?? []), 'scissors', 'grooming scissors', 'shears'])],
        };
        await svc.upsertRule({ ...e, pattern: updated } as IntentRule, (e as any).priority ?? 560);
        console.log('DOG_GROOMING_CLIPPER_INTENT: added scissors/shears to noneOf ✅');
      } else {
        console.log('DOG_GROOMING_CLIPPER_INTENT: not found');
      }
    }

    console.log(`\nPatch TT2 complete`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
