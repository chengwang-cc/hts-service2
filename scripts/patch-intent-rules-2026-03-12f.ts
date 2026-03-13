#!/usr/bin/env ts-node
/**
 * Patch F — 2026-03-12:
 *
 * 1. COSMETICS_FOUNDATION_DENY_TEXTILE — "foundation makeup" / "makeup foundation" →
 *    ch.59 (5901 hat/book foundations) gets top results due to "foundation" token.
 *    Fix: when "foundation" appears with cosmetic terms → deny ch.59, boost ch.33.
 *
 * 2. COSMETICS_BEAUTY_INTENT — broad cosmetics intent rule: makeup/beauty/skincare
 *    queries → boost ch.33 (cosmetics/beauty preparations).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12f.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // 1. COSMETICS_FOUNDATION_DENY_TEXTILE
  {
    priority: 5,
    rule: {
      id: 'COSMETICS_FOUNDATION_DENY_TEXTILE',
      description: 'Foundation/makeup queries → deny ch.59 (textile hat foundations), boost ch.33 (cosmetics)',
      pattern: {
        anyOfGroups: [
          // must have "foundation" or related cosmetic product name
          ['foundation', 'concealer', 'primer', 'bronzer', 'highlighter', 'blush', 'contour'],
          // must have cosmetic context word
          ['makeup', 'make-up', 'cosmetic', 'cosmetics', 'beauty', 'skincare', 'skin care',
           'bb cream', 'cc cream', 'tinted', 'complexion', 'coverage'],
        ],
        noneOf: ['hat', 'book', 'textile', 'fabric', 'building', 'construction', 'concrete', 'civil'],
      },
      inject: [
        { prefix: '3304', syntheticRank: 0 },
        { prefix: '3303', syntheticRank: 5 },
        { prefix: '3305', syntheticRank: 8 },
      ],
      whitelist: {
        denyChapters: ['59'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '33' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '59' },
      ],
    },
  },

  // 2. COSMETICS_BEAUTY_INTENT — general cosmetics/beauty boost
  {
    priority: 6,
    rule: {
      id: 'COSMETICS_BEAUTY_INTENT',
      description: 'Makeup/beauty/skincare/fragrance queries → boost ch.33 (cosmetic preparations)',
      pattern: {
        anyOf: [
          // makeup
          'makeup', 'make-up', 'lipstick', 'lip gloss', 'lip balm', 'chapstick',
          'mascara', 'eyeliner', 'eyeshadow', 'eye shadow', 'eyebrow', 'brow pencil',
          'blush', 'rouge', 'bronzer', 'highlighter', 'contour', 'concealer', 'primer',
          'setting powder', 'setting spray', 'bb cream', 'cc cream', 'tinted moisturizer',
          // skincare
          'moisturizer', 'moisturiser', 'serum', 'toner', 'face wash', 'cleanser',
          'face cream', 'eye cream', 'night cream', 'day cream', 'sunscreen', 'spf',
          'retinol', 'vitamin c serum', 'hyaluronic acid', 'niacinamide', 'exfoliant',
          // fragrance
          'perfume', 'fragrance', 'cologne', 'eau de toilette', 'eau de parfum', 'body spray',
          // hair
          'shampoo', 'conditioner', 'hair mask', 'hair serum', 'hair spray', 'dry shampoo',
          // nails
          'nail polish', 'nail lacquer', 'nail varnish', 'gel nail', 'nail gel',
          // body
          'body lotion', 'body cream', 'body butter', 'bath bomb', 'shower gel', 'body wash',
          'deodorant', 'antiperspirant',
        ],
        noneOf: ['machine', 'industrial', 'equipment', 'tool', 'part'],
      },
      boosts: [
        { delta: 0.50, chapterMatch: '33' },
        { delta: 0.20, chapterMatch: '34' },
      ],
      penalties: [
        { delta: 0.90, chapterMatch: '59' },
      ],
    },
  },
];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch F)...`);

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
    console.log(`\nPatch F complete: ${success} applied, ${failed} failed`);
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
