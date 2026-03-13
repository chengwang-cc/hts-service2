#!/usr/bin/env ts-node
/**
 * Patch M — 2026-03-12:
 *
 * Fix 4 systematic failure patterns identified via full 700-record accuracy eval:
 *
 * 1. IRON_STEEL_TUBE_PIPE_HTS_INTENT (+7 expected):
 *    Iron/steel tube/pipe HTS descriptions going to ch.92 (musical instruments).
 *    Root cause: "tube" in HTS text matches organ/wind instrument pipes in ch.92 embeddings.
 *    Fix: deny ch.92 when query contains HTS tube/pipe terminology.
 *
 * 2. MARINE_PROPULSION_MACHINERY_HTS_INTENT (+5 expected):
 *    Machinery queries ("marine propulsion engines", "gear hobbers", "honing machines")
 *    going to ch.91 (clocks). Root cause: "gear" matches clockwork gears; "marine"
 *    matches marine chronometer.
 *    Fix: deny ch.91 when machining/propulsion vocabulary appears.
 *
 * 3. PREPARED_FISH_SEAFOOD_HTS_INTENT (+4 expected):
 *    Prepared/canned fish HTS descriptions going to ch.02/03 (raw meat/fish).
 *    Root cause: "lobster", "salmon", "clams" match raw fish chapters strongly.
 *    Fix: detect preparation signals ("prepared meals", "airtight containers",
 *    "prepared or preserved fish", "neither cooked nor in oil") → inject ch.16,
 *    deny ch.02/03.
 *
 * 4. KNITTED_CROCHETED_HTS_INTENT (+4 expected):
 *    Clothing HTS descriptions with "knitted or crocheted" going to ch.62 (woven).
 *    Root cause: garment vocabulary (suits, trousers, shirts) matches both ch.61/62;
 *    "knitted or crocheted" phrase not boosting ch.61 strongly enough.
 *    Fix: when "knitted or crocheted" is in query, boost ch.61 and deny ch.62.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12m.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Iron/steel tubes & pipes — deny ch.92 (musical instrument pipes) ──
  {
    priority: 950,
    rule: {
      id: 'IRON_STEEL_TUBE_PIPE_HTS_INTENT',
      description:
        'Iron/steel tubes, pipes and hollow profiles (HTS ch.72/73) — deny ch.92. ' +
        'Fires on formal HTS description language: "tubes and pipes", "nonalloy steel", ' +
        '"wall thickness", "circular cross section". Prevents steel pipe descriptions ' +
        'from matching ch.92 musical instrument pipes via embedding confusion.',
      pattern: {
        anyOf: [
          // Multi-word phrases (queryLower.includes match)
          'tubes and pipes',
          'nonalloy steel',
          'wall thickness',
          'circular cross section',
          'longitudinally welded',
          'seamless tubes',
          'stainless steel welded',
          // Single tokens (tokenSet match)
          'nonalloy',
        ],
        // Prevent firing for actual musical instrument queries
        noneOf: ['organ', 'flute', 'clarinet', 'oboe', 'bassoon', 'bagpipe', 'harmonica'],
      },
      whitelist: {
        denyChapters: ['92'],
      },
      boosts: [
        { delta: 0.45, chapterMatch: '73' },
        { delta: 0.35, chapterMatch: '72' },
      ],
    },
  },

  // ── 2. Marine propulsion / machine-tool HTS descriptions — deny ch.91 ────
  {
    priority: 950,
    rule: {
      id: 'MARINE_PROPULSION_MACHINERY_HTS_INTENT',
      description:
        'Marine propulsion engines (8409) and machine tools (8460/8461) HTS descriptions ' +
        '— deny ch.91 (clocks/watches). Root cause: "marine" matches marine chronometer; ' +
        '"gear" matches clockwork gears; "honing/lapping" have no obvious ch.91 exclude. ' +
        'Fires on propulsion/machining vocabulary.',
      pattern: {
        anyOf: [
          // Propulsion/engine vocabulary
          'marine propulsion',
          'propulsion engines',
          // Machine tool vocabulary
          'honing',
          'lapping',
          'gear hobber',
          'gear hobbers',
          'hobbing',
          'gear cutting',
          'gear-cutting',
          // Single tokens
          'hobber',
          'hobbers',
        ],
        noneOf: ['clock', 'watch', 'chronometer'],
      },
      inject: [
        { prefix: '8409.', syntheticRank: 20 },  // Parts for engines
        { prefix: '8460.', syntheticRank: 25 },  // Deburring/honing/lapping machines
        { prefix: '8461.', syntheticRank: 28 },  // Gear-cutting/hobbing machines
      ],
      whitelist: {
        denyChapters: ['91'],
      },
      boosts: [
        { delta: 0.60, chapterMatch: '84' },
      ],
    },
  },

  // ── 3. Prepared/canned fish & seafood — deny ch.02/03, boost ch.16 ───────
  {
    priority: 950,
    rule: {
      id: 'PREPARED_FISH_SEAFOOD_HTS_INTENT',
      description:
        'Prepared or preserved fish/seafood HTS descriptions (ch.16) — deny ch.02/03. ' +
        'Detects formal HTS preparation signals: "prepared meals", "in airtight containers", ' +
        '"prepared or preserved fish", "neither cooked nor in oil". Without this rule, ' +
        'seafood words (lobster, salmon, clams) match raw fish/meat in ch.02/03.',
      pattern: {
        // Must have a preparation signal phrase
        anyOf: [
          'prepared meals',
          'in airtight containers',
          'airtight containers',
          'prepared or preserved fish',
          'neither cooked nor in oil',
          'in oil in airtight',
          'in oil',
        ],
        // AND must have a fish/seafood word (prevents firing on non-seafood "in oil" queries)
        anyOfGroups: [[
          'fish', 'seafood', 'lobster', 'crustacean', 'crustaceans',
          'salmon', 'clam', 'clams', 'eel', 'eels', 'tuna', 'shrimp',
          'crab', 'oyster', 'oysters', 'mussel', 'mussels', 'herring',
          'anchovy', 'anchovies', 'sardine', 'sardines', 'mackerel',
        ]],
        noneOf: ['fresh', 'live', 'chilled'],
      },
      inject: [
        { prefix: '1604.', syntheticRank: 18 },  // Prepared/preserved fish
        { prefix: '1605.', syntheticRank: 20 },  // Prepared/preserved crustaceans/molluscs
      ],
      whitelist: {
        denyChapters: ['02', '03'],
      },
      boosts: [
        { delta: 0.65, chapterMatch: '16' },
      ],
    },
  },

  // ── 4. "Knitted or crocheted" phrase — boost ch.61, deny ch.62 ───────────
  {
    priority: 950,
    rule: {
      id: 'KNITTED_CROCHETED_HTS_INTENT',
      description:
        'HTS descriptions containing "knitted or crocheted" belong to ch.61. ' +
        'Garment vocabulary (suits, trousers, shirts) also appears in ch.62 (woven), ' +
        'so the phrase alone is the decisive discriminator. ' +
        'Deny ch.62 and strongly boost ch.61 when this phrase appears.',
      pattern: {
        anyOf: [
          'knitted or crocheted',
          'crocheted',
        ],
        // Ensure it's a garment context, not craft supplies
        anyOfGroups: [[
          'suits', 'suit', 'trousers', 'shorts', 'shirts', 'shirt',
          'jackets', 'jacket', 'dresses', 'dress', 'skirts', 'skirt',
          'garments', 'garment', 'jerseys', 'jersey', 'blouses', 'blouse',
          'ensembles', 'outerwear', 'underwear', 'hosiery', 'socks',
          'swimwear', 'overalls', 'bib', 'breeches',
        ]],
        noneOf: ['crochet hook', 'crochet needle', 'knitting needle', 'yarn'],
      },
      whitelist: {
        denyChapters: ['62'],
      },
      boosts: [
        { delta: 0.70, chapterMatch: '61' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch M)...`);

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
    console.log(`\nPatch M complete: ${success} applied, ${failed} failed`);
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
