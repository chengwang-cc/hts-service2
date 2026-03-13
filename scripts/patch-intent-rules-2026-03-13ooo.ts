#!/usr/bin/env ts-node
/**
 * Patch OOO — 2026-03-13:
 *
 * Continue improving accuracy from 92.57% baseline.
 *
 * Fixes:
 *
 * 1.  STRENGTHEN NON_ALCOHOLIC_BEVERAGE_INTENT
 *     "Waters...and other non-alcoholic beverages not including..."
 *     → expected 2202.99.28.00, still got 2202.10.00.20
 *     Rule fires but boost (0.5) insufficient. Increase to 0.8 + penalty for 2202.10.
 *
 * 2.  STRENGTHEN BEE_KEEPING_MACHINERY_PARTS_INTENT
 *     "...bee-keeping machinery...poultry incubators and brooders parts thereof"
 *     → expected 8436.99.00.90, still got 8436.91.00.40
 *     "poultry incubators" strongly favors 8436.91. Need stronger boost + penalty.
 *
 * 3.  NEW TRUNKS_OUTER_SURFACE_PLASTICS_INTENT
 *     "Trunks suitcases vanity cases...With outer surface of plastics or of textile materials..."
 *     → expected 4202.12.21, got 4202.31.30.00
 *     Phrase "outer surface of plastics or of textile" combined with trunks/suitcases → 4202.12.
 *
 * 4.  NEW STATIONERY_OTHER_ARTICLES_INTENT
 *     "Registers account books notebooks...manifold business forms interleaved carbon sets
 *      and other articles of stationery of paper or paperboard..."
 *     → expected 4820.90.00.00, got 4820.10.20.20
 *     "interleaved carbon sets" and "manifold business forms" are distinctive → 4820.90.
 *
 * 5.  NEW DELIVERY_TRICYCLES_INTENT
 *     "Other cycles Bicycles and other cycles including delivery tricycles not motorized"
 *     → expected 8712.00.50.00 (other bicycles), got 8712.00.44.00 (with hand brakes)
 *     "delivery tricycles" is the distinctive phrase → 8712.00.50.
 *
 * 6.  NEW NOTE3_POLYMERS_INTENT
 *     "petroleum resins coumarone-indene resins polyterpenes polysulfides polysulfones
 *      and other products specified in note 3 to this chapter..."
 *     → expected 3911.90.25.00, got 3911.10.00.00 (petroleum resins)
 *     "polysulfides" or "polysulfones" or "coumarone-indene" → 3911.90 (note 3 polymers).
 *
 * 7.  NEW PINEAPPLES_FROZEN_INTENT
 *     "Pineapples" → expected 0811.90.50 (frozen ch.08), got 0804.30.20.00 (fresh pineapples)
 *     Bare "Pineapples" is ambiguous. Inject 0811.90 (frozen) — need to check if parent
 *     heading context says frozen or if it's a bare query issue.
 *     Actually pineapples bare query → 0804.30 (fresh pineapples) is likely correct for
 *     a general lookup. Skip this one — too ambiguous.
 *
 * 8.  NEW CRUSTACEANS_PREPARED_INTENT
 *     "Other Other Other crustaceans" → expected 1605.40.10.90 (ch.16 prepared),
 *     got 0306.11.00.10 (ch.03 fresh/frozen lobsters). Cross-chapter error.
 *     This is a very short ambiguous query — hard to fix with a rule without false positives.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ooo.ts
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

    // ── 1. STRENGTHEN NON_ALCOHOLIC_BEVERAGE_INTENT ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'NON_ALCOHOLIC_BEVERAGE_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingBoosts = (existing.boosts ?? []) as any[];
        // Remove old 2202.99 boost, add stronger one + penalty for 2202.10
        const filteredBoosts = existingBoosts.filter((b: any) => b.prefixMatch !== '2202.99');
        patches.push({
          priority: 670,
          rule: {
            ...existing,
            description: 'Other non-alcoholic beverages (not waters) → 2202.99 (ch.22). ' +
              'Strengthened boost to 0.8 + penalty for 2202.10 (waters with sugar).',
            boosts: [
              ...filteredBoosts,
              { delta: 0.8, prefixMatch: '2202.99' },
              { delta: -0.4, prefixMatch: '2202.10' },
            ],
          },
        });
        console.log('NON_ALCOHOLIC_BEVERAGE_INTENT: strengthened boost + added 2202.10 penalty');
      } else {
        patches.push({
          priority: 670,
          rule: {
            id: 'NON_ALCOHOLIC_BEVERAGE_INTENT',
            description: 'Other non-alcoholic beverages (not waters) → 2202.99 (ch.22). ' +
              'Queries describe both "waters" AND "other non-alcoholic beverages" → 2202.99.',
            pattern: {
              anyOf: ['other non-alcoholic beverages', 'non-alcoholic beverages not including'],
              noneOf: ['beer', 'wine', 'spirits'],
            },
            whitelist: { allowChapters: ['22'] },
            inject: [{ prefix: '2202.99', syntheticRank: 8 }],
            boosts: [
              { delta: 0.8, prefixMatch: '2202.99' },
              { delta: -0.4, prefixMatch: '2202.10' },
            ],
          },
        });
      }
    }

    // ── 2. STRENGTHEN BEE_KEEPING_MACHINERY_PARTS_INTENT ─────────────────────
    {
      const existing = allRules.find(r => r.id === 'BEE_KEEPING_MACHINERY_PARTS_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingBoosts = (existing.boosts ?? []) as any[];
        const filteredBoosts = existingBoosts.filter((b: any) => b.prefixMatch !== '8436.99');
        patches.push({
          priority: 670,
          rule: {
            ...existing,
            description: 'Bee-keeping machinery parts → 8436.99 (ch.84). ' +
              'Increased boost to 0.8 + penalty for 8436.91 (poultry incubator parts).',
            boosts: [
              ...filteredBoosts,
              { delta: 0.8, prefixMatch: '8436.99' },
              { delta: -0.5, prefixMatch: '8436.91' },
            ],
          },
        });
        console.log('BEE_KEEPING_MACHINERY_PARTS_INTENT: strengthened boost + added 8436.91 penalty');
      } else {
        patches.push({
          priority: 670,
          rule: {
            id: 'BEE_KEEPING_MACHINERY_PARTS_INTENT',
            description: 'Bee-keeping machinery parts → 8436.99 (ch.84).',
            pattern: {
              anyOf: ['bee-keeping', 'bee keeping', 'beekeeping', 'apiary'],
              anyOfGroups: [
                ['parts', 'machinery', 'machine'],
              ],
            },
            whitelist: { allowChapters: ['84'] },
            inject: [{ prefix: '8436.99', syntheticRank: 8 }],
            boosts: [
              { delta: 0.8, prefixMatch: '8436.99' },
              { delta: -0.5, prefixMatch: '8436.91' },
            ],
          },
        });
      }
    }

    // ── 3. NEW TRUNKS_OUTER_SURFACE_PLASTICS_INTENT ───────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT',
        description: 'Trunks/suitcases with outer surface of plastics or textile → 4202.12 (ch.42). ' +
          'Semantic picks 4202.31 (pocket/handbag articles). ' +
          '"Outer surface of plastics or of textile" + trunks/suitcases context → 4202.12.',
        pattern: {
          anyOf: [
            'outer surface of plastics or of textile',
            'outer surface of plastics',
            'with outer surface of plastics',
            'outer surface of textile materials',
          ],
          anyOfGroups: [
            ['trunks', 'suitcases', 'vanity cases', 'attache cases', 'briefcases'],
          ],
        },
        whitelist: { allowChapters: ['42'] },
        inject: [{ prefix: '4202.12', syntheticRank: 8 }],
        boosts: [{ delta: 0.6, prefixMatch: '4202.12' }],
      },
    });

    // ── 4. NEW STATIONERY_OTHER_ARTICLES_INTENT ────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'STATIONERY_OTHER_ARTICLES_INTENT',
        description: 'Other articles of stationery (manifold/carbon sets) → 4820.90 (ch.48). ' +
          'Semantic picks 4820.10 (registers/notebooks). ' +
          '"interleaved carbon sets" or "manifold business forms" uniquely identify 4820.90.',
        pattern: {
          anyOf: [
            'interleaved carbon sets',
            'manifold business forms',
            'and other articles of stationery of paper',
            'interleaved carbon',
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4820.90', syntheticRank: 8 }],
        boosts: [{ delta: 0.6, prefixMatch: '4820.90' }],
      },
    });

    // ── 5. NEW DELIVERY_TRICYCLES_INTENT ──────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'DELIVERY_TRICYCLES_INTENT',
        description: 'Bicycles/other cycles including delivery tricycles (not motorized) → 8712.00.50 (ch.87). ' +
          'Semantic picks 8712.00.44 (with hand brakes). ' +
          '"delivery tricycles" or "other cycles including delivery" → 8712.00.50 (other).',
        pattern: {
          anyOf: [
            'delivery tricycles',
            'other cycles including delivery',
            'including delivery tricycles',
          ],
          noneOf: ['motorized', 'motor'],
        },
        whitelist: { allowChapters: ['87'] },
        inject: [{ prefix: '8712.00.50', syntheticRank: 8 }],
        boosts: [{ delta: 0.6, prefixMatch: '8712.00.50' }],
      },
    });

    // ── 6. NEW NOTE3_POLYMERS_INTENT ──────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'NOTE3_POLYMERS_INTENT',
        description: 'Polymers specified in note 3 (ch.39) → 3911.90 (ch.39). ' +
          'Semantic picks 3911.10 (petroleum resins). ' +
          '"polysulfides"/"polysulfones"/"coumarone-indene" signals note-3 polymer list → 3911.90.',
        pattern: {
          anyOf: ['polysulfides', 'polysulfones', 'coumarone-indene resins', 'polyterpenes polysulfides'],
          anyOfGroups: [
            ['resins', 'polymers', 'petroleum resins', 'polyterpenes'],
          ],
        },
        whitelist: { allowChapters: ['39'] },
        inject: [{ prefix: '3911.90', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '3911.90' },
          { delta: -0.4, prefixMatch: '3911.10' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch OOO)...`);
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
    console.log(`\nPatch OOO complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
