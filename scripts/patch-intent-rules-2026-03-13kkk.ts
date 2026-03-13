#!/usr/bin/env ts-node
/**
 * Patch KKK — 2026-03-13:
 *
 * Fix bugs introduced in III and HHH:
 *
 * 1.  FIX WOMEN_SYNTHETIC_SUITS_INTENT — remove 'swimwear' from noneOf
 *     The target query: "Other Of synthetic fibers Women s or girls suits ensembles
 *     suit-type jackets blazers dresses...other than swimwear knitted or crocheted"
 *     The phrase "other than swimwear" causes 'swimwear' to be a token → noneOf
 *     was blocking the rule from firing. Remove 'swimwear' from noneOf.
 *     The rule still won't fire for actual swimwear queries because it requires
 *     'suits'/'ensembles' context which swimwear queries won't have.
 *
 * 2.  FIX SWEET_POTATO_INTENT — remove 'frozen'/'dried' from noneOf
 *     The target query: "Other Sweet potatoes Cassava manioc arrowroot...
 *     fresh chilled frozen or dried whether or not sliced..."
 *     The phrase "frozen or dried" causes tokens 'frozen' and 'dried' to appear
 *     → noneOf was blocking the rule. Remove them.
 *     0714.20 covers fresh/chilled/frozen/dried sweet potatoes, so it's correct.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13kkk.ts
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

    // ── 1. FIX WOMEN_SYNTHETIC_SUITS_INTENT ───────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'WOMEN_SYNTHETIC_SUITS_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const newNoneOf = (pat.noneOf ?? []).filter((t: string) => t !== 'swimwear' && t !== 'swim');
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            description: 'Women\'s/girls\' knitted suits/ensembles of synthetic fibers → 6104.13 (ch.61). ' +
              'Target query has "other than swimwear" containing swimwear token — removed from noneOf.',
            pattern: {
              ...pat,
              noneOf: newNoneOf,
            },
          },
        });
        console.log(`WOMEN_SYNTHETIC_SUITS_INTENT noneOf was: ${JSON.stringify(pat.noneOf)}`);
        console.log(`WOMEN_SYNTHETIC_SUITS_INTENT noneOf now: ${JSON.stringify(newNoneOf)}`);
      } else {
        console.log('WOMEN_SYNTHETIC_SUITS_INTENT not found — creating fresh');
        patches.push({
          priority: 660,
          rule: {
            id: 'WOMEN_SYNTHETIC_SUITS_INTENT',
            description: 'Women\'s/girls\' knitted suits/ensembles of synthetic fibers → 6104.13 (ch.61).',
            pattern: {
              anyOf: ['synthetic fibers', 'synthetic fiber', 'of synthetic'],
              anyOfGroups: [
                ['women', 'girls'],
                ['suits', 'ensembles', 'suit-type'],
              ],
              noneOf: ['woven', 'not knitted'],
            },
            whitelist: { allowChapters: ['61'] },
            inject: [{ prefix: '6104.13', syntheticRank: 8 }],
            boosts: [{ delta: 0.5, prefixMatch: '6104.13' }],
          },
        });
      }
    }

    // ── 2. FIX SWEET_POTATO_INTENT ────────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SWEET_POTATO_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        // Remove 'frozen', 'dried', 'chilled', 'cooked' from noneOf
        // 0714.20 covers all states (fresh/chilled/frozen/dried)
        const toRemove = new Set(['frozen', 'dried', 'chilled', 'fresh', 'cooked', 'refrigerated']);
        const newNoneOf = (pat.noneOf ?? []).filter((t: string) => !toRemove.has(t));
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            description: 'Sweet potatoes → 0714.20 (ch.07). ' +
              'Removed state words (frozen/dried) from noneOf since query path includes state description.',
            pattern: {
              ...pat,
              noneOf: newNoneOf,
            },
          },
        });
        console.log(`SWEET_POTATO_INTENT noneOf was: ${JSON.stringify(pat.noneOf)}`);
        console.log(`SWEET_POTATO_INTENT noneOf now: ${JSON.stringify(newNoneOf)}`);
      } else {
        console.log('SWEET_POTATO_INTENT not found — creating fresh');
        patches.push({
          priority: 660,
          rule: {
            id: 'SWEET_POTATO_INTENT',
            description: 'Sweet potatoes → 0714.20 (ch.07).',
            pattern: {
              anyOf: ['sweet potato', 'sweet potatoes'],
              noneOf: ['juice', 'flour', 'starch', 'paste', 'puree', 'chips', 'crisps'],
            },
            whitelist: { allowChapters: ['07'] },
            inject: [{ prefix: '0714.20', syntheticRank: 8 }],
            boosts: [{ delta: 0.5, prefixMatch: '0714.20' }],
          },
        });
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch KKK)...`);
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
    console.log(`\nPatch KKK complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
