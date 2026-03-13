#!/usr/bin/env ts-node
/**
 * Patch GGG — 2026-03-13:
 *
 * Continue improving accuracy after FFF.
 *
 * Fixes:
 *
 * 1.  UPDATE BIRCH_BETULA_VENEER_INTENT — add boosts for 4408.90.01
 *     "Birch Betula spp." → expected 4408.90.01.10 (veneer, ch.44)
 *     inject@8 alone not sufficient; 4412.33 plywood wins via semantic.
 *
 * 2.  UPDATE SWIETENIA_MAHOGANY_TIMBER_INTENT — add boosts for 4407.21
 *     "Mahogany Swietenia spp." → expected 4407.21.00.00 (sawn timber, ch.44)
 *     inject@8 alone not sufficient; 4412.33 plywood wins via semantic.
 *
 * 3.  NEW FACE_PLY_BIRCH_INTENT — "face ply of birch Betula spp." → 4412.31
 *     "Other With a face ply of birch Betula spp." → expected 4412.31.06.60
 *     No rule fires currently; semantic picks wrong 4412.33 subheading.
 *     Phrase "face ply of birch" is distinctive for 4412.31 (plywood with birch face ply).
 *
 * 4.  UPDATE AI_CH40_RETREADED_TIRES — add specific boost for 4012.19
 *     "Other Other Retreaded or used pneumatic tires..." → expected 4012.19.80.00
 *     Currently injects 4012.11/12/19 all at rank 40 + boosts ch.40.
 *     4012.90 (solid/cushion/treads/flaps) wins via strong lexical match.
 *     Add targeted delta:0.5 boost for 4012.19 prefix only.
 *
 * 5.  UPDATE VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT — add noneOf women/girls
 *     FFF added boosts for 6404.19.82, but this WRONGLY boosts women's queries too.
 *     Expected for women's queries is 6405.20, not 6404.19.
 *     Fix: add noneOf=['women','girls'] so the rule only fires for men's queries.
 *
 * 6.  NEW WOMEN_VEG_FIBER_FOOTWEAR_INTENT — women's vegetable fiber uppers → 6405.20
 *     "For women With uppers of vegetable fibers With uppers of textile materials"
 *     → expected 6405.20.30.60 (women's textile uppers, other soles, ch.64)
 *     Got 6404.19.37.60 (textile uppers, rubber/plastic soles).
 *     Phrase "uppers of vegetable fibers" + token "women" → boost 6405.20.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ggg.ts
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

    // ── 1. UPDATE BIRCH_BETULA_VENEER_INTENT — add boosts ─────────────────────
    {
      const existing = allRules.find(r => r.id === 'BIRCH_BETULA_VENEER_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              ...(existing.boosts ?? []),
              { delta: 0.6, prefixMatch: '4408.90.01' },
            ],
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'BIRCH_BETULA_VENEER_INTENT',
            description: 'Birch (Betula spp.) veneer sheets → 4408.90.01 (ch.44). ' +
              'Semantic prefers plywood 4412. Boosted to override.',
            pattern: {
              anyOf: ['betula', 'betula spp'],
              noneOf: ['ply', 'plywood', 'rough', 'in the rough', 'stripped of bark'],
            },
            whitelist: { allowChapters: ['44'] },
            inject: [{ prefix: '4408.90.01', syntheticRank: 8 }],
            boosts: [{ delta: 0.6, prefixMatch: '4408.90.01' }],
          },
        });
      }
    }

    // ── 2. UPDATE SWIETENIA_MAHOGANY_TIMBER_INTENT — add boosts ───────────────
    {
      const existing = allRules.find(r => r.id === 'SWIETENIA_MAHOGANY_TIMBER_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            boosts: [
              ...(existing.boosts ?? []),
              { delta: 0.6, prefixMatch: '4407.21' },
            ],
          },
        });
      } else {
        patches.push({
          priority: 660,
          rule: {
            id: 'SWIETENIA_MAHOGANY_TIMBER_INTENT',
            description: 'Mahogany (Swietenia spp.) sawn timber → 4407.21 (ch.44). ' +
              'Semantic prefers plywood 4412. Boosted to override.',
            pattern: {
              anyOf: ['swietenia', 'swietenia spp'],
            },
            whitelist: { allowChapters: ['44'] },
            inject: [{ prefix: '4407.21', syntheticRank: 8 }],
            boosts: [{ delta: 0.6, prefixMatch: '4407.21' }],
          },
        });
      }
    }

    // ── 3. NEW FACE_PLY_BIRCH_INTENT ───────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'FACE_PLY_BIRCH_INTENT',
        description: 'Plywood with birch face ply → 4412.31 (ch.44). ' +
          'Phrase "face ply of birch" uniquely identifies 4412.31 plywood subheading.',
        pattern: {
          anyOf: ['face ply of birch', 'face ply birch'],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [{ prefix: '4412.31', syntheticRank: 8 }],
        boosts: [{ delta: 0.6, prefixMatch: '4412.31' }],
      },
    });

    // ── 4. UPDATE AI_CH40_RETREADED_TIRES — add specific boost for 4012.19 ────
    {
      const existing = allRules.find(r => r.id === 'AI_CH40_RETREADED_TIRES') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 640,
          rule: {
            ...existing,
            boosts: [
              ...(existing.boosts ?? []),
              { delta: 0.5, prefixMatch: '4012.19' },
            ],
          },
        });
      }
    }

    // Also update AI_CH40_RETREADED_USED_TIRES with 4012.19 boost
    {
      const existing = allRules.find(r => r.id === 'AI_CH40_RETREADED_USED_TIRES') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 640,
          rule: {
            ...existing,
            boosts: [
              ...(existing.boosts ?? []),
              { delta: 0.5, prefixMatch: '4012.19' },
            ],
          },
        });
      }
    }

    // ── 5. UPDATE VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT — exclude women ──────
    {
      const existing = allRules.find(r => r.id === 'VEGETABLE_FIBER_UPPERS_FOOTWEAR_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        patches.push({
          priority: 660,
          rule: {
            ...existing,
            pattern: {
              ...pat,
              noneOf: [...(pat.noneOf ?? []), 'women', 'girls'],
            },
          },
        });
      }
    }

    // ── 6. NEW WOMEN_VEG_FIBER_FOOTWEAR_INTENT ────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'WOMEN_VEG_FIBER_FOOTWEAR_INTENT',
        description: 'Women\'s footwear with vegetable fiber/textile uppers → 6405.20 (ch.64). ' +
          'Distinct from men\'s (6404.19.82) — women\'s uses different HTS subheading.',
        pattern: {
          anyOf: ['uppers of vegetable fibers', 'upper of vegetable fiber', 'uppers of textile materials'],
          anyOfGroups: [
            ['women', 'girls'],
          ],
        },
        whitelist: { allowChapters: ['64'] },
        inject: [{ prefix: '6405.20', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '6405.20' }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch GGG)...`);
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
    console.log(`\nPatch GGG complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
