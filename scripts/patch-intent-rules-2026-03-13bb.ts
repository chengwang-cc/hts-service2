#!/usr/bin/env ts-node
/**
 * Patch BB — 2026-03-13:
 *
 * Fix 5 rules causing cross-chapter misclassification:
 *
 * 1. AI_CH13_SHELLAC_LAC: bare "bleached" in anyOf fires for "Sheeting Other Bleached"
 *    (ch.52 cotton fabric), "Weighing more than 170 g/m Unbleached or bleached" (ch.54
 *    synthetic filament fabric) → allowChapters:[13] blocks correct chapters.
 *    Fix: remove bare "bleached" — use "bleached shellac", "bleached lac" phrases.
 *    Also remove bare "lac" (fires for too many generic contexts).
 *
 * 2. AI_CH51_WOOL_FABRIC: "broadcloth" in anyOf fires for "Poplin or broadcloth Of
 *    numbers 43 to 68 Plain weave" (ch.52 cotton fabric) and "Poplin or broadcloth
 *    Other Of yarns of different colors" (ch.54 synthetic filament) → allowChapters:[51]
 *    blocks ch.52/54. Fix: add noneOf for non-wool fiber context.
 *
 * 3. AI_CH59_COATED_FABRIC_PVC_PU: anyOfGroups fire for "impregnated coated covered
 *    or laminated...Garments made up of fabrics of heading 5903 5906 or 5907" (ch.62)
 *    and same knitted/crocheted (ch.61). The coating terms describe the surface of the
 *    finished garment, not the fabric itself. allowChapters:[59,39] blocks ch.62/61.
 *    Fix: add noneOf for garment context.
 *
 * 4. AI_CH56_RUBBER_ELASTIC_THREAD: anyOfGroups fire for "rubber or plastics material"
 *    + "covered or laminated" in garment descriptions → allowChapters:[56] blocks ch.62.
 *    Fix: add noneOf for garment/plastics coating context.
 *
 * 5. AI_CH03_FISH_MEAL_FLOUR: "flour" fires for "leather dust powder and flour"
 *    (ch.41 leather waste) → allowChapters:[03]; LEATHER_HIDES_INTENT denies [03]
 *    → EMPTY result. Fix: add noneOf for leather/waste context (mirrors FLOUR_GRAIN_INTENT fix).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13bb.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH13_SHELLAC_LAC — remove bare "bleached" and "lac" ─────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH13_SHELLAC_LAC',
      description: 'Shellac, seedlac, lac → ch.13. ' +
        'Removed bare "bleached": fires for fabric weight/processing descriptions like ' +
        '"Weighing more than 170 g/m Unbleached or bleached" (ch.54) and "Sheeting Other ' +
        'Bleached" (ch.52), sending them to ch.13 instead of correct chapters. ' +
        'Removed bare "lac": too generic. Use "bleached shellac"/"seedlac" phrases.',
      pattern: {
        anyOf: [
          'shellac', 'seedlac',
          'bleached shellac', 'bleached lac',
          'button lac', 'garnet lac', 'stick lac',
        ],
      },
      whitelist: { allowChapters: ['13'] },
    },
  },

  // ── 2. Fix AI_CH51_WOOL_FABRIC — add noneOf for non-wool fiber context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH51_WOOL_FABRIC',
      description: 'Woven wool fabrics: tweed, flannel, worsted, broadcloth → ch.51. ' +
        'Added noneOf for cotton/synthetic fiber context: "broadcloth" fires for ' +
        '"Poplin or broadcloth Of numbers 43 to 68 Plain weave" (ch.52 cotton) and ' +
        '"Poplin or broadcloth Of yarns of different colors" (ch.54 synthetic filament). ' +
        'Broadcloth can be woven from cotton, synthetic, or wool — needs fiber context.',
      pattern: {
        anyOf: [
          'tweed', 'flannel', 'worsted', 'woolen', 'woolens',
          'broadcloth', 'melton', 'serge', 'gabardine',
        ],
        noneOf: [
          'coat', 'suit', 'garment', 'sweater', 'blanket', 'carpet',
          // Non-wool fiber context
          'cotton', 'polyester', 'nylon', 'synthetic', 'filament',
          'man-made', 'man made', 'artificial', 'acrylic',
          // Poplin context (often cotton/synthetic)
          'poplin', 'numbers', 'plain weave',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 3. Fix AI_CH59_COATED_FABRIC_PVC_PU — add noneOf for garment context ──────
  {
    priority: 630,
    rule: {
      id: 'AI_CH59_COATED_FABRIC_PVC_PU',
      description: 'Coated/laminated/impregnated fabrics → ch.59/39. ' +
        'Added noneOf for finished garment context: "impregnated coated covered or laminated" ' +
        'describes the surface of ch.62/61 garments made from ch.59 fabrics. HTS descriptions ' +
        'like "garments made up of fabrics of heading 5903 5906 or 5907" use coating vocabulary ' +
        'but classify as ch.62/61 (finished garments), not ch.59 (fabric).',
      pattern: {
        noneOf: [
          'tire', 'tyre', 'cord', 'conveyor', 'belt',
          'buttons', 'button', 'press-fastener', 'press-fasteners',
          'snap-fastener', 'snap-fasteners', 'button molds', 'button blanks',
          'fastener', 'fasteners',
          // Finished garment context → ch.62/61
          'garments', 'garment', 'wearing apparel',
          "men s or boys", "women s or girls", "girls", "boys",
          'knitted or crocheted', 'knitted', 'crocheted',
          'suits', 'trousers', 'jackets', 'dresses', 'skirts', 'blouses',
        ],
        anyOfGroups: [
          ['coated', 'laminated', 'impregnated', 'covered'],
          ['pvc', 'vinyl', 'polyurethane', 'polyester', 'nylon', 'fabric', 'textile', 'cloth'],
        ],
      },
      whitelist: { allowChapters: ['59', '39'] },
    },
  },

  // ── 4. Fix AI_CH56_RUBBER_ELASTIC_THREAD — add noneOf for garment context ──────
  {
    priority: 630,
    rule: {
      id: 'AI_CH56_RUBBER_ELASTIC_THREAD',
      description: 'Rubber/latex/elastic thread, covered yarn → ch.56. ' +
        'Added noneOf for garment/coating context: "rubber or plastics material which ' +
        'completely obscures the underlying fabric" (garment surface coating, ch.62) has ' +
        '"rubber" + "covered" → anyOfGroups both fire, blocking ch.62. ' +
        'Rubber/elastic thread is ch.56; garments with rubber coating are ch.62.',
      pattern: {
        anyOf: ['rubber', 'latex', 'elastic'],
        noneOf: [
          // Finished garment context → ch.62/61
          'garments', 'garment', 'wearing apparel',
          "men s or boys", "women s or girls",
          'plastics material', 'plastics',
          'outer surface', 'obscures', 'underlying fabric',
          'knitted or crocheted',
        ],
        anyOfGroups: [
          ['rubber', 'latex', 'elastic'],
          ['thread', 'cord', 'yarn', 'covered'],
        ],
      },
      whitelist: { allowChapters: ['56'] },
    },
  },

  // ── 5. Fix AI_CH03_FISH_MEAL_FLOUR — exclude leather/waste context ─────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH03_FISH_MEAL_FLOUR',
      description: 'Fish meal, fish flour, surimi, fish paste → ch.03. ' +
        'Added noneOf for leather/waste context: "leather dust powder and flour" (ch.41 ' +
        'leather waste byproduct) contains "flour". LEATHER_HIDES_INTENT denies ch.03, ' +
        'causing EMPTY result. Leather flour ≠ fish flour.',
      pattern: {
        anyOf: ['meal', 'flour', 'pellet', 'surimi', 'paste', 'minced'],
        noneOf: [
          // Leather/waste context → ch.41
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust',
          'composition leather', 'not suitable',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch BB)...`);

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
    console.log(`\nPatch BB complete: ${success} applied, ${failed} failed`);
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
