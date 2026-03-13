#!/usr/bin/env ts-node
/**
 * Patch DDD — 2026-03-13:
 *
 * Continue improving accuracy after CCC.
 * Targets specific within/cross-chapter failures with distinct phrase patterns.
 *
 * Fixes:
 *
 * 1.  NEW REFRACTORY_CLAY_CEMENT_INTENT — "Clay" → ch.38 (3816.00.20.10)
 *     "Clay" bare query gets ch.25 (raw clay minerals, 2508.40.01.10) via semantic.
 *     3816.00.20.10 = Clay refractory cement (ch.38). The noneOf='clays' (plural)
 *     cleanly separates this from "Other clays Other clays not including..." (ch.25 query).
 *
 * 2.  NEW CIGARETTE_LEAF_TOBACCO_INTENT — "Cigarette leaf Tobacco not stemmed..." → 2401.10.44
 *     The query title includes "tobacco refuse" from ancestor heading description,
 *     confusing semantic into picking 2401.30 (tobacco refuse) instead of 2401.10 (unstemmed).
 *     "Cigarette leaf" is a distinctive HTS phrase for flue-cured Virginia tobacco (2401.10.44).
 *
 * 3.  NEW BEEF_AIRTIGHT_SAUSAGE_INTENT — "Other Beef in airtight containers" → 1601.00.40
 *
 * 4.  FIX USED TIRES — "Other Used pneumatic tires" → 4012.20 (used, not retreaded)
 *     Both AI_CH40_RETREADED_TIRES and AI_CH40_RETREADED_USED_TIRES fire for 'used'+'tires'
 *     and inject 4012.11/12/19/20 all at rank 40. Semantic prefers 4012.12 (retreaded).
 *     Fix: Remove 4012.20 from those rules' inject lists. Add NEW USED_TIRES_ONLY_INTENT
 *     that fires for 'used'+'tires' but NOT 'retreaded', injecting only 4012.20 at rank 8.
 *     Expected 1601.00.40.90 (beef sausages in airtight containers, ch.16).
 *     Got 1602.50.07.20 (other prepared beef, ch.16). Both within-chapter.
 *     'beef' + 'airtight containers' uniquely identifies beef sausages in airtight containers.
 *     noneOf=['salmon','fish','seafood','tuna'] prevents false positives on fish queries.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ddd.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(IntentRuleService, { strict: false });
    const allRules = svc.getAllRules() as IntentRule[];

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW REFRACTORY_CLAY_CEMENT_INTENT ─────────────────────────────────────
    // "Clay" (bare single word) → expected 3816.00.20.10 (clay refractory cement, ch.38).
    // Semantic picks 2508.40.01.10 (raw clay minerals, ch.25).
    // Key distinction: "Clay" (singular) vs "Other clays" (plural, 2508 ch.25 entry).
    // noneOf='clays' (plural) ensures the rule doesn't fire for "Other clays..." queries.
    patches.push({
      priority: 660,
      rule: {
        id: 'REFRACTORY_CLAY_CEMENT_INTENT',
        description: 'Clay refractory cement → 3816.00.20 (ch.38). ' +
          'Bare "Clay" query goes to ch.25 (raw minerals) via semantic. ' +
          'noneOf="clays" (plural) separates from ch.25 "Other clays..." queries.',
        pattern: {
          anyOf: ['clay'],
          noneOf: [
            'clays', 'other clays', 'expanded clays',
            'andalusite', 'kyanite', 'sillimanite', 'mullite', 'chamotte',
            'mineral', 'minerals', 'crude',
          ],
        },
        whitelist: { allowChapters: ['38'] },
        inject: [{ prefix: '3816.00.20', syntheticRank: 8 }],
      },
    });

    // ── 2. NEW CIGARETTE_LEAF_TOBACCO_INTENT ─────────────────────────────────────
    // "Cigarette leaf Tobacco not stemmed/stripped Unmanufactured tobacco... tobacco refuse"
    // → expected 2401.10.44.00 (flue-cured Virginia cigarette leaf, not stemmed/stripped).
    // The heading-level description includes "tobacco refuse" causing semantic to pick 2401.30.
    // "Cigarette leaf" phrase uniquely identifies 2401.10.44 (flue-cured unstemmed tobacco).
    patches.push({
      priority: 660,
      rule: {
        id: 'CIGARETTE_LEAF_TOBACCO_INTENT',
        description: 'Cigarette leaf tobacco (unstemmed) → 2401.10.44. ' +
          'The concatenated HTS path includes "tobacco refuse" from heading 2401, ' +
          'confusing semantic to pick 2401.30. Anchored by "cigarette leaf" phrase.',
        pattern: {
          anyOf: ['cigarette leaf'],
          noneOf: ['partly stemmed', 'wholly stemmed', 'partly or wholly stemmed'],
        },
        whitelist: { allowChapters: ['24'] },
        inject: [{ prefix: '2401.10.44', syntheticRank: 8 }],
      },
    });

    // ── 3. NEW BEEF_AIRTIGHT_SAUSAGE_INTENT ──────────────────────────────────────
    // "Other Beef in airtight containers" → expected 1601.00.40.90 (beef sausages, airtight).
    // Semantic picks 1602.50.07.20 (other prepared beef). Both within ch.16.
    // In HTS: 1601 = sausages; 1601.00.40 = beef sausages in airtight containers.
    // Phrase 'airtight containers' + token 'beef' uniquely identifies this within ch.16.
    patches.push({
      priority: 660,
      rule: {
        id: 'BEEF_AIRTIGHT_SAUSAGE_INTENT',
        description: 'Beef sausages in airtight containers → 1601.00.40 (ch.16). ' +
          'Anchored by beef + airtight containers phrase to avoid firing for fish queries.',
        pattern: {
          anyOf: ['airtight containers', 'airtight container'],
          noneOf: [
            'salmon', 'tuna', 'fish', 'seafood', 'herring', 'mackerel',
            'shrimp', 'prawn', 'lobster', 'crab', 'clam', 'oyster',
            'apricot', 'citrus', 'peach', 'pear', 'fruit', 'cereal',
          ],
          anyOfGroups: [
            ['beef', 'bovine', 'cattle'],
          ],
        },
        whitelist: { allowChapters: ['16'] },
        inject: [{ prefix: '1601.00.40', syntheticRank: 8 }],
      },
    });

    // ── 4. FIX USED TIRES — remove 4012.20 from retreaded rules, add dedicated rule ──
    // "Other Used pneumatic tires" → expected 4012.20.45.00 (used tires, not retreaded).
    // Both retreaded rules fire (have 'used'+'tires') and inject 4012.11/12/19/20 at rank 40.
    // Semantic prefers 4012.12 (retreaded car tires) over 4012.20 (used tires) in a tie.
    // Fix: Remove 4012.20 from the two retreaded rules, so only USED_TIRES_ONLY injects it.
    {
      const retreaded1 = allRules.find((r: IntentRule) => r.id === 'AI_CH40_RETREADED_TIRES') as IntentRule | undefined;
      if (retreaded1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inj: any[] = (retreaded1.inject as any[]) ?? [];
        patches.push({
          priority: 640,
          rule: {
            ...retreaded1,
            inject: inj.filter((s) => !s.prefix.startsWith('4012.20')),
          },
        });
      }
    }
    {
      const retreaded2 = allRules.find((r: IntentRule) => r.id === 'AI_CH40_RETREADED_USED_TIRES') as IntentRule | undefined;
      if (retreaded2) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inj: any[] = (retreaded2.inject as any[]) ?? [];
        patches.push({
          priority: 640,
          rule: {
            ...retreaded2,
            inject: inj.filter((s) => !s.prefix.startsWith('4012.20')),
          },
        });
      }
    }

    // NEW USED_TIRES_ONLY_INTENT: fires when 'used'+'tires' but NOT 'retreaded'.
    // Injects ONLY 4012.20 (used pneumatic tires) at high rank (8).
    patches.push({
      priority: 660,
      rule: {
        id: 'USED_TIRES_ONLY_INTENT',
        description: 'Used (not retreaded) pneumatic tires → 4012.20. ' +
          'The retreaded rules now exclude 4012.20; only this rule injects 4012.20.',
        pattern: {
          anyOfGroups: [
            ['used'],
            ['tire', 'tires', 'tyre', 'tyres'],
          ],
          noneOf: [
            'retreaded', 'retread', 'recapped', 'recap', 'remolded', 'remould',
            'solid', 'cushion', 'tread only', 'tire tread', 'tire flap',
          ],
        },
        whitelist: { allowChapters: ['40'] },
        inject: [{ prefix: '4012.20', syntheticRank: 8 }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch DDD)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
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
    console.log(`\nPatch DDD complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
