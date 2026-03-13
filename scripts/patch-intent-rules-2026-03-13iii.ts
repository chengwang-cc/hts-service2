#!/usr/bin/env ts-node
/**
 * Patch III — 2026-03-13:
 *
 * Continue improving accuracy after HHH.
 *
 * Fixes:
 *
 * 1.  NEW WORSTED_WOOL_TROUSERS_INTENT
 *     "Trousers of worsted wool fabric made of wool yarn having an average fiber
 *     diameter of 18.5 microns or less" → expected 6203.41.03 (ch.62)
 *     Got 6203.29.10.20. Both in 6203 (men's woven trousers).
 *     6203.41 = trousers of wool. 6203.29 = trousers of other textile materials.
 *     "Worsted" + "trousers" uniquely identifies 6203.41 (wool trousers, ch.62).
 *
 * 2.  NEW WOMEN_SYNTHETIC_SUITS_INTENT
 *     "Other Of synthetic fibers Women s or girls suits ensembles...knitted or crocheted"
 *     → expected 6104.13.20.00 (ch.61)
 *     Got 6104.23.00.14. Both ch.61 (knitted women's suits).
 *     6104.13 = women's/girls' suits/ensembles of synthetic fibers.
 *     6104.23 = women's/girls' ensembles of other textile materials.
 *     "Synthetic fibers" + "women" + "suits/ensembles" → 6104.13.
 *     Multiple garment rules fire (DRESS_SKIRT, PANTS_JEANS, etc.) but none boost 6104.13.
 *
 * 3.  NEW KNITTED_CROCHETED_INTENT
 *     Many ch.61 failures occur because semantic prefers ch.62 (woven).
 *     When query explicitly says "knitted or crocheted", inject ch.61 signal.
 *     Anchor: anyOf=['knitted or crocheted', 'knitted', 'crocheted'] in garment context.
 *     Boost ch.61 entries when knitted context is explicit.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13iii.ts
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

    // ── 1. NEW WORSTED_WOOL_TROUSERS_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'WORSTED_WOOL_TROUSERS_INTENT',
        description: 'Men\'s worsted wool trousers → 6203.41 (ch.62). ' +
          'PANTS_JEANS_INTENT injects 6203.42 (synthetic) instead. ' +
          '"Worsted" + "trousers" uniquely identifies 6203.41 (wool trousers).',
        pattern: {
          anyOfGroups: [
            ['trouser', 'trousers'],
            ['worsted', 'worsted wool'],
          ],
          noneOf: ['knitted', 'crocheted', 'women', 'girls'],
        },
        whitelist: { allowChapters: ['62'] },
        inject: [{ prefix: '6203.41', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '6203.41' }],
      },
    });

    // ── 2. NEW WOMEN_SYNTHETIC_SUITS_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'WOMEN_SYNTHETIC_SUITS_INTENT',
        description: 'Women\'s/girls\' knitted suits/ensembles of synthetic fibers → 6104.13 (ch.61). ' +
          'Garment rules inject 6104.4x/5x (dresses/skirts) but not 6104.13 (suits). ' +
          '"synthetic fibers" + women/girls + suits/ensembles context → 6104.13.',
        pattern: {
          anyOf: ['synthetic fibers', 'synthetic fiber', 'of synthetic'],
          anyOfGroups: [
            ['women', 'girls'],
            ['suits', 'ensembles', 'suit-type'],
          ],
          noneOf: ['swimwear', 'swim', 'woven', 'not knitted'],
        },
        whitelist: { allowChapters: ['61'] },
        inject: [{ prefix: '6104.13', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '6104.13' }],
      },
    });

    // ── 3. UPDATE KNITTED_CROCHETED_HTS_INTENT — verify/add ch.61 boost ──────
    // Check if existing rule already boosts ch.61, if not add it
    {
      const existing = allRules.find(r => r.id === 'KNITTED_CROCHETED_HTS_INTENT') as IntentRule | undefined;
      if (existing) {
        const existingBoosts = (existing.boosts ?? []) as Array<{ delta: number; chapterMatch?: string; prefixMatch?: string }>;
        const hasCh61Boost = existingBoosts.some(b => b.chapterMatch === '61' && b.delta >= 0.3);
        if (!hasCh61Boost) {
          patches.push({
            priority: 650,
            rule: {
              ...existing,
              boosts: [
                ...existingBoosts,
                { delta: 0.3, chapterMatch: '61' },
              ],
            },
          });
          console.log('Adding ch.61 boost to KNITTED_CROCHETED_HTS_INTENT');
        } else {
          console.log('KNITTED_CROCHETED_HTS_INTENT already has ch.61 boost, skipping');
        }
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch III)...`);
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
    console.log(`\nPatch III complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
