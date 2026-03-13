#!/usr/bin/env ts-node
/**
 * Patch P — 2026-03-12:
 *
 * Fix 2 remaining failure patterns:
 *
 * 1. PREPARED_FISH_SEAFOOD_HTS_INTENT: "eggs" in HTS query ("fish eggs", "caviar substitutes
 *    prepared from fish eggs") triggers ch.04 (bird eggs) via lexical match. The rule denies
 *    ch.02/03 but not ch.04, so ch.04 bird egg entries score perfectly and win.
 *    Fix: add '04' to denyChapters.
 *
 * 2. SWIMWEAR_INTENT: "swimwear" appears in garment HTS descriptions as an exclusion clause
 *    ("other than swimwear knitted or crocheted"). The intent fires because "swimwear" is a
 *    token in the query, injecting 6112 swimwear entries and restricting to ch.61/62. This
 *    causes the expected 6104 garment result to be buried under 6112 swimwear entries.
 *    Fix: add noneOf: ['other than swimwear'] so the intent doesn't fire when swimwear is
 *    used as an HTS exclusion phrase.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12p.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix PREPARED_FISH_SEAFOOD_HTS_INTENT — also deny ch.04 (bird eggs) ──
  {
    priority: 950,
    rule: {
      id: 'PREPARED_FISH_SEAFOOD_HTS_INTENT',
      description:
        'Prepared or preserved fish/seafood HTS descriptions (ch.16) — deny ch.02/03/04. ' +
        'ch.04 added because "fish eggs" / "caviar substitutes prepared from fish eggs" ' +
        'in HTS descriptions lexically matches bird egg entries (0407) in ch.04, ' +
        'causing ch.04 to win when ch.02/03 are correctly denied.',
      pattern: {
        anyOf: [
          'prepared meals',
          'in airtight containers',
          'airtight containers',
          'prepared or preserved fish',
          'neither cooked nor in oil',
          'in oil in airtight',
          'in oil',
        ],
        anyOfGroups: [[
          'fish', 'seafood', 'lobster', 'crustacean', 'crustaceans',
          'salmon', 'clam', 'clams', 'eel', 'eels', 'tuna', 'shrimp',
          'crab', 'oyster', 'oysters', 'mussel', 'mussels', 'herring',
          'anchovy', 'anchovies', 'sardine', 'sardines', 'mackerel',
          'caviar',
        ]],
        noneOf: ['fresh', 'live', 'chilled'],
      },
      inject: [
        { prefix: '1604.', syntheticRank: 15 },
        { prefix: '1605.', syntheticRank: 18 },
      ],
      whitelist: {
        denyChapters: ['02', '03', '04'],
      },
      boosts: [
        { delta: 0.65, chapterMatch: '16' },
      ],
    },
  },

  // ── 2. Fix SWIMWEAR_INTENT — don't fire for HTS exclusion "other than swimwear" ──
  {
    priority: 620,
    rule: {
      id: 'SWIMWEAR_INTENT',
      description:
        'Swimsuit/bikini/swim trunks → ch.61 (6112.xx). ' +
        'Added noneOf: ["other than swimwear"] to prevent firing when "swimwear" appears ' +
        'as an HTS exclusion clause in garment descriptions ' +
        '(e.g. "suits...other than swimwear knitted or crocheted").',
      pattern: {
        anyOf: [
          'swimsuit', 'bathing suit', 'swimwear', 'bikini', 'swim trunks',
          'tankini', 'one piece swimsuit', 'board shorts', 'swim wear',
        ],
        noneOf: [
          'other than swimwear',  // HTS exclusion clause in garment headings
        ],
      },
      inject: [{ prefix: '6112.41', syntheticRank: 22 }],
      whitelist: { allowChapters: ['61', '62'] },
      boosts: [{ delta: 0.60, prefixMatch: '6112.' }],
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch P)...`);

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
    console.log(`\nPatch P complete: ${success} applied, ${failed} failed`);
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
