#!/usr/bin/env ts-node
/**
 * Patch N — 2026-03-12:
 *
 * Fix overly-broad AI-generated rules that conflict with patch-M rules, causing EMPTY results.
 *
 * Root cause: When rule A has allowChapters:['X'] and rule B has denyChapters:['X'],
 * ch.X entries get denied (B wins) but all other chapters are also denied by A → EMPTY.
 *
 * Conflicts identified:
 *
 * 1. AI_CH92_XYLOPHONE_MARIMBA: has bare "steel" and "pipes" in anyOf
 *    → fires for ANY iron/steel tube query → allowChapters:['92'] conflicts with
 *    IRON_STEEL_TUBE_PIPE_HTS_INTENT's denyChapters:['92'] → EMPTY
 *    Fix: remove "steel", "pipes", "bells", "chimes", "tubular", "tongue", "hang", "pan"
 *    (too generic); keep only specific marimba/xylophone/steelpan terms.
 *
 * 2. AI_CH92_BAGPIPES: has bare "pipes" in anyOf
 *    → fires for "tubes and pipes" in steel pipe queries → same EMPTY conflict
 *    Fix: remove bare "pipes"; keep "bagpipes", "bagpipe", "highland pipes", "uilleann", "chanter".
 *
 * 3. AI_CH91_WATCH_PARTS_DIAL: has "gear", "spring", "hand", "hands", "face", "stem", "crown"
 *    → fires for "Gear hobbers Gear cutting machines" ("gear") → allowChapters:['91'] conflicts
 *    with MARINE_PROPULSION_MACHINERY_HTS_INTENT's denyChapters:['91'] → EMPTY
 *    Fix: remove extremely generic tokens; keep watch-specific terms with "watch" context.
 *
 * 4. SEAFOOD_FISH_INTENT: has "salmon", "tuna", "lobster", etc. → allowChapters:['03']
 *    → fires for prepared fish queries ("in oil in airtight containers Salmon") → conflicts with
 *    PREPARED_FISH_SEAFOOD_HTS_INTENT's denyChapters:['03'] → EMPTY
 *    Fix: add noneOf for preparation signals so it doesn't fire when prep language is present.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12n.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH92_XYLOPHONE_MARIMBA — remove "steel", "pipes", "bells", etc. ──
  {
    priority: 600,
    rule: {
      id: 'AI_CH92_XYLOPHONE_MARIMBA',
      description: 'Xylophone / marimba / vibraphone / glockenspiel / tuned percussion → 9206.00.80. ' +
        'Removed generic tokens "steel", "pipes", "bells", "chimes", "tubular", "tongue", "hang", "pan" ' +
        'which caused false positives on iron/steel tube queries.',
      pattern: {
        anyOf: [
          'xylophone',
          'marimba',
          'vibraphone',
          'glockenspiel',
          'vibes',
          'steelpan',    // "steel pan" instrument (not steel the metal)
          'handpan',
          'carillon',
          // Multi-word phrases are safe
          'steel pan',
          'steel drum instrument',
          'tuned bells',
          'tubular bells',  // phrase — safe
          'wind chimes',    // phrase
          'bell chimes',    // phrase
        ],
      },
      whitelist: {
        allowChapters: ['92'],
      },
    },
  },

  // ── 2. Fix AI_CH92_BAGPIPES — remove bare "pipes" ─────────────────────────
  {
    priority: 600,
    rule: {
      id: 'AI_CH92_BAGPIPES',
      description: 'Bagpipes / highland pipes / uilleann pipes → 9205.90.20. ' +
        'Removed bare "pipes" and "drones" which caused false positives on steel pipe queries.',
      pattern: {
        anyOf: [
          'bagpipe',
          'bagpipes',
          'uilleann',
          'chanter',
          'highland pipes',    // phrase
          'uilleann pipes',    // phrase
          'scottish bagpipe',  // phrase
          'irish pipes',       // phrase
        ],
      },
      whitelist: {
        allowChapters: ['92'],
      },
    },
  },

  // ── 3. Fix AI_CH91_WATCH_PARTS_DIAL — remove generic tokens ───────────────
  {
    priority: 600,
    rule: {
      id: 'AI_CH91_WATCH_PARTS_DIAL',
      description: 'Watch/clock parts: dial, face, hands, movement components → 9114. ' +
        'Removed generic single-word tokens (gear, spring, hand, face, stem, crown) ' +
        'which caused false positives on gear-cutting machine queries. ' +
        'Now uses watch-specific phrases and compound terms.',
      pattern: {
        anyOf: [
          // Specific watch/clock part terms only
          'mainspring',
          'hairspring',
          'jewel',
          'jewels',
          'pinion',
          // Phrases (safe — require context)
          'watch dial',
          'clock dial',
          'watch face',
          'clock face',
          'watch hands',
          'watch movement',
          'clock movement',
          'watch crown',
          'watch stem',
          'watch spring',
          'clock spring',
          'watch gear',
          'watch jewel',
          'clock hand',
          'minute hand',
          'hour hand',
          'second hand watch',
        ],
      },
      whitelist: {
        allowChapters: ['91'],
      },
    },
  },

  // ── 4. Fix SEAFOOD_FISH_INTENT — exclude preparation-context queries ───────
  {
    priority: 600,
    rule: {
      id: 'SEAFOOD_FISH_INTENT',
      description: 'Fresh/frozen/raw fish/seafood → ch.03. ' +
        'Added noneOf for preparation signals to prevent firing on prepared/canned fish ' +
        'queries (which belong to ch.16 via PREPARED_FISH_SEAFOOD_HTS_INTENT). ' +
        'Without this, "in oil ... salmon" triggered allowChapters:[03] + denyChapters:[03] = EMPTY.',
      pattern: {
        anyOf: [
          'salmon', 'tuna', 'shrimp', 'prawn', 'lobster', 'crab', 'seafood',
          'fish', 'fillet', 'tilapia', 'cod', 'halibut', 'catfish', 'trout',
          'scallop', 'oyster', 'clam', 'mussel', 'squid', 'octopus',
        ],
        noneOf: [
          // Preparation signals → these queries belong to ch.16, not ch.03
          'prepared meals',
          'airtight containers',
          'in oil',
          'preserved fish',
          'cooked',
        ],
      },
      whitelist: {
        allowChapters: ['03'],
      },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch N)...`);

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
    console.log(`\nPatch N complete: ${success} applied, ${failed} failed`);
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
