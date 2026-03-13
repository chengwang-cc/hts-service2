#!/usr/bin/env ts-node
/**
 * Patch MM — 2026-03-13:
 *
 * Fix 2 rules:
 *
 * 1. AI_CH47_RECOVERED_PAPER: "paperboard" and "corrugated" fire for "Machinery for
 *    finishing paper or paperboard...making pulp of fibrous cellulosic material" (8439 ch.84).
 *    Patches JJ added machinery noneOf to AI_CH47_WOODPULP and AI_CH47_COTTON_LINTERS_PULP
 *    but missed AI_CH47_RECOVERED_PAPER. Fix: add machinery noneOf.
 *
 * 2. NEW GLASS_INNERS_CH70_INTENT: "Glass inners for vacuum flasks or for other vacuum
 *    vessels" (7020 ch.70) → gets ch.85 (vacuum flask appliance). "Glass inner/liner" =
 *    the glass tube inside a vacuum flask, not the flask itself. Add explicit rule for
 *    glass liner/inner context → ch.70.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13mm.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const MACHINERY_NONE_OF = [
  'machinery', 'machines', 'equipment', 'apparatus', 'calender',
  'pressing', 'winding', 'drying machine',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH47_RECOVERED_PAPER — add machinery noneOf ──────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH47_RECOVERED_PAPER',
      description: 'Recovered/recycled paper, wastepaper, newsprint → ch.47. ' +
        'Added noneOf for machinery context: "Machinery for finishing paper or paperboard ' +
        '...making pulp" (8439 ch.84) has "paperboard","corrugated" → fires allowChapters:[47]. ' +
        '"Paperboard" in machinery descriptions is the material being processed, not a ' +
        'recovered paper product. Paper/pulp machinery is ch.84 (missed by patch JJ).',
      pattern: {
        anyOf: [
          'recovered', 'recycled', 'scrap', 'wastepaper', 'newsprint',
          'deinking', 'corrugated', 'paperboard',
        ],
        noneOf: MACHINERY_NONE_OF,
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

  // ── 2. NEW GLASS_INNERS_CH70_INTENT — glass liners for vacuum vessels ────────
  {
    priority: 650,
    rule: {
      id: 'GLASS_INNERS_CH70_INTENT',
      description: 'Glass inners/liners for vacuum flasks and vacuum vessels → ch.70. ' +
        '"Glass inners for vacuum flasks or for other vacuum vessels" (7020 ch.70) gets ' +
        'ch.85 (vacuum flask as household appliance). The glass inner is the glass tube ' +
        'component (ch.70 glassware), not the finished vacuum flask (ch.85).',
      pattern: {
        anyOf: [
          'glass inners', 'glass inner', 'glass liner', 'glass liners',
          'glass tube for vacuum', 'vacuum vessel glass',
        ],
      },
      whitelist: { allowChapters: ['70'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch MM)...`);

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
    console.log(`\nPatch MM complete: ${success} applied, ${failed} failed`);
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
