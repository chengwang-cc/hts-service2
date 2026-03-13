#!/usr/bin/env ts-node
/**
 * Patch H — 2026-03-12:
 *
 * Fix high-impact failures from accuracy analysis:
 *
 * 1. Fix AI_CH19_SWEET_BISCUIT_COOKIE — "cookie" fires allowChapters['19'] for
 *    "cookie cutter" / "cookie stamp" queries (kitchen tools, not food).
 *    Fix: add noneOf for kitchen tool vocabulary.
 *
 * 2. COOKIE_CUTTER_INTENT — "cookie cutter" / "biscuit cutter" → ch.39 (plastic) / ch.73 (metal)
 *    deny ch.19 (food items).
 *
 * 3. SILICONE_MOLD_INTENT — extend RESIN_MOLD_INTENT: "cake mold", "silicone mold",
 *    "ice cube tray" etc. → ch.39 (plastic molds), deny ch.19 (food).
 *
 * 4. FRIDGE_MAGNET_INTENT — "fridge magnet", "neodymium magnet" → ch.85 (8505).
 *
 * 5. PET_ACCESSORY_INTENT — "dog collar", "pet collar", "dog leash" → ch.42,
 *    deny ch.71 (jewelry — "necklace" token misleads to jewelry).
 *
 * 6. DEVICE_CASE_INTENT — "iPad case", "tablet case", "tablet sleeve" → ch.42.
 *    TABLET_COMPUTER_INTENT fires allowPrefixes['8471.'] for "ipad" — adding
 *    allowChapters['42'] from this rule lets ch.42 entries pass via OR logic.
 *
 * 7. ELECTRIC_MOTOR_INTENT — "servo motor", "stepper motor", "dc motor" → ch.85 (8501).
 *    "motor" alone maps to ch.87 (cars) via semantic search.
 *
 * 8. 3D_PRINT_PLASTIC_INTENT — "3D printed", "PLA", "FDM", "PETG" → ch.39 (plastics).
 *
 * 9. ABS_PLASTIC_INTENT — "ABS blocks", "ABS rods" → ch.39, deny ch.72 (steel) / ch.70 (glass).
 *
 * 10. ACRYLIC_BLANKS_INTENT — "acrylic blanks", "acrylic acetate blank" → ch.39,
 *     deny ch.54 (man-made textiles — "acetate" triggers textile rules).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12h.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH19_SWEET_BISCUIT_COOKIE — exclude kitchen tool queries ────
  {
    priority: 305,
    rule: {
      id: 'AI_CH19_SWEET_BISCUIT_COOKIE',
      description: 'Sweet biscuits/cookies (food) → ch.19 (1905.31); not kitchen tools',
      pattern: {
        anyOf: ['cookie', 'cookies', 'biscuit', 'biscuits', 'shortbread', 'digestive', 'oreo', 'sandwich cookie', 'chocolate chip'],
        // Exclude kitchen tool / craft context — these are tools, not food
        noneOf: ['cutter', 'cutters', 'mold', 'mould', 'molds', 'moulds', 'stamp', 'stamps',
                 'plunger', 'embosser', 'tool', 'kit', 'set', 'press', 'silicone',
                 'stl', 'print', '3d', 'resin'],
      },
      whitelist: {
        allowChapters: ['19'],
      },
      boosts: [
        { delta: 0.55, prefixMatch: '1905.31' },
      ],
    },
  },

  // ── 2. COOKIE_CUTTER_INTENT ───────────────────────────────────────────────
  {
    priority: 55,
    rule: {
      id: 'COOKIE_CUTTER_INTENT',
      description: 'Cookie cutters / biscuit cutters / pastry tools → ch.39 (plastic) or ch.73 (metal), deny ch.19 (food)',
      pattern: {
        anyOf: [
          'cookie cutter', 'cookie cutters', 'biscuit cutter', 'pastry cutter',
          'fondant cutter', 'cookie stamp', 'cookie mold', 'biscuit mold',
          'pastry tool', 'fondant tool',
        ],
        noneOf: ['dough', 'flour', 'batter', 'butter'],
      },
      whitelist: {
        denyChapters: ['19'],
      },
      boosts: [
        { delta: 0.45, chapterMatch: '39' },
        { delta: 0.40, chapterMatch: '73' },
        { delta: 0.30, chapterMatch: '82' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '19' },
      ],
    },
  },

  // ── 3. SILICONE_MOLD_INTENT — extend to kitchen/cake molds ───────────────
  {
    priority: 56,
    rule: {
      id: 'SILICONE_MOLD_INTENT',
      description: 'Silicone / plastic molds for baking, candy, soap, ice → ch.39 (plastic), deny ch.19 (food)',
      pattern: {
        anyOf: [
          'silicone mold', 'silicone mould', 'cake mold', 'cake mould',
          'baking mold', 'candy mold', 'chocolate mold', 'soap mold',
          'ice cube mold', 'ice cube tray', 'ice tray', 'ice mold',
          'fondant mold', 'gummy mold', 'resin mold', 'craft mold',
          'silicone baking', 'cookie mold',
        ],
        noneOf: ['food', 'recipe', 'ingredient'],
      },
      whitelist: {
        denyChapters: ['19'],
      },
      inject: [
        { prefix: '3926', syntheticRank: 2 },
        { prefix: '3922', syntheticRank: 5 },
      ],
      boosts: [
        { delta: 0.55, chapterMatch: '39' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '19' },
      ],
    },
  },

  // ── 4. FRIDGE_MAGNET_INTENT ───────────────────────────────────────────────
  {
    priority: 57,
    rule: {
      id: 'FRIDGE_MAGNET_INTENT',
      description: 'Fridge magnets / neodymium magnets / magnetic items → ch.85 (8505)',
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
      boosts: [
        { delta: 0.55, chapterMatch: '85' },
      ],
    },
  },

  // ── 5. PET_ACCESSORY_INTENT ───────────────────────────────────────────────
  {
    priority: 58,
    rule: {
      id: 'PET_ACCESSORY_INTENT',
      description: 'Pet collars / leashes / harnesses → ch.42, deny ch.71 (jewelry), deny ch.62/61 (apparel)',
      pattern: {
        anyOf: [
          'dog collar', 'cat collar', 'pet collar', 'puppy collar',
          'dog leash', 'cat leash', 'pet leash', 'dog lead', 'pet lead',
          'dog harness', 'cat harness', 'pet harness',
          'dog necklace', 'pet necklace', 'cat necklace',
          'dog tag', 'pet tag', 'dog id tag',
        ],
        noneOf: ['food', 'treat', 'toy', 'costume'],
      },
      whitelist: {
        denyChapters: ['71'],
      },
      inject: [
        { prefix: '4201', syntheticRank: 0 },
      ],
      boosts: [
        { delta: 0.60, chapterMatch: '42' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '71' },
        { delta: 0.70, chapterMatch: '61' },
        { delta: 0.70, chapterMatch: '62' },
      ],
    },
  },

  // ── 6. DEVICE_CASE_INTENT — allow ch.42 alongside TABLET_COMPUTER_INTENT ─
  {
    priority: 59,
    rule: {
      id: 'DEVICE_CASE_INTENT',
      description: 'iPad/tablet/laptop cases → ch.42 (4202); adds allowChapters[42] via OR logic alongside TABLET_COMPUTER_INTENT allowPrefixes[8471]',
      pattern: {
        anyOfGroups: [
          ['ipad', 'tablet', 'kindle', 'e-reader', 'ereader', 'surface', 'ipad case', 'tablet case'],
          ['case', 'cases', 'sleeve', 'sleeves', 'cover', 'covers', 'folio', 'pouch', 'bag', 'holder'],
        ],
        noneOf: ['screen protector', 'charger', 'cable', 'stand', 'keyboard', 'stylus'],
      },
      whitelist: {
        allowChapters: ['42'],
      },
      inject: [
        { prefix: '4202', syntheticRank: 0 },
      ],
      boosts: [
        { delta: 0.60, chapterMatch: '42' },
      ],
    },
  },

  // ── 7. ELECTRIC_MOTOR_INTENT ──────────────────────────────────────────────
  {
    priority: 60,
    rule: {
      id: 'ELECTRIC_MOTOR_INTENT',
      description: 'Electric motors / servo / stepper motors → ch.85 (8501), deny ch.87 (vehicles)',
      pattern: {
        anyOf: [
          'electric motor', 'servo motor', 'stepper motor', 'brushless motor',
          'dc motor', 'ac motor', 'gear motor', 'gearbox motor', 'motor controller',
          'motor driver', 'bldc motor', 'nema motor', 'nema 17', 'nema 23',
          'rotisserie motor', 'bbq motor',
        ],
        noneOf: ['car', 'vehicle', 'engine', 'motorcycle', 'truck', 'boat', 'aircraft'],
      },
      inject: [
        { prefix: '8501', syntheticRank: 0 },
      ],
      boosts: [
        { delta: 0.55, chapterMatch: '85' },
      ],
      penalties: [
        { delta: 0.90, chapterMatch: '87' },
      ],
    },
  },

  // ── 8. 3D_PRINT_PLASTIC_INTENT ────────────────────────────────────────────
  {
    priority: 61,
    rule: {
      id: '3D_PRINT_PLASTIC_INTENT',
      description: '3D printed items / PLA / PETG / resin prints → ch.39 (plastics)',
      pattern: {
        anyOf: [
          '3d printed', '3d print', '3d printing', '3d-printed',
          'pla', 'pla filament', 'petg', 'petg filament', 'fdm',
          'abs filament', 'resin print', 'resin printed', 'resin cast',
          'vat cover', 'resin tank',
        ],
        noneOf: ['printer', 'filament spool', 'sla printer', 'fdm printer'],
      },
      boosts: [
        { delta: 0.50, chapterMatch: '39' },
      ],
      penalties: [
        { delta: 0.70, chapterMatch: '44' },
        { delta: 0.70, chapterMatch: '73' },
        { delta: 0.70, chapterMatch: '72' },
      ],
    },
  },

  // ── 9. ABS_PLASTIC_INTENT ─────────────────────────────────────────────────
  {
    priority: 62,
    rule: {
      id: 'ABS_PLASTIC_INTENT',
      description: 'ABS plastic blocks/rods/sheets → ch.39, deny ch.72 (steel) / ch.70 (glass)',
      pattern: {
        anyOfGroups: [
          ['abs', 'abs plastic', 'abs resin', 'abs sheet', 'abs rod', 'abs block', 'abs plate'],
          ['block', 'blocks', 'rod', 'rods', 'sheet', 'sheets', 'bar', 'bars',
           'tube', 'tubes', 'panel', 'panels', 'plate', 'plates', 'plastic'],
        ],
        noneOf: ['brakes', 'anti-lock', 'brake system', 'sensor', 'car'],
      },
      inject: [
        { prefix: '3903', syntheticRank: 0 },
        { prefix: '3921', syntheticRank: 3 },
      ],
      boosts: [
        { delta: 0.55, chapterMatch: '39' },
      ],
      penalties: [
        { delta: 0.90, chapterMatch: '72' },
        { delta: 0.90, chapterMatch: '70' },
        { delta: 0.70, chapterMatch: '73' },
      ],
    },
  },

  // ── 10. ACRYLIC_BLANKS_INTENT ─────────────────────────────────────────────
  {
    priority: 63,
    rule: {
      id: 'ACRYLIC_BLANKS_INTENT',
      description: 'Acrylic blanks / acrylic acetate craft blanks → ch.39 (plastics), deny ch.54 (textiles)',
      pattern: {
        anyOf: [
          'acrylic blank', 'acrylic blanks', 'acrylic acetate blank', 'acrylic acetate',
          'acrylic sheet', 'acrylic sheets', 'acrylic panel', 'acrylic plate',
          'acrylic rod', 'acrylic rods', 'acrylic tube', 'acrylic block',
          'pmma', 'perspex', 'plexiglass', 'plexiglas',
        ],
        noneOf: ['keychain', 'charm', 'paint', 'nail'],
      },
      whitelist: {
        denyChapters: ['54'],
      },
      inject: [
        { prefix: '3906', syntheticRank: 0 },
        { prefix: '3920', syntheticRank: 3 },
        { prefix: '3921', syntheticRank: 5 },
      ],
      boosts: [
        { delta: 0.55, chapterMatch: '39' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '54' },
        { delta: 0.70, chapterMatch: '55' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch H)...`);

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
    console.log(`\nPatch H complete: ${success} applied, ${failed} failed`);
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
