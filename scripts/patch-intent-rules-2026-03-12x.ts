#!/usr/bin/env ts-node
/**
 * Patch X — 2026-03-12:
 *
 * Fix 3 more overly-broad rules causing EMPTY or wrong results:
 *
 * 1. AI_CH36_METALDEHYDE: "pellets" in anyOf fires for "whether or not in the form of
 *    pellets of a kind used in animal feeding" (ch.23 = vegetable waste animal feed) →
 *    allowChapters:[36] blocks ch.23. Pelletized slug bait ≠ pelletized animal feed.
 *    Fix: remove "pellets" from anyOf; add noneOf for animal feed/vegetable waste context.
 *
 * 2. AI_CH69_CERAMIC_SANITARY: "toilet" fires for "toilet sprayers" in ch.96 scent
 *    sprayer/atomizer HTS descriptions → allowChapters:[69] blocks ch.96.
 *    "Toilet sprayers" = perfume atomizers/cologne pumps, NOT ceramic bathroom fixtures.
 *    Fix: add noneOf=['sprayer','sprayers','atomizer','scent','perfume','cologne'].
 *
 * 3. AI_CH40_PNEUMATIC_TIRES + AI_CH40_RUBBER_TIRES + AI_CH40_RUBBER_TIRES_PASSENGER:
 *    "tires/tyres" fires for "Wheels with tires for off-the-highway use Other Parts" →
 *    allowChapters:[40] blocks ch.87. This is a wheel+tire assembly classified as vehicle
 *    parts (ch.87), not standalone rubber tires (ch.40). Fix: add noneOf=['parts','part']
 *    so the ch.40 restriction doesn't fire when the query explicitly says "Parts".
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12x.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH36_METALDEHYDE — remove "pellets" ────────────────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH36_METALDEHYDE',
      description: 'Metaldehyde, slug/snail bait, firelighters, hexamine → ch.36. ' +
        'Removed "pellets" (fires for animal feed pellets context in ch.23). ' +
        'Added noneOf for animal feed/vegetable waste context. ' +
        '"solid" was removed in patch W. Now uses "slug pellets" as safe phrase.',
      pattern: {
        anyOf: [
          'metaldehyde',
          'slug',
          'snail',
          // "pellets" removed — fires for "pellets of a kind used in animal feeding"
          'slug pellets',       // phrase — safe
          'slug bait',
          'snail bait',
          'bait',
          'tablet',
          'tablets',
          'hexamine',
          'firelighter',
          'firelighters',
          'solid fuel',
        ],
        noneOf: [
          'fishing', 'fish',
          'bamboo', 'wood', 'timber',
          // Animal feed/vegetable waste context → ch.23
          'vegetable', 'animal', 'feeding', 'feed', 'waste', 'residues',
          'byproducts', 'by-products', 'fodder', 'forage',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 2. Fix AI_CH69_CERAMIC_SANITARY — exclude toilet sprayer context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH69_CERAMIC_SANITARY',
      description: 'Ceramic sanitary fixtures: toilets, sinks, bathtubs → ch.69. ' +
        'Added noneOf for sprayer/atomizer context: "toilet" fires for "toilet sprayers" ' +
        'in ch.96 scent/perfume sprayer HTS descriptions. ' +
        '"Toilet sprayers" = perfume atomizers (ch.96), not ceramic bathroom fixtures.',
      pattern: {
        anyOf: [
          'toilet', 'toilets', 'sink', 'sinks', 'washbasin', 'washbasins',
          'bathtub', 'bathtubs', 'bidet', 'bidets', 'urinal', 'urinals',
          'lavatory', 'lavatories', 'commode', 'commodes',
        ],
        noneOf: [
          'paper', 'seat', 'cover', 'plunger', 'brush', 'cleaner', 'mat', 'rug',
          // Sprayer/atomizer context → ch.96
          'sprayer', 'sprayers', 'atomizer', 'atomizers',
          'scent', 'perfume', 'cologne', 'fragrance',
        ],
      },
      whitelist: { allowChapters: ['69'] },
    },
  },

  // ── 3a. Fix AI_CH40_PNEUMATIC_TIRES — exclude "Parts" context ────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH40_PNEUMATIC_TIRES',
      description: 'Pneumatic tires → ch.40. ' +
        'Added noneOf=[\'parts\',\'part\'] to prevent blocking ch.87 when "Parts" context ' +
        'is present: "Wheels with tires for off-the-highway use Other Parts" is classified ' +
        'as vehicle parts (ch.87), not standalone rubber tires (ch.40).',
      pattern: {
        anyOf: ['tire', 'tyre', 'tires', 'tyres'],
        noneOf: [
          'retreaded', 'used', 'aircraft', 'tread', 'inner', 'tube',
          // Vehicle parts context → ch.87
          'parts', 'part',
        ],
      },
      whitelist: { allowChapters: ['40'] },
    },
  },

  // ── 3b. Fix AI_CH40_RUBBER_TIRES — same ──────────────────────────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH40_RUBBER_TIRES',
      description: 'Rubber tires → ch.40. ' +
        'Added noneOf=[\'parts\',\'part\'] to prevent blocking ch.87 vehicle parts context.',
      pattern: {
        anyOf: ['tire', 'tires', 'tyre', 'tyres'],
        noneOf: [
          'retreaded', 'used', 'solid', 'inner', 'tube', 'flap', 'tread',
          'parts', 'part',
        ],
      },
      whitelist: { allowChapters: ['40'] },
    },
  },

  // ── 3c. Fix AI_CH40_RUBBER_TIRES_PASSENGER — same ────────────────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH40_RUBBER_TIRES_PASSENGER',
      description: 'Passenger rubber tires → ch.40. ' +
        'Added noneOf=[\'parts\',\'part\'] to prevent blocking ch.87 vehicle parts context.',
      pattern: {
        anyOf: ['tire', 'tires', 'tyre', 'tyres'],
        noneOf: [
          'bicycle', 'bike', 'motorcycle', 'truck', 'bus', 'tractor',
          'atv', 'golf', 'lawn', 'retreaded', 'used', 'inner', 'tube',
          'parts', 'part',
        ],
      },
      whitelist: { allowChapters: ['40'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch X)...`);

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
    console.log(`\nPatch X complete: ${success} applied, ${failed} failed`);
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
