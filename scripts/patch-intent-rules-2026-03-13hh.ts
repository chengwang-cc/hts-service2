#!/usr/bin/env ts-node
/**
 * Patch HH — 2026-03-13:
 *
 * Fix 3 rules:
 *
 * 1. YARN_INTENT: allowChapters:[55,51,52] blocks ch.54 synthetic filament woven
 *    fabrics. "Woven fabrics of synthetic filament yarn" has "yarn" → YARN_INTENT
 *    fires → ch.54 not in surviving. Add '54' to allowChapters. Also add 'filament'
 *    to noneOf to prevent firing on synthetic filament fabric descriptions where
 *    the result is actually ch.54 (filament fabrics vs staple fiber fabrics).
 *
 * 2. AI_CH89_PERSONAL_WATERCRAFT: "jet" fires for "Jet type Other" (ch.84 looms
 *    — air-jet/water-jet looms) → allowChapters:[89] blocks ch.84.
 *    "Jet type" in textile/weaving context = type of loom drive mechanism.
 *    Fix: add noneOf for loom/weaving/textile context.
 *
 * 3. MIRROR_INTENT: "mirrors" fires for "Lenses prisms mirrors and other optical
 *    elements...parts of instruments or apparatus" (ch.90 optical instrument parts)
 *    → allowChapters:[70] blocks ch.90. Mounted optical mirrors as instrument
 *    components are ch.90, not ch.70 (flat glass mirrors).
 *    Fix: add noneOf for optical instrument context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13hh.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix YARN_INTENT — add ch.54 to allowChapters ──────────────────────────
  {
    priority: 640,
    rule: {
      id: 'YARN_INTENT',
      description: 'Knitting/crochet yarn, textile yarn → ch.54/55/51/52. ' +
        'Added ch.54 to allowChapters: "Woven fabrics of synthetic filament yarn" (ch.54) ' +
        'was excluded because allowChapters only had [55,51,52]. Synthetic filament woven ' +
        'fabrics are ch.54, not ch.55 (man-made staple). ' +
        'Keeps noneOf for finished garment context from patch GG.',
      pattern: {
        anyOf: ['yarn', 'knitting yarn', 'crochet yarn', 'wool knitting yarn', 'acrylic yarn', 'chunky yarn', 'cotton yarn'],
        noneOf: [
          'trousers', 'trouser', 'pants', 'suit', 'suits', 'garment', 'garments',
          'jacket', 'jackets', 'coat', 'coats', 'dress', 'dresses',
          'diameter', 'microns', 'micron', 'fiber diameter', 'average fiber',
        ],
      },
      whitelist: { allowChapters: ['54', '55', '51', '52'] },
    },
  },

  // ── 2. Fix AI_CH89_PERSONAL_WATERCRAFT — add noneOf for loom/textile context ──
  {
    priority: 630,
    rule: {
      id: 'AI_CH89_PERSONAL_WATERCRAFT',
      description: 'Personal watercraft, jet skis → ch.89. ' +
        'Added noneOf for loom/textile weaving context: "Jet type Other" (ch.84 looms — ' +
        'air-jet and water-jet looms are types of weaving machines) has "jet" → fires ' +
        'allowChapters:[89], blocking ch.84. Jet-type looms are industrial weaving ' +
        'machinery (ch.84), not watercraft.',
      pattern: {
        anyOf: ['jet ski', 'personal watercraft', 'pwc', 'seadoo', 'waverunner', 'jet boat', 'jet'],
        noneOf: [
          // Loom/weaving context → ch.84
          'loom', 'looms', 'weft', 'warp', 'weaving', 'textile', 'fabric', 'fabrics',
          'weave', 'shuttleless', 'rapier', 'projectile',
          // Aircraft context (not the same as watercraft)
          'aircraft', 'airplane', 'jet engine', 'turbine',
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 3. Fix MIRROR_INTENT — add noneOf for optical instrument context ───────────
  {
    priority: 630,
    rule: {
      id: 'MIRROR_INTENT',
      description: 'Flat glass mirrors, decorative mirrors → ch.70. ' +
        'Added noneOf for optical instrument context: "Lenses prisms mirrors and other ' +
        'optical elements...parts of instruments or apparatus" (ch.90) has "mirrors" → ' +
        'fires allowChapters:[70]. Mounted optical elements as instrument components are ' +
        'ch.90 (scientific/optical instruments), not ch.70 (flat glass).',
      pattern: {
        anyOf: ['mirror', 'mirrors', 'looking glass', 'vanity mirror'],
        noneOf: [
          // Optical instrument context → ch.90
          'optical elements', 'optical element', 'optical', 'prisms', 'prism',
          'lenses', 'lens', 'instruments', 'apparatus', 'mounted',
          'fittings for', 'parts of instruments',
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

    console.log(`Applying ${PATCHES.length} rule patches (batch HH)...`);

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
    console.log(`\nPatch HH complete: ${success} applied, ${failed} failed`);
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
