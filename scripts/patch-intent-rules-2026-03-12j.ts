#!/usr/bin/env ts-node
/**
 * Patch J — 2026-03-12:
 *
 * Root-cause fixes from second failure analysis round:
 *
 * 1. Fix SNACK_CHIP_INTENT — "chips" fires allowChapters['19'] for "crystal chips",
 *    "obsidian chips" (gemstones). Add noneOf for mineral/gemstone context.
 *
 * 2. Fix AI_CH69_CERAMIC_FIGURINE — "figurine" fires allowChapters['69'] for
 *    "crystal figurine", "glass figurine". Add noneOf for glass/crystal/quartz.
 *
 * 3. Fix INDOOR_PLANT_INTENT — "plant"/"succulent" fires allowChapters['06'] for
 *    "fridge magnet planter", "stained glass plant stake", blocking ch.85/70 results.
 *    Add noneOf for magnet, stained glass, stake, glass.
 *
 * 4. Fix AI_CH65_VISOR — bare "visor"/"sunvisor" fires allowChapters['65'] for
 *    car sun visors (ch.70 mirror). Require hat/headgear context; add noneOf for automotive.
 *
 * 5. Fix AI_CH67_ARTIFICIAL_FLOWERS — "plastic" + "plant/succulent" fires allowChapters['67']
 *    for "plastic succulent fridge magnets". Add noneOf for magnet context.
 *
 * 6. Fix FRIDGE_MAGNET_INTENT — add allowChapters['85'] so OR logic competes with
 *    INDOOR_PLANT_INTENT's allowChapters['06'] for "succulent fridge magnet" queries.
 *
 * 7. Create POWER_ADAPTER_INTENT — "laptop power adapter", "wall charger", "ac adapter"
 *    → ch.85 (8504); deny ch.90 (massage/therapy apparatus).
 *
 * 8. Create PHONE_CASE_INTENT — "phone case", "custom phone case", "iphone case"
 *    → ch.42 (4202); add allowChapters['42'] to compete with any phone-related rules.
 *
 * 9. Create CRYSTAL_GEMSTONE_INTENT — "quartz crystal", "amethyst", "obsidian", "worry stone"
 *    → ch.71 (precious/semi-precious stones), deny ch.19 (food snack chips).
 *
 * 10. Create WOOD_LASER_DECOR_INTENT — wooden place cards, laser-cut names, wood ornaments,
 *     wood coasters, wooden stands → ch.44, deny ch.91 (clocks) / ch.95 (toys).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12j.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix SNACK_CHIP_INTENT — exclude gemstone/mineral context ───────────
  {
    priority: 308,
    rule: {
      id: 'SNACK_CHIP_INTENT',
      description: 'Snack chips/crisps/crackers (food) → ch.19; not gemstone chips or casino chips',
      pattern: {
        anyOf: ['chips', 'crisps', 'potato chips', 'corn chips', 'tortilla chips',
                'popcorn', 'crackers', 'cracker', 'pretzels', 'pretzel', 'rice cake', 'puffed snack'],
        noneOf: ['casino', 'poker', 'gambling',
                 // gemstone/mineral context
                 'crystal', 'gemstone', 'mineral', 'quartz', 'stone', 'obsidian',
                 'amethyst', 'opal', 'turquoise', 'jasper', 'agate', 'lapis',
                 'wood', 'wooden', 'paint', 'tile', 'glass', 'cork'],
      },
      whitelist: {
        allowChapters: ['19'],
      },
    },
  },

  // ── 2. Fix AI_CH69_CERAMIC_FIGURINE — exclude glass/crystal material ──────
  {
    priority: 309,
    rule: {
      id: 'AI_CH69_CERAMIC_FIGURINE',
      description: 'Ceramic/porcelain figurines → ch.69; not glass or crystal figurines',
      pattern: {
        anyOf: [
          'figurine', 'figurines', 'statuette', 'statuettes', 'ceramic figurine',
          'porcelain figurine', 'ceramic ornament', 'ceramic ornaments',
          'ceramic decor', 'ceramic decoration', 'ceramic sculpture', 'porcelain doll',
          'ceramic animal', 'ceramic angel', 'chinaware figurine',
        ],
        noneOf: [
          'bird bath', 'garden statue', 'wind spinner', 'planter', 'pot',
          // glass/crystal materials should go to ch.70/71
          'crystal', 'glass', 'quartz', 'obsidian', 'amethyst', 'gemstone', 'resin',
        ],
      },
      whitelist: {
        allowChapters: ['69'],
      },
    },
  },

  // ── 3. Fix INDOOR_PLANT_INTENT — exclude non-plant contexts ──────────────
  {
    priority: 310,
    rule: {
      id: 'INDOOR_PLANT_INTENT',
      description: 'Indoor plants/succulents for cultivation → ch.06; not decorative items that mention plant/stake',
      pattern: {
        anyOf: ['plant', 'plants', 'succulent', 'succulents', 'houseplant', 'houseplants',
                'bonsai', 'seedling', 'herb'],
        noneOf: [
          'factory', 'power', 'industrial', 'manufacturing',
          // prevent firing for "plant stake" (garden tool), "stained glass plant", etc.
          'stake', 'hanger', 'stained glass', 'stained',
          // prevent firing for "succulent fridge magnet" type queries
          'magnet', 'magnets', 'magnetic', 'fridge magnet',
          // prevent firing for "plant stand" (furniture) — those are ch.94
          'stand', 'shelf',
        ],
      },
      whitelist: {
        allowChapters: ['06'],
      },
    },
  },

  // ── 4. Fix AI_CH65_VISOR — require hat/headgear context ──────────────────
  {
    priority: 311,
    rule: {
      id: 'AI_CH65_VISOR',
      description: 'Hat visors and headgear visors → ch.65; not automotive sun visors (ch.70)',
      pattern: {
        anyOfGroups: [
          ['visor', 'visors', 'sunvisor'],
          ['hat', 'cap', 'headband', 'headgear', 'sport visor', 'sun hat', 'running visor'],
        ],
        noneOf: ['car', 'auto', 'automotive', 'vehicle', 'driver', 'passenger', 'windshield',
                 'mirror', 'rearview', 'toyota', 'honda', 'ford', 'chevrolet', 'bmw', 'audi'],
      },
      whitelist: {
        allowChapters: ['65'],
      },
    },
  },

  // ── 5. Fix AI_CH67_ARTIFICIAL_FLOWERS — exclude magnet context ───────────
  {
    priority: 312,
    rule: {
      id: 'AI_CH67_ARTIFICIAL_FLOWERS',
      description: 'Artificial/silk/plastic decorative flowers and foliage → ch.67; not fridge magnets',
      pattern: {
        anyOfGroups: [
          ['artificial', 'silk', 'fake', 'faux', 'synthetic', 'plastic', 'decorative'],
          ['flower', 'flowers', 'floral', 'bouquet', 'foliage', 'greenery', 'arrangement',
           'plant', 'plants', 'fruit', 'stem', 'stems', 'wreath', 'garland',
           'centerpiece', 'centerpieces'],
        ],
        noneOf: [
          'dried', 'preserved', 'real', 'fresh', 'live', 'seed',
          // magnets and fridge items should NOT trigger artificial flower classification
          'magnet', 'magnets', 'magnetic', 'fridge', 'neodymium',
        ],
      },
      whitelist: {
        allowChapters: ['67'],
      },
    },
  },

  // ── 6. Fix FRIDGE_MAGNET_INTENT — add allowChapters['85'] for OR logic ───
  {
    priority: 57,
    rule: {
      id: 'FRIDGE_MAGNET_INTENT',
      description: 'Fridge magnets / neodymium magnets → ch.85 (8505); allowChapters[85] competes with plant/flower rules',
      pattern: {
        anyOf: [
          'magnet', 'magnets', 'fridge magnet', 'fridge magnets',
          'neodymium magnet', 'neodymium', 'n52', 'n35', 'n42',
          'magnetic fridge', 'magnetic sheet', 'magnetic sticker',
          'needle minder', 'needle minders',
        ],
        noneOf: ['motor', 'speaker', 'headphone', 'earbud', 'compass', 'mri'],
      },
      inject: [
        { prefix: '8505', syntheticRank: 0 },
      ],
      whitelist: {
        allowChapters: ['85'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '85' },
      ],
    },
  },

  // ── 7. Create POWER_ADAPTER_INTENT ────────────────────────────────────────
  {
    priority: 64,
    rule: {
      id: 'POWER_ADAPTER_INTENT',
      description: 'Power adapters / laptop chargers / wall chargers → ch.85 (8504), deny ch.90 (massage apparatus)',
      pattern: {
        anyOf: [
          'power adapter', 'power adaptor', 'laptop power adapter', 'laptop charger',
          'laptop adapter', 'ac adapter', 'dc adapter', 'wall adapter', 'wall charger',
          'usb wall charger', 'usb charger', 'usb power adapter',
          'phone charger', 'charging brick', 'charging block',
          '9v 1a', '12v 1a', '5v 2a', '5v 3a', '12v 2a',
        ],
        noneOf: ['battery', 'power bank', 'solar', 'cable', 'cord'],
      },
      inject: [
        { prefix: '8504', syntheticRank: 0 },
      ],
      whitelist: {
        allowChapters: ['85'],
        denyChapters: ['90'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '85' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '90' },
      ],
    },
  },

  // ── 8. Create PHONE_CASE_INTENT ───────────────────────────────────────────
  {
    priority: 65,
    rule: {
      id: 'PHONE_CASE_INTENT',
      description: 'Phone cases / custom phone cases → ch.42 (4202); allowChapters[42]',
      pattern: {
        anyOf: [
          'phone case', 'phone cases', 'phonecase', 'phonecases',
          'iphone case', 'android case', 'mobile case', 'cell phone case',
          'custom phone case', 'custom phonecase', 'smartphone case',
          'galaxy case', 'pixel case',
        ],
        noneOf: ['screen protector', 'charger', 'cable', 'mount'],
      },
      inject: [
        { prefix: '4202', syntheticRank: 0 },
      ],
      whitelist: {
        allowChapters: ['42'],
      },
      boosts: [
        { delta: 0.60, chapterMatch: '42' },
      ],
    },
  },

  // ── 9. Create CRYSTAL_GEMSTONE_INTENT ─────────────────────────────────────
  {
    priority: 66,
    rule: {
      id: 'CRYSTAL_GEMSTONE_INTENT',
      description: 'Crystal/quartz/gemstone specimens, worry stones, tumbled stones → ch.71; deny ch.19 (food chips)',
      pattern: {
        anyOf: [
          'quartz', 'amethyst', 'obsidian', 'crystal chips', 'tumbled stone', 'tumbled stones',
          'worry stone', 'worry stones', 'crystal specimen', 'mineral specimen',
          'gemstone', 'gemstones', 'crystal sphere', 'crystal tower', 'crystal wand',
          'crystal palm stone', 'crystal pendulum', 'opal chips', 'turquoise chips',
          'jasper', 'agate', 'labradorite', 'selenite', 'fluorite', 'pyrite',
          'lapis lazuli', 'malachite', 'rose quartz', 'clear quartz', 'smoky quartz',
          'black obsidian', 'rainbow moonstone',
        ],
        noneOf: ['wine glass', 'crystal glass', 'chandelier', 'growing kit', 'oscillator',
                 'watch crystal', 'clock crystal'],
      },
      inject: [
        { prefix: '7103', syntheticRank: 0 },
        { prefix: '7104', syntheticRank: 3 },
      ],
      whitelist: {
        allowChapters: ['71'],
        denyChapters: ['19'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '71' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '19' },
        { delta: 0.70, chapterMatch: '69' },
      ],
    },
  },

  // ── 10. Create WOOD_LASER_DECOR_INTENT ────────────────────────────────────
  {
    priority: 67,
    rule: {
      id: 'WOOD_LASER_DECOR_INTENT',
      description: 'Laser-cut wood / wooden place cards / wood ornaments / wood coasters → ch.44; deny ch.91 (clocks) and ch.95 (toys)',
      pattern: {
        anyOf: [
          'wooden place card', 'wood place card', 'place card holder', 'place cards',
          'laser cut name', 'laser cut names', 'laser engraved wood', 'laser cut wood',
          'wood ornament', 'wooden ornament', 'wood coaster', 'wooden coaster',
          'wood stand', 'wooden stand', 'wood sign', 'wooden sign',
          'wood name tag', 'wood tag', 'name plate wooden', 'table name wooden',
          'basswood', 'balsa wood', 'laser wood blank', 'wood blank', 'wood blanks',
        ],
        noneOf: ['clock', 'watch', 'toy', 'game', 'puzzle', 'flooring', 'floor'],
      },
      inject: [
        { prefix: '4404', syntheticRank: 0 },
        { prefix: '4421', syntheticRank: 3 },
        { prefix: '4419', syntheticRank: 5 },
      ],
      whitelist: {
        denyChapters: ['91'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '44' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '91' },
        { delta: 0.80, chapterMatch: '95' },
        { delta: 0.70, chapterMatch: '92' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch J)...`);

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
    console.log(`\nPatch J complete: ${success} applied, ${failed} failed`);
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
