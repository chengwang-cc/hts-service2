#!/usr/bin/env ts-node
/**
 * Patch Z — 2026-03-12:
 *
 * Fix ch.41 (leather/hides) regressions introduced by LEATHER_HIDES_INTENT (patch S):
 *
 * 1. AI_CH02_SALTED_CURED_MEAT: "salted","dried" fire for "raw hides and skins...
 *    fresh or salted dried limed pickled or otherwise preserved" → allowChapters:[02].
 *    LEATHER_HIDES_INTENT denies ch.02, but ch.51 (from AI_CH51_RAW_WOOL "raw") remains
 *    → only ch.51 survives → EMPTY for ch.41. Fix: add noneOf for hides/leather context.
 *
 * 2. AI_CH03_SMOKED_DRIED_SALTED_FISH: "salted","dried","smoked" fire for same hide
 *    preservation query → allowChapters:[03]. Same conflict. Fix: add noneOf for hides/
 *    leather context.
 *
 * 3. AI_CH51_RAW_WOOL: "raw" fires for "raw hides and skins" → allowChapters:[51].
 *    Animal hides in "raw" state are ch.41, not ch.51 wool. Fix: add noneOf=['hides',
 *    'hide','skins','skin','leather'].
 *
 * 4. AI_CH64_SHOE_UPPER: "leather upper" in anyOf fires for "upper leather ... lining
 *    leather Grain splits" because "upper leather upper" contains the substring "leather
 *    upper" → allowChapters:[64] blocks ch.41. Fix: remove "leather upper" from anyOf
 *    (too generic — fires for "upper leather" = leather grade term in ch.41 context).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12z.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const LEATHER_NONE_OF_EXTRA = [
  'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning', 'parchment',
  'limed', 'pickled', 'dehaired', 'pretanned', 'crusting',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH02_SALTED_CURED_MEAT — exclude leather/hide preservation context
  {
    priority: 640,
    rule: {
      id: 'AI_CH02_SALTED_CURED_MEAT',
      description: 'Salted, cured, smoked, dried meat → ch.02. ' +
        'Added noneOf for leather/hide preservation context: hide preservation uses ' +
        '"salted","dried","limed","pickled" → same words as meat preservation. ' +
        'Raw hides and skins in a salted/pickled state are ch.41, not ch.02.',
      pattern: {
        anyOf: [
          'salted', 'cured', 'smoked', 'dried', 'brine', 'corned',
          'pancetta', 'serrano', 'coppa', 'guanciale', 'salt', 'jerky',
        ],
        noneOf: [
          'beef jerky', 'meat jerky',
          ...LEATHER_NONE_OF_EXTRA,
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 2. Fix AI_CH03_SMOKED_DRIED_SALTED_FISH — exclude leather/hide context ──
  {
    priority: 640,
    rule: {
      id: 'AI_CH03_SMOKED_DRIED_SALTED_FISH',
      description: 'Smoked, dried, salted, cured fish → ch.03. ' +
        'Added noneOf for leather/hide preservation context: same issue as AI_CH02 — ' +
        '"salted","dried" appear in animal hide preservation HTS descriptions (ch.41). ' +
        'Salted/dried fish ≠ salted/dried hides.',
      pattern: {
        anyOf: [
          'smoked', 'dried', 'salted', 'cured', 'kippered', 'bacalao', 'stockfish',
          'salt', 'brine', 'jerky', 'lox', 'gravlax', 'anchovies', 'anchovy',
          'herring', 'sardine', 'mackerel',
        ],
        noneOf: LEATHER_NONE_OF_EXTRA,
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 3. Fix AI_CH51_RAW_WOOL — exclude hides/skins context ────────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH51_RAW_WOOL',
      description: 'Raw wool, fleece, greasy wool → ch.51. ' +
        'Added noneOf for hides/skins context: "raw" fires for "raw hides and skins" in ' +
        'ch.41 animal hide HTS descriptions. Raw animal hides are ch.41, not ch.51 wool. ' +
        'Also keeps prior mineral/slag wool and fabric context noneOf.',
      pattern: {
        anyOf: ['wool', 'fleece', 'greasy', 'shorn', 'raw', 'unwashed'],
        noneOf: [
          'yarn', 'fabric', 'knit', 'woven', 'felt', 'blanket', 'sweater', 'coat', 'carpet',
          'slag', 'mineral', 'rock wool', 'slag wool', 'glass wool', 'ceramic',
          'insulation', 'insulating', 'pipe',
          // Hides/skins context → ch.41
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 4. Fix AI_CH64_SHOE_UPPER — remove "leather upper" phrase ────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH64_SHOE_UPPER',
      description: 'Shoe uppers, footwear uppers, vamps → ch.64. ' +
        'Removed "leather upper" from anyOf: "upper leather [space] upper leather" in ' +
        'leather grading HTS descriptions (ch.41) contains the substring "leather upper", ' +
        'causing this rule to fire for leather grade queries. ' +
        '"shoe upper", "footwear upper", "boot upper" phrases are sufficient.',
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

    console.log(`Applying ${PATCHES.length} rule patches (batch Z)...`);

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
    console.log(`\nPatch Z complete: ${success} applied, ${failed} failed`);
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
