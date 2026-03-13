#!/usr/bin/env ts-node
/**
 * Patch AA — 2026-03-13:
 *
 * Fix 10 rules and add 2 new intents:
 *
 * 1. UMBRELLA_INTENT: "umbrellas" fires for raw wood stick descriptions like
 *    "suitable for the manufacture of walking-sticks umbrellas" → allowChapters:[66]
 *    blocks ch.44. Fix: add noneOf for raw-wood/hoopwood context.
 *
 * 2. AI_CH66_WALKING_STICK: "walking" fires for same raw wood manufacture query.
 *    Fix: add noneOf for raw-wood context.
 *
 * 3. AI_CH47_WOODPULP: "coniferous"/"nonconiferous" are too generic — fire for
 *    conifer wood product queries (ch.44), not just wood pulp. Fix: replace bare
 *    "coniferous"/"nonconiferous" with phrases "coniferous pulp"/"nonconiferous pulp";
 *    add noneOf for timber/lumber context.
 *
 * 4. AI_CH51_RAW_WOOL: "wool" fires for "Subject to wool restraints" (trade quota
 *    language) → allowChapters:[51] blocks ch.62 garments. Fix: add noneOf=['restraints'].
 *
 * 5. AI_CH51_WOOL_FABRIC_GENERIC: same "wool restraints" pattern → allowChapters:[51].
 *    Fix: add noneOf=['restraints','restraint'].
 *
 * 6. FLOUR_GRAIN_INTENT: "flour" fires for "leather dust powder and flour" (leather
 *    waste byproduct, ch.41) → allowChapters:[11] blocks ch.41.
 *    Fix: add noneOf for leather/waste context.
 *
 * 7. AI_CH36_EXPLOSIVES: "powder" fires for same leather dust query → allowChapters:[36].
 *    Fix: add noneOf for leather/waste context.
 *
 * 8. NUTS_SEEDS_INTENT: "sunflower seeds","pumpkin seeds","flaxseeds","sesame seeds"
 *    are ch.12 oilseeds, not ch.08 edible nuts. Fix: remove oilseeds from anyOf.
 *    New OILSEEDS_CH12_INTENT covers them.
 *
 * 9. New OILSEEDS_CH12_INTENT: sunflower/sesame/flax/rapeseed/canola etc → ch.12.
 *
 * 10. New PREPARED_CANNED_MEATS_INTENT: "beef in airtight containers", sausages,
 *     prepared meats → ch.16. MEAT_BEEF_INTENT (ch.02) was causing this to fall
 *     through to ch.86 (transport containers) after patch T added noneOf=['airtight'].
 *
 * 11. AI_CH03_MOLLUSCS: "razor" fires for "Razor clams Siliqua patula" (a prepared
 *     mollusc, ch.16). Add noneOf for ch.16 preparation context. (Partial fix.)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13aa.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix UMBRELLA_INTENT — exclude raw-wood manufacturing context ───────────
  {
    priority: 640,
    rule: {
      id: 'UMBRELLA_INTENT',
      description: 'Umbrellas, parasols → ch.66. ' +
        'Added noneOf for raw-wood manufacturing context: "umbrellas" appears in HTS ' +
        'descriptions for raw wooden sticks "suitable for the manufacture of walking-sticks ' +
        'umbrellas tool handles" (ch.44). These are raw materials, not finished umbrellas.',
      pattern: {
        anyOf: ['umbrella', 'umbrellas', 'parasol', 'parasols'],
        noneOf: [
          'hoopwood', 'chipwood', 'poles', 'piles', 'stakes',
          'pointed', 'trimmed', 'sawn', 'manufacture of',
          'walking-sticks', 'walking sticks', 'tool handles',
        ],
      },
      whitelist: { allowChapters: ['66'] },
    },
  },

  // ── 2. Fix AI_CH66_WALKING_STICK — exclude raw-wood context ─────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH66_WALKING_STICK',
      description: 'Walking sticks, canes, whips → ch.66. ' +
        'Added noneOf for raw-wood manufacturing context: "walking" fires for ' +
        '"suitable for manufacture of walking-sticks" (raw wood stock, ch.44). ' +
        'Raw unfinished wood material for making walking sticks is ch.44, not ch.66.',
      pattern: {
        anyOf: [
          'walkingstick', 'walking stick', 'walking-stick',
          'seatstick', 'whip', 'whips', 'ridingcrop', 'riding crop',
          'swagger', 'malacca',
        ],
        noneOf: [
          'hoopwood', 'chipwood', 'poles', 'piles', 'stakes',
          'pointed', 'trimmed', 'sawn', 'manufacture of',
          'tool handles', 'wood', 'wooden',
        ],
      },
      whitelist: { allowChapters: ['66'] },
    },
  },

  // ── 3. Fix AI_CH47_WOODPULP — replace bare "coniferous"/"nonconiferous" ──────
  {
    priority: 630,
    rule: {
      id: 'AI_CH47_WOODPULP',
      description: 'Wood pulp, cellulose pulp, chemical pulp → ch.47. ' +
        'Replaced bare "coniferous"/"nonconiferous" with phrases: bare "coniferous" fires ' +
        'for "Coniferous Hoopwood..." (ch.44 wood products). Wood pulp uses "coniferous pulp" ' +
        'or appears with "kraft"/"sulfate"/"bleached" etc. ' +
        'Added noneOf for timber/lumber context.',
      pattern: {
        anyOf: [
          'pulp', 'woodpulp', 'wood pulp', 'cellulose', 'dissolving',
          'kraft', 'sulfate', 'sulfite', 'soda',
          'coniferous pulp', 'nonconiferous pulp',
          // "bleached"/"unbleached"/"semibleached" only useful with pulp context:
        ],
        noneOf: [
          'hoopwood', 'chipwood', 'poles', 'piles', 'stakes',
          'lumber', 'timber', 'sawn', 'joinery', 'carpentry',
          'plywood', 'veneer', 'boards', 'planks',
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

  // ── 4. Fix AI_CH51_RAW_WOOL — exclude trade restraints context ────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH51_RAW_WOOL',
      description: 'Raw wool, fleece, greasy wool → ch.51. ' +
        'Added noneOf for trade restraints context: "Subject to wool restraints" uses ' +
        '"wool" as a quota category label (trade law), not as a fiber. Garments ' +
        '"subject to wool restraints" are ch.62, not ch.51 raw fiber. ' +
        'Also keeps prior noneOf for mineral/slag wool and hides context.',
      pattern: {
        anyOf: ['wool', 'fleece', 'greasy', 'shorn', 'raw', 'unwashed'],
        noneOf: [
          'yarn', 'fabric', 'knit', 'woven', 'felt', 'blanket', 'sweater', 'coat', 'carpet',
          'slag', 'mineral', 'rock wool', 'slag wool', 'glass wool', 'ceramic',
          'insulation', 'insulating', 'pipe',
          // Hides/skins context → ch.41
          'hides', 'hide', 'skins', 'skin', 'leather', 'tanned', 'tanning',
          // Trade restraints context → ch.62
          'restraints', 'restraint',
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 5. Fix AI_CH51_WOOL_FABRIC_GENERIC — exclude trade restraints context ─────
  {
    priority: 630,
    rule: {
      id: 'AI_CH51_WOOL_FABRIC_GENERIC',
      description: 'Woven wool fabric, woolen cloth → ch.51. ' +
        'Added noneOf for trade restraints context: "Subject to wool restraints Of other ' +
        'textile materials Women\'s blouses" (ch.62) has "wool" + "materials" → anyOfGroups ' +
        'both fire. "Restraints" in "wool restraints" is a quota/trade term, not fiber context.',
      pattern: {
        noneOf: [
          'yarn', 'fiber', 'fibre', 'knit', 'sweater', 'coat', 'garment', 'carpet', 'blanket',
          // Trade restraints context → ch.62
          'restraints', 'restraint',
        ],
        anyOfGroups: [
          ['wool', 'merino', 'cashmere', 'mohair'],
          ['fabric', 'cloth', 'textile', 'material', 'yardage', 'woven'],
        ],
      },
      whitelist: { allowChapters: ['51'] },
    },
  },

  // ── 6. Fix FLOUR_GRAIN_INTENT — exclude leather/waste context ────────────────
  {
    priority: 630,
    rule: {
      id: 'FLOUR_GRAIN_INTENT',
      description: 'Grain flour, wheat flour, all-purpose flour → ch.11. ' +
        'Added noneOf for leather/waste context: "leather dust powder and flour" (ch.41 ' +
        'leather waste byproduct) contains "flour". Leather flour ≠ grain flour.',
      pattern: {
        anyOf: [
          'flour', 'all-purpose flour', 'wheat flour', 'bread flour',
          'cake flour', 'whole wheat flour', 'corn flour', 'rice flour',
        ],
        noneOf: [
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust', 'composition leather',
          'not suitable', 'manufacture of leather',
        ],
      },
      whitelist: { allowChapters: ['11'] },
    },
  },

  // ── 7. Fix AI_CH36_EXPLOSIVES — exclude leather/waste context ────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH36_EXPLOSIVES',
      description: 'Explosives, gunpowder, blasting agents → ch.36. ' +
        'Added noneOf for leather/waste context: "leather dust powder and flour" (ch.41) ' +
        'contains "powder". Leather dust/powder is a tanning byproduct, not an explosive. ' +
        'Keeps prior noneOf for firearm context.',
      pattern: {
        anyOf: [
          'explosives', 'explosive', 'dynamite', 'blasting', 'anfo',
          'detonating', 'detonator', 'detonators', 'propellant', 'gunpowder', 'powder',
        ],
        noneOf: [
          'firearms', 'firearm', 'pistol', 'revolver', 'revolvers',
          'rifle', 'rifles', 'shotgun', 'shotguns',
          'military weapons', 'military weapon', 'carbine', 'muzzle-loading',
          'ammunition', 'blank ammunition', 'captive-bolt', 'captive',
          // Leather/tanning byproduct context → ch.41
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust', 'composition leather',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 8. Fix NUTS_SEEDS_INTENT — remove oilseeds (ch.12), keep edible nuts ──────
  {
    priority: 630,
    rule: {
      id: 'NUTS_SEEDS_INTENT',
      description: 'Edible nuts (almonds, cashews, walnuts, peanuts) → ch.08. ' +
        'Removed oilseeds (sunflower, pumpkin, sesame, flax) which are ch.12, not ch.08. ' +
        'HTS 1206/1207 covers oilseeds; HTS 0802 covers edible nuts. ' +
        'A new OILSEEDS_CH12_INTENT covers the removed terms.',
      pattern: {
        anyOf: [
          'almonds', 'cashews', 'walnuts', 'peanuts', 'pistachios',
          'macadamia', 'hazelnuts', 'pecans', 'pine nuts', 'chestnuts',
          'brazil nuts', 'brazil nut', 'betel nuts', 'kola nuts',
        ],
      },
      whitelist: { allowChapters: ['08'] },
    },
  },

  // ── 9. New OILSEEDS_CH12_INTENT — oilseeds are ch.12 ──────────────────────────
  {
    priority: 650,
    rule: {
      id: 'OILSEEDS_CH12_INTENT',
      description: 'Oilseeds: sunflower, sesame, flax, rapeseed, canola → ch.12. ' +
        'These are oilseeds (HTS ch.12, heading 1206-1207), not edible nuts/fruits (ch.08). ' +
        'Prior NUTS_SEEDS_INTENT had "sunflower seeds" etc sending queries to ch.08.',
      pattern: {
        anyOf: [
          'sunflower seeds', 'sunflower seed', 'sunflower',
          'sesame seeds', 'sesame seed', 'sesame',
          'flaxseed', 'flaxseeds', 'linseed', 'linseeds',
          'rapeseed', 'rapeseeds', 'canola seed', 'canola seeds',
          'pumpkin seeds', 'pumpkin seed',
          'oilseed', 'oilseeds', 'oil seed', 'oil seeds',
          'soya beans', 'soybean', 'soybeans', 'soy bean',
          'mustard seed', 'mustard seeds', 'poppy seed', 'poppy seeds',
        ],
        noneOf: [
          // Food/snack context that might be ch.20 (prepared) or ch.08
          'roasted', 'salted', 'flavored', 'seasoned',
          // Oil context → ch.15
          'fixed oil', 'crude oil', 'refined oil',
        ],
      },
      whitelist: { allowChapters: ['12'] },
    },
  },

  // ── 10. New PREPARED_CANNED_MEATS_INTENT — prepared/canned meats → ch.16 ──────
  {
    priority: 660,
    rule: {
      id: 'PREPARED_CANNED_MEATS_INTENT',
      description: 'Prepared/canned meats, sausages, beef in airtight containers → ch.16. ' +
        'MEAT_BEEF_INTENT (ch.02) was blocking "beef in airtight containers" (ch.16) but patch T ' +
        'added noneOf=[airtight] which caused fallthrough to ch.86 (transport containers). ' +
        'This intent redirects to ch.16 for preserved/canned/prepared meat context.',
      pattern: {
        anyOf: [
          'airtight containers', 'airtight container',
          'sausage', 'sausages', 'frankfurter', 'frankfurters',
          'bologna', 'salami', 'mortadella', 'chorizo',
          'prepared meats', 'prepared meat',
          'canned beef', 'canned meat', 'canned pork',
          'meat preparations', 'meat preparation',
          'homogenized', 'pate', 'pâté',
        ],
        noneOf: [
          // Fresh/raw context → ch.02/03
          'live', 'carcass', 'carcasses', 'offal',
        ],
      },
      whitelist: { allowChapters: ['16'] },
    },
  },

  // ── 11. Fix AI_CH03_MOLLUSCS — exclude prepared mollusc context ────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH03_MOLLUSCS',
      description: 'Fresh/live molluscs, clams, shellfish → ch.03. ' +
        'Added noneOf for prepared/canned context: "Razor clams Siliqua patula" in ch.16 ' +
        'descriptions (prepared molluscs). Prepared/canned molluscs are ch.16, not ch.03.',
      pattern: {
        anyOf: [
          'abalone', 'conch', 'geoduck', 'snail', 'periwinkle',
          'whelk', 'nautilus', 'limpet', 'cockle', 'razor', 'shellfish',
        ],
        noneOf: [
          // Prepared/canned context → ch.16
          'airtight', 'canned', 'prepared', 'preserved', 'smoked',
          'patula', 'siliqua',
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

    console.log(`Applying ${PATCHES.length} rule patches (batch AA)...`);

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
    console.log(`\nPatch AA complete: ${success} applied, ${failed} failed`);
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
