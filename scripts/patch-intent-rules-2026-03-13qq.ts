#!/usr/bin/env ts-node
/**
 * Patch QQ — 2026-03-13:
 *
 * Fix multiple cross-chapter conflicts from eval-nnoo:
 *
 * 1. AI_CH91_POCKET_WATCH: bare "chain" fires for "chain modified polypeptides"
 *    (2937 ch.29 hormones) → allowChapters:[91] (clocks/watches). A peptide "chain"
 *    is a molecular structure, not a watch chain. Fix: remove bare "chain".
 *
 * 2. AI_CH35_STARCH_DEXTRIN: "modified" fires for "chain modified polypeptides"
 *    (ch.29 hormones). "Chain modified" = polypeptide modification (organic chemistry),
 *    not modified starch. Fix: add noneOf for hormone/polypeptide context.
 *
 * 3. AI_CH31_POTASSIUM_FERTILIZER: "potassium" fires for "Of potassium...phosphates"
 *    (2835 ch.28) and "Of potassium...silicates" (2839 ch.28). Potassium phosphates/
 *    silicates are inorganic chemicals (ch.28), not fertilizers (ch.31).
 *    Fix: add noneOf for specific inorganic chemical terms.
 *
 * 4. SUGAR_INTENT + AI_CH17_GLUCOSE_SYRUP + AI_CH17_FRUCTOSE + AI_CH17_LACTOSE_MALTOSE:
 *    Fire for "D-Arabinose Sugars chemically pure...sugar ethers sugar acetals" (2940 ch.29).
 *    HTS 2940 describes chemically pure sugars as organic chemistry compounds (ch.29), not
 *    commercial food sugars (ch.17). "Chemically pure","sugar ethers","acetals","esters"
 *    indicate organic chemistry context. Fix: add noneOf.
 *
 * 5. BANDAGE_FIRST_AID_INTENT + CEMENT_CONCRETE_INTENT: fire for "By plaster cement
 *    ceramics or glass deposit" (8485 ch.84 additive manufacturing). "Plaster/cement
 *    deposit" = 3D printing deposition process, not building materials.
 *    Fix: add noneOf for deposition/additive manufacturing context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13qq.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const ORGANIC_CHEM_NONE_OF = [
  'chemically pure', 'chemically defined', 'chemically modified',
  'ethers', 'acetals', 'esters', 'derivatives', 'synthesis',
  'structural analogues', 'analogues',
];

const DEPOSITION_NONE_OF = [
  'deposit', 'deposition', 'additive', 'layer', 'printing',
  'ceramics', 'ceramic', 'glass deposit',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH91_POCKET_WATCH — remove bare "chain" ────────────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH91_POCKET_WATCH',
      description: 'Pocket watches, fob watches, vest watches → ch.91. ' +
        'Removed bare "chain" from anyOf: "chain modified polypeptides" (2937 ch.29 hormones) ' +
        'has "chain" → fires allowChapters:[91]. A polypeptide "chain" is molecular structure, ' +
        'not a watch chain. Replaced with phrases.',
      pattern: {
        anyOf: [
          'pocket', 'fob', 'vest',
          'watch chain', 'fob chain', 'pocket watch chain',
          // bare "chain" removed — fires for "chain modified polypeptides" in ch.29 hormone descriptions
        ],
      },
      whitelist: { allowChapters: ['91'] },
    },
  },

  // ── 2. Fix AI_CH35_STARCH_DEXTRIN — add hormone/polypeptide noneOf ────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH35_STARCH_DEXTRIN',
      description: 'Modified starches, dextrins, adhesives → ch.35. ' +
        'Added noneOf for hormone/polypeptide context: "chain modified polypeptides...used ' +
        'primarily as hormones" (2937 ch.29) has "modified" → fires allowChapters:[35]. ' +
        '"Chain modified" = polypeptide modification (organic chemistry), not starch modification. ' +
        'Also keeps fats/oils noneOf from patch NN.',
      pattern: {
        anyOf: ['dextrin', 'dextrins', 'starch', 'pregelatinized', 'esterified', 'modified'],
        noneOf: [
          // Fats/oils context → ch.15
          'fats', 'oils', 'fat', 'oil', 'fatty', 'fractions',
          'microbial', 'polymerized', 'oxidized', 'sulfurized', 'blown',
          // Hormone/polypeptide context → ch.29
          'hormone', 'hormones', 'polypeptide', 'polypeptides',
          'prostaglandin', 'thromboxane', 'leukotriene',
          'synthesis', 'reproduced by synthesis', 'structural analogues',
        ],
      },
      whitelist: { allowChapters: ['35'], denyChapters: ['11', '17'] },
    },
  },

  // ── 3. Fix AI_CH31_POTASSIUM_FERTILIZER — add inorganic chemical noneOf ───────
  {
    priority: 640,
    rule: {
      id: 'AI_CH31_POTASSIUM_FERTILIZER',
      description: 'Potash, potassium fertilizers → ch.31. ' +
        'Added noneOf for inorganic chemistry context: "Of potassium...phosphates polyphosphates" ' +
        '(2835 ch.28) and "Of potassium...silicates" (2839 ch.28) have "potassium" → fires ' +
        'allowChapters:[31]. Potassium phosphates/silicates are inorganic chemicals (ch.28), ' +
        'not fertilizers (ch.31). Fertilizer context uses "potash","muriate","mop","sop".',
      pattern: {
        anyOf: ['potash', 'potassium', 'muriate', 'mop', 'sop'],
        noneOf: [
          // Inorganic chemistry context → ch.28
          'phosphate', 'phosphates', 'polyphosphate', 'polyphosphates',
          'phosphite', 'phosphites', 'phosphonate', 'phosphonates',
          'hypophosphite', 'hypophosphites', 'phosphinate',
          'silicate', 'silicates',
          'carbonate', 'carbonates', 'bicarbonate',
          'hydroxide', 'hydroxides',
          'permanganate', 'chromate', 'dichromate',
        ],
      },
      whitelist: { allowChapters: ['31'] },
    },
  },

  // ── 4. Fix SUGAR_INTENT — add organic chemistry noneOf ───────────────────────
  {
    priority: 640,
    rule: {
      id: 'SUGAR_INTENT',
      description: 'Sugar, cane sugar, beet sugar, raw sugar → ch.17. ' +
        'Added noneOf for organic chemistry context: "Sugars chemically pure...sugar ethers ' +
        'sugar acetals and sugar esters" (2940 ch.29) has "sugar" → fires allowChapters:[17]. ' +
        '"Chemically pure","acetals","ethers","esters" indicate organic chemistry (ch.29), not ' +
        'commercial food sugars (ch.17). Also keeps preserved food noneOf from patch KK.',
      pattern: {
        anyOf: [
          'sugar', 'white sugar', 'brown sugar', 'cane sugar', 'powdered sugar',
          'granulated sugar', 'raw sugar', 'caster sugar',
        ],
        noneOf: [
          // Preserved food context → ch.20 (from patch KK)
          'preserved by sugar', 'preserved', 'drained', 'glazed', 'crystallized',
          'candied', 'glace', 'in syrup',
          // Organic chemistry context → ch.29
          ...ORGANIC_CHEM_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['17'] },
    },
  },

  // ── 5. Fix AI_CH17_GLUCOSE_SYRUP — add organic chemistry noneOf ──────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH17_GLUCOSE_SYRUP',
      description: 'Glucose syrup, dextrose, corn syrup → ch.17. ' +
        'Added noneOf for organic chemistry context: "Sugars chemically pure...other than ' +
        'sucrose lactose maltose glucose and fructose" (2940 ch.29) mentions "glucose" in the ' +
        'exclusion list → fires allowChapters:[17]. Chemically pure glucose as organic ' +
        'compound is ch.29, not commercial food glucose (ch.17).',
      pattern: {
        anyOf: ['glucose', 'dextrose', 'corn syrup', 'cornsyrup', 'dextrose monohydrate'],
        noneOf: ORGANIC_CHEM_NONE_OF,
      },
      whitelist: { allowChapters: ['17'] },
    },
  },

  // ── 6. Fix AI_CH17_FRUCTOSE — add organic chemistry noneOf ───────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH17_FRUCTOSE',
      description: 'Fructose, HFCS → ch.17. ' +
        'Added noneOf for organic chemistry context: "fructose" in organic chemistry ' +
        'descriptions (2940 ch.29) triggers ch.17. Chemically pure fructose is ch.29.',
      pattern: {
        anyOf: ['fructose', 'hfcs', 'levulose', 'fruit sugar'],
        noneOf: ORGANIC_CHEM_NONE_OF,
      },
      whitelist: { allowChapters: ['17'] },
    },
  },

  // ── 7. Fix AI_CH17_LACTOSE_MALTOSE — add organic chemistry noneOf ─────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH17_LACTOSE_MALTOSE',
      description: 'Lactose, maltose, milk sugar → ch.17. ' +
        'Added noneOf for organic chemistry context: "lactose maltose" in organic chemistry ' +
        'descriptions (2940 ch.29) triggers ch.17. Chemically pure lactose/maltose is ch.29.',
      pattern: {
        anyOf: ['lactose', 'maltose', 'milk sugar', 'lactulose'],
        noneOf: ORGANIC_CHEM_NONE_OF,
      },
      whitelist: { allowChapters: ['17'] },
    },
  },

  // ── 8. Fix BANDAGE_FIRST_AID_INTENT — add deposition/additive mfg noneOf ──────
  {
    priority: 640,
    rule: {
      id: 'BANDAGE_FIRST_AID_INTENT',
      description: 'Bandages, adhesive dressings, wound plasters → ch.30. ' +
        'Added noneOf for deposition/additive manufacturing context: "By plaster cement ' +
        'ceramics or glass deposit" (8485 ch.84 additive manufacturing) has "plaster" → fires ' +
        'allowChapters:[30]. "Plaster deposit" = 3D printing process, not medical plaster.',
      pattern: {
        anyOf: [
          'bandage', 'adhesive bandage', 'wound dressing', 'plaster',
          'medical bandage', 'elastic bandage', 'gauze bandage', 'bandaid', 'band-aid',
        ],
        noneOf: [
          'gypsum', 'building', 'construction', 'board', 'ceiling', 'wall',
          'plasterboard', 'drywall',
          // Additive manufacturing/deposition context → ch.84
          ...DEPOSITION_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['30'] },
    },
  },

  // ── 9. Fix CEMENT_CONCRETE_INTENT — add deposition/additive mfg noneOf ────────
  {
    priority: 640,
    rule: {
      id: 'CEMENT_CONCRETE_INTENT',
      description: 'Cement, concrete, mortar, building materials → ch.25. ' +
        'Added noneOf for deposition/additive manufacturing context: "By plaster cement ' +
        'ceramics or glass deposit" (8485 ch.84 additive manufacturing) has "cement" → fires ' +
        'allowChapters:[25]. "Cement deposit" = 3D printing/additive process, not construction.',
      pattern: {
        anyOf: [
          'cement', 'concrete', 'mortar', 'portland cement', 'ready mix cement',
          'concrete block', 'cinder block', 'cement board',
        ],
        noneOf: [
          'mixer', 'mixers', 'vehicle', 'vehicles', 'motor vehicle', 'motor vehicles',
          'crane', 'cranes', 'truck', 'trucks', 'sweeper', 'sweepers',
          'fire fighting', 'wrecker', 'wreckers', 'radiological',
          // Additive manufacturing/deposition context → ch.84
          ...DEPOSITION_NONE_OF,
        ],
      },
      whitelist: { allowChapters: ['25'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch QQ)...`);

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
    console.log(`\nPatch QQ complete: ${success} applied, ${failed} failed`);
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
