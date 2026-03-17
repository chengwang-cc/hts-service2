#!/usr/bin/env ts-node
/**
 * Patch TT102 — 2026-03-16: Fix SEWING_PATTERN_PAPER_INTENT blocking ch.63 results.
 *
 * Problem: "Sewing Pattern (Butterick 3255)" → EMPTY even after TT101.
 *
 * Root cause (found via DB query):
 *   5 rules all match "sewing pattern" phrase. The interaction:
 *   - SEWING_PATTERN_PAPER_INTENT: denyChapters:['63','61','62'] — via AND logic, blocks ALL ch.63
 *   - SEWING_PAPER_PATTERN_INTENT: allowChapters:['63','49','48'] — allows only these chapters
 *   Combined: entries must be in ['63','49','48'] AND NOT in ['63','61','62']
 *   → ch.63 is allowed by allowChapters but BLOCKED by denyChapters → EMPTY!
 *
 * Fix 1: Update SEWING_PATTERN_PAPER_INTENT — remove denyChapters:['63','61','62'],
 *   replace with denyChapters:['84','85'] (block sewing machines/electronics only).
 *   This allows ch.63 (Butterick/Simplicity patterns) through while keeping unwanted chapters out.
 *
 * Fix 2: Update SEWING_PAPER_PATTERN_INTENT — remove allowChapters restriction entirely.
 *   The allowChapters:['63','49','48'] blocks ch.84 (sewing machines), which is good,
 *   but creates fragility. Use denyChapters:['84','85','73'] instead for soft routing.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt102.ts
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

    // 1. FIX SEWING_PATTERN_PAPER_INTENT — remove denyChapters:['63','61','62']
    //    Current: denyChapters:['63','61','62'] → via AND logic blocks ALL ch.63 entries
    //    when combined with SEWING_PAPER_PATTERN_INTENT.allowChapters:['63','49','48']
    //    Result: ch.63 is "allowed" by one rule but "denied" by another → EMPTY
    //    Fix: only deny ch.84 and ch.85 (sewing machines and electronics)
    {
      const existing = allRules.find(r => r.id === 'SEWING_PATTERN_PAPER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            denyChapters: ['84', '85'],   // only block sewing machines/electronics
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 565, rule: updated });
        console.log('SEWING_PATTERN_PAPER_INTENT: changed denyChapters from [63,61,62] to [84,85]');
      } else {
        console.log('SEWING_PATTERN_PAPER_INTENT: not found');
      }
    }

    // 2. FIX SEWING_PAPER_PATTERN_INTENT — replace allowChapters with denyChapters
    //    Current: allowChapters:['63','49','48'] + denyChapters:['84','85']
    //    The allowChapters causes fragility: if a ch.63 entry doesn't pass the OR check
    //    for some reason, we get empty. Convert to pure denyChapters for robustness.
    {
      const existing = allRules.find(r => r.id === 'SEWING_PAPER_PATTERN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            denyChapters: ['84', '85', '73'],   // deny sewing machines, electronics, iron articles
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 551, rule: updated });
        console.log('SEWING_PAPER_PATTERN_INTENT: replaced allowChapters with denyChapters:[84,85,73]');
      } else {
        console.log('SEWING_PAPER_PATTERN_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT102)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT102 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
