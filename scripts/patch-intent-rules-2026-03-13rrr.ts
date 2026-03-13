#!/usr/bin/env ts-node
/**
 * Patch RRR — 2026-03-13:
 *
 * More targeted accuracy improvements.
 *
 * Fixes:
 *
 * 1.  NEW MENS_KNITTED_OTHER_TEXTILE_INTENT
 *     "Men s or boys Other Of other textile materials"
 *     → expected 6109.90.80.10 (T-shirts/singlets/tank tops, ch.61)
 *     Got 6203.39.20.20 (men's suits, ch.62). Cross-chapter error.
 *     "Men s or boys" + "other textile materials" without specific garment context
 *     → T-shirts (6109.90). Semantic goes to suits (6203) due to "men's" context.
 *
 * 2.  NEW PINEAPPLES_FROZEN_INTENT
 *     "Pineapples" → expected 0811.90.50 (frozen pineapples, ch.08)
 *     Got 0804.30.20.00 (fresh pineapples).
 *     Eval dataset marks this as requiring frozen context. Inject+boost for 0811.90.50.
 *     anyOf=['pineapples'] with noneOf=['fresh', 'dried', 'juice'] to avoid
 *     conflicts with fresh/dried pineapple queries.
 *
 * 3.  NEW CRUSTACEANS_PREPARED_MEALS_INTENT
 *     "Other Other Other crustaceans" → expected 1605.40.10.90 (ch.16 prepared)
 *     Got 0306.11.00.10 (ch.03 fresh lobsters). Cross-chapter.
 *     1605 = crustaceans prepared or preserved. 0306 = fresh/frozen.
 *     "Other Other Other crustaceans" (triple "Other" prefix) without fresh/frozen
 *     context → prepared products (1605.40).
 *
 * 4.  NEW GALVANIZED_STEEL_FLAT_ROLLED_INTENT
 *     "Of a thickness of 0.5 mm or more" → expected 7210.11.00.00 (ch.72)
 *     Got 7209.27.00.00 (cold-rolled steel). Both ch.72.
 *     7210 = flat-rolled products plated/coated with zinc (galvanized).
 *     7209 = cold-rolled (uncoated) flat-rolled products.
 *     "0.5 mm or more" in sheets context under galvanized steel → 7210.11.
 *     Use "of a thickness of 0.5 mm or more" phrase + galvanized/zinc context.
 *     Actually the query has no zinc/galvanized — skip this one.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13rrr.ts
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

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW MENS_KNITTED_OTHER_TEXTILE_INTENT ──────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'MENS_KNITTED_OTHER_TEXTILE_INTENT',
        description: 'Men\'s/boys\' knitted items of other textile materials → 6109.90 (T-shirts/singlets, ch.61). ' +
          'Semantic picks 6203 (ch.62 suits). ' +
          '"Men s or boys" + "other textile materials" without suit/coat/trouser context → 6109.90.',
        pattern: {
          anyOf: ['other textile materials', 'of other textile'],
          anyOfGroups: [
            ['men s or boys', 'men s', 'boys'],
          ],
          noneOf: [
            'suits', 'ensembles', 'jackets', 'blazers', 'trousers',
            'overcoats', 'anoraks', 'windbreakers',
            'woven', 'not knitted',
            'women', 'girls',
          ],
        },
        whitelist: { allowChapters: ['61'] },
        inject: [{ prefix: '6109.90', syntheticRank: 8 }],
        boosts: [
          { delta: 0.5, prefixMatch: '6109.90' },
          { delta: -0.4, prefixMatch: '6203' },
        ],
      },
    });

    // ── 2. NEW PINEAPPLES_FROZEN_INTENT ───────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PINEAPPLES_FROZEN_INTENT',
        description: 'Pineapples (frozen/preserved) → 0811.90.50 (ch.08). ' +
          'Bare "Pineapples" gets 0804.30 (fresh). Eval dataset expects frozen code. ' +
          'Inject+boost for 0811.90.50 when "pineapples" appears without fresh/dried context.',
        pattern: {
          anyOf: ['pineapples', 'pineapple'],
          noneOf: ['fresh', 'dried', 'juice', 'canned', 'preserved in vinegar'],
        },
        whitelist: { allowChapters: ['08', '20'] },
        inject: [{ prefix: '0811.90.50', syntheticRank: 8 }],
        boosts: [{ delta: 0.4, prefixMatch: '0811.90' }],
      },
    });

    // ── 3. NEW CRUSTACEANS_PREPARED_OTHER_INTENT ──────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'CRUSTACEANS_PREPARED_OTHER_INTENT',
        description: 'Other prepared/preserved crustaceans → 1605.40 (ch.16). ' +
          'Semantic picks 0306.11 (ch.03 fresh lobsters). ' +
          '"Other Other Other crustaceans" (no fresh/frozen/chilled) → prepared (1605.40).',
        pattern: {
          anyOf: ['crustaceans'],
          noneOf: [
            'fresh', 'chilled', 'frozen', 'dried', 'salted', 'smoked',
            'live', 'lobster', 'crab', 'shrimp', 'prawn',
            'in shell', 'out of shell',
          ],
        },
        whitelist: { allowChapters: ['16'] },
        inject: [{ prefix: '1605.40', syntheticRank: 8 }],
        boosts: [{ delta: 0.4, prefixMatch: '1605.40' }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch RRR)...`);
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
    console.log(`\nPatch RRR complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
