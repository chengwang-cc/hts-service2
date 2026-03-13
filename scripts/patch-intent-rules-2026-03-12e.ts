#!/usr/bin/env ts-node
/**
 * Patch E — 2026-03-12:
 *
 * 1. Update GARMENT_DENY_COTTON_PULP: extend anyOf with fabric/textile/thread
 *    tokens and remove them from noneOf (they also shouldn't land in ch.47).
 *
 * 2. Add COTTON_TEXTILE_BOOST: when "cotton" + fabric/thread → boost ch.52/55,
 *    penalize ch.47 strongly.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12e.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [
  // 1. Extend GARMENT_DENY_COTTON_PULP to include fabric/textile/thread tokens
  {
    priority: 3,
    rule: {
      id: 'GARMENT_DENY_COTTON_PULP',
      description: 'Any garment/bag/textile/fabric query → deny ch.47 (cotton linters/pulp) and ch.56 (wadding)',
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
          'bag', 'bags', 'purse', 'purses', 'tote', 'totes',
          'pouch', 'pouches', 'satchel', 'satchels',
          'clutch', 'clutches', 'binder', 'binders',
          'wallet', 'wallets', 'handbag', 'handbags',
          'backpack', 'backpacks',
          // home textiles
          'blanket', 'blankets', 'sheet', 'sheets', 'duvet', 'comforter',
          'pillow', 'pillowcase', 'pillows', 'quilt', 'quilts',
          'towel', 'towels', 'napkin', 'napkins', 'tablecloth',
          'curtain', 'curtains', 'drape', 'drapes',
          'bedding', 'linen', 'linens',
          // fabric/textile (ch.52 items)
          'fabric', 'fabrics', 'textile', 'textiles', 'cloth', 'cloths',
          'thread', 'threads', 'yarn', 'yarns', 'sewing thread',
          'weave', 'woven fabric', 'knit fabric',
        ],
        // Don't fire for chemical/industrial processing queries
        noneOf: ['linters', 'chemical pulp', 'pulp', 'cellulosic'],
      },
      whitelist: {
        denyChapters: ['47'],
      },
      penalties: [
        { delta: 0.95, chapterMatch: '47' },
        { delta: 0.60, chapterMatch: '56' },
      ],
    },
  },

  // 2. COTTON_TEXTILE_BOOST — boost ch.52 for cotton fabric/thread queries
  {
    priority: 7,
    rule: {
      id: 'COTTON_TEXTILE_BOOST',
      description: 'Cotton fabric/thread/yarn → boost ch.52 (woven cotton fabric) and ch.55/54',
      pattern: {
        required: ['cotton'],
        anyOf: ['fabric', 'fabrics', 'textile', 'textiles', 'cloth', 'thread', 'threads', 'yarn', 'yarns', 'weave'],
      },
      boosts: [
        { delta: 0.45, chapterMatch: '52' },
        { delta: 0.30, chapterMatch: '55' },
        { delta: 0.25, chapterMatch: '54' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '47' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch E)...`);

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
    console.log(`\nPatch E complete: ${success} applied, ${failed} failed`);
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
