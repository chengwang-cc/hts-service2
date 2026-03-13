#!/usr/bin/env ts-node
/**
 * Patch ZZ — 2026-03-13:
 *
 * Fix remaining tractable cross-chapter routing failures.
 * Starting accuracy: 88.00% (616/700), 0 empty results.
 *
 * Fixes:
 *
 * 1.  AI_CH36_EXPLOSIVES — "granite powder granules chippings" → ch.84 (computers?!)
 *     'powder' fires → allowSet=[36], ch.68 excluded → semantic fallback picks ch.84.
 *     Add stone/granite context to noneOf.
 *
 * 2.  AI_CH54_POLYPROPYLENE_YARN — "polyethylene/polypropylene strip sacks and bags" → ch.54
 *     'polypropylene' fires → allowSet=[54], ch.63 excluded.
 *     Add sack/bag/strip context to noneOf.
 *
 * 3.  YARN_INTENT — "Circular knit...cotton yarns...knitted or crocheted fabrics" → ch.52
 *     'yarn'/'cotton yarn' fires → allowSet=[51,52,54,55], ch.60 excluded.
 *     Add 'knitted or crocheted' phrase to noneOf (fabrics not yarns).
 *
 * 4.  AI_CH54_ELASTOMERIC_YARN — "...elastomeric yarn...Knitted or crocheted fabrics" → ch.52
 *     'elastomeric' fires → allowSet=[54], ch.60 excluded.
 *     Add 'knitted or crocheted' to noneOf.
 *
 * 5.  AI_CH40_RUBBER_THREAD_CORD — "rubber thread...Knitted or crocheted fabrics" → ch.52
 *     Add 'knitted or crocheted' to noneOf.
 *
 * 6.  AI_CH56_RUBBER_THREAD — same → add 'knitted or crocheted' to noneOf.
 *
 * 7.  AI_CH56_RUBBER_ELASTIC_THREAD — same → add 'knitted or crocheted' to noneOf.
 *
 * 8.  AI_CH58_BRAID_TASSEL_TRIM — "Cords braids...used in industry as packing/lubricating" → ch.58
 *     'braids' fires → allowSet=[56,58,63], ch.59 excluded.
 *     Add 'lubricating material','industrial' to noneOf.
 *
 * 9.  NEW MODIFIED_FATS_OILS_INTENT — "...fats...boiled oxidized...polymerized by heat in vacuum..."
 *     No rules fire → semantic picks ch.85 (vacuum cleaners via 'vacuum').
 *     New rule for chemically-modified fats/oils → allowChapters:[15].
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13zz.ts
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

    // ── 1. AI_CH36_EXPLOSIVES — exclude stone/granite/powder context ─────────────
    {
      const ex = getExisting('AI_CH36_EXPLOSIVES');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, [
        'stone', 'granite', 'marble', 'slate', 'natural stone', 'limestone',
        'chippings', 'granules', 'gravel', 'rock',
      ]) });
    }

    // ── 2. AI_CH54_POLYPROPYLENE_YARN — exclude sacks/bags/strip context ─────────
    {
      const ex = getExisting('AI_CH54_POLYPROPYLENE_YARN');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, [
        'sacks', 'sack', 'bags', 'bag', 'strip', 'strips',
        'packing of goods', 'packing goods', 'raffia',
      ]) });
    }

    // ── 3. YARN_INTENT — exclude knitted/crocheted fabric context ────────────────
    // These yarn rules fire when the query describes a FABRIC (ch.60/61), not raw yarn.
    // The phrase "knitted or crocheted" appears in fabric headings but not in raw yarn headings.
    {
      const ex = getExisting('YARN_INTENT');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['knitted or crocheted', 'knitted or crocheted fabrics']) });
    }

    // ── 4. AI_CH54_ELASTOMERIC_YARN — exclude knitted/crocheted fabric context ───
    {
      const ex = getExisting('AI_CH54_ELASTOMERIC_YARN');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['knitted or crocheted', 'knitted or crocheted fabrics']) });
    }

    // ── 5. AI_CH40_RUBBER_THREAD_CORD — exclude knitted/crocheted fabric context ─
    {
      const ex = getExisting('AI_CH40_RUBBER_THREAD_CORD');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['knitted or crocheted', 'knitted or crocheted fabrics']) });
    }

    // ── 6. AI_CH56_RUBBER_THREAD — exclude knitted/crocheted fabric context ──────
    {
      const ex = getExisting('AI_CH56_RUBBER_THREAD');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['knitted or crocheted', 'knitted or crocheted fabrics']) });
    }

    // ── 7. AI_CH56_RUBBER_ELASTIC_THREAD — exclude knitted/crocheted fabric ──────
    {
      const ex = getExisting('AI_CH56_RUBBER_ELASTIC_THREAD');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, ['knitted or crocheted', 'knitted or crocheted fabrics']) });
    }

    // ── 8. AI_CH58_BRAID_TASSEL_TRIM — exclude industrial/lubricating context ────
    // 'braids' fires for "Cords braids and the like of a kind used in industry as
    // packing or lubricating material" (ch.59 industrial textiles).
    {
      const ex = getExisting('AI_CH58_BRAID_TASSEL_TRIM');
      if (ex) patches.push({ priority: 640, rule: addNoneOf(ex, [
        'lubricating material', 'lubricating', 'industrial',
        'packing material', 'packing or lubricating', 'in industry',
      ]) });
    }

    // ── 9. NEW MODIFIED_FATS_OILS_INTENT — chemically modified fats → ch.15 ──────
    // Query: "Animal vegetable fats...boiled oxidized...polymerized by heat in vacuum or in inert gas"
    // Semantic picks ch.85 (vacuum cleaners) because of 'vacuum'.
    // New rule to route chemically-modified fats/oils to ch.15.
    patches.push({
      priority: 650,
      rule: {
        id: 'MODIFIED_FATS_OILS_INTENT',
        description:
          'Chemically modified fats/oils → ch.15 (1518). ' +
          '"Polymerized by heat in vacuum or in inert gas" describes standing oils/blown oils. ' +
          'Without this rule, "vacuum" in the description causes semantic to pick ch.85 ' +
          '(vacuum cleaners/electrical appliances). ' +
          'anyOf phrases are all from the ch.15 heading 1518 description.',
        pattern: {
          anyOf: [
            'polymerized by heat in vacuum',
            'in vacuum or in inert gas',
            'chemically modified',
            'sulfurized blown',
            'blown oxidized',
            'dehydrated sulfurized',
            'oxidized dehydrated',
            'inedible mixtures or preparations of animal vegetable',
            'inedible mixtures or preparations',
            'boiled oxidized dehydrated',
          ],
        },
        whitelist: { allowChapters: ['15'] },
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch ZZ)...`);
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
    console.log(`\nPatch ZZ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
