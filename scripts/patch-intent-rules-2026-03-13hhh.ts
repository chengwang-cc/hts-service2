#!/usr/bin/env ts-node
/**
 * Patch HHH — 2026-03-13:
 *
 * Continue improving accuracy after GGG.
 *
 * Fixes:
 *
 * 1.  FIX FACE_PLY_BIRCH_INTENT — add noneOf=['nonconiferous']
 *     GGG's rule boosts 4412.31 for ALL face-ply-birch queries including
 *     "With a face ply of birch...nonconiferous wood" → expected 4412.52.
 *     Adding noneOf='nonconiferous' stops it from harming that query.
 *
 * 2.  NEW NONCONIFEROUS_OUTER_PLY_INTENT
 *     "With a face ply of birch...Other with at least one outer ply of nonconiferous wood"
 *     → expected 4412.52.10 (ch.44 plywood with nonconiferous outer ply).
 *     Pattern anchored by 'nonconiferous' + face ply/birch context.
 *
 * 3.  NEW HEAD_LETTUCE_INTENT
 *     "Other Head lettuce cabbage lettuce" → expected 0705.11.40.00 (ch.07)
 *     Got 0709.99.30.00. Both ch.07. Phrase "head lettuce" uniquely identifies
 *     0705.11 (head lettuce/cabbage lettuce). FRESH_VEGETABLE_INTENT restricts
 *     to ch.07 but semantic picks 0709 (other vegetables). Add inject+boost.
 *
 * 4.  NEW SWEET_POTATO_INTENT
 *     "Other Sweet potatoes Cassava manioc..." → expected 0714.20.20.00 (ch.07)
 *     Got 0714.90.51.00. Both ch.07. "sweet potato/potatoes" uniquely identifies
 *     0714.20 subheading within ch.07.
 *
 * 5.  NEW GLASS_WOOL_PRODUCTS_INTENT
 *     "Other Glass wool and articles of glass wool" → expected 7019.80.90.00 (ch.70)
 *     Got 7019.90.51.20. Both ch.70. "glass wool" phrase → 7019.80 (glass wool
 *     products). 7019.90 = other glass fiber products. Within-code fix.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13hhh.ts
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

    // ── 1. FIX FACE_PLY_BIRCH_INTENT — add noneOf nonconiferous ──────────────
    {
      const existing = allRules.find(r => r.id === 'FACE_PLY_BIRCH_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            pattern: {
              ...pat,
              noneOf: [...(pat.noneOf ?? []), 'nonconiferous'],
            },
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'FACE_PLY_BIRCH_INTENT',
            description: 'Plywood with birch face ply → 4412.31 (ch.44). ' +
              'noneOf nonconiferous prevents confusion with 4412.52.',
            pattern: {
              anyOf: ['face ply of birch', 'face ply birch'],
              noneOf: ['nonconiferous'],
            },
            whitelist: { allowChapters: ['44'] },
            inject: [{ prefix: '4412.31', syntheticRank: 8 }],
            boosts: [{ delta: 0.6, prefixMatch: '4412.31' }],
          },
        });
      }
    }

    // ── 2. NEW NONCONIFEROUS_OUTER_PLY_INTENT ─────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'NONCONIFEROUS_OUTER_PLY_INTENT',
        description: 'Plywood with nonconiferous outer ply (not tropical) → 4412.52 (ch.44). ' +
          'Distinct from 4412.31 (with tropical wood). Anchored by "nonconiferous" + birch/betula/face ply.',
        pattern: {
          anyOf: ['nonconiferous'],
          anyOfGroups: [
            ['birch', 'betula', 'face ply'],
          ],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [{ prefix: '4412.52', syntheticRank: 8 }],
        boosts: [{ delta: 0.6, prefixMatch: '4412.52' }],
      },
    });

    // ── 3. NEW HEAD_LETTUCE_INTENT ─────────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'HEAD_LETTUCE_INTENT',
        description: 'Head lettuce / cabbage lettuce → 0705.11 (ch.07). ' +
          'FRESH_VEGETABLE_INTENT restricts to ch.07 but semantic picks 0709. ' +
          'Phrase "head lettuce" or "cabbage lettuce" uniquely identifies 0705.11.',
        pattern: {
          anyOf: ['head lettuce', 'cabbage lettuce'],
        },
        whitelist: { allowChapters: ['07'] },
        inject: [{ prefix: '0705.11', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '0705.11' }],
      },
    });

    // ── 4. NEW SWEET_POTATO_INTENT ────────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'SWEET_POTATO_INTENT',
        description: 'Sweet potatoes → 0714.20 (ch.07). ' +
          'Query "Other Sweet potatoes Cassava manioc arrowroot..." gets 0714.90 (other roots). ' +
          '"sweet potato/potatoes" uniquely identifies 0714.20 subheading.',
        pattern: {
          anyOf: ['sweet potato', 'sweet potatoes'],
          noneOf: [
            'juice', 'flour', 'starch', 'paste', 'puree', 'cooked',
            'frozen', 'dried', 'dehydrated', 'canned', 'preserved',
          ],
        },
        whitelist: { allowChapters: ['07'] },
        inject: [{ prefix: '0714.20', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '0714.20' }],
      },
    });

    // ── 5. NEW GLASS_WOOL_PRODUCTS_INTENT ─────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'GLASS_WOOL_PRODUCTS_INTENT',
        description: 'Glass wool and articles thereof → 7019.80 (ch.70). ' +
          'Semantic picks 7019.90 (other glass fiber) over 7019.80 (glass wool products). ' +
          '"Glass wool" phrase anchors this to the 7019.80 subheading.',
        pattern: {
          anyOf: ['glass wool'],
          noneOf: ['woven', 'fabrics', 'rovings', 'yarn', 'fibre', 'fiber'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [{ prefix: '7019.80', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '7019.80' }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch HHH)...`);
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
    console.log(`\nPatch HHH complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
