#!/usr/bin/env ts-node
/**
 * Patch SS — 2026-03-13:
 *
 * Fix 7 cross-chapter EMPTY results found in live-server empty scan:
 *
 * 1. AI_CH88_AIRPLANE: "aircraft" fires for "Articles for use in civil aircraft...
 *    Friction materials" (6813 ch.68). "For use in civil aircraft" is an HTS duty
 *    qualifier (duty-free for aircraft use), not a product classifier. Friction
 *    materials are ch.68, not ch.88. Fix: add noneOf=['friction'].
 *
 * 2. AI_CH47_WOODPULP: "cellulose" fires for "Film strip and sheets...Of other
 *    cellulose derivatives" (3920.79 ch.39 plastic film). Cellulose derivatives
 *    (cellulose acetate, cellophane film) are modified cellulose plastics (ch.39),
 *    not raw wood/cellulose pulp (ch.47). GARMENT_DENY_COTTON_PULP then denies
 *    ch.47 via "sheets" → EMPTY. Fix: add noneOf=['cellulose derivative',
 *    'cellulose derivatives','film','film strip'].
 *
 * 3. AI_CH02_SALTED_CURED_MEAT + AI_CH03_SMOKED_DRIED_SALTED_FISH: "dried" fires
 *    for "Of the genus Pimenta including allspice Dried neither crushed nor ground"
 *    (0904.21 ch.09 spices). Dried spices are ch.09, not dried meat (ch.02) or
 *    dried fish (ch.03). Both rules fire → surviving=[02,03] → ch.09 EMPTY.
 *    Fix: add noneOf for spice context to both rules.
 *
 * 4. FRESH_FRUIT_INTENT: Fruit terms fire for "In airtight containers and not
 *    containing apricots citrus fruits peaches or pears" (1904.20 ch.19 cereal
 *    products). The fruits are mentioned in a NEGATIVE context: the product does
 *    NOT contain them. Fix: add noneOf=['not containing'] phrase — "not containing X"
 *    means X is explicitly excluded from the product.
 *
 * 5. PREPARED_CANNED_MEATS_INTENT: "in airtight containers" fires for same query
 *    (ch.19 cereal) → allowChapters:[16] also blocks ch.19. The item in airtight
 *    containers is cereal/rice/tapioca (ch.19), not meat. Fix: add noneOf=['not
 *    containing'] to prevent firing when the product explicitly excludes ingredients.
 *
 * 6. AI_CH36_METALDEHYDE: "solid fuel" fires for "Hibachis Other including
 *    appliances for solid fuel" (7321.19 ch.73 iron/steel stoves). Hibachis and
 *    solid-fuel appliances are iron stoves (ch.73), not solid-fuel tablets/
 *    metaldehyde pellets (ch.36). Fix: add noneOf=['hibachi','hibachis',
 *    'appliances','grill','grills','stove','stoves','cooking'].
 *
 * 7. AI_CH57_KILIM_FLATWEAVE_RUG: "tapestry" fires for "Tapestry fabrics and
 *    upholstery fabrics of a weight not exceeding 140 g/m2" (5111.30 ch.51 wool
 *    fabrics). Tapestry as an upholstery fabric is ch.51 (woven wool fabrics),
 *    not ch.57 (floor coverings/rugs). "Upholstery fabric" is the key distinguisher.
 *    Fix: add noneOf=['upholstery','upholstery fabric','upholstery fabrics'].
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ss.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const SPICE_NONE_OF = [
  'allspice', 'pimenta', 'genus', 'spice', 'spices',
  'herb', 'herbs', 'botanical',
  'cinnamon', 'pepper', 'clove', 'cloves', 'cardamom',
  'ginger', 'nutmeg', 'mace', 'saffron', 'turmeric',
  'vanilla', 'bay', 'curry', 'cumin', 'coriander',
  'neither crushed nor ground', 'crushed nor ground',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH88_AIRPLANE — exclude friction materials context ───────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH88_AIRPLANE',
      description: 'Airplanes, aircraft, helicopters, gliders → ch.88. ' +
        'Added noneOf for friction materials context: "Articles for use in civil ' +
        'aircraft...Friction materials" (6813 ch.68) has "aircraft" → fires ' +
        'allowChapters:[88]. "For use in civil aircraft" is an HTS duty-free ' +
        'qualifier, not a product classifier. Friction materials → ch.68.',
      pattern: {
        anyOf: [
          'airplane', 'airplanes', 'aircraft', 'civil aircraft',
          'helicopter', 'helicopters', 'glider', 'gliders',
          'aerospace', 'jetliner',
        ],
        noneOf: [
          'stoves', 'stove', 'ovens', 'oven', 'ranges', 'range', 'cooking',
          'furnace', 'furnaces', 'heating',
          'motors', 'motor', 'engines', 'engine',
          'compressor', 'pump', 'roller', 'bearing', 'bearings',
          // Friction materials context → ch.68
          'friction', 'friction materials', 'friction material',
        ],
      },
      whitelist: { allowChapters: ['88'] },
    },
  },

  // ── 2. Fix AI_CH47_WOODPULP — exclude cellulose derivative film context ────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH47_WOODPULP',
      description: 'Wood pulp, cellulose pulp for papermaking → ch.47. ' +
        'Added noneOf for cellulose derivative/film context: "Film strip and sheets ' +
        '...Of other cellulose derivatives" (3920.79 ch.39 plastic film) has ' +
        '"cellulose" → fires allowChapters:[47]. Cellulose derivatives (acetate, ' +
        'cellophane) are modified-cellulose plastics (ch.39), not raw pulp (ch.47). ' +
        'Also keeps machinery noneOf from patch JJ.',
      pattern: {
        anyOf: [
          'pulp', 'woodpulp', 'wood pulp', 'cellulose', 'dissolving',
          'kraft pulp', 'kraft wood pulp', 'sulfite pulp', 'sulfate pulp', 'soda pulp',
          'coniferous pulp', 'nonconiferous pulp', 'chemical pulp', 'mechanical pulp',
          'chemi-mechanical', 'dissolving grades',
        ],
        noneOf: [
          'hoopwood', 'chipwood', 'poles', 'piles', 'stakes', 'lumber', 'timber',
          'sawn', 'joinery', 'carpentry', 'plywood', 'veneer', 'boards', 'planks',
          'wrapping paper', 'tissue', 'printing paper', 'writing paper',
          'bags', 'sacks', 'boxes', 'cartons',
          // Machinery context → ch.84 (from patch JJ)
          'machinery', 'machines', 'equipment', 'apparatus', 'calender',
          'pressing', 'winding', 'drying machine',
          // Cellulose derivative plastic film context → ch.39
          'cellulose derivative', 'cellulose derivatives',
          'cellulose acetate', 'cellophane', 'film', 'film strip',
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

  // ── 3. Fix AI_CH02_SALTED_CURED_MEAT — exclude spice context ──────────────────
  {
    priority: 650,
    rule: {
      id: 'AI_CH02_SALTED_CURED_MEAT',
      description: 'Salted, cured, smoked, dried meat → ch.02. ' +
        'Added noneOf for spice context: "...allspice Dried neither crushed nor ' +
        'ground" (0904.21 ch.09 spices) has "dried" → fires allowChapters:[02]. ' +
        'Dried spices are ch.09; "dried" in spice descriptions means dehydrated ' +
        'berries/seeds, not preserved meat. Key term: "allspice","genus","pimenta".',
      pattern: {
        anyOf: [
          'salted', 'cured', 'smoked', 'dried', 'brine', 'corned',
          'pancetta', 'serrano', 'coppa', 'guanciale', 'salt', 'jerky',
        ],
        noneOf: [
          'beef jerky', 'meat jerky',
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          'parchment', 'limed', 'pickled', 'dehaired', 'pretanned', 'crusting',
          // Offal context → ch.05 (from patch JJ)
          'guts', 'bladders', 'bladder', 'stomachs', 'stomach',
          'entrails', 'offal', 'tripe', 'intestines', 'intestine',
          // Spice context → ch.09
          ...SPICE_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 4. Fix AI_CH03_SMOKED_DRIED_SALTED_FISH — exclude spice context ───────────
  {
    priority: 650,
    rule: {
      id: 'AI_CH03_SMOKED_DRIED_SALTED_FISH',
      description: 'Smoked, dried, salted, cured fish → ch.03. ' +
        'Added noneOf for spice context: same issue as AI_CH02 — "dried" in ' +
        'allspice/spice descriptions (ch.09) fires allowChapters:[03]. ' +
        'Dried spices (allspice, pimenta, pepper) are ch.09, not smoked fish.',
      pattern: {
        anyOf: [
          'smoked', 'dried', 'salted', 'cured', 'kippered', 'bacalao', 'stockfish',
          'salt', 'brine', 'jerky', 'lox', 'gravlax', 'anchovies', 'anchovy',
          'herring', 'sardine', 'mackerel',
        ],
        noneOf: [
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          'parchment', 'limed', 'pickled', 'dehaired', 'pretanned', 'crusting',
          // Offal context → ch.05 (from patch JJ)
          'guts', 'bladders', 'bladder', 'stomachs', 'stomach',
          'entrails', 'offal', 'tripe', 'intestines', 'intestine',
          // Spice context → ch.09
          ...SPICE_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 5. Fix FRESH_FRUIT_INTENT — exclude "not containing" phrase context ────────
  {
    priority: 640,
    rule: {
      id: 'FRESH_FRUIT_INTENT',
      description: 'Fresh/chilled/frozen fruit → ch.08. ' +
        'Added noneOf for "not containing" phrase: "In airtight containers and not ' +
        'containing apricots citrus fruits peaches or pears" (1904.20 ch.19 cereal) ' +
        'has "fruits","peaches","pears" etc. → fires allowChapters:[08]. The fruits ' +
        'are mentioned in a NEGATIVE exclusion clause. "not containing X" means the ' +
        'product does NOT contain X — should not trigger fresh fruit intent.',
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
          'activated carbon', 'activated', 'charcoal', 'carbon black',
          'mineral products', 'fibers', 'fiber', 'material', 'materials',
          'upper', 'uppers', 'sole', 'soles', 'textile', 'textiles',
          'yarn', 'thread', 'woven', 'knitted', 'derived',
          'preserved by sugar', 'preserved', 'drained', 'glazed', 'crystallized',
          'candied', 'glace', 'in syrup', 'otherwise prepared', 'prepared or preserved',
          // Negative exclusion clause → fruits mentioned as ingredients excluded
          'not containing',
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

  // ── 6. Fix PREPARED_CANNED_MEATS_INTENT — exclude "not containing" context ─────
  {
    priority: 640,
    rule: {
      id: 'PREPARED_CANNED_MEATS_INTENT',
      description: 'Prepared/canned meats, sausages, preserved fish → ch.16. ' +
        'Added noneOf for "not containing" phrase: same query as above — ' +
        '"in airtight containers" fires allowChapters:[16], blocking ch.19 cereal. ' +
        '"not containing X" = explicit ingredient exclusion, not a meat product. ' +
        'Also keeps existing noneOf for live/fresh context.',
      pattern: {
        anyOf: [
          'airtight containers', 'airtight container',
          'sausage', 'sausages', 'frankfurter', 'frankfurters',
          'bologna', 'salami', 'mortadella', 'chorizo',
          'prepared meats', 'prepared meat', 'canned beef', 'canned meat',
          'canned pork', 'meat preparations', 'meat preparation', 'homogenized',
          'pate', 'pâté',
          'prepared or preserved fish', 'preserved fish',
          'neither cooked nor in oil', 'in airtight containers',
          'caviar', 'caviar substitutes', 'fish eggs',
          'prepared or preserved crustaceans', 'prepared crustaceans',
          'prepared or preserved molluscs',
        ],
        noneOf: [
          'live', 'carcass', 'carcasses', 'offal', 'fresh', 'chilled',
          // Negative exclusion clause → airtight container mentioned for non-meat product
          'not containing',
        ],
      },
      whitelist: { allowChapters: ['16'] },
    },
  },

  // ── 7. Fix AI_CH36_METALDEHYDE — exclude appliance/grill context ──────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH36_METALDEHYDE',
      description: 'Metaldehyde, slug pellets, firelighters, solid fuel tablets → ch.36. ' +
        'Added noneOf for appliance context: "Hibachis Other including appliances for ' +
        'solid fuel" (7321.19 ch.73 iron stoves/grills) has "solid fuel" → fires ' +
        'allowChapters:[36]. Hibachis and solid-fuel appliances are iron stoves (ch.73); ' +
        'ch.36 covers the fuel tablets/pellets themselves, not fuel-burning appliances.',
      pattern: {
        anyOf: [
          'metaldehyde', 'slug', 'snail', 'slug pellets', 'slug bait',
          'snail bait', 'bait', 'tablet', 'tablets',
          'hexamine', 'firelighter', 'firelighters', 'solid fuel',
        ],
        noneOf: [
          'fishing', 'fish', 'bamboo', 'wood', 'timber',
          'vegetable', 'animal', 'feeding', 'feed',
          'waste', 'residues', 'byproducts', 'by-products', 'fodder', 'forage',
          // Appliance/grill context → ch.73 (iron stoves) or ch.84 (other equipment)
          'hibachi', 'hibachis', 'appliance', 'appliances',
          'grill', 'grills', 'stove', 'stoves', 'barbecue', 'bbq',
          'cooking', 'range', 'ranges', 'oven', 'ovens',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 8. Fix AI_CH57_KILIM_FLATWEAVE_RUG — exclude upholstery fabric context ─────
  {
    priority: 640,
    rule: {
      id: 'AI_CH57_KILIM_FLATWEAVE_RUG',
      description: 'Kilim, dhurrie, tapestry rugs and floor coverings → ch.57. ' +
        'Added noneOf for upholstery fabric context: "Tapestry fabrics and ' +
        'upholstery fabrics of a weight not exceeding 140 g/m2" (5111.30 ch.51 ' +
        'wool fabrics) has "tapestry" → fires allowChapters:[57]. Tapestry as ' +
        'upholstery fabric is ch.51 (woven wool/animal hair fabrics), not ch.57 ' +
        '(floor coverings). "Upholstery fabric" = furniture fabric, not a rug.',
      pattern: {
        anyOf: [
          'kilim', 'kelim', 'dhurrie', 'dhurry', 'flatweave', 'soumak',
          'sumak', 'karamanie', 'schumack', 'kelem', 'tapestry', 'kilims',
        ],
        noneOf: [
          // Upholstery/woven fabric context → ch.51/ch.54/ch.55 (not floor coverings)
          'upholstery', 'upholstery fabric', 'upholstery fabrics',
          'fabric weight', 'weight not exceeding', 'g/m2',
        ],
      },
      whitelist: { allowChapters: ['57'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch SS)...`);

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
    console.log(`\nPatch SS complete: ${success} applied, ${failed} failed`);
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
