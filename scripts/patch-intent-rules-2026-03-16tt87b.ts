#!/usr/bin/env ts-node
/**
 * Patch TT87b — 2026-03-16: Fix TT87 anyOfGroups regression.
 *
 * Regression from TT87:
 *  TT87 added anyOfGroups:[['yarn','knitting','knit','crochet','fiber','thread']] to both
 *  WOOL_YARN_FIBER_INTENT and SYNTHETIC_MMF_YARN_INTENT. The 'crochet', 'knit', 'knitting'
 *  in anyOfGroups caused intents to fire for FINISHED GOODS, not just raw yarn:
 *    "Crochet Acrylic Bag" → got 5508.10 (acrylic yarn!) instead of expected 4202.22 (bags)
 *    "Black Crochet Skinny Scarf - Handmade Acrylic Knit" → got 5508 instead of 6117 (knit accessories)
 *    "100% acrylic crochet food coasters set" → got 5508 instead of 6006.33 (knitted fabric)
 *  Root cause: 'acrylic' (anyOf) + 'crochet'/'knit' (anyOfGroups) fires for finished crochet/knit
 *  items made of acrylic fiber, which are NOT raw yarn.
 *
 *  Fix: Narrow anyOfGroups to [['yarn']] only.
 *  'yarn' token specifically indicates the item IS raw yarn being sold for knitting/crochet.
 *  "Crochet Acrylic Bag" has no 'yarn' token → intent doesn't fire ✅
 *  "300g 75%wool/25%nylon knitting yarn" has 'yarn' token → intent fires ✅
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt87b.ts
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

    // Fix WOOL_YARN_FIBER_INTENT — narrow anyOfGroups to ['yarn'] only
    // Previous TT87 had ['yarn','knitting','knit','crochet',...] which fires for:
    // "wool sweater" (no yarn token, but knit is present), etc.
    // Narrowing to ['yarn'] ensures only raw-yarn queries trigger this.
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOfGroups: [
              ['yarn'],  // Only fire if 'yarn' token is present — indicates raw yarn sale
            ],
          },
        } as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 500);
        console.log('✅ WOOL_YARN_FIBER_INTENT: narrowed anyOfGroups to [["yarn"]] only');
      } else {
        console.log('❌ WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // Fix SYNTHETIC_MMF_YARN_INTENT — narrow anyOfGroups to ['yarn'] only
    // Previous TT87 had ['yarn','knitting','knit','crochet','fiber','thread'] which fires for:
    // "Crochet Acrylic Bag" (acrylic token + crochet in anyOfGroups) → wrong ch.55
    // "Black Crochet Skinny Scarf - Handmade Acrylic Knit" → wrong ch.55
    // "100% acrylic crochet food coasters set" → wrong ch.55
    // Narrowing to ['yarn'] prevents these finished-good regressions.
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_MMF_YARN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOfGroups: [
              ['yarn'],  // Only fire if 'yarn' token is present
            ],
          },
        } as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 500);
        console.log('✅ SYNTHETIC_MMF_YARN_INTENT: narrowed anyOfGroups to [["yarn"]] only');
      } else {
        console.log('❌ SYNTHETIC_MMF_YARN_INTENT: not found');
      }
    }

    console.log('\nTT87b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
