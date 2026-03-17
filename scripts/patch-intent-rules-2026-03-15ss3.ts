#!/usr/bin/env ts-node
/**
 * Patch SS3 — 2026-03-15: Fix v1 block regressions from SS1.
 *
 * Fixes:
 *  1. CROCHET_KNIT_TOY_INTENT: remove allowChapters restriction (too broad — blocks
 *     "100% cotton hand made crochet toy" → ch.59 rubberized textile)
 *     Keep inject+boosts only; don't restrict chapters.
 *  2. WALLET_TRIFOLD_BIFOLD_INTENT: remove allowChapters restriction (too broad — blocks
 *     "Secrid Slim Wallet Vintage" → ch.61 in v1). Use inject+boosts only.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss3.ts
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

    // 1. CROCHET_KNIT_TOY_INTENT: remove whitelist (was [95, 63])
    //    v1 block: "100 % cotton hand made crochet toy" → 5906.99.10.00 (ch.59) was blocked
    {
      const e = allRules.find(r => r.id === 'CROCHET_KNIT_TOY_INTENT');
      if (e) {
        const { whitelist, ...ruleWithoutWhitelist } = e as any;
        patches.push({ priority: (e as any).priority ?? 560, rule: ruleWithoutWhitelist });
        console.log('CROCHET_KNIT_TOY_INTENT: removed whitelist (keeps inject+boosts only)');
      }
    }

    // 2. WALLET_TRIFOLD_BIFOLD_INTENT: remove whitelist (was [42])
    //    v1 block: "Secrid Slim Wallet Vintage" → 6110.30.10.60 (ch.61) was blocked
    {
      const e = allRules.find(r => r.id === 'WALLET_TRIFOLD_BIFOLD_INTENT');
      if (e) {
        const { whitelist, ...ruleWithoutWhitelist } = e as any;
        patches.push({ priority: (e as any).priority ?? 550, rule: ruleWithoutWhitelist });
        console.log('WALLET_TRIFOLD_BIFOLD_INTENT: removed whitelist (keeps inject+boosts only)');
      }
    }

    // 3. LEATHER_CASH_BINDER_INTENT: also remove whitelist as precaution
    {
      const e = allRules.find(r => r.id === 'LEATHER_CASH_BINDER_INTENT');
      if (e) {
        const { whitelist, ...ruleWithoutWhitelist } = e as any;
        patches.push({ priority: (e as any).priority ?? 550, rule: ruleWithoutWhitelist });
        console.log('LEATHER_CASH_BINDER_INTENT: removed whitelist (keeps inject+boosts only)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch SS3)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS3 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
