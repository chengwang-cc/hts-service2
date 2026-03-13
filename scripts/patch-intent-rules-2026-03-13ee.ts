#!/usr/bin/env ts-node
/**
 * Patch EE — 2026-03-13:
 *
 * Fix AI_CH64_SHOE_UPPER — re-apply patch Z "leather upper" removal:
 *
 * "leather upper" in anyOf fires for "Upper leather Upper leather lining leather
 * Grain splits" because "upper leather upper leather" contains the substring
 * "leather upper" → allowChapters:[64] blocks ch.41.
 *
 * Patch Z removed "leather upper" from anyOf but the change did not persist.
 * Re-applying at higher priority (660) to ensure it wins.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ee.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── Fix AI_CH64_SHOE_UPPER — remove "leather upper" from anyOf ────────────────
  {
    priority: 660,
    rule: {
      id: 'AI_CH64_SHOE_UPPER',
      description: 'Shoe uppers, footwear uppers, vamps → ch.64. ' +
        'Removed "leather upper" from anyOf: "upper leather upper leather" in ' +
        'leather grading HTS descriptions (ch.41) contains the substring "leather upper", ' +
        'causing this rule to fire for leather grade queries and block ch.41. ' +
        '"shoe upper", "footwear upper", "boot upper" phrases are sufficient and safe.',
      pattern: {
        anyOf: [
          'shoe upper', 'shoe uppers',
          'footwear upper', 'footwear uppers',
          'vamp',
          'boot upper',
          'sneaker upper',
          // "leather upper" removed — fires for "upper leather" in ch.41 context
        ],
      },
      whitelist: { allowChapters: ['64'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch EE)...`);

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
    console.log(`\nPatch EE complete: ${success} applied, ${failed} failed`);
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
