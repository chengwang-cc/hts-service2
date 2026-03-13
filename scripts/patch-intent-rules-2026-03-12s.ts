#!/usr/bin/env ts-node
/**
 * Patch S — 2026-03-12:
 *
 * Fix meat/animal intent rules firing for leather/hide/tanning HTS descriptions,
 * and poultry/whistle rules firing for cotton "duck weave" fabric descriptions.
 *
 * 1. MEAT_BEEF_INTENT: "bovine" in anyOf fires for leather queries like
 *    "parchment-dressed leather of bovine including buffalo" → allowChapters:[02]
 *    blocks ch.41 (leather). Fix: add noneOf for leather/tanning context.
 *
 * 2. AI_CH02_HORSE_MEAT: "equine" in anyOf fires for "of equine animals... hides"
 *    → allowChapters:[02] blocks ch.41. Fix: add noneOf for leather context.
 *
 * 3. AI_CH02_GAME_EXOTIC: "buffalo" in anyOf fires for "leather of bovine including
 *    buffalo" → allowChapters:[02]. Fix: add noneOf for leather/tanning context.
 *
 * 4. AI_CH03_MAHI_SNAPPER_GROUPER: "sole" in anyOf fires for "upper leather SOLE leather"
 *    (sole leather = thick leather for shoe soles) → allowChapters:[03]. Fix: remove "sole"
 *    (too generic as single word) — use "sole fillet" or similar phrase instead. Also add
 *    noneOf for leather/tanning to catch any remaining overlap.
 *
 * 5. AI_CH67_HUMAN_HAIR_PREPARED: anyOfGroups requires "hair" + (processed/prepared/etc).
 *    Fires for "leather... without hair on... prepared after tanning" because tokens "hair"
 *    and "prepared" both appear. Fix: add noneOf=['leather','tanning','without hair',
 *    'hair on','hide','hides'].
 *
 * 6. MEAT_POULTRY_INTENT: "duck" in anyOf fires for "Duck except plain weave... Woven
 *    fabrics of cotton" (duck = heavy woven cotton fabric in textile HTS descriptions).
 *    Fix: add noneOf for weave/fabric context.
 *
 * 7. AI_CH92_WHISTLE_DECOY: "duck" in anyOf fires for same duck weave query →
 *    allowChapters:[92]. Fix: add noneOf for weave/fabric context.
 *
 * 8. AI_CH67_WIGS_HAIRPIECES: "weave"/"weaves" in anyOf fires for "plain weave" in
 *    cotton woven fabric query → allowChapters:[67] blocks ch.52. Fix: add noneOf for
 *    fabric/weaving context so "weave" only matches hair weave context.
 *
 * Also add NEW rule LEATHER_HIDES_INTENT to positively route leather queries to ch.41/43
 * and deny ch.02/03 when leather/tanning context is clearly present.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12s.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const LEATHER_NONE_OF = [
  'leather', 'tanning', 'tanned', 'parchment', 'crusting', 'hide', 'hides',
  'tannery', 'tanner', 'chamois', 'suede', 'nubuck',
];

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. MEAT_BEEF_INTENT — exclude leather/tanning context ────────────────────
  {
    priority: 640,
    rule: {
      id: 'MEAT_BEEF_INTENT',
      description: 'Beef, steak, brisket, sirloin, bovine meat → ch.02. ' +
        'Added noneOf for leather/tanning context: "bovine" appears in HTS leather ' +
        'descriptions (ch.41) like "leather of bovine including buffalo".',
      pattern: {
        anyOf: ['beef', 'steak', 'brisket', 'sirloin', 'bovine', 'ground beef'],
        noneOf: LEATHER_NONE_OF,
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 2. AI_CH02_HORSE_MEAT — exclude leather context ──────────────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH02_HORSE_MEAT',
      description: 'Horse meat, mule, donkey, equine meat → ch.02. ' +
        'Added noneOf for leather context: "equine" appears in HTS leather descriptions ' +
        '(ch.41) like "of equine animals... hides and skins".',
      pattern: {
        anyOf: ['horse', 'horsemeat', 'mule', 'donkey', 'equine', 'ass'],
        noneOf: LEATHER_NONE_OF,
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 3. AI_CH02_GAME_EXOTIC — exclude leather context ─────────────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH02_GAME_EXOTIC',
      description: 'Game and exotic meat (rabbit, venison, bison, buffalo...) → ch.02. ' +
        'Added noneOf for leather context: "buffalo" appears in leather descriptions ' +
        '(ch.41) like "leather of bovine including buffalo".',
      pattern: {
        anyOf: [
          'rabbit', 'hare', 'venison', 'deer', 'bison', 'buffalo',
          'quail', 'frog', 'reptile', 'snake', 'turtle', 'camel',
          'alpaca', 'llama', 'ostrich', 'emu',
        ],
        noneOf: LEATHER_NONE_OF,
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 4. AI_CH03_MAHI_SNAPPER_GROUPER — remove "sole", add leather noneOf ──────
  {
    priority: 630,
    rule: {
      id: 'AI_CH03_MAHI_SNAPPER_GROUPER',
      description: 'Ocean fish (mahi, snapper, grouper, bass, shark...) → ch.03. ' +
        'Removed bare "sole" (fires for "sole leather" in ch.41 leather descriptions). ' +
        'Added noneOf for leather/tanning context.',
      pattern: {
        anyOf: [
          'mahi', 'dolphinfish', 'snapper', 'grouper', 'monkfish', 'swordfish',
          'bass', 'shark', 'ray', 'skate', 'pollock', 'haddock', 'mackerel',
          'sardine', 'pilchard', 'herring', 'anchovy', 'flounder',
          // "sole" removed — too generic (sole leather = thick leather for shoe soles)
          'dover sole',   // use phrase instead
          'lemon sole',   // use phrase instead
          'plaice', 'turbot', 'perch', 'pike', 'eel', 'mullet', 'sturgeon',
          'sprat', 'capelin', 'smelt', 'whiting', 'lingcod', 'sablefish', 'butterfish',
        ],
        noneOf: LEATHER_NONE_OF,
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 5. AI_CH67_HUMAN_HAIR_PREPARED — exclude leather/tanning context ─────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH67_HUMAN_HAIR_PREPARED',
      description: 'Human hair prepared/dressed/worked → ch.67. ' +
        'Added noneOf for leather context: "hair" + "prepared" both appear in HTS leather ' +
        'descriptions like "leather... without hair on... prepared after tanning".',
      pattern: {
        anyOfGroups: [
          ['human', 'raw', 'bulk', 'processed', 'prepared', 'dressed', 'thinned', 'bleached', 'worked'],
          ['hair'],
        ],
        noneOf: [
          'wig', 'extension', 'weave', 'lace', 'shampoo', 'conditioner',
          'color', 'dye', 'accessory',
          // Leather context — "without hair on" = hide preparation, not human hair
          'leather', 'tanning', 'tanned', 'hide', 'hides', 'parchment',
          'without hair', 'hair on',
        ],
      },
      whitelist: { allowChapters: ['67'] },
    },
  },

  // ── 6. MEAT_POULTRY_INTENT — exclude weave/fabric context ────────────────────
  {
    priority: 640,
    rule: {
      id: 'MEAT_POULTRY_INTENT',
      description: 'Chicken, turkey, poultry, duck, goose meat → ch.02. ' +
        'Added noneOf for fabric/weave context: "duck" is also a heavy woven cotton fabric ' +
        'used in HTS ch.52 descriptions (e.g. "Duck except plain weave... Woven fabrics of ' +
        'cotton"). Also excludes machinery context (from prior patch Q).',
      pattern: {
        anyOf: ['chicken', 'turkey', 'poultry', 'broiler', 'fowl', 'duck', 'goose'],
        noneOf: [
          // Machinery context (from patch Q)
          'machinery', 'machine', 'machines', 'incubator', 'incubators',
          'brooder', 'brooders', 'keeping', 'equipment',
          // Fabric/weave context — "duck" = heavy woven cotton fabric
          'weave', 'woven', 'fabric', 'fabrics', 'plain weave', 'cloth', 'textile',
          'twill', 'yarn', 'thread',
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 7. AI_CH92_WHISTLE_DECOY — exclude weave/fabric context ─────────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH92_WHISTLE_DECOY',
      description: 'Whistles, birdcalls, duck/turkey/elk calls, game decoys → ch.92. ' +
        'Added noneOf for fabric/weave context: "duck" also appears in cotton fabric HTS ' +
        'descriptions (duck weave). Removed bare "bird" (too generic).',
      pattern: {
        anyOf: [
          'whistle', 'whistles', 'birdcall', 'bird call', 'duck call',
          'turkey call', 'elk call', 'deer call', 'predator call',
          'decoy', 'game call',
          // Kept "duck" and "turkey" but protected by noneOf below
          'duck', 'turkey', 'elk', 'deer',
        ],
        noneOf: [
          // Fabric/weave context
          'weave', 'woven', 'fabric', 'fabrics', 'plain weave', 'cloth', 'textile',
          'yarn', 'thread',
          // Meat context (duck meat = poultry ch.02, not ch.92)
          'meat', 'poultry', 'frozen', 'fresh', 'chilled', 'cooked',
        ],
      },
      whitelist: { allowChapters: ['92'] },
    },
  },

  // ── 8. AI_CH67_WIGS_HAIRPIECES — exclude plain weave/woven fabric context ────
  {
    priority: 630,
    rule: {
      id: 'AI_CH67_WIGS_HAIRPIECES',
      description: 'Wigs, hairpieces, toupees, hair weaves, extensions → ch.67. ' +
        'Added noneOf for woven fabric context: "weave"/"weaves" in anyOf fires for ' +
        '"plain weave" in cotton/synthetic woven fabric HTS descriptions (ch.52/54). ' +
        '"weave" in ch.67 context means hair weave (sewn-in extensions).',
      pattern: {
        anyOf: [
          'wig', 'wigs', 'hairpiece', 'hairpieces', 'toupee', 'toupees',
          'hairnet', 'hairnets', 'extension', 'extensions', 'ponytail',
          'switch', 'switches', 'postiche',
          'weave', 'weaves',  // hair weave/sew-in
          'topper', 'toppers', 'lace front', 'full lace', 'half wig', 'u part',
        ],
        noneOf: [
          // Woven fabric context — "plain weave", "woven fabrics"
          'plain weave', 'woven fabric', 'woven fabrics',
          'cotton', 'polyester', 'nylon', 'silk', 'linen',
          'yarn', 'thread', 'textile', 'fabrics',
          'selvage', 'selvages', 'warp', 'filling',
        ],
      },
      whitelist: { allowChapters: ['67'] },
    },
  },

  // ── NEW: LEATHER_HIDES_INTENT — positive route for leather/hide queries ──────
  {
    priority: 660,
    rule: {
      id: 'LEATHER_HIDES_INTENT',
      description: 'Leather, hides, skins, tanning → ch.41/43. ' +
        'Created to prevent meat intent rules (ch.02) from firing when animal terms ' +
        '(bovine, equine, buffalo) appear in leather HTS descriptions. ' +
        'Denies ch.02 (meat) and ch.03 (fish) when leather/tanning vocabulary is present. ' +
        'noneOf for footwear prevents conflict with ch.64.',
      pattern: {
        anyOf: [
          'leather', 'tanning', 'tanned', 'parchment', 'crusting',
          'hide', 'hides', 'grain split', 'grain splits',
          'upper leather', 'sole leather', 'lining leather',
          'pretanned', 'not pretanned',
          'chamois', 'suede', 'nubuck',
        ],
        noneOf: [
          // Footwear noneOf — ch.64 queries mention leather but target footwear
          'shoe', 'shoes', 'boot', 'boots', 'footwear', 'sandal', 'sandals',
          'slipper', 'slippers', 'moccasin',
          // Upholstery/furniture
          'upholstered', 'sofa', 'chair', 'furniture',
        ],
      },
      whitelist: {
        denyChapters: ['02', '03'],
      },
      boosts: [
        { delta: 0.50, chapterMatch: '41' },
        { delta: 0.30, chapterMatch: '43' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch S)...`);

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
    console.log(`\nPatch S complete: ${success} applied, ${failed} failed`);
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
