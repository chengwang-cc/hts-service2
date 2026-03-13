#!/usr/bin/env ts-node
/**
 * Second patch batch — 2026-03-12:
 *
 * 1. Extend GARMENT_DENY_COTTON_PULP to include bag/tote/pouch keywords
 *    (cotton bag/tote → ch.47 has same root cause as cotton jacket).
 *
 * 2. LEATHER_GOODS_DENY_PLANTS — "leather purse/bag/wallet" → ch.06 (plants).
 *    6403992030 (footwear) and 0604200065 (foliage) are false top-1 matches
 *    due to embedding proximity of "leather" to botanical "leather fern/leaf".
 *
 * 3. LAMP_LIGHTING_INTENT — lamp/lantern queries → ch.59 (5908 textile wicks).
 *    Word "lamp" in query pulls 5908000000 (wicks) to top.
 *
 * 4. WOOD_CRAFT_DENY_FOOTWEAR — wooden craft items → ch.64 (6403992030 wooden shoes).
 *    Embeddings place "wooden stand/box/board" close to wooden clogs.
 *
 * 5. HOME_TEXTILE_DENY_COTTON_PULP — extend ch.47 deny to bedding/linen queries.
 *    "cotton blanket", "cotton sheet", "cotton pillow" → 4706100000.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12b.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const BAG_TOKENS = [
  'bag', 'bags', 'purse', 'purses', 'tote', 'totes',
  'pouch', 'pouches', 'satchel', 'satchels',
  'clutch', 'clutches', 'binder', 'binders',
  'wallet', 'wallets', 'handbag', 'handbags',
  'backpack', 'backpacks',
];

const HOME_TEXTILE_TOKENS = [
  'blanket', 'blankets', 'sheet', 'sheets', 'duvet', 'comforter',
  'pillow', 'pillowcase', 'pillows', 'quilt', 'quilts',
  'towel', 'towels', 'napkin', 'napkins', 'tablecloth',
  'curtain', 'curtains', 'drape', 'drapes',
  'bedding', 'linen', 'linens',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // ── 1. Extend GARMENT_DENY_COTTON_PULP with bag/tote/pouch/home-textile tokens ──
  {
    priority: 3,
    rule: {
      id: 'GARMENT_DENY_COTTON_PULP',
      description: 'Any garment/bag/home-textile query → deny ch.47 (cotton linters/pulp) and ch.56 (wadding)',
      pattern: {
        anyOf: [
          // clothing
          'jacket', 'jackets', 'coat', 'coats', 'outerwear',
          'dress', 'dresses', 'skirt', 'skirts',
          'pants', 'jeans', 'trousers', 'shorts', 'overalls', 'leggings',
          'shirt', 'shirts', 'tshirt', 'tshirts', 'tee', 'blouse', 'tunic',
          'sweater', 'sweaters', 'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts',
          'pullover', 'pullovers', 'cardigan', 'cardigans',
          'vest', 'vests', 'cloak', 'cloaks', 'cape', 'capes',
          'apparel', 'garment', 'garments', 'clothing', 'clothes',
          'swimsuit', 'swimwear', 'bikini', 'swimtrunks',
          // bags
          ...BAG_TOKENS,
          // home textiles
          ...HOME_TEXTILE_TOKENS,
        ],
        noneOf: ['fiber', 'fibers', 'filament', 'yarn', 'thread', 'spun', 'linters'],
      },
      whitelist: {
        denyChapters: ['47'],
      },
      penalties: [
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.70, chapterMatch: '56' },
      ],
    },
  },

  // ── 2. LEATHER_GOODS_DENY_PLANTS ─────────────────────────────────────────
  {
    priority: 4,
    rule: {
      id: 'LEATHER_GOODS_DENY_PLANTS',
      description: 'Leather/PU/vegan bag/purse/wallet queries → deny ch.06 (plants) which attracts "leather fern" results',
      pattern: {
        anyOfGroups: [
          // must mention a leather type or bag type
          ['leather', 'pu', 'vegan leather', 'faux leather', 'pvc', 'pleather'],
          BAG_TOKENS,
        ],
        noneOf: ['fern', 'plant', 'flower', 'botanical', 'garden', 'herb'],
      },
      whitelist: {
        denyChapters: ['06'],
      },
      penalties: [
        { delta: 0.95, chapterMatch: '06' },
        { delta: 0.70, chapterMatch: '47' },
      ],
    },
  },

  // ── 3. LAMP_DENY_WICKS ───────────────────────────────────────────────────
  {
    priority: 50,
    rule: {
      id: 'LAMP_DENY_WICKS',
      description: 'Lamp/lantern/lighting queries → deny ch.59 (5908 textile wicks) which surfaces due to "lamp" token',
      pattern: {
        anyOf: ['lamp', 'lamps', 'lampshade', 'lantern', 'lanterns', 'chandelier', 'sconce', 'sconces', 'luminaire'],
        noneOf: ['oil lamp wick', 'wick', 'wicks', 'candle'],
      },
      whitelist: {
        denyChapters: ['59'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '94' },
        { delta: 0.35, chapterMatch: '85' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '59' },
      ],
    },
  },

  // ── 4. WOOD_CRAFT_DENY_FOOTWEAR ──────────────────────────────────────────
  {
    priority: 51,
    rule: {
      id: 'WOOD_CRAFT_DENY_FOOTWEAR',
      description: 'Wooden craft/furniture/decor items → deny ch.64 (6403 footwear) which attracts wooden shoe codes',
      pattern: {
        anyOf: ['wooden', 'wood', 'walnut', 'bamboo', 'pine', 'oak', 'maple', 'birch', 'cedar', 'mahogany', 'teak'],
        noneOf: ['shoe', 'shoes', 'clog', 'clogs', 'sandal', 'sandals', 'footwear', 'boot', 'boots', 'sole', 'heel'],
      },
      whitelist: {
        denyChapters: ['64'],
      },
      boosts: [
        { delta: 0.45, chapterMatch: '44' },
        { delta: 0.35, chapterMatch: '94' },
      ],
      penalties: [
        { delta: 0.90, chapterMatch: '64' },
      ],
    },
  },

  // ── 5. HOME_TEXTILE_INTENT — boost ch.63 for bedding/linen queries ───────
  {
    priority: 52,
    rule: {
      id: 'HOME_TEXTILE_INTENT',
      description: 'Bedding/towels/home textiles → ch.63 (household textile articles)',
      pattern: {
        anyOf: HOME_TEXTILE_TOKENS,
        noneOf: ['paper', 'disposable'],
      },
      boosts: [
        { delta: 0.50, chapterMatch: '63' },
        { delta: 0.35, chapterMatch: '62' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.65, chapterMatch: '56' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch B)...`);

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
    console.log(`\nPatch B complete: ${success} applied, ${failed} failed`);
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
