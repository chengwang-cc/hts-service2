#!/usr/bin/env ts-node
/**
 * Patch V — 2026-03-12:
 *
 * Fix 8 overly-broad rules causing cross-chapter misclassification:
 *
 * 1. AI_CH56_FISHING_NET_HAMMOCK: bare "net" fires for "net engine power" in tractor
 *    queries → allowChapters:[56] blocks ch.87. Fix: remove bare "net"; use phrases.
 *
 * 2. SKI_SNOWBOARD_INTENT: allowChapters:[95] blocks ski/snowboard garments (ch.62).
 *    Ski pants/jackets are ch.62; ski equipment (boards, poles) is ch.95.
 *    Fix: add noneOf for garment context to redirect to ch.62 for clothing.
 *
 * 3. AI_CH22_ETHYL_ALCOHOL & AI_CH22_ETHYL_ALCOHOL_HIGH: "ethyl" fires for organic
 *    chemistry names like "diethylamino ethyl chloride" → allowChapters:[22] blocks ch.29.
 *    Fix: replace bare "ethyl" with "ethyl alcohol" phrase; add noneOf for chemistry context.
 *    Also fix "isopropyl" (fires for isopropyl groups in organic chemistry).
 *
 * 4. AI_CH31_PHOSPHATIC_FERTILIZER: "phosphorus" fires for "Containing a phosphorus atom"
 *    in organo-inorganic compound HTS descriptions → allowChapters:[31] blocks ch.29.
 *    Fix: add noneOf for organic chemistry context.
 *
 * 5. AI_CH58_RIBBON_TRIM: "ribbons" fires for "thermal transfer printing ribbons" →
 *    allowChapters:[58,56] blocks ch.96 (typewriter/printer ribbons).
 *    Fix: add noneOf for thermal/transfer/printing ribbon context.
 *
 * 6. AI_CH13_NATURAL_GUMS_RESINS: "resin" fires for "acrylic resin of polyester resin"
 *    (synthetic plastic resins for buttons) → allowChapters:[13] blocks ch.96.
 *    Fix: add noneOf for synthetic resin context.
 *
 * 7. AI_CH11_OAT_PRODUCTS: bare "rolled" fires for "Hot-rolled" steel sections →
 *    allowChapters:[11] blocks ch.72. Fix: replace "rolled" with "rolled oats" phrase;
 *    add noneOf for steel/metal context.
 *
 * 8. AI_CH14_PLAITING_MATERIALS: "bamboo" fires for bamboo in builders joinery/carpentry
 *    HTS descriptions (ch.44) → allowChapters:[14] blocks ch.44.
 *    Fix: add noneOf for construction/joinery context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12v.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH56_FISHING_NET_HAMMOCK — remove bare "net", use phrases ──────
  {
    priority: 630,
    rule: {
      id: 'AI_CH56_FISHING_NET_HAMMOCK',
      description: 'Fishing nets, cargo nets, hammocks → ch.56. ' +
        'Removed bare "net" (fires for "net engine power" in machinery queries). ' +
        'Removed bare "fishing" and "cargo" (too generic). Use compound phrases.',
      pattern: {
        anyOf: [
          'fishing net', 'fishing nets',
          'cargo net', 'cargo nets',
          'hammock', 'hammocks',
          'netting',
          'knotted netting',
          'gill net', 'seine', 'trawl net',
        ],
      },
      whitelist: { allowChapters: ['56'] },
    },
  },

  // ── 2. Fix SKI_SNOWBOARD_INTENT — exclude garment context ────────────────────
  {
    priority: 640,
    rule: {
      id: 'SKI_SNOWBOARD_INTENT',
      description: 'Ski/snowboard equipment → ch.95. ' +
        'Added noneOf for garment context: ski pants/jackets are ch.62 (woven garments), ' +
        'not ch.95 (sporting goods/equipment). When garment vocabulary is present, ' +
        'the query is about ski clothing, not ski hardware.',
      pattern: {
        anyOf: [
          'ski', 'skis', 'alpine ski', 'downhill ski', 'cross-country ski',
          'snowboard', 'freestyle snowboard',
        ],
        noneOf: [
          'pants', 'jacket', 'jackets', 'garments', 'garment', 'outerwear',
          'suit', 'suits', 'bib', 'overalls', 'breeches', 'clothing',
          'trousers', 'shorts',
        ],
      },
      whitelist: { allowChapters: ['95'] },
    },
  },

  // ── 3a. Fix AI_CH22_ETHYL_ALCOHOL — replace "ethyl" with phrase ──────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH22_ETHYL_ALCOHOL',
      description: 'Ethanol, denatured alcohol → ch.22. ' +
        'Replaced bare "ethyl" with "ethyl alcohol" phrase: bare "ethyl" fires for organic ' +
        'chemistry compound names like "diethylamino ethyl chloride" (ch.29). ' +
        'Added noneOf for organic chemistry context. ' +
        '"isopropyl" also replaced with "isopropyl alcohol" to avoid organic chemistry names.',
      pattern: {
        anyOf: [
          'ethanol',
          'ethyl alcohol',     // phrase — safe
          'isopropyl alcohol', // phrase — safe
          'denatured',
          'denatured alcohol',
        ],
        noneOf: [
          'hand', 'sanitizer', 'gel', 'cleaner',
          // Organic chemistry context
          'chloride', 'chlorides', 'amino', 'hydrochloride', 'diamine',
          'organo', 'compound', 'compounds', 'phosphate', 'amine', 'amide',
          'ester', 'esters', 'ketone', 'aldehyde', 'nitrile',
        ],
      },
      whitelist: { allowChapters: ['22'] },
    },
  },

  // ── 3b. Fix AI_CH22_ETHYL_ALCOHOL_HIGH — same fix ────────────────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH22_ETHYL_ALCOHOL_HIGH',
      description: 'High-proof ethanol, grain alcohol, neutral spirits → ch.22. ' +
        'Replaced bare "ethyl" and "isopropyl" with phrases to avoid organic chemistry ' +
        'compound name false positives (ch.29 vs ch.22).',
      pattern: {
        anyOf: [
          'ethanol',
          'ethyl alcohol',
          'grain alcohol',
          'denatured',
          'isopropyl alcohol',
          'rubbing alcohol',
          'pure alcohol',
          'neutral spirits',
          'everclear',
        ],
        noneOf: [
          'chloride', 'chlorides', 'amino', 'hydrochloride',
          'organo', 'compound', 'compounds', 'phosphate', 'amine',
          'ester', 'esters', 'nitrile', 'ketone',
        ],
      },
      whitelist: { allowChapters: ['22'] },
    },
  },

  // ── 4. Fix AI_CH31_PHOSPHATIC_FERTILIZER — add noneOf for organic chem ───────
  {
    priority: 630,
    rule: {
      id: 'AI_CH31_PHOSPHATIC_FERTILIZER',
      description: 'Phosphatic fertilizers, DAP, MAP, superphosphate → ch.31. ' +
        'Added noneOf for organic chemistry context: "phosphorus" fires for HTS descriptions ' +
        'like "Containing a phosphorus atom to which... carbon atoms bonded" (ch.29 organo- ' +
        'inorganic compounds). Phosphatic fertilizers use "phosphate"/"phosphatic"/"DAP" etc, ' +
        'not "phosphorus atom" chemistry language.',
      pattern: {
        anyOf: [
          'phosphate', 'phosphatic', 'superphosphate', 'dap', 'map',
          'diammonium', 'monoammonium', 'phosphorus',
        ],
        noneOf: [
          // Organic chemistry context
          'atom', 'bonded', 'organo', 'inorganic', 'organic',
          'ester', 'esters', 'compound', 'compounds', 'carbon atoms',
          'methyl', 'ethyl', 'propyl', 'isopropyl', 'n-propyl',
        ],
      },
      whitelist: { allowChapters: ['31'] },
    },
  },

  // ── 5. Fix AI_CH58_RIBBON_TRIM — exclude thermal/printer ribbon context ───────
  {
    priority: 630,
    rule: {
      id: 'AI_CH58_RIBBON_TRIM',
      description: 'Woven decorative ribbons, grosgrain, satin ribbon → ch.58/56. ' +
        'Added noneOf for thermal transfer/printer ribbon context: "ribbons" fires for ' +
        '"thermal transfer printing ribbons" (ch.96 = typewriter/printer ribbons/supplies). ' +
        'Ink ribbons for typewriters/printers are ch.9612, not woven fabric ribbons.',
      pattern: {
        anyOf: [
          'ribbon', 'ribbons', 'grosgrain', 'satin ribbon', 'organza ribbon',
          'wired ribbon', 'trim ribbon', 'decorative ribbon', 'gift ribbon',
          'craft ribbon', 'hair ribbon',
        ],
        noneOf: [
          // Printer/typewriter ribbon context → ch.96
          'thermal transfer', 'thermal', 'transfer printing', 'typewriter',
          'printer ribbon', 'ink ribbon', 'polyethylene terephthalate',
          'coated polyethylene', 'film',
        ],
      },
      whitelist: { allowChapters: ['58', '56'] },
    },
  },

  // ── 6. Fix AI_CH13_NATURAL_GUMS_RESINS — exclude synthetic resin context ──────
  {
    priority: 630,
    rule: {
      id: 'AI_CH13_NATURAL_GUMS_RESINS',
      description: 'Natural gums, oleoresins, turpentine, rosin, balsam → ch.13. ' +
        'Added noneOf for synthetic plastic resin context: "resin" fires for "acrylic resin ' +
        'of polyester resin" in button/fastener HTS descriptions (ch.96). ' +
        'Natural resins (arabic, karaya, rosin) ≠ synthetic plastic resins (acrylic, polyester).',
      pattern: {
        anyOf: [
          'gum', 'resin', 'oleoresin', 'turpentine', 'balsam', 'arabic',
          'karaya', 'tragacanth', 'rosin', 'dammar', 'copal', 'mastic',
        ],
        noneOf: [
          // Synthetic/plastic resin context
          'acrylic', 'synthetic', 'plastic', 'plastics', 'polyester', 'polyurethane',
          'epoxy', 'phenolic', 'polypropylene', 'polyethylene', 'nylon',
          'buttons', 'button', 'fastener', 'fasteners', 'press-fastener',
        ],
      },
      whitelist: { allowChapters: ['13'] },
    },
  },

  // ── 7. Fix AI_CH11_OAT_PRODUCTS — replace "rolled" with phrase ───────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH11_OAT_PRODUCTS',
      description: 'Oat products: oatmeal, groats, rolled oats → ch.11. ' +
        'Replaced bare "rolled" with "rolled oats" phrase: "rolled" alone fires for ' +
        '"Hot-rolled" steel products (ch.72). Steel rolling ≠ oat flake rolling. ' +
        'Added noneOf for steel/metal context.',
      pattern: {
        anyOf: [
          'oats', 'oat', 'oatmeal', 'groats',
          'rolled oats',  // phrase — safe
        ],
        noneOf: [
          'flour', 'bran', 'cookie', 'bar', 'bread',
          // Steel/metal context
          'steel', 'iron', 'metal', 'hot-rolled', 'cold-rolled',
          'stainless', 'alloy', 'sections', 'angles', 'bars', 'rods',
          'drilled', 'punched', 'advanced',
        ],
      },
      whitelist: { allowChapters: ['11'] },
    },
  },

  // ── 8. Fix AI_CH14_PLAITING_MATERIALS — add noneOf for joinery/carpentry ─────
  {
    priority: 630,
    rule: {
      id: 'AI_CH14_PLAITING_MATERIALS',
      description: 'Plaiting materials: rattan, raffia, bamboo, wicker, reed, straw → ch.14. ' +
        'Added noneOf for builders joinery/carpentry context: "bamboo" fires for HTS ' +
        'descriptions like "Solid Of bamboo... Builders joinery and carpentry of wood" (ch.44). ' +
        'Plaiting-grade bamboo (raw material) ≠ processed bamboo in structural construction.',
      pattern: {
        anyOf: [
          'rattan', 'raffia', 'osier', 'rushes', 'rush', 'reed', 'reeds',
          'willow', 'wicker', 'bamboo', 'cane', 'canes', 'straw',
          'broom', 'broomcorn', 'istle',
        ],
        noneOf: [
          // Existing noneOf (from prior patches)
          'furniture', 'chair', 'basket', 'mat', 'flooring',
          'artificial', 'finished', 'product', 'woven',
          'baler', 'balers', 'fodder', 'machinery', 'machine', 'machines',
          'harvesting', 'threshing', 'mower', 'mowers',
          // New: builders joinery/carpentry context → ch.44
          'joinery', 'carpentry', 'builders', 'shingles', 'shakes',
          'construction', 'structural', 'flooring panels', 'builders joinery',
          'cellular wood', 'assembled flooring',
        ],
      },
      whitelist: { allowChapters: ['14'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch V)...`);

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
    console.log(`\nPatch V complete: ${success} applied, ${failed} failed`);
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
