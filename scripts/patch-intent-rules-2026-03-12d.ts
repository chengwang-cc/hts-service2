#!/usr/bin/env ts-node
/**
 * Patch D — 2026-03-12:
 *
 * Fix AI-generated rules with overly broad patterns that cause empty results
 * when combined with deny rules:
 *
 * 1. AI_CH47_COTTON_LINTERS_PULP — fires for ANY "cotton" query.
 *    Fix: require 'linters' or specific cotton-fiber vocab; add noneOf for apparel.
 *
 * 2. AI_CH59_CANDLE_WICK_GAS_MANTLE — fires for "lamp" and "lantern".
 *    Fix: remove 'lamp', 'lantern', 'candle' from anyOf (they are final products,
 *    not wicks). Keep only 'wick', 'wicks', 'mantle', 'mantles', 'incandescent'.
 *
 * 3. AI_CH64_WOOD_CLOGS — fires for "wooden" (all wooden items).
 *    Fix: remove 'wooden' from anyOf; keep only 'clog', 'clogs', 'woodbase'.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12d.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // Fix AI_CH47_COTTON_LINTERS_PULP — too broad, fires for all cotton
  {
    priority: 300,
    rule: {
      id: 'AI_CH47_COTTON_LINTERS_PULP',
      description: 'Cotton linters / chemical pulp → ch.47 (4706); only for fiber/pulp processing queries',
      pattern: {
        // Require specific pulp/fiber vocab, not just "cotton"
        anyOf: ['linters', 'linter', 'chemical pulp', 'cotton pulp', 'fibrous', 'cellulosic'],
        noneOf: [
          // apparel
          'jacket', 'jackets', 'coat', 'coats', 'dress', 'dresses', 'pants', 'jeans',
          'shirt', 'shirts', 'tshirt', 'tee', 'skirt', 'sweater', 'hoodie', 'blouse',
          'clothing', 'apparel', 'garment',
          // bags
          'bag', 'bags', 'purse', 'tote', 'wallet', 'handbag',
          // home textiles
          'blanket', 'towel', 'sheet', 'pillow', 'quilt', 'bedding',
        ],
      },
      whitelist: {
        allowChapters: ['47'],
      },
    },
  },

  // Fix AI_CH59_CANDLE_WICK_GAS_MANTLE — remove lamp/lantern/candle from anyOf
  {
    priority: 301,
    rule: {
      id: 'AI_CH59_CANDLE_WICK_GAS_MANTLE',
      description: 'Textile wicks and gas mantles → ch.59 (5908); only for wick/mantle queries',
      pattern: {
        // Only specific wick/mantle terms, NOT lamp/lantern/candle (those are final products in ch.94)
        anyOf: ['wick', 'wicks', 'mantle', 'mantles', 'incandescent mantle', 'gas mantle'],
        noneOf: ['lamp', 'lantern', 'candle', 'light', 'lighting'],
      },
      whitelist: {
        allowChapters: ['59'],
      },
    },
  },

  // Fix AI_CH64_WOOD_CLOGS — remove "wooden" from anyOf
  {
    priority: 302,
    rule: {
      id: 'AI_CH64_WOOD_CLOGS',
      description: 'Wooden clogs/sabot → ch.64 (6401/6403); only for explicit clog queries',
      pattern: {
        // Remove "wooden" — it matches wooden craft items and causes empty results
        // Keep only specific clog/woodbase terms
        anyOf: ['clog', 'clogs', 'woodbase', 'sabot', 'sabots', 'wooden clog', 'wooden shoe', 'wooden shoes'],
      },
      whitelist: {
        allowChapters: ['64'],
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

    console.log(`Applying ${PATCHES.length} rule patches (batch D)...`);

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
    console.log(`\nPatch D complete: ${success} applied, ${failed} failed`);
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
