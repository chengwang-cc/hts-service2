#!/usr/bin/env ts-node
/**
 * Patch DD — 2026-03-13:
 *
 * Fix AI_CH47_WOODPULP — "sulfite","soda","kraft" are too generic:
 *
 * "Sulfite wrapping paper" (ch.48) contains "sulfite" → AI_CH47_WOODPULP fires
 * → allowChapters:[47] blocks ch.48 paper.
 *
 * "sulfite" in wood pulp context refers to "sulfite pulp" (chemical pulp process
 * using sulfurous acid). But "sulfite wrapping paper", "sulfite tissue", "sulfite
 * printing paper" etc are finished papers (ch.48), not wood pulp (ch.47).
 *
 * Same issue applies to:
 * - "soda" → can fire for "baking soda" or "soda water" context
 * - "kraft" → "kraft paper" is ch.48; "kraft pulp" is ch.47
 *
 * Fix: Replace bare "sulfite","soda","kraft" with phrases "sulfite pulp","soda
 * pulp","kraft pulp" to only fire for actual wood pulp descriptions.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13dd.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── Fix AI_CH47_WOODPULP — replace generic chemistry terms with phrases ────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH47_WOODPULP',
      description: 'Wood pulp, chemical pulp, cellulose pulp → ch.47. ' +
        'Replaced bare "sulfite" with "sulfite pulp": bare "sulfite" fires for ' +
        '"Sulfite wrapping paper" (ch.48 paper), not ch.47 pulp. ' +
        'Replaced bare "soda" with "soda pulp" and "kraft" with "kraft pulp": ' +
        '"kraft paper"/"kraft bags" are ch.48; "kraft pulp"/"kraft wood pulp" are ch.47. ' +
        'Also keeps noneOf for timber/lumber context from patch AA.',
      pattern: {
        anyOf: [
          'pulp', 'woodpulp', 'wood pulp', 'cellulose', 'dissolving',
          'kraft pulp', 'kraft wood pulp',
          'sulfite pulp', 'sulfate pulp',
          'soda pulp',
          'coniferous pulp', 'nonconiferous pulp',
          'chemical pulp', 'mechanical pulp', 'chemi-mechanical',
          'dissolving grades',
        ],
        noneOf: [
          'hoopwood', 'chipwood', 'poles', 'piles', 'stakes',
          'lumber', 'timber', 'sawn', 'joinery', 'carpentry',
          'plywood', 'veneer', 'boards', 'planks',
          // Paper context (finished paper product, not pulp)
          'wrapping paper', 'tissue', 'printing paper', 'writing paper',
          'bags', 'sacks', 'boxes', 'cartons',
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch DD)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
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
    console.log(`\nPatch DD complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
