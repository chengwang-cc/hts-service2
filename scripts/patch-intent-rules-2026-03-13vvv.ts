#!/usr/bin/env ts-node
/**
 * Patch VVV — 2026-03-13:
 *
 * Additional targeted ch.48 and other fixes.
 *
 * Fixes:
 *
 * 1.  NEW PAPER_CUPS_NESTED_CONTAINERS_INTENT
 *     "Cups and round nested food containers" → expected 4823.61.00 (ch.48 paper cups)
 *     Got 6911.10.37.10 (ceramic cups, ch.69). Cross-chapter.
 *     "Nested food containers" or "round nested" + no ceramic/porcelain/glass context → 4823.61.
 *
 * 2.  NEW WRITING_COVER_PAPER_INTENT
 *     "Writing and cover paper" → expected 4802.55.10 (ch.48)
 *     Got 4802.56.70.50. Both 4802. "Writing and cover paper" is a specific paper
 *     heading in 4802.55 (writing/printing paper ≥40 g/m²).
 *
 * 3.  NEW DRAWING_PAPER_INTENT
 *     "Drawing paper" → expected 4802.55.20 (ch.48)
 *     Got 4802.56.20.00. Both 4802. "Drawing paper" identifies 4802.55.20 specifically.
 *
 * 4.  NEW COTTON_FIBER_COATED_PAPER_INTENT
 *     "Containing by weight 25 percent or more cotton fiber Other Other"
 *     → expected 4810.29.70.20 (ch.48)
 *     Got 4810.22.70.20. Both 4810.
 *     4810.29 = other coated paper. 4810.22 = light-weight coated paper.
 *     "25 percent or more cotton fiber" context → 4810.29 (other coated paper, not light-weight).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13vvv.ts
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

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW PAPER_CUPS_NESTED_CONTAINERS_INTENT ────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PAPER_CUPS_NESTED_CONTAINERS_INTENT',
        description: 'Paper cups and round nested food containers → 4823.61 (ch.48). ' +
          'Semantic picks 6911 (ceramic cups). ' +
          '"Nested food containers" or "cups" in paper context → 4823.61.',
        pattern: {
          anyOf: ['round nested food containers', 'nested food containers', 'nested food'],
          noneOf: ['ceramic', 'porcelain', 'glass', 'plastic', 'metal', 'earthenware'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4823.61', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4823.61' },
          { delta: -0.5, prefixMatch: '6911' },
        ],
      },
    });

    // ── 2. NEW WRITING_COVER_PAPER_INTENT ─────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'WRITING_COVER_PAPER_INTENT',
        description: 'Writing and cover paper → 4802.55.10 (ch.48). ' +
          'Semantic picks 4802.56. ' +
          '"Writing and cover paper" phrase identifies 4802.55 heading.',
        pattern: {
          anyOf: ['writing and cover paper', 'cover paper'],
          noneOf: ['coated', 'printing', 'kraft', 'rolls'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4802.55.10', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4802.55.10' },
          { delta: 0.5, prefixMatch: '4802.55' },
          { delta: -0.4, prefixMatch: '4802.56' },
        ],
      },
    });

    // ── 3. NEW DRAWING_PAPER_INTENT ───────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'DRAWING_PAPER_INTENT',
        description: 'Drawing paper → 4802.55.20 (ch.48). ' +
          'Semantic picks 4802.56. ' +
          '"Drawing paper" identifies 4802.55.20 specifically.',
        pattern: {
          anyOf: ['drawing paper'],
          noneOf: ['coated', 'blueprint', 'tracing', 'kraft'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4802.55.20', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4802.55.20' },
          { delta: 0.5, prefixMatch: '4802.55' },
          { delta: -0.4, prefixMatch: '4802.56' },
        ],
      },
    });

    // ── 4. NEW COTTON_FIBER_COATED_PAPER_INTENT ───────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'COTTON_FIBER_COATED_PAPER_INTENT',
        description: 'Coated paper with ≥25% cotton fiber → 4810.29 (ch.48). ' +
          'Semantic picks 4810.22 (light-weight coated paper). ' +
          '"25 percent or more cotton fiber" → other coated paper 4810.29 (not light-weight).',
        pattern: {
          anyOf: [
            '25 percent or more cotton fiber',
            '25 percent or more cotton',
            'percent or more cotton fiber',
            'percent cotton fiber',
          ],
          anyOfGroups: [
            ['coated', 'containing', 'paper'],
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4810.29', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4810.29' },
          { delta: -0.4, prefixMatch: '4810.22' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch VVV)...`);
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
    console.log(`\nPatch VVV complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
