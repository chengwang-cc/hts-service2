#!/usr/bin/env ts-node
/**
 * Patch W — 2026-03-12:
 *
 * Fix 9 more overly-broad rules causing cross-chapter misclassification:
 *
 * 1. FRESH_FRUIT_INTENT: "coconut" fires for "Derived from coconut [activated carbon]" →
 *    allowChapters:[08] blocks ch.38. "Derived from" = processed product, not fresh fruit.
 *    Fix: add noneOf=['derived'].
 *
 * 2. CEMENT_CONCRETE_INTENT: "concrete" fires for "concrete mixers" in special-purpose
 *    motor vehicle HTS descriptions (mobile cranes, fire trucks, road sweepers) →
 *    allowChapters:[25] blocks ch.87. Fix: add noneOf for vehicle context.
 *
 * 3. AI_CH51_RAW_WOOL: "wool" fires for "slag wool rock wool mineral wools" (mineral
 *    insulation) → allowChapters:[51] blocks ch.68. Fix: add noneOf for mineral/slag context.
 *
 * 4. BANDAGE_FIRST_AID_INTENT: "plaster" fires for "gypsum plaster" (building material) →
 *    allowChapters:[30] blocks ch.68. Fix: add noneOf=['gypsum','building'].
 *
 * 5. AI_CH67_FEATHER_ARTICLES: "feather" + "duster/dusters" fires for "feather dusters"
 *    in ch.96 brush/broom HTS descriptions → allowChapters:[67] blocks ch.96.
 *    Fix: add noneOf for brush/broom/mop context.
 *
 * 6. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: bare "feather" fires for "feather dusters" in
 *    brush HTS descriptions → allowChapters:[31] blocks ch.96. Feather meal fertilizer ≠
 *    feather duster cleaning tool. Fix: add noneOf=['duster','dusters','brushes','brush'].
 *
 * 7. AI_CH36_METALDEHYDE: bare "solid" fires for "Solid Of bamboo" in bamboo builders
 *    joinery (ch.44) → allowChapters:[36] blocks ch.44. Fix: remove "solid" from anyOf
 *    (too generic — "solid state", "solid wood", "solid metal" all fire this).
 *
 * 8. AI_CH13_VEGETABLE_EXTRACTS: "sap" fires for "sap-wood" in "Wood in the rough
 *    whether or not stripped of bark or sap-wood" → allowChapters:[13] blocks ch.44.
 *    Fix: add noneOf=['wood','timber','lumber','rough','bark','stripped','squared'].
 *
 * 9. AI_CH59_COATED_FABRIC_PVC_PU: "covered" (from "not covered with textile material") +
 *    "polyester" (from "polyester resin") fires for button/fastener HTS descriptions →
 *    allowChapters:[59,39] blocks ch.96. Fix: add noneOf for button/fastener context.
 *
 * Also fix AI_CH89_FERRY_CARGO_VESSEL firing for "bulk" in mineral wool descriptions.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12w.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix FRESH_FRUIT_INTENT — "derived from" = processed product ───────────
  {
    priority: 670,
    rule: {
      id: 'FRESH_FRUIT_INTENT',
      description: 'Fresh/frozen fruit → ch.08. ' +
        'Added noneOf=[\'derived\'] so "Derived from coconut" (activated carbon, ch.38) ' +
        'doesn\'t trigger the fresh fruit intent. "Derived from" indicates a processed product, ' +
        'not fresh fruit. Also keeps prior machinery, fiber, and activated-carbon noneOf.',
      pattern: {
        anyOf: [
          'apple', 'apples', 'banana', 'bananas', 'orange', 'oranges',
          'strawberry', 'strawberries', 'blueberry', 'blueberries',
          'grape', 'grapes', 'mango', 'mangoes', 'avocado', 'avocados',
          'lemon', 'lemons', 'lime', 'limes', 'peach', 'peaches',
          'pear', 'pears', 'watermelon', 'pineapple', 'cherry', 'cherries',
          'kiwi', 'papaya', 'coconut', 'plum', 'plums', 'fruit', 'fruits',
        ],
        noneOf: [
          // Machinery context
          'machinery', 'machine', 'machines', 'sorting', 'grading', 'harvesting',
          'threshing', 'cleaning', 'processing', 'incubator', 'agricultural machinery',
          // Activated carbon / chemical products
          'activated carbon', 'activated', 'charcoal', 'carbon black', 'mineral products',
          // Fiber/textile/footwear context
          'fibers', 'fiber', 'material', 'materials',
          'upper', 'uppers', 'sole', 'soles', 'textile', 'textiles',
          'yarn', 'thread', 'woven', 'knitted',
          // "Derived from" = processed product context
          'derived',
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

  // ── 2. Fix CEMENT_CONCRETE_INTENT — exclude vehicle/crane context ─────────────
  {
    priority: 640,
    rule: {
      id: 'CEMENT_CONCRETE_INTENT',
      description: 'Cement, concrete, mortar → ch.25. ' +
        'Added noneOf for vehicle context: "concrete" fires for "concrete mixers" in HTS ' +
        'descriptions for special-purpose motor vehicles (mobile cranes, fire trucks, road ' +
        'sweepers → ch.87). A truck with a concrete mixer attachment is ch.87, not ch.25.',
      pattern: {
        anyOf: [
          'cement', 'concrete', 'mortar', 'portland cement', 'ready mix cement',
          'concrete block', 'cinder block', 'cement board',
        ],
        noneOf: [
          // Vehicle context — "concrete mixers" appear in motor vehicle HTS descriptions
          'mixer', 'mixers', 'vehicle', 'vehicles', 'motor vehicle', 'motor vehicles',
          'crane', 'cranes', 'truck', 'trucks', 'sweeper', 'sweepers',
          'fire fighting', 'wrecker', 'wreckers', 'radiological',
        ],
      },
      whitelist: { allowChapters: ['25'] },
    },
  },

  // ── 3. Fix AI_CH51_RAW_WOOL — exclude mineral/slag wool context ───────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH51_RAW_WOOL',
      description: 'Raw wool, fleece, greasy wool → ch.51. ' +
        'Added noneOf for mineral wool context: "wool" fires for "slag wool", "rock wool", ' +
        '"mineral wools" (mineral insulation for pipes/buildings → ch.68). ' +
        'Animal wool ≠ mineral insulation.',
      pattern: {
        anyOf: ['wool', 'fleece', 'greasy', 'shorn', 'raw', 'unwashed'],
        noneOf: [
          'yarn', 'fabric', 'knit', 'woven', 'felt', 'blanket', 'sweater', 'coat', 'carpet',
          // Mineral/slag wool context → ch.68
          'slag', 'mineral', 'rock wool', 'slag wool', 'glass wool', 'ceramic',
          'insulation', 'insulating', 'pipe',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 4. Fix BANDAGE_FIRST_AID_INTENT — exclude gypsum/building context ─────────
  {
    priority: 630,
    rule: {
      id: 'BANDAGE_FIRST_AID_INTENT',
      description: 'Bandages, wound dressings, adhesive plasters → ch.30. ' +
        'Added noneOf for gypsum/building context: "plaster" fires for "gypsum plaster" ' +
        '(building material → ch.68). Bandage plasters ≠ gypsum building plaster.',
      pattern: {
        anyOf: [
          'bandage', 'adhesive bandage', 'wound dressing', 'plaster',
          'medical bandage', 'elastic bandage', 'gauze bandage', 'bandaid', 'band-aid',
        ],
        noneOf: [
          // Gypsum/building context → ch.68
          'gypsum', 'building', 'construction', 'board', 'ceiling', 'wall',
          'plasterboard', 'drywall',
        ],
      },
      whitelist: { allowChapters: ['30'] },
    },
  },

  // ── 5. Fix AI_CH67_FEATHER_ARTICLES — exclude brush/broom/mop context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH67_FEATHER_ARTICLES',
      description: 'Decorative feather articles, plumes, boas → ch.67. ' +
        'Added noneOf for brush/broom cleaning tool context: "feather dusters" appears in ' +
        'ch.96 brush/broom HTS descriptions. Cleaning feather dusters are ch.96, not ch.67 ' +
        'decorative feather articles.',
      pattern: {
        anyOfGroups: [
          ['feather', 'feathers', 'down', 'plume', 'plumes', 'quill', 'quills'],
          ['boa', 'boas', 'trim', 'trimming', 'decoration', 'decorations', 'article', 'articles',
            'ornament', 'ornaments', 'duster', 'dusters', 'fan', 'fans', 'hat', 'headdress',
            'mask', 'pillow', 'stuffed'],
        ],
        noneOf: [
          'goose', 'sleeping', 'jacket', 'coat', 'comforter', 'duvet', 'synthetic', 'polyester',
          // Cleaning tool context → ch.96
          'brush', 'brushes', 'broom', 'brooms', 'mop', 'mops', 'squeegee', 'squeegees',
          'knot', 'knots', 'tufts', 'paint', 'cosmetic',
        ],
      },
      whitelist: { allowChapters: ['67'] },
    },
  },

  // ── 6. Fix AI_CH31_ORGANIC_ANIMAL_FERTILIZER — exclude duster/brush context ───
  {
    priority: 630,
    rule: {
      id: 'AI_CH31_ORGANIC_ANIMAL_FERTILIZER',
      description: 'Organic/animal fertilizers: manure, compost, feather meal → ch.31. ' +
        'Added noneOf for duster/brush context: bare "feather" fires for "feather dusters" ' +
        'in ch.96 brush/broom HTS descriptions. Feather meal fertilizer ≠ feather duster.',
      pattern: {
        anyOf: [
          'manure', 'compost', 'biosolids', 'bone', 'blood', 'guano',
          'worm', 'vermicompost', 'fishmeal', 'feather',
        ],
        noneOf: [
          // Cleaning/brush tool context → ch.96
          'duster', 'dusters', 'brush', 'brushes', 'broom', 'brooms',
          'mop', 'mops', 'squeegee', 'applicator',
        ],
      },
      whitelist: { allowChapters: ['31'] },
    },
  },

  // ── 7. Fix AI_CH36_METALDEHYDE — remove bare "solid" (too generic) ───────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH36_METALDEHYDE',
      description: 'Metaldehyde, slug/snail bait, firelighters, hexamine → ch.36. ' +
        'Removed bare "solid" from anyOf: fires for "Solid Of bamboo" in bamboo builders ' +
        'joinery (ch.44) and any "solid" material description. "Solid fuel tablet" context ' +
        'is better served by "tablet" or "firelighter" which are already in anyOf.',
      pattern: {
        anyOf: [
          'metaldehyde',
          'slug',
          'snail',
          'pellets',
          'bait',
          'tablet',
          'tablets',
          'hexamine',
          'firelighter',
          'firelighters',
          // "solid" removed — too generic
          'solid fuel',          // phrase — safe
          'solid fuel tablet',   // phrase — safe
        ],
        noneOf: [
          // Fishing/snail-fishing context
          'fishing', 'fish',
          // Bamboo/wood context
          'bamboo', 'wood', 'timber',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 8. Fix AI_CH13_VEGETABLE_EXTRACTS — exclude wood/sap-wood context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH13_VEGETABLE_EXTRACTS',
      description: 'Vegetable saps, extracts, licorice, hops, ginseng → ch.13. ' +
        'Added noneOf for wood/timber context: "sap" fires for "sap-wood" in "Wood in the ' +
        'rough whether or not stripped of bark or sap-wood" (ch.44). ' +
        'Tree sap as industrial extract (ch.13) ≠ sapwood as wood anatomy term.',
      pattern: {
        anyOf: [
          'licorice', 'liquorice', 'hops', 'hop', 'ginseng', 'ephedra',
          'cashew', 'poppy', 'opium', 'botanical', 'herbal', 'extract', 'sap',
        ],
        noneOf: [
          // Wood/timber context — "sap-wood" = wood anatomy, not sap extract
          'wood', 'timber', 'lumber', 'rough', 'bark', 'stripped', 'squared',
          'sap-wood', 'sapwood', 'log', 'logs', 'plank', 'planks',
        ],
      },
      whitelist: { allowChapters: ['13'] },
    },
  },

  // ── 9. Fix AI_CH59_COATED_FABRIC_PVC_PU — exclude button/fastener context ─────
  {
    priority: 640,
    rule: {
      id: 'AI_CH59_COATED_FABRIC_PVC_PU',
      description: 'PVC/polyurethane coated fabrics → ch.59/39. ' +
        'Added noneOf for button/fastener context: "covered" (from "not covered with textile ' +
        'material") + "polyester" (from "polyester resin") fires for buttons/fasteners HTS ' +
        'descriptions (ch.96). Coated/laminated fabric ≠ plastic buttons.',
      pattern: {
        anyOfGroups: [
          ['coated', 'laminated', 'impregnated', 'covered'],
          ['pvc', 'vinyl', 'polyurethane', 'polyester', 'nylon', 'fabric', 'textile', 'cloth'],
        ],
        noneOf: [
          'tire', 'tyre', 'cord', 'conveyor', 'belt',
          // Button/fastener context → ch.96
          'buttons', 'button', 'press-fastener', 'press-fasteners',
          'snap-fastener', 'snap-fasteners', 'button molds', 'button blanks',
          'fastener', 'fasteners',
        ],
      },
      whitelist: { allowChapters: ['59', '39'] },
    },
  },

  // ── 10. Fix AI_CH89_FERRY_CARGO_VESSEL — exclude bulk material context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH89_FERRY_CARGO_VESSEL',
      description: 'Ferries, barges, tankers, freighters, cargo vessels → ch.89. ' +
        'Added noneOf for bulk material context: "bulk" fires for "in bulk sheets or rolls" ' +
        'in mineral wool insulation HTS descriptions (ch.68). ' +
        '"bulk" as in bulk cargo/material ≠ bulk cargo vessels.',
      pattern: {
        anyOf: [
          'ferry', 'barge', 'tanker', 'freighter', 'cargo', 'container',
          'bulk', 'vessel', 'ship',
        ],
        noneOf: [
          // Mineral/insulation context
          'wool', 'mineral', 'slag', 'insulation', 'rolls', 'sheets',
          'pipe', 'coverings',
          // Fabric/material context
          'fabric', 'textile', 'cloth', 'cotton', 'fiber',
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch W)...`);

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
    console.log(`\nPatch W complete: ${success} applied, ${failed} failed`);
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
