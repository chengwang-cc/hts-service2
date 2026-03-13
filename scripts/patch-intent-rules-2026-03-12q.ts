#!/usr/bin/env ts-node
/**
 * Patch Q — 2026-03-12:
 *
 * Fix 14 overly-broad AI rules causing allowChapters conflicts for ch.84/85/76/64 queries.
 *
 * Root causes (all same pattern: generic single-word tokens in allowChapters rules):
 *   - "produce"/"fruit" → FRESH_VEG/FRUIT fires for harvesting machinery descriptions
 *   - "straw" → AI_CH14_PLAITING_MATERIALS fires for "straw or fodder balers"
 *   - "plane" → AI_CH88_AIRPLANE fires for "horizontal plane"
 *   - "baler"/"hay" → AI_CH56_TWINE_BALER fires for baling machinery
 *   - "poultry" → MEAT_POULTRY_INTENT fires for poultry-keeping machinery
 *   - "shovel" → SHOVEL_RAKE_GARDEN_INTENT fires for "shovel loaders" (heavy equipment)
 *   - "clock" → CLOCK_TIMEPIECE_INTENT fires for "clock and timing circuits" (IC chips)
 *   - "single" → AI_CH22_SPIRITS_WHISKEY fires for "single-phase" AC motors
 *   - "flat" → AI_CH57_KILIM_FLATWEAVE_RUG fires for "flat packs" (electronic components)
 *   - "aluminum" → AI_CH89_MOTORBOAT fires for "aluminum structures" (ch.76)
 *   - "bridge"/"rest"/"bow"/"peg" → AI_CH92_VIOLIN_BOW fires for aluminum bridge structures
 *   - "platform" → AI_CH89_DREDGER_PLATFORM fires for "wooden platform shoes"
 *   - wood+no-footwear-tokens → WOOD_CRAFT_DENY_FOOTWEAR denies ch.64 for wooden shoe queries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12q.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. FRESH_VEGETABLE_INTENT — don't fire for machinery/sorting descriptions ──
  {
    priority: 620,
    rule: {
      id: 'FRESH_VEGETABLE_INTENT',
      description: 'Fresh vegetables → ch.07. Added noneOf for machinery context to prevent ' +
        'firing on harvesting/sorting machine HTS descriptions containing "produce", "fruit".',
      pattern: {
        anyOf: [
          'broccoli', 'carrot', 'carrots', 'potato', 'potatoes', 'onion', 'onions',
          'tomato', 'tomatoes', 'spinach', 'lettuce', 'mushroom', 'mushrooms',
          'cucumber', 'cucumbers', 'corn', 'garlic', 'asparagus', 'zucchini',
          'eggplant', 'celery', 'cabbage', 'cauliflower', 'pumpkin', 'squash',
          'vegetable', 'vegetables', 'produce',
        ],
        noneOf: [
          'machinery', 'machine', 'machines', 'sorting', 'grading', 'harvesting',
          'threshing', 'cleaning', 'processing', 'incubator', 'agricultural machinery',
        ],
      },
      whitelist: { allowChapters: ['07'] },
    },
  },

  // ── 2. FRESH_FRUIT_INTENT — don't fire for machinery descriptions ─────────
  {
    priority: 620,
    rule: {
      id: 'FRESH_FRUIT_INTENT',
      description: 'Fresh fruit → ch.08. Added noneOf for machinery context.',
      pattern: {
        anyOf: [
          'apple', 'apples', 'banana', 'bananas', 'orange', 'oranges',
          'strawberry', 'strawberries', 'blueberry', 'blueberries', 'grape', 'grapes',
          'mango', 'mangoes', 'avocado', 'avocados', 'lemon', 'lemons', 'lime', 'limes',
          'peach', 'peaches', 'pear', 'pears', 'watermelon', 'pineapple',
          'cherry', 'cherries', 'kiwi', 'papaya', 'coconut', 'plum', 'plums',
          'fruit', 'fruits',
        ],
        noneOf: [
          'machinery', 'machine', 'machines', 'sorting', 'grading', 'harvesting',
          'cleaning', 'processing', 'agricultural machinery',
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

  // ── 3. AI_CH14_PLAITING_MATERIALS — don't fire for baling machinery ───────
  {
    priority: 620,
    rule: {
      id: 'AI_CH14_PLAITING_MATERIALS',
      description: 'Plaiting/basketry materials: rattan, bamboo, straw, etc. → ch.14. ' +
        'Added noneOf for baler/fodder/machinery context — "straw" in "straw or fodder balers" ' +
        'is harvesting machinery (ch.84), not raw plaiting material.',
      pattern: {
        anyOf: ['rattan', 'raffia', 'osier', 'rushes', 'rush', 'reed', 'reeds', 'willow',
          'wicker', 'bamboo', 'cane', 'canes', 'straw', 'broom', 'broomcorn', 'istle'],
        noneOf: [
          'furniture', 'chair', 'basket', 'mat', 'flooring', 'artificial', 'finished',
          'product', 'woven',
          // Added: machinery context for straw
          'baler', 'balers', 'fodder', 'machinery', 'machine', 'machines', 'harvesting',
          'threshing', 'mower', 'mowers',
        ],
      },
      whitelist: { allowChapters: ['14'] },
    },
  },

  // ── 4. AI_CH88_AIRPLANE — remove bare "plane" (fires for "horizontal plane") ─
  {
    priority: 620,
    rule: {
      id: 'AI_CH88_AIRPLANE',
      description: 'Aircraft/airplanes → ch.88. Removed bare "plane" which fired for ' +
        '"horizontal plane" in machinery descriptions. Added "planes" only if context-safe.',
      pattern: {
        anyOf: [
          'airplane', 'airplanes', 'aircraft', 'ultralight', 'ultralights',
          'turboprop', 'turbofan',
          'jet aircraft', 'piston aircraft',  // phrases only (safe)
          // "plane" and "planes" removed — too generic (horizontal plane, cutting plane, etc.)
          // "jet" removed — too generic (jet nozzle, water jet, etc.)
          // "piston" removed — piston in IC engines
        ],
        noneOf: ['drone', 'uav', 'unmanned', 'helicopter', 'quadcopter'],
      },
      whitelist: { allowChapters: ['88'] },
    },
  },

  // ── 5. AI_CH56_TWINE_BALER — add machinery noneOf, remove "hay" ──────────
  {
    priority: 620,
    rule: {
      id: 'AI_CH56_TWINE_BALER',
      description: 'Baler twine/rope, sisal/jute/hemp cord → ch.56 (5607). Added noneOf for ' +
        'machinery context: "baler" in machinery description = 8433 (harvesting machine), ' +
        'not twine. Removed bare "hay" (too generic — hay mowers are ch.84).',
      pattern: {
        anyOf: [
          'baler twine', 'baling twine', 'sisal twine',    // phrases
          'twine', 'sisal', 'jute', 'hemp', 'manila',
          // "baler" alone removed — could be harvesting machine
          // "hay" alone removed — hay mower is ch.84
        ],
        noneOf: ['machinery', 'machine', 'machines', 'mower', 'mowers', 'harvesting', 'baling machine'],
      },
      whitelist: { allowChapters: ['56'] },
    },
  },

  // ── 6. MEAT_POULTRY_INTENT — don't fire for poultry machinery ────────────
  {
    priority: 620,
    rule: {
      id: 'MEAT_POULTRY_INTENT',
      description: 'Fresh/frozen poultry meat → ch.02. Added noneOf for machinery/equipment ' +
        'context — "poultry-keeping machinery", "poultry incubators" belong to ch.84.',
      pattern: {
        anyOf: ['chicken', 'turkey', 'poultry', 'broiler', 'fowl', 'duck', 'goose'],
        noneOf: [
          'machinery', 'machine', 'machines', 'incubator', 'incubators',
          'brooder', 'brooders', 'keeping', 'equipment',
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 7. SHOVEL_RAKE_GARDEN_INTENT — don't fire for heavy equipment ─────────
  {
    priority: 620,
    rule: {
      id: 'SHOVEL_RAKE_GARDEN_INTENT',
      description: 'Garden hand tools: shovel, rake, hoe → ch.82. Added noneOf for heavy ' +
        'construction/mining equipment context — "shovel loaders", "mechanical shovels" ' +
        'are earth-moving equipment in ch.84, not hand tools.',
      pattern: {
        anyOf: [
          'garden shovel', 'spade', 'rake', 'garden rake', 'leaf rake',
          'hoe', 'garden fork', 'cultivator',
          'shovel',  // kept but protected by noneOf
        ],
        noneOf: [
          'loader', 'loaders', 'bulldozer', 'bulldozers', 'excavator', 'excavators',
          'mechanical', 'self-propelled', 'angledozer', 'crawler',
        ],
      },
      whitelist: { allowChapters: ['82'] },
    },
  },

  // ── 8. CLOCK_TIMEPIECE_INTENT — don't fire for "clock and timing circuits" ─
  {
    priority: 620,
    rule: {
      id: 'CLOCK_TIMEPIECE_INTENT',
      description: 'Clocks/timepieces → ch.91. Added noneOf for electronic circuit context — ' +
        '"clock and timing circuits" in IC/semiconductor HTS descriptions (ch.85) ' +
        'should not trigger this clock rule.',
      pattern: {
        anyOf: [
          'clock', 'wall clock', 'alarm clock', 'mantel clock', 'cuckoo clock',
          'digital clock', 'desk clock',
        ],
        noneOf: [
          'watch', 'smartwatch', 'wristwatch',
          // Added: electronic circuit context
          'circuit', 'circuits', 'integrated', 'amplifier', 'amplifiers',
          'converter', 'converters', 'timing circuits', 'logic circuits',
          'semiconductor', 'processor', 'controllers',
        ],
      },
      whitelist: { allowChapters: ['91'] },
    },
  },

  // ── 9. AI_CH22_SPIRITS_WHISKEY — remove "single" (fires for "single-phase") ─
  {
    priority: 620,
    rule: {
      id: 'AI_CH22_SPIRITS_WHISKEY',
      description: 'Whiskey/whisky spirits → ch.22. Removed "single" from anyOf — it fired for ' +
        '"single-phase" in AC motor descriptions. Use "single malt" phrase instead.',
      pattern: {
        anyOf: [
          'whiskey', 'whisky', 'bourbon', 'scotch', 'rye', 'whiskeys', 'whiskies',
          'tennessee', 'malt',  // "single" removed, "blended" kept
          'blended',
          'single malt',     // phrase — safe
          'single barrel',   // phrase — safe
        ],
        noneOf: ['glass', 'barrel', 'cask', 'decanter'],
      },
      whitelist: { allowChapters: ['22'] },
    },
  },

  // ── 10. AI_CH57_KILIM_FLATWEAVE_RUG — remove "flat" (fires for "flat packs") ─
  {
    priority: 620,
    rule: {
      id: 'AI_CH57_KILIM_FLATWEAVE_RUG',
      description: 'Kilim/flatweave rugs → ch.57. Removed bare "flat" which fired for ' +
        '"flat packs" in electronic component descriptions (ch.85 resistors/ICs).',
      pattern: {
        anyOf: [
          'kilim', 'kelim', 'dhurrie', 'dhurry', 'flatweave', 'soumak', 'sumak',
          'karamanie', 'schumack', 'kelem', 'tapestry', 'kilims',
          // "flat" alone removed — too generic
        ],
      },
      whitelist: { allowChapters: ['57'] },
    },
  },

  // ── 11. AI_CH89_MOTORBOAT — remove "aluminum" (fires for aluminum structures) ─
  {
    priority: 620,
    rule: {
      id: 'AI_CH89_MOTORBOAT',
      description: 'Motorboats/speedboats → ch.89. Removed bare "aluminum" which fired for ' +
        '"aluminum structures" (ch.76). Now requires boat-specific context.',
      pattern: {
        anyOf: [
          'motorboat', 'speedboat', 'powerboat', 'bowrider', 'runabout',
          'bass boat', 'pontoon boat', 'johnboat',
          'aluminum boat', 'aluminum hull',  // phrases — safe
          'fiberglass boat',                 // phrase
          'outboard', 'inboard', 'sterndrive',
          // "aluminum" alone removed — fires for aluminum structural products
          // "bass" alone removed — too generic
          // "pontoon" alone removed — could be bridge pontoon
          // "jon" alone removed — too generic
          // "fiberglass" alone kept as phrase only
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 12. AI_CH92_VIOLIN_BOW — remove generic single-word tokens ───────────
  {
    priority: 620,
    rule: {
      id: 'AI_CH92_VIOLIN_BOW',
      description: 'Violin/cello/bass bow and parts → ch.92. Removed generic single-word tokens ' +
        '(bow, bows, bridge, rest, shoulder, chin, peg, pegs) that fired for structural terms ' +
        '("aluminum bridge structures", "roofing frameworks"). Now requires compound phrases.',
      pattern: {
        anyOf: [
          'violin bow', 'cello bow', 'bass bow', 'viola bow',  // phrases
          'bow hair', 'horsehair bow', 'bow stick',
          'chin rest', 'shoulder rest violin',
          'violin bridge', 'cello bridge',
          'tuning peg', 'violin peg',
          'bowstick', 'horsehair',
          'tailpiece', 'chinrest',
          // Removed: 'bow', 'bows', 'bridge', 'rest', 'shoulder', 'chin', 'peg', 'pegs'
        ],
      },
      whitelist: { allowChapters: ['92'] },
    },
  },

  // ── 13. AI_CH89_DREDGER_PLATFORM — remove bare "platform" ───────────────
  {
    priority: 620,
    rule: {
      id: 'AI_CH89_DREDGER_PLATFORM',
      description: 'Dredgers, crane vessels, drilling/floating platforms → ch.89. Removed bare ' +
        '"platform" which fired for "wooden platform shoes" (ch.64 footwear). Now requires ' +
        'compound phrases for platforms.',
      pattern: {
        anyOf: [
          'dredger', 'dredging', 'crane vessel', 'crane ship',
          'drilling platform', 'offshore platform', 'floating platform',  // phrases
          'floating dock', 'drydock', 'floating crane',
          // "platform" alone removed — fires for "wooden platform shoes"
          // "crane" alone removed — industrial cranes are ch.84
          // "drilling" alone removed — drilling machines are ch.84/85
          // "floating" alone removed — too generic
          // "dock" alone removed — loading dock is not ch.89
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 14. WOOD_CRAFT_DENY_FOOTWEAR — add "platform" and "base" to noneOf ──
  {
    priority: 620,
    rule: {
      id: 'WOOD_CRAFT_DENY_FOOTWEAR',
      description: 'Wood craft/decor context → deny ch.64 (footwear). Added "platform" and ' +
        '"base" to noneOf because "wooden platform shoes" and "shoes on a base of wood" ' +
        'ARE footwear — the wooden element is the sole/platform, not a craft product.',
      pattern: {
        anyOf: [
          'wooden', 'wood', 'walnut', 'bamboo', 'pine', 'oak', 'maple',
          'birch', 'cedar', 'mahogany', 'teak',
        ],
        noneOf: [
          'shoe', 'shoes', 'clog', 'clogs', 'sandal', 'sandals', 'footwear',
          'boot', 'boots', 'sole', 'heel',
          // Added: platform/base shoe contexts
          'platform', 'base',
        ],
      },
      whitelist: { denyChapters: ['64'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });
    console.log(`Applying ${PATCHES.length} rule patches (batch Q)...`);

    let success = 0, failed = 0;
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
    console.log(`\nPatch Q complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
