#!/usr/bin/env ts-node
/**
 * Patch TT100 — 2026-03-16: Fix EMPTY results from TT99 intents.
 *
 * Problem: TT99 added 4 intents with allowChapters restrictions that are causing 7 new EMPTY results.
 * When denyChapters blocks all organic results AND allowChapters restricts all other chapters,
 * if the inject entries don't resolve in the search pool, the result is empty.
 *
 * Fix: Remove allowChapters from all 4 TT99 intents. Keep denyChapters + inject + boosts/penalties.
 * This is the "soft routing" approach: inject adds correct chapter to candidates, denyChapters
 * blocks known-wrong chapters, but doesn't block ALL other chapters (preventing empty results).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt100.ts
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

    const intentsToFix = [
      'ABRASIVE_SANDING_MATERIAL_INTENT',
      'FABRIC_SAMPLE_KIT_INTENT',
      'STAINLESS_STEEL_TABLEWARE_INTENT',
      'SEWING_PATTERN_INTENT',
    ];

    for (const id of intentsToFix) {
      const existing = allRules.find(r => r.id === id);
      if (existing) {
        const currentWhitelist = (existing as any).whitelist || {};
        // Remove allowChapters, keep only denyChapters
        const updated = {
          ...existing,
          whitelist: {
            denyChapters: currentWhitelist.denyChapters || [],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 540, rule: updated });
        console.log(`${id}: removed allowChapters (keeping denyChapters:${JSON.stringify(currentWhitelist.denyChapters)})`);
      } else {
        console.log(`${id}: not found`);
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT100)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT100 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
