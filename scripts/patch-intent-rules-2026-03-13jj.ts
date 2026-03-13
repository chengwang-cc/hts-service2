#!/usr/bin/env ts-node
/**
 * Patch JJ — 2026-03-13:
 *
 * Fix 5 cross-chapter conflicts:
 *
 * 1. AI_CH03_ROE_CAVIAR + SEAFOOD_FISH_INTENT: "fish eggs" fires for "Fertilized
 *    fish eggs" (0511.91 — ch.05 animal products for reproduction). Fertilized fish
 *    eggs are used for hatchery/aquaculture, not food roe/caviar. Fix: add noneOf
 *    for fertilized/hatchery context.
 *
 * 2. SEAFOOD_FISH_INTENT + AI_CH02_SALTED_CURED_MEAT + AI_CH03_SMOKED_DRIED_SALTED_FISH:
 *    "fish","salted","dried","smoked" fire for "Guts bladders and stomachs of animals
 *    other than fish...salted in brine dried or smoked" (0504 — ch.05 offal/entrails).
 *    These preservation words appear in ch.05 animal product descriptions. Fix: add noneOf
 *    for guts/bladders/stomachs/entrails/offal context.
 *
 * 3. CARDBOARD_PAPER_INTENT + AI_CH47_WOODPULP + AI_CH47_COTTON_LINTERS_PULP: "paperboard",
 *    "pulp","cellulosic" fire for "Machinery for finishing paper or paperboard...for making
 *    pulp of fibrous cellulosic material" (8439 — ch.84 industrial machinery). The word
 *    "paperboard"/"pulp"/"cellulosic" describe what the machinery processes, not what the
 *    product IS. Fix: add noneOf for machinery/equipment context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13jj.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const OFFAL_NONE_OF = [
  'guts', 'bladders', 'bladder', 'stomachs', 'stomach', 'entrails', 'offal', 'tripe',
  'intestines', 'intestine',
];

const MACHINERY_NONE_OF = [
  'machinery', 'machines', 'equipment', 'apparatus', 'calender',
  'pressing', 'winding', 'drying machine',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH03_ROE_CAVIAR — exclude fertilized/hatchery context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH03_ROE_CAVIAR',
      description: 'Fish roe, caviar, fish eggs as food → ch.03. ' +
        'Added noneOf for fertilized/hatchery context: "Fertilized fish eggs" ' +
        '(0511.91 ch.05 animal products for reproduction) has "fish eggs" → fires ' +
        'allowChapters:[03]. Fertilized fish eggs are for aquaculture/hatcheries, ' +
        'not food roe/caviar.',
      pattern: {
        anyOf: [
          'roe', 'caviar', 'ikura', 'tobiko', 'masago', 'tarama', 'bottarga',
          'kazunoko', 'fish roe', 'salmon roe', 'fish eggs',
        ],
        noneOf: [
          'prepared or preserved', 'preserved fish', 'substitutes',
          'in oil', 'neither cooked', 'prepared meals', 'airtight containers',
          // Hatchery/reproduction context → ch.05
          'fertilized', 'fertile', 'hatchery', 'broodstock', 'aquaculture breeding',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 2. Fix SEAFOOD_FISH_INTENT — exclude offal + fertilized context ──────────
  {
    priority: 640,
    rule: {
      id: 'SEAFOOD_FISH_INTENT',
      description: 'Fresh/chilled/frozen seafood and fish → ch.03. ' +
        'Added noneOf for offal context: "Guts bladders and stomachs of animals other ' +
        'than fish...salted in brine dried or smoked" (0504 ch.05) has "fish" (in "other ' +
        'than fish") → fires allowChapters:[03]. Guts/bladders/stomachs of land animals ' +
        'are ch.05, not ch.03 seafood. ' +
        'Also added "fertilized" noneOf for fertilized fish eggs (ch.05).',
      pattern: {
        anyOf: [
          'salmon', 'tuna', 'shrimp', 'prawn', 'lobster', 'crab', 'seafood', 'fish',
          'fillet', 'tilapia', 'cod', 'halibut', 'catfish', 'trout', 'scallop',
          'oyster', 'clam', 'mussel', 'squid', 'octopus',
        ],
        noneOf: [
          'prepared meals', 'airtight containers', 'in oil', 'preserved fish', 'cooked',
          // Offal context → ch.05
          ...OFFAL_NONE_OF,
          // Fertilized eggs context → ch.05
          'fertilized',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 3. Fix AI_CH02_SALTED_CURED_MEAT — exclude offal context ─────────────────
  {
    priority: 650,
    rule: {
      id: 'AI_CH02_SALTED_CURED_MEAT',
      description: 'Salted, cured, smoked, dried meat → ch.02. ' +
        'Added noneOf for offal/entrails context: "Guts bladders and stomachs of ' +
        'animals other than fish...salted in brine dried or smoked" (0504 ch.05) uses ' +
        '"salted","dried","smoked" to describe preservation state of ch.05 animal products. ' +
        'Animal offal preserved by salting/drying is ch.05, not ch.02 meat.',
      pattern: {
        anyOf: [
          'salted', 'cured', 'smoked', 'dried', 'brine', 'corned',
          'pancetta', 'serrano', 'coppa', 'guanciale', 'salt', 'jerky',
        ],
        noneOf: [
          'beef jerky', 'meat jerky',
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          'parchment', 'limed', 'pickled', 'dehaired', 'pretanned', 'crusting',
          // Offal context → ch.05
          ...OFFAL_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 4. Fix AI_CH03_SMOKED_DRIED_SALTED_FISH — exclude offal context ──────────
  {
    priority: 650,
    rule: {
      id: 'AI_CH03_SMOKED_DRIED_SALTED_FISH',
      description: 'Smoked, dried, salted, cured fish → ch.03. ' +
        'Added noneOf for offal/entrails context: same issue as AI_CH02 — "salted",' +
        '"dried","smoked" appear in ch.05 animal organ/offal HTS descriptions. ' +
        'Preserved animal guts/stomachs/bladders are ch.05, not ch.03 smoked fish.',
      pattern: {
        anyOf: [
          'smoked', 'dried', 'salted', 'cured', 'kippered', 'bacalao', 'stockfish',
          'salt', 'brine', 'jerky', 'lox', 'gravlax', 'anchovies', 'anchovy',
          'herring', 'sardine', 'mackerel',
        ],
        noneOf: [
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          'parchment', 'limed', 'pickled', 'dehaired', 'pretanned', 'crusting',
          // Offal context → ch.05
          ...OFFAL_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 5. Fix CARDBOARD_PAPER_INTENT — exclude machinery context ────────────────
  {
    priority: 640,
    rule: {
      id: 'CARDBOARD_PAPER_INTENT',
      description: 'Cardboard boxes, paperboard packaging → ch.48. ' +
        'Added noneOf for machinery context: "Machinery for finishing paper or paperboard ' +
        '...for making pulp of fibrous cellulosic material" (8439 ch.84) contains "paperboard" ' +
        'as the material being processed, not as the product itself. Paper/paperboard processing ' +
        'machinery is ch.84, not ch.48.',
      pattern: {
        anyOf: [
          'cardboard', 'corrugated cardboard', 'cardboard box', 'carton', 'paperboard',
          'shipping box', 'corrugated box', 'mailer box',
        ],
        noneOf: MACHINERY_NONE_OF,
      },
      whitelist: { allowChapters: ['48'] },
    },
  },

  // ── 6. Fix AI_CH47_WOODPULP — exclude machinery context ─────────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH47_WOODPULP',
      description: 'Wood pulp, cellulose pulp for papermaking → ch.47. ' +
        'Added noneOf for machinery context: "Machinery for making pulp of fibrous ' +
        'cellulosic material" (8439 ch.84) contains "pulp" and "cellulosic" describing ' +
        'what the machine processes, not a pulp product. Paper/pulp machinery is ch.84.',
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
          // Machinery context → ch.84
          ...MACHINERY_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

  // ── 7. Fix AI_CH47_COTTON_LINTERS_PULP — exclude machinery context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH47_COTTON_LINTERS_PULP',
      description: 'Cotton linters, chemical/cellulosic pulp → ch.47. ' +
        'Added noneOf for machinery context: "fibrous cellulosic material" in paper ' +
        'machinery descriptions (8439 ch.84) triggers "cellulosic"/"fibrous" → fires ' +
        'allowChapters:[47]. Paper-making machinery is ch.84, not ch.47 pulp products.',
      pattern: {
        anyOf: [
          'linters', 'linter', 'chemical pulp', 'cotton pulp', 'fibrous', 'cellulosic',
        ],
        noneOf: [
          'jacket', 'jackets', 'coat', 'coats', 'dress', 'dresses', 'pants', 'jeans',
          'shirt', 'shirts', 'tshirt', 'tee', 'skirt', 'sweater', 'hoodie', 'blouse',
          'clothing', 'apparel', 'garment', 'bag', 'bags', 'purse', 'tote', 'wallet',
          'handbag', 'blanket', 'towel', 'sheet', 'pillow', 'quilt', 'bedding',
          // Machinery context → ch.84
          ...MACHINERY_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch JJ)...`);

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
    console.log(`\nPatch JJ complete: ${success} applied, ${failed} failed`);
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
