#!/usr/bin/env ts-node
/**
 * Patch VV — 2026-03-13:
 *
 * Fix 2 remaining semantic EMPTY results:
 *
 * 1. ch.84 Agricultural sprayer: "Agricultural or horticultural Mechanical
 *    appliances...for projecting dispersing or spraying...fire extinguishers
 *    ...steam or sand blasting machines" (8424.82 ch.84).
 *
 *    AI_CH36_FUSES_DETONATORS fires for "blasting" (from "sand blasting machines")
 *    → allowChapters:[36]. The existing noneOf has "appliance" (singular) but the
 *    query has "appliances" (plural) — token matching is exact, so plural doesn't
 *    match. Fix: add 'appliances','extinguishers','sand','fire extinguishers'.
 *
 *    AI_CH36_EXPLOSIVES fires for "blasting" → allowChapters:[36].
 *    Sand/abrasive blasting (ch.84 machinery) is industrial surface cleaning, not
 *    explosive blasting (ch.36). Fix: add noneOf='appliances','sand','extinguishers'.
 *
 * 2. ch.32 Stamping foils: "Stamping foils Pigments...in liquid or paste form
 *    ...paints including enamels...dyes and other coloring matter" (3212.10 ch.32).
 *
 *    AI_CH03_FISH_MEAL_FLOUR fires for "paste" (from "paste form") → allowChapters:[03].
 *    "Paste form" in paint/pigment/ink descriptions = physical form, not fish paste.
 *    Key discriminators: "paints","pigments","enamels","dyes","coloring matter".
 *    Fix: add noneOf=['paint','paints','pigment','pigments','coloring','dyes',
 *    'inks','ink','enamels','enamel','stamping'].
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13vv.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH36_FUSES_DETONATORS — exclude sand blasting/appliance context ───
  {
    priority: 640,
    rule: {
      id: 'AI_CH36_FUSES_DETONATORS',
      description: 'Fuses, detonators, blasting caps, ignition devices → ch.36. ' +
        'Added noneOf for sand blasting/appliance context: "steam or sand blasting ' +
        'machines" (8424.82 ch.84) has "blasting" → fires allowChapters:[36]. ' +
        'Sand/abrasive blasting machines are industrial cleaning machinery (ch.84), ' +
        'not explosive blasting caps. Existing noneOf had "appliance" singular but ' +
        '"appliances" plural was not caught.',
      pattern: {
        anyOf: [
          'electric fuse', 'electric detonator', 'electric blasting cap',
          'electric primer', 'electric initiator', 'electric squib',
          'fuse', 'fuses', 'detonating cord', 'percussion cap', 'percussion caps',
          'igniter', 'igniters', 'detonator', 'detonators',
          'blasting cap', 'blasting', 'pyrotechnic fuse',
        ],
        noneOf: [
          'motor', 'kettle', 'guitar', 'scooter', 'keyboard', 'razor',
          'toothbrush', 'shaver', 'fan', 'heater', 'cooler', 'blanket',
          'bike', 'wheelchair', 'skateboard', 'hoverboard', 'desk',
          'car', 'vehicle', 'appliance', 'wire', 'cable', 'charger',
          // Sand/abrasive blasting machinery → ch.84
          'appliances', 'sand', 'sand blasting', 'abrasive', 'abrasive blasting',
          'extinguisher', 'extinguishers', 'fire extinguisher', 'fire extinguishers',
          'spraying', 'spray', 'spray gun', 'spray guns',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 2. Fix AI_CH36_EXPLOSIVES — exclude sand blasting/machinery context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH36_EXPLOSIVES',
      description: 'Explosives, dynamite, blasting agents → ch.36. ' +
        'Added noneOf for sand blasting/agricultural machinery context: "steam or ' +
        'sand blasting machines and similar jet projecting machines" (8424.82 ch.84) ' +
        'has "blasting" → fires allowChapters:[36]. Sand/abrasive blasting = ' +
        'industrial cleaning machinery (ch.84), not explosive charges (ch.36). ' +
        '"Fire extinguishers whether or not charged" also has no relation to explosives.',
      pattern: {
        anyOf: [
          'explosives', 'explosive', 'dynamite', 'blasting', 'anfo',
          'detonating', 'detonator', 'detonators', 'propellant', 'gunpowder', 'powder',
        ],
        noneOf: [
          'firearms', 'firearm', 'pistol', 'revolver', 'revolvers',
          'rifle', 'rifles', 'shotgun', 'shotguns', 'military weapons',
          'military weapon', 'carbine', 'muzzle-loading', 'ammunition',
          'blank ammunition', 'captive-bolt', 'captive',
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust',
          'composition leather',
          // Sand/abrasive blasting and agricultural spraying machinery → ch.84
          'appliances', 'sand', 'sand blasting', 'abrasive', 'agricultural',
          'horticultural', 'spraying', 'spray', 'spray gun', 'spray guns',
          'extinguisher', 'extinguishers', 'fire extinguisher', 'fire extinguishers',
          'projecting', 'dispersing', 'liquids',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 3. Fix AI_CH03_FISH_MEAL_FLOUR — exclude paint/pigment paste context ─────────
  {
    priority: 650,
    rule: {
      id: 'AI_CH03_FISH_MEAL_FLOUR',
      description: 'Fish meal, fish flour, fish paste → ch.03. ' +
        'Added noneOf for paint/pigment context: "Stamping foils Pigments...in liquid ' +
        'or paste form...paints including enamels...dyes and other coloring matter" ' +
        '(3212.10 ch.32) has "paste" → fires allowChapters:[03]. "Paste form" in ' +
        'paint/pigment/ink descriptions = physical form of colorant, not fish paste.',
      pattern: {
        anyOf: [
          'meal', 'flour', 'pellet', 'surimi', 'paste', 'minced',
        ],
        noneOf: [
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust',
          'composition leather', 'not suitable',
          'corn', 'maize', 'gluten', 'soybean', 'soya', 'oilseed',
          'brewer', 'distiller', 'stillage', 'starch residue',
          'plant', 'vegetable', 'bran', 'acorn', 'acorns',
          'wheat flour', 'rye flour', 'corn flour', 'rice flour',
          // Paint/pigment/ink context → ch.32
          'paint', 'paints', 'pigment', 'pigments', 'coloring', 'dyes',
          'inks', 'ink', 'enamels', 'enamel', 'stamping', 'varnish', 'varnishes',
          'lacquer', 'lacquers', 'colorant', 'colorants',
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

    console.log(`Applying ${PATCHES.length} rule patches (batch VV)...`);

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
    console.log(`\nPatch VV complete: ${success} applied, ${failed} failed`);
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
