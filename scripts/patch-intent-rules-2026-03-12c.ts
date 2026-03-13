#!/usr/bin/env ts-node
/**
 * Patch C — 2026-03-12:
 *
 * Fix critical bug: AI_CH06_ORNAMENTAL_FOLIAGE has "leather" in its anyOf,
 * which fires allowChapters:['06'] for ANY leather query (bags, jackets, etc.),
 * blocking all non-ch.06 results and producing empty search results.
 *
 * Fix: replace bare "leather" token with multi-word phrases "leather leaf" and
 * "leather fern" which are the actual botanical terms intended.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12c.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // Fix AI_CH06_ORNAMENTAL_FOLIAGE — remove bare "leather" token
  {
    priority: 200,
    rule: {
      id: 'AI_CH06_ORNAMENTAL_FOLIAGE',
      description: 'Ornamental foliage/greenery for floristry → ch.06 (0604)',
      pattern: {
        anyOf: [
          'foliage', 'greenery', 'eucalyptus', 'moss', 'lichen',
          'fern', 'ferns', 'branches', 'ruscus', 'pittosporum',
          'statice', 'aralia', 'aspidistra', 'chamadorea',
          // "leather" replaced with precise multi-word botanical phrases:
          'leather leaf', 'leather fern', 'leatherleaf',
          'wreath',
        ],
        noneOf: ['artificial', 'silk', 'plastic', 'dried', 'faux', 'synthetic'],
      },
      whitelist: {
        allowChapters: ['06'],
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

    console.log(`Applying ${PATCHES.length} rule patches (batch C)...`);

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
    console.log(`\nPatch C complete: ${success} applied, ${failed} failed`);
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
