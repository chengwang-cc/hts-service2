#!/usr/bin/env ts-node
/**
 * Patch AAA — 2026-03-13:
 *
 * Fix ch.55 routing failures and ch.68→ch.84 granite failure.
 * Starting accuracy: 88.71% (621/700), 0 empty results.
 *
 * Fixes:
 *
 * 1.  AI_CH54_NYLON_FABRIC — "Satin weave...artificial staple fibers" → ch.54
 *     'satin'+'woven' anyOfGroups fires → allowSet=[54], ch.55 excluded.
 *     "Staple fibers" = ch.55 (not filament ch.54). Add noneOf phrase.
 *
 * 2.  AI_CH54_RAYON_FABRIC — "viscose rayon staple fibers" → ch.54
 *     'rayon'/'viscose' fires → allowSet=[54], ch.55 excluded.
 *     "Staple fibers" context = ch.55. Add noneOf phrase.
 *
 * 3.  AI_CH58_GAUZE_FABRIC — "Cheesecloth...viscose rayon staple fibers" → ch.52
 *     'cheesecloth' fires → allowSet=[52,58], ch.55 excluded.
 *     Add staple fiber noneOf.
 *
 * 4.  NEW BUILDING_STONE_INTENT — "Granite...Worked monumental or building stone" → ch.84
 *     No rules fire after ZZ patch → semantic confusion (granite query → computers).
 *     Add rule to route building stone/granite queries → ch.68.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13aaa.ts
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

    // ── 1. AI_CH54_NYLON_FABRIC — exclude staple fiber context ───────────────────
    // ch.54 = synthetic/artificial FILAMENT yarns and fabrics
    // ch.55 = synthetic/artificial STAPLE fiber yarns and fabrics
    // The rule fires for satin-woven queries → ch.54 (filament), but "staple fibers"
    // explicitly indicates ch.55. Add 'staple fibers' phrase to noneOf.
    {
      const ex = getExisting('AI_CH54_NYLON_FABRIC');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, [
        'staple fibers', 'staple fibres', 'staple fiber',
        'artificial staple', 'synthetic staple',
      ]) });
    }

    // ── 2. AI_CH54_RAYON_FABRIC — exclude staple fiber context ───────────────────
    // Fires for 'rayon'/'viscose' → allowSet=[54]. But "viscose rayon staple fibers"
    // means ch.55 not ch.54.
    {
      const ex = getExisting('AI_CH54_RAYON_FABRIC');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, [
        'staple fibers', 'staple fibres', 'staple fiber',
        'artificial staple', 'synthetic staple',
      ]) });
    }

    // ── 3. AI_CH58_GAUZE_FABRIC — exclude staple fiber context ───────────────────
    // Fires for 'cheesecloth' → allowSet=[52,58]. But "Cheesecloth...viscose rayon
    // staple fibers" is ch.55.
    {
      const ex = getExisting('AI_CH58_GAUZE_FABRIC');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, [
        'staple fibers', 'staple fibres', 'staple fiber',
        'artificial staple', 'viscose rayon', 'rayon staple',
      ]) });
    }

    // ── 4. NEW BUILDING_STONE_INTENT — building/monumental stone → ch.68 ─────────
    // "Granite Worked monumental or building stone...mosaic cubes" → expected 6802 (ch.68).
    // After ZZ patch, no rules fire → semantic picks ch.84 (computers) due to confusing
    // terms in the long query. Add a rule to anchor stone-working queries to ch.68.
    patches.push({
      priority: 650,
      rule: {
        id: 'BUILDING_STONE_INTENT',
        description:
          'Worked building/monumental stone → ch.68 (6801-6803). ' +
          'Long HTS descriptions for granite/marble articles have terms that confuse ' +
          'semantic search (e.g., "surface-worked", "subheading") leading to ch.84. ' +
          'anyOf phrases are all taken from ch.68 heading descriptions.',
        pattern: {
          anyOf: [
            'monumental or building stone',
            'monumental or building',
            'building stone',
            'building purposes',
            'worked monumental',
            'mosaic cubes and the like of natural stone',
            'mosaic cubes',
            'chippings and powder of natural stone',
            'artificially colored granules',
            'artificially coloured granules',
          ],
          noneOf: [
            'machinery', 'machine', 'machines', 'equipment',
            'electronics', 'electrical', 'computer',
          ],
        },
        whitelist: { allowChapters: ['68'] },
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch AAA)...`);
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
    console.log(`\nPatch AAA complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
