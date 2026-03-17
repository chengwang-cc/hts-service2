#!/usr/bin/env ts-node
/**
 * Patch TT112 — 2026-03-16: Fix WOODEN_COAT_HANGER_INTENT — add allowChapters:['44'].
 *
 * Problem: "wooden clothing rack" returns 0 results despite WOODEN_COAT_HANGER_INTENT firing.
 * Root cause: WOODEN_FURNITURE_HOUSEHOLD_INTENT also fires for "wooden clothing rack"
 *   (its anyOf includes "wooden clothing rack") with allowChapters:['94'].
 *   Because WOODEN_COAT_HANGER_INTENT has NO allowChapters, the positive filter logic
 *   only sees WOODEN_FURNITURE_HOUSEHOLD_INTENT's allowChapters:['94'].
 *   Entry 4421.10.00.00 (ch.44) fails the positive filter → blocked → 0 results.
 *
 * Fix: Add allowChapters:['44'] to WOODEN_COAT_HANGER_INTENT.
 *   Now ch.44 entries pass the positive filter (via WOODEN_COAT_HANGER_INTENT) while
 *   ch.94 entries pass via WOODEN_FURNITURE_HOUSEHOLD_INTENT — OR logic ensures both survive.
 *   The 4421.10 inject at rank 1 + 0.95 boost wins decisively over 9403's rank 5 + 0.55 boost.
 *
 * For "wood clothing rack for household use" → WOODEN_COAT_HANGER_INTENT doesn't fire
 *   (noneOf "household use" excludes it) → only WOODEN_FURNITURE_HOUSEHOLD_INTENT fires →
 *   9403.60 wins correctly.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt112.ts
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

    // FIX WOODEN_COAT_HANGER_INTENT — add allowChapters:['44']
    // Without allowChapters, WOODEN_FURNITURE_HOUSEHOLD_INTENT's allowChapters:['94']
    // is the only positive filter, so ch.44 entries are blocked.
    // Adding allowChapters:['44'] makes ch.44 pass the positive filter via this rule.
    {
      const existing = allRules.find(r => r.id === 'WOODEN_COAT_HANGER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            ...(existing as any).whitelist,
            allowChapters: ['44'],         // ch.44 (wood articles) passes positive filter
            denyChapters: ['61', '62'],    // keep garment chapter deny
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 575, rule: updated });
        console.log('WOODEN_COAT_HANGER_INTENT: added allowChapters:[44] (fixes "wooden clothing rack" → 0 results)');
      } else {
        console.log('WOODEN_COAT_HANGER_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT112)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT112 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
