#!/usr/bin/env ts-node
/**
 * Patch YY — 2026-03-13:
 *
 * Fix 2 EMPTY results + 1 cross-chapter failure introduced or remaining after XX.
 * Starting accuracy: 87.86% (615/700), 2 empty results.
 *
 * Fixes:
 *
 * 1.  SCREW_BOLT_INTENT — "Other Shelled Other nuts fresh or dried..." → EMPTY (ch.08)
 *     'nuts' in anyOf fires → allowSet=[73]. But 'kernel'/'peel' in existing noneOf don't catch
 *     'kernels'/'peeled' (exact token mismatch). Add 'shelled','peeled' to noneOf.
 *
 * 2.  AI_CH02_SALTED_CURED_MEAT — same query fires for 'dried' → allowSet=[02].
 *     Add 'nuts','nut','shelled','peeled' to noneOf.
 *
 * 3.  AI_CH14_PLAITING_MATERIALS — "...Cane or beet sugar...sucrose in solid form" → EMPTY (ch.17)
 *     'cane' in anyOf fires for sugar queries → allowSet=[14]. ch.17 excluded → empty result.
 *     Add 'sugar','sucrose','beet','flavoring','coloring matter' to noneOf.
 *
 * 4.  MUSICAL_INSTRUMENT_INTENT — "...Cases boxes crates drums...packing cases of wood" → ch.92
 *     'drums' fires → allowSet=[44,92]. Both allowed but semantic picks ch.92.
 *     Add 'packing','cable','crate','crates','pallet','pallets' to noneOf.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13yy.ts
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
    const allRules = svc.getAllRules();

    function getExisting(id: string): IntentRule | undefined {
      return allRules.find((r) => r.id === id) as IntentRule | undefined;
    }

    function addNoneOf(existing: IntentRule, extra: string[]): IntentRule {
      const pat = existing.pattern as Record<string, unknown>;
      const curr: string[] = (pat.noneOf as string[]) ?? [];
      return { ...existing, pattern: { ...pat, noneOf: Array.from(new Set([...curr, ...extra])) } };
    }

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. SCREW_BOLT_INTENT — exclude shelled nuts context ──────────────────────
    // 'nuts' in anyOf → fires for "shelled nuts fresh or dried" (ch.08 almonds).
    // The existing noneOf has 'peel','kernel'/'kernels' but not 'peeled'/'shelled' (exact tokens).
    {
      const ex = getExisting('SCREW_BOLT_INTENT');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['shelled', 'peeled', 'almond', 'almonds', 'walnut', 'walnuts', 'pistachio', 'pistachios', 'hazelnut', 'hazelnuts', 'cashew', 'cashews']) });
    }

    // ── 2. AI_CH02_SALTED_CURED_MEAT — exclude nuts/seeds context ────────────────
    // 'dried' fires for "nuts fresh or dried whether or not shelled or peeled" → allowSet=[02].
    // ch.08 excluded → empty result. Add nut context to noneOf.
    {
      const ex = getExisting('AI_CH02_SALTED_CURED_MEAT');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['nuts', 'nut', 'shelled', 'peeled', 'kernel', 'kernels']) });
    }

    // ── 3. AI_CH14_PLAITING_MATERIALS — exclude sugar cane context ────────────────
    // 'cane' in anyOf fires for "Cane or beet sugar...sucrose" → allowSet=[14], ch.17 excluded.
    // Add sugar context to noneOf.
    {
      const ex = getExisting('AI_CH14_PLAITING_MATERIALS');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['sugar', 'sucrose', 'beet', 'molasses', 'fructose', 'glucose', 'syrup', 'flavoring', 'flavouring', 'coloring', 'colouring', 'added flavoring', 'added flavouring']) });
    }

    // ── 4. MUSICAL_INSTRUMENT_INTENT — exclude packing/crates/pallets context ────
    // 'drums' fires for wooden packing cases query ("drums and similar packings, cable-drums").
    // allowSet=[44,92] → semantic picks ch.92 over ch.44.
    // Add packaging context to noneOf.
    {
      const ex = getExisting('MUSICAL_INSTRUMENT_INTENT');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['packing', 'packing case', 'packing cases', 'cable', 'crate', 'crates', 'pallet', 'pallets', 'similar packings']) });
    }

    console.log(`Applying ${patches.length} rule patches (batch YY)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch YY complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
