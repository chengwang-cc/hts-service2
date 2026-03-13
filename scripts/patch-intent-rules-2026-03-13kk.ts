#!/usr/bin/env ts-node
/**
 * Patch KK — 2026-03-13:
 *
 * Fix multiple cross-chapter conflicts identified from eval-GGHHII:
 *
 * 1. AI_CH89_ROWBOAT_PADDLEBOAT: "shell" fires for "Other Other In shell" (1202.41
 *    peanuts in shell — ch.12). Racing/rowing shells are boats (ch.89) but "in shell"
 *    = peanut description. Fix: remove bare "shell"; add "rowing shell","racing shell" phrases.
 *
 * 2. AI_CH89_PERSONAL_WATERCRAFT: bare "jet" fires for "Jet type Other" (8446 ch.84 looms).
 *    "Jet-type" is a weaving loom drive mechanism, not a watercraft. The loom noneOf from HH
 *    doesn't help because "Jet type Other" has no loom words. Fix: remove bare "jet" from anyOf.
 *
 * 3. AI_CH51_RAW_WOOL: fires for "23 percent wool...Trousers breeches and shorts" (ch.61
 *    knitted garments) — "wool" triggers, but "trousers","breeches","shorts" not in noneOf.
 *    Fix: add garment types to noneOf.
 *
 * 4. SUGAR_INTENT: "sugar" fires for "Vegetables...preserved by sugar" (ch.20) → allowChapters:[17].
 *    Preservation by sugar = ch.20 (prepared foods), not ch.17 (sugar products).
 *    Fix: add noneOf for preserved/candied context.
 *
 * 5. FRESH_VEGETABLE_INTENT + FRESH_FRUIT_INTENT: fire for "preserved by sugar" query → block ch.20.
 *    Fix: add noneOf for preservation context.
 *
 * 6. SCREW_BOLT_INTENT: "nuts" (in anyOf as hardware nuts) fires for "Vegetables fruit nuts
 *    ...preserved by sugar" → allowChapters:[73] blocks ch.20.
 *    Fix: add noneOf for food context.
 *
 * 7. AI_CH02_HORSE_MEAT: "horse" fires for "horse-chestnuts" (ch.23 animal feed) → [02] blocks.
 *    Fix: add noneOf for horse-chestnut context.
 *
 * 8. NUTS_SEEDS_INTENT: "chestnuts" fires for "Acorns and horse-chestnuts" (ch.23) → [08].
 *    Acorns/horse-chestnuts are animal feed (ch.23), not edible nuts (ch.08).
 *    Fix: add noneOf for acorn/horse-chestnut context.
 *
 * 9. AI_CH03_FISH_MEAL_FLOUR: "meal" fires for "Corn gluten meal" (ch.23) → [03].
 *    Corn gluten meal is a plant byproduct for animal feed, not fish flour/meal.
 *    Fix: add noneOf for corn/plant-based gluten context.
 *
 * 10. AI_CH11_WHEAT_GLUTEN + AI_CH11_SEMOLINA_GROATS: "gluten","meal" fire for "Corn gluten
 *     meal" (ch.23) → [11]. Corn gluten meal is ch.23, not ch.11 wheat products.
 *     Fix: add noneOf for corn/maize gluten and animal feed context.
 *
 * 11. NEW PRESERVED_FOOD_CH20_INTENT: Add intent for sugar-preserved/prepared fruit/veg (ch.20).
 *
 * 12. NEW ANIMAL_FEED_CH23_INTENT: Add intent for corn gluten meal, acorns, distillers grains (ch.23).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13kk.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PRESERVED_FOOD_NONE_OF = [
  'preserved by sugar', 'preserved', 'drained', 'glazed', 'crystallized', 'candied',
  'glace', 'in syrup', 'otherwise prepared', 'prepared or preserved',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH89_ROWBOAT_PADDLEBOAT — remove bare "shell" ─────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH89_ROWBOAT_PADDLEBOAT',
      description: 'Rowboats, paddle boats, human-powered watercraft → ch.89. ' +
        'Removed bare "shell" from anyOf: "Other Other In shell" (1202.41 peanuts in ' +
        'shell — ch.12) has "shell" token → fires allowChapters:[89]. A racing/rowing ' +
        '"shell" is a boat but "in shell" describes peanut/nut state. ' +
        'Added "rowing shell","racing shell" phrases instead.',
      pattern: {
        anyOf: [
          'rowboat', 'rowing', 'paddleboat', 'pedal', 'sculling', 'scull',
          'rowing shell', 'racing shell', 'race shell',
          'skiff', 'punt', 'gondola', 'dory',
          // "shell" removed — fires for "in shell" peanut/nut descriptions
        ],
        noneOf: [
          'peanut', 'peanuts', 'nut', 'nuts', 'seed', 'seeds',
          'groundnut', 'groundnuts', 'grain', 'cereal',
          'almond', 'almonds', 'walnut', 'walnuts',
          'pistachio', 'hazelnut', 'cashew', 'pecan',
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 2. Fix AI_CH89_PERSONAL_WATERCRAFT — remove bare "jet" ──────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH89_PERSONAL_WATERCRAFT',
      description: 'Personal watercraft, jet skis → ch.89. ' +
        'Removed bare "jet" from anyOf: "Jet type Other" (8446.30 ch.84 air-jet/water-jet ' +
        'looms) has "jet" token → fires allowChapters:[89], blocking ch.84. The loom ' +
        'noneOf from patch HH doesn\'t help because "Jet type Other" has no loom words. ' +
        'Bare "jet" is too generic — keeps phrases only.',
      pattern: {
        anyOf: [
          'jet ski', 'personal watercraft', 'pwc', 'seadoo', 'waverunner', 'jet boat',
          // bare "jet" removed — fires for "Jet type" (loom drive type) in ch.84 context
        ],
        noneOf: [
          'loom', 'looms', 'weft', 'warp', 'weaving', 'textile', 'fabric', 'fabrics',
          'weave', 'shuttleless', 'rapier', 'projectile',
          'aircraft', 'airplane', 'jet engine', 'turbine',
        ],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 3. Fix AI_CH51_RAW_WOOL — add garment types to noneOf ──────────────────
  {
    priority: 660,
    rule: {
      id: 'AI_CH51_RAW_WOOL',
      description: 'Raw wool, fleece, greasy wool → ch.51. ' +
        'Added noneOf for garment types: "23 percent wool...Trousers breeches and shorts" ' +
        '(ch.61 knitted garments) has "wool" → fires allowChapters:[51], blocking ch.61. ' +
        '"Trousers","breeches","shorts" were not in noneOf (only "coat","jacket" etc. were). ' +
        'Wool garments are ch.61/62, not ch.51 raw wool fiber.',
      pattern: {
        anyOf: ['wool', 'fleece', 'greasy', 'shorn', 'raw', 'unwashed'],
        noneOf: [
          'yarn', 'fabric', 'knit', 'woven', 'felt', 'blanket', 'sweater', 'coat', 'carpet',
          'slag', 'mineral', 'rock wool', 'slag wool', 'glass wool', 'ceramic',
          'insulation', 'insulating', 'pipe',
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          'restraints', 'restraint',
          'overcoats', 'overcoat', 'anoraks', 'anorak', 'cloaks', 'cloak',
          'windbreakers', 'windbreaker', 'capes', 'jackets', 'jacket', 'padded', 'sleeveless',
          // Added: more garment types → ch.61/62
          'trousers', 'trouser', 'breeches', 'breech', 'shorts', 'garments', 'garment',
          'wearing apparel', 'suits', 'blouses', 'dresses', 'skirts',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 4. Fix SUGAR_INTENT — exclude preserved-by-sugar context (ch.20) ─────────
  {
    priority: 640,
    rule: {
      id: 'SUGAR_INTENT',
      description: 'Sugar, cane sugar, beet sugar, raw sugar → ch.17. ' +
        'Added noneOf for preserved-food context: "Vegetables...preserved by sugar drained ' +
        'glazed or crystallized" (ch.20 prepared foods) has "sugar" → fires allowChapters:[17]. ' +
        '"Preserved by sugar" is a preservation method producing ch.20 products, not ch.17 sugar.',
      pattern: {
        anyOf: [
          'sugar', 'white sugar', 'brown sugar', 'cane sugar', 'powdered sugar',
          'granulated sugar', 'raw sugar', 'caster sugar',
        ],
        noneOf: PRESERVED_FOOD_NONE_OF,
      },
      whitelist: { allowChapters: ['17'] },
    },
  },

  // ── 5. Fix FRESH_VEGETABLE_INTENT — exclude preserved context + corn gluten ──
  {
    priority: 640,
    rule: {
      id: 'FRESH_VEGETABLE_INTENT',
      description: 'Fresh vegetables, raw produce → ch.07. ' +
        'Added noneOf for (a) preservation context: "preserved by sugar" queries (ch.20) ' +
        'have vegetable/fruit tokens → fires allowChapters:[07], blocking ch.20; ' +
        '(b) corn gluten context: "Corn gluten meal" (ch.23) has "corn" → fires [07]. ' +
        'Also keeps existing machinery/textile noneOf.',
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
          'fibers', 'fiber', 'material', 'materials',
          'upper', 'uppers', 'sole', 'soles', 'textile', 'textiles',
          'yarn', 'thread', 'woven', 'knitted',
          // Preserved food context → ch.20
          ...PRESERVED_FOOD_NONE_OF,
          // Corn gluten/feed context → ch.23
          'gluten', 'gluten meal', 'corn gluten',
        ],
      },
      whitelist: { allowChapters: ['07'] },
    },
  },

  // ── 6. Fix FRESH_FRUIT_INTENT — exclude preserved context (ch.20) ────────────
  {
    priority: 640,
    rule: {
      id: 'FRESH_FRUIT_INTENT',
      description: 'Fresh/dried fruit → ch.08. ' +
        'Added noneOf for preserved-food context: "Vegetables fruit...preserved by sugar ' +
        'drained glazed or crystallized" (ch.20) has fruit tokens → fires allowChapters:[08], ' +
        'blocking ch.20. Preserving with sugar, glazing, crystallizing = ch.20 products.',
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
          'machinery', 'machine', 'machines', 'sorting', 'grading', 'harvesting',
          'threshing', 'cleaning', 'processing', 'incubator', 'agricultural machinery',
          'activated carbon', 'activated', 'charcoal', 'carbon black', 'mineral products',
          'fibers', 'fiber', 'material', 'materials',
          'upper', 'uppers', 'sole', 'soles', 'textile', 'textiles',
          'yarn', 'thread', 'woven', 'knitted', 'derived',
          // Preserved food context → ch.20
          ...PRESERVED_FOOD_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

  // ── 7. Fix SCREW_BOLT_INTENT — exclude food/botanical "nuts" context ─────────
  {
    priority: 640,
    rule: {
      id: 'SCREW_BOLT_INTENT',
      description: 'Screws, bolts, nuts (hardware fasteners) → ch.73. ' +
        'Added noneOf for food context: "Vegetables fruit nuts...preserved by sugar" has ' +
        '"nuts" token → fires allowChapters:[73] (hardware nuts). Edible nuts are ch.08, ' +
        'botanical "parts of plants" are ch.20. Hardware "nuts" ≠ food "nuts".',
      pattern: {
        anyOf: [
          'screws', 'screw', 'wood screw', 'machine screw', 'self-tapping screw',
          'bolts', 'bolt', 'hex bolt', 'carriage bolt',
          'nuts', 'hex nut', 'lock nut', 'wing nut',
          'washers', 'washer', 'flat washer',
        ],
        noneOf: [
          'firearms', 'firearm', 'pistol', 'revolver', 'revolvers',
          'rifle', 'rifles', 'shotgun', 'shotguns', 'military weapons', 'military weapon',
          'carbine', 'muzzle-loading', 'ammunition', 'blank ammunition',
          'captive-bolt', 'captive',
          // Food/botanical context — "nuts" as edible nuts or plant parts
          'vegetable', 'vegetables', 'fruit', 'fruits', 'plant', 'plants', 'botanical',
          'edible', 'food', 'peel', 'flesh', 'kernel', 'kernels',
        ],
      },
      whitelist: { allowChapters: ['73'] },
    },
  },

  // ── 8. Fix AI_CH02_HORSE_MEAT — exclude horse-chestnut context ──────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH02_HORSE_MEAT',
      description: 'Horse meat, mule meat, equine meat → ch.02. ' +
        'Added noneOf for horse-chestnut context: "Acorns and horse-chestnuts" (2308 ch.23 ' +
        'animal feed) has "horse" → fires allowChapters:[02]. Horse-chestnuts (Aesculus spp.) ' +
        'are inedible seeds used as animal feed, not horse meat.',
      pattern: {
        anyOf: ['horse', 'horsemeat', 'mule', 'donkey', 'equine', 'ass'],
        noneOf: [
          'leather', 'tanning', 'tanned', 'parchment', 'crusting', 'hide', 'hides',
          'tannery', 'tanner', 'chamois', 'suede', 'nubuck',
          // Horse-chestnut context → ch.23
          'chestnut', 'chestnuts', 'horse-chestnut', 'horse chestnut',
          'acorn', 'acorns', 'conker', 'conkers', 'aesculus',
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 9. Fix NUTS_SEEDS_INTENT — exclude acorns/horse-chestnuts (ch.23) ────────
  {
    priority: 640,
    rule: {
      id: 'NUTS_SEEDS_INTENT',
      description: 'Edible nuts and dried fruits → ch.08. ' +
        'Added noneOf for animal feed nuts: "Acorns and horse-chestnuts" (2308 ch.23) ' +
        'has "chestnuts" → fires allowChapters:[08]. Horse-chestnuts are inedible (Aesculus), ' +
        'acorns are animal feed — neither are edible ch.08 nuts.',
      pattern: {
        anyOf: [
          'almonds', 'cashews', 'walnuts', 'peanuts', 'pistachios', 'macadamia',
          'hazelnuts', 'pecans', 'pine nuts', 'chestnuts', 'brazil nuts',
          'brazil nut', 'betel nuts', 'kola nuts',
        ],
        noneOf: [
          // Inedible/animal feed context → ch.23
          'acorn', 'acorns', 'horse-chestnut', 'horse chestnut', 'aesculus',
          'conker', 'conkers',
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

  // ── 10. Fix AI_CH03_FISH_MEAL_FLOUR — exclude corn/plant gluten context ──────
  {
    priority: 650,
    rule: {
      id: 'AI_CH03_FISH_MEAL_FLOUR',
      description: 'Fish meal, fish flour, fish pellets → ch.03. ' +
        'Added noneOf for corn/plant-based gluten context: "Corn gluten meal" (2303 ch.23) ' +
        'has "meal" → fires allowChapters:[03]. Corn gluten meal is a plant byproduct used ' +
        'as animal feed (ch.23), not fish meal (ch.03). Also prevents firing for soybean/oilseed meal.',
      pattern: {
        anyOf: ['meal', 'flour', 'pellet', 'surimi', 'paste', 'minced'],
        noneOf: [
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust',
          'composition leather', 'not suitable',
          // Corn/plant gluten meal context → ch.23
          'corn', 'maize', 'gluten', 'soybean', 'soya', 'oilseed',
          'brewer', 'distiller', 'stillage', 'starch residue',
          'plant', 'vegetable', 'bran', 'acorn', 'acorns',
          // Grain/flour context → ch.11/19
          'wheat flour', 'rye flour', 'corn flour', 'rice flour',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 11. Fix AI_CH11_WHEAT_GLUTEN — exclude corn/maize gluten context ─────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH11_WHEAT_GLUTEN',
      description: 'Wheat gluten, vital wheat gluten → ch.11. ' +
        'Added noneOf for corn/maize gluten context: "Corn gluten meal" (2303 ch.23) ' +
        'has "gluten" → fires allowChapters:[11]. Corn gluten is a byproduct of corn starch ' +
        'manufacture, used as animal feed (ch.23). Wheat gluten is the ch.11 product.',
      pattern: {
        anyOf: ['gluten', 'seitan', 'vital'],
        noneOf: [
          // Corn/maize gluten → ch.23
          'corn', 'maize', 'corn gluten', 'maize gluten',
          'brewer', 'distiller', 'feed', 'animal feed',
        ],
      },
      whitelist: { allowChapters: ['11'] },
    },
  },

  // ── 12. Fix AI_CH11_SEMOLINA_GROATS — exclude corn gluten/feed context ────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH11_SEMOLINA_GROATS',
      description: 'Semolina, groats, cornmeal, grits, polenta → ch.11. ' +
        'Added noneOf for animal feed context: "Corn gluten meal" (2303 ch.23) has "meal" → ' +
        'fires allowChapters:[11]. "Gluten meal" and "feed" context indicates ch.23 byproducts ' +
        'not ch.11 milled cereal products.',
      pattern: {
        anyOf: ['semolina', 'groats', 'cornmeal', 'grits', 'grit', 'polenta', 'meal'],
        noneOf: [
          'flour', 'bread', 'pasta', 'noodle',
          // Animal feed byproduct context → ch.23
          'gluten', 'gluten meal', 'corn gluten', 'maize gluten',
          'animal feed', 'feed ingredient', 'brewer', 'distiller',
        ],
      },
      whitelist: { allowChapters: ['11'] },
    },
  },

  // ── 13. NEW PRESERVED_FOOD_CH20_INTENT — sugar-preserved/prepared foods ──────
  {
    priority: 660,
    rule: {
      id: 'PRESERVED_FOOD_CH20_INTENT',
      description: 'Fruits/vegetables preserved by sugar, glazed, crystallized, in syrup; ' +
        'jams, marmalades, jellies → ch.20. ' +
        'Addresses: "Vegetables fruit nuts...preserved by sugar drained glac or crystallized" ' +
        '(2006 ch.20) — SUGAR_INTENT/FRESH_FRUIT/FRESH_VEG rules block ch.20 by restricting ' +
        'to [17,07,08]. This rule explicitly allows ch.20 for preserved-food context.',
      pattern: {
        anyOf: [
          'preserved by sugar', 'drained glazed', 'glazed or crystallized',
          'crystallized', 'candied', 'in syrup', 'in sugar syrup',
          'jam', 'jams', 'marmalade', 'marmalades', 'jelly', 'jellies',
          'fruit butter', 'fruit paste', 'chutney', 'fruit preserves',
        ],
      },
      whitelist: { allowChapters: ['20'] },
    },
  },

  // ── 14. NEW ANIMAL_FEED_CH23_INTENT — corn gluten meal, acorns, distillers ───
  {
    priority: 660,
    rule: {
      id: 'ANIMAL_FEED_CH23_INTENT',
      description: 'Animal feed ingredients: corn gluten meal, acorns, distillers grains, ' +
        'brewer\'s grains → ch.23. ' +
        'Addresses: (a) "Corn gluten meal" (2303 ch.23) — fish/cereal/veg rules block ch.23; ' +
        '(b) "Acorns and horse-chestnuts" (2308 ch.23) — nut/meat rules block ch.23.',
      pattern: {
        anyOf: [
          'corn gluten meal', 'corn gluten feed', 'maize gluten meal',
          'distillers grains', 'distillers dried grains', 'brewers grains', 'brewer grains',
          'draff', 'bagasse', 'oilcake', 'oil cake', 'oil-cake',
          'acorns', 'horse-chestnuts', 'horse chestnuts',
          'marc', 'pomace', 'lees', 'residues from starch',
        ],
      },
      whitelist: { allowChapters: ['23'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch KK)...`);

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
    console.log(`\nPatch KK complete: ${success} applied, ${failed} failed`);
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
