#!/usr/bin/env ts-node
/**
 * Patch intent rules to fix accuracy regressions identified 2026-03-12:
 *
 * Key finding: "cotton jacket", "cotton dress", "cotton pants" etc. land on
 * 4706100000 (cotton linters / chemical pulp, ch.47) because the lexical
 * "cotton" signal overwhelms the ch.61/62 boosts in OUTERWEAR/DRESS/PANTS rules.
 *
 * Fixes:
 *  1. Add GARMENT_DENY_COTTON_PULP — hard deny ch.47 for any garment query.
 *  2. Update OUTERWEAR_INTENT     — add ch.47 + ch.56 penalties.
 *  3. Update DRESS_SKIRT_INTENT   — add ch.47 + ch.56 penalties.
 *  4. Update PANTS_JEANS_INTENT   — add ch.47 + ch.56 penalties.
 *  5. Update KNITWEAR_INTENT      — add ch.47 + ch.56 penalties.
 *  6. Update COTTON_APPAREL       — extend anyOf with more garment keywords.
 *  7. Update APPAREL_INTENT       — extend anyOf + add ch.47 penalty.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

// All garment-related tokens that should never map to ch.47 (cotton pulp)
const GARMENT_TOKENS = [
  'jacket', 'jackets', 'coat', 'coats', 'outerwear',
  'dress', 'dresses', 'skirt', 'skirts',
  'pants', 'jeans', 'trousers', 'shorts', 'overalls', 'leggings',
  'shirt', 'shirts', 'tshirt', 'tshirts', 'tee', 'blouse', 'tunic',
  'sweater', 'sweaters', 'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts',
  'pullover', 'pullovers', 'cardigan', 'cardigans',
  'vest', 'vests', 'cloak', 'cloaks', 'cape', 'capes',
  'apparel', 'garment', 'garments', 'clothing', 'clothes',
  'swimsuit', 'swimwear', 'bikini', 'swimtrunks',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // ── New rule: hard-deny ch.47 (cotton pulp) for all garment queries ───────
  {
    priority: 3, // run early
    rule: {
      id: 'GARMENT_DENY_COTTON_PULP',
      description: 'Any garment query → deny ch.47 (cotton linters/pulp) and ch.56 (wadding) results',
      pattern: {
        anyOf: GARMENT_TOKENS,
        // Don't fire for fiber/textile manufacturing queries
        noneOf: ['fiber', 'fibers', 'filament', 'yarn', 'thread', 'spun', 'woven fabric', 'linters'],
      },
      whitelist: {
        denyChapters: ['47'],
      },
      penalties: [
        { delta: 0.95, chapterMatch: '47' },
        // ch.56 (wadding/felt/nonwovens) also tends to surface incorrectly
        { delta: 0.70, chapterMatch: '56' },
      ],
    },
  },

  // ── Update OUTERWEAR_INTENT — add ch.47/56/51/52 penalties ───────────────
  {
    priority: 39,
    rule: {
      id: 'OUTERWEAR_INTENT',
      description: 'Jacket/coat → ch.62 woven or ch.61 knitted outerwear',
      pattern: {
        anyOf: ['jacket', 'jackets', 'coat', 'coats', 'outerwear'],
        noneOf: ['life', 'safety', 'lab', 'laboratory', 'paint', 'spray'],
      },
      inject: [
        { prefix: '6201.', syntheticRank: 22 },
        { prefix: '6202.', syntheticRank: 25 },
        { prefix: '6101.', syntheticRank: 30 },
        { prefix: '6102.', syntheticRank: 33 },
      ],
      boosts: [
        { delta: 0.65, chapterMatch: '62' },
        { delta: 0.60, chapterMatch: '61' },
      ],
      penalties: [
        { delta: 0.80, chapterMatch: '84' },
        { delta: 0.70, chapterMatch: '85' },
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.75, chapterMatch: '56' },
        { delta: 0.65, chapterMatch: '51' },
        { delta: 0.65, chapterMatch: '52' },
      ],
    },
  },

  // ── Update DRESS_SKIRT_INTENT — add ch.47/56 penalties ───────────────────
  {
    priority: 40,
    rule: {
      id: 'DRESS_SKIRT_INTENT',
      description: 'Dress/skirt → 6204/6104 women\'s apparel',
      pattern: {
        anyOf: ['dress', 'dresses', 'skirt', 'skirts'],
        noneOf: ['code', 'uniform', 'military'],
      },
      inject: [
        { prefix: '6204.4', syntheticRank: 22 },
        { prefix: '6204.5', syntheticRank: 25 },
        { prefix: '6104.4', syntheticRank: 28 },
        { prefix: '6104.5', syntheticRank: 31 },
      ],
      boosts: [
        { delta: 0.65, chapterMatch: '62' },
        { delta: 0.60, chapterMatch: '61' },
      ],
      penalties: [
        { delta: 0.70, chapterMatch: '84' },
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.75, chapterMatch: '56' },
      ],
    },
  },

  // ── Update PANTS_JEANS_INTENT — add ch.47/56 penalties ───────────────────
  {
    priority: 41,
    rule: {
      id: 'PANTS_JEANS_INTENT',
      description: 'Pants/jeans/trousers → 6203.42/6204.62 woven bottoms',
      pattern: {
        anyOf: ['pants', 'jeans', 'trousers', 'shorts', 'overalls'],
      },
      inject: [
        { prefix: '6203.42', syntheticRank: 22 },
        { prefix: '6204.62', syntheticRank: 25 },
        { prefix: '6103.42', syntheticRank: 30 },
        { prefix: '6104.62', syntheticRank: 33 },
      ],
      boosts: [
        { delta: 0.65, chapterMatch: '62' },
        { delta: 0.60, chapterMatch: '61' },
      ],
      penalties: [
        { delta: 0.70, chapterMatch: '84' },
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.75, chapterMatch: '56' },
      ],
    },
  },

  // ── Update KNITWEAR_INTENT — add ch.47/56 penalties ─────────────────────
  {
    priority: 42,
    rule: {
      id: 'KNITWEAR_INTENT',
      description: 'Hoodie/sweater/sweatshirt → 6110 knitted jerseys/pullovers; boost ch.61',
      pattern: {
        anyOf: ['hoodie', 'hoodies', 'sweater', 'sweaters', 'sweatshirt', 'sweatshirts', 'pullover', 'pullovers', 'cardigan', 'cardigans'],
      },
      inject: [
        { prefix: '6110.20', syntheticRank: 22 },
        { prefix: '6110.30', syntheticRank: 25 },
        { prefix: '6110.11', syntheticRank: 30 },
      ],
      boosts: [
        { delta: 0.70, prefixMatch: '6110.' },
        { delta: 0.45, chapterMatch: '61' },
      ],
      penalties: [
        { delta: 0.60, chapterMatch: '62' },
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.75, chapterMatch: '56' },
      ],
    },
  },

  // ── Update APPAREL_INTENT — add more tokens + ch.47 penalty ─────────────
  {
    priority: 5,
    rule: {
      id: 'APPAREL_INTENT',
      description: 'Apparel/clothing → chapters 61 (knit) and 62 (woven)',
      pattern: {
        anyOf: [
          'tshirt', 'tshirts', 'shirt', 'shirts', 'tee', 'apparel', 'garment', 'garments', 'clothing', 'clothes',
          'blouse', 'blouses', 'tunic', 'tunics', 'vest', 'vests',
        ],
      },
      boosts: [
        { delta: 0.35, chapterMatch: '61' },
        { delta: 0.35, chapterMatch: '62' },
        { delta: 0.30, entryMustHaveAnyToken: ['tshirt', 'tshirts', 'shirt', 'shirts', 'tee', 'apparel', 'garment', 'pullover', 'jersey', 'undershirt', 'singlet'] },
      ],
      penalties: [
        { delta: 0.45, chapterMatch: '52', entryMustHaveAnyToken: ['yarn', 'spun', 'thread', 'fiber', 'fibers', 'filament'] },
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.70, chapterMatch: '56' },
      ],
    },
  },

  // ── Update COTTON_APPAREL — extend to all garment keywords ───────────────
  {
    priority: 6,
    rule: {
      id: 'COTTON_APPAREL',
      description: '"Cotton" modifier on apparel → extra boost for ch.61/62, deny ch.47 (pulp)',
      pattern: {
        required: ['cotton'],
        anyOf: [
          'tshirt', 'tshirts', 'shirt', 'shirts', 'tee', 'apparel', 'garment', 'garments', 'clothing', 'clothes',
          'jacket', 'jackets', 'coat', 'coats', 'dress', 'dresses', 'skirt', 'skirts',
          'pants', 'jeans', 'trousers', 'shorts', 'overalls', 'leggings',
          'blouse', 'blouses', 'tunic', 'tunics', 'vest', 'vests',
          'sweater', 'sweaters', 'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts',
          'cloak', 'cape',
        ],
      },
      whitelist: {
        denyChapters: ['47'],
      },
      boosts: [
        { delta: 0.12, chapterMatch: '61' },
        { delta: 0.12, chapterMatch: '62' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.75, chapterMatch: '56' },
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

    console.log(`Applying ${PATCHES.length} rule patches...`);

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
    console.log(`\nPatch complete: ${success} applied, ${failed} failed`);
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
