#!/usr/bin/env ts-node
/**
 * Patch G — 2026-03-12:
 *
 * Fix AI_CH59_BUCKRAM_STIFFENED — has bare "foundation" in anyOf with
 * allowChapters:['59']. When combined with COSMETICS_FOUNDATION_DENY_TEXTILE
 * (denyChapters:['59']), queries like "foundation makeup" fire both rules,
 * allowChapters restricts results to ch.59, then denyChapters removes ch.59 → empty results.
 *
 * Fix: remove "foundation" from anyOf (it fires for cosmetic foundation queries);
 * keep only unambiguous textile/hat vocabulary; add noneOf for cosmetic context.
 *
 * Also update CONCEALER_FOUNDATION_INTENT to fire for bare "foundation" + "makeup"
 * context so ch.33 results are always available for cosmetic foundation queries.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12g.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // Fix AI_CH59_BUCKRAM_STIFFENED — remove bare "foundation" (cosmetic conflict)
  {
    priority: 303,
    rule: {
      id: 'AI_CH59_BUCKRAM_STIFFENED',
      description: 'Buckram/stiffened textile for hat/book making → ch.59 (5901); only for textile construction queries',
      pattern: {
        // Remove "foundation" — it fires for cosmetic foundation queries
        // Keep only unambiguous textile/hat construction terms
        anyOf: ['buckram', 'tracing cloth', 'bookcloth', 'hat foundation', 'hat stiffener', 'interlining', 'stiffened textile'],
        noneOf: ['canvas', 'painting', 'artist', 'makeup', 'cosmetic', 'skin', 'coverage'],
      },
      whitelist: {
        allowChapters: ['59'],
      },
    },
  },

  // Update CONCEALER_FOUNDATION_INTENT to also fire for bare "foundation" in cosmetic context
  {
    priority: 304,
    rule: {
      id: 'CONCEALER_FOUNDATION_INTENT',
      description: 'Cosmetic foundation/concealer queries → ch.33 (3304); boost face makeup preparations',
      pattern: {
        anyOf: [
          'concealer', 'face concealer', 'foundation cream', 'bb cream', 'cc cream',
          'tinted moisturizer', 'liquid foundation', 'powder foundation',
          'full coverage foundation', 'matte foundation', 'dewy foundation',
          'skin foundation', 'face foundation',
        ],
      },
      whitelist: {
        allowChapters: ['33'],
      },
    },
  },
];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch G)...`);

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
    console.log(`\nPatch G complete: ${success} applied, ${failed} failed`);
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
