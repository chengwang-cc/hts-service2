#!/usr/bin/env ts-node
/**
 * Patch II — 2026-03-13:
 *
 * Fix 1 rule:
 *
 * 1. AI_CH56_WADDING_BATTING: "stuffing" in anyOf fires for feathers/bird-skin
 *    HTS descriptions like "Feathers of a kind used for stuffing down Skins and
 *    other parts of birds with their feathers or down feathers..." → allowChapters:[56]
 *    blocks ch.05. Bird feathers/down used as stuffing material are ch.05, not ch.56
 *    (wadding, batting, nonwovens). Fix: add noneOf for feather/bird/down context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ii.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH56_WADDING_BATTING — exclude feather/bird/down context ───────
  {
    priority: 640,
    rule: {
      id: 'AI_CH56_WADDING_BATTING',
      description: 'Wadding, batting, nonwovens, textile fill material → ch.56. ' +
        'Added noneOf for feather/bird/down context: "Feathers of a kind used for ' +
        'stuffing down Skins and other parts of birds with their feathers or down ' +
        'feathers..." has "stuffing" → fires allowChapters:[56], blocking ch.05. ' +
        'Bird feathers and down used as fill/stuffing material are ch.05 (feathers ' +
        'and down), not ch.56 (manufactured textile wadding/batting).',
      pattern: {
        anyOf: [
          'wadding', 'batting', 'nonwoven', 'nonwovens', 'felt', 'stuffing',
          'fiberfill', 'fibre fill', 'fiber fill', 'textile fill',
        ],
        noneOf: [
          // Feather/bird/down context → ch.05
          'feathers', 'feather', 'down feathers', 'down', 'birds', 'bird',
          'avian', 'plumage', 'disinfected', 'trimmed edges', 'preservation',
          'powder and waste', 'parts of feathers', 'bird skins',
          // Garment context
          'garments', 'garment', 'wearing apparel', 'padded', 'quilted',
        ],
      },
      whitelist: { allowChapters: ['56'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch II)...`);

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
    console.log(`\nPatch II complete: ${success} applied, ${failed} failed`);
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
