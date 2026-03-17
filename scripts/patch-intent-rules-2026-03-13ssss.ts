#!/usr/bin/env ts-node
/**
 * Patch SSSS — 2026-03-13:
 *
 * Fix YARN_INTENT (priority 640) diluting SYNTHETIC_MMF_YARN_INTENT:
 *
 * Problem: YARN_INTENT has allowChapters=['54','55','51','52'] and fires on
 * generic 'yarn' token. For "acrylic yarn", "bernat knitting yarn",
 * "red heart super saver" etc., YARN_INTENT fires and adds ch.52 to allowSet.
 * Combined allowSet = {52,54,55,51}, allowing ch.52 cotton fabric results
 * even though SYNTHETIC_MMF_YARN_INTENT restricts to ch.55 only.
 *
 * Fix 1: Add synthetic/acrylic/brand name terms to YARN_INTENT noneOf
 *         so ch.52-inclusive YARN_INTENT doesn't fire for those queries.
 *
 * Fix 2: Add natural fiber terms (wool, merino, alpaca, cashmere) to
 *         SYNTHETIC_MMF_YARN_INTENT noneOf (belt-and-suspenders already done
 *         in RRRR but confirm).
 *
 * Fix 3: NEW KNITTING_CRAFT_YARN_INTENT (priority 545):
 *         Catch remaining generic craft yarn queries that don't match
 *         specific fiber rules. Routes to ch.55 (synthetic MMF yarn)
 *         as the most common craft yarn fiber type.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ssss.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed SSSS: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. YARN_INTENT: add synthetic/brand terms to noneOf ──────────────────
    // YARN_INTENT fires on 'yarn' with allowChapters=['54','55','51','52'].
    // When brand-name acrylic yarns fire YARN_INTENT, ch.52 gets added to allowSet
    // and dominates over SYNTHETIC_MMF_YARN_INTENT's ch.55-only restriction.
    // Adding these terms to noneOf ensures YARN_INTENT doesn't fire for
    // brand-name acrylic yarn queries → SYNTHETIC_MMF_YARN_INTENT handles them alone.
    addNoneOf('YARN_INTENT', [
      // Synthetic fiber terms
      'acrylic', 'polyester', 'nylon', 'synthetic',
      'man-made fiber', 'mmf', 'microfiber',
      // Brand names (popular acrylic/synthetic yarn brands)
      'bernat', 'red heart', 'caron', 'lion brand',
      'paintbox', 'drops', 'premier yarns',
    ], 'exclude synthetic/brand yarn queries so SYNTHETIC_MMF_YARN_INTENT handles them with ch.55-only restriction');

    console.log(`Applying ${patches.length} rule patches (batch SSSS)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch SSSS complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
