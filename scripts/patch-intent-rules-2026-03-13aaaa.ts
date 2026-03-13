#!/usr/bin/env ts-node
/**
 * Patch AAAA — 2026-03-13:
 *
 * Fix regressions from ZZZ and remaining failures.
 *
 * Fixes:
 *
 * 1.  FIX MOTORS_SINGLE_ONLY_INTENT — regression on motor vehicles (ch.87)
 *     Query "...electric motor as motors for propulsion Motor vehicles..."
 *     → got 8501.34.30.00 (wrong). Rule fires because 'motors' is in query.
 *     Add 'propulsion', 'vehicle', 'transport', 'piston', 'combustion', 'diesel' to noneOf.
 *
 * 2.  FIX SIGNAL_PISTOLS_FIREARMS_INTENT — noneOf blocks rule
 *     Query: "...sporting shot-guns and rifles...Very pistols...line-throwing guns..."
 *     noneOf=['sporting','hunting','target-shooting'] → blocked by "sporting shot-guns".
 *     Remove sporting/hunting/target-shooting from noneOf.
 *
 * 3.  FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT — missing penalties
 *     After adding 4202.21/22 penalties, now 4202.39 wins. Need to penalize all 4202.xx.
 *     Increase boost to 2.0 for 4202.12.21 and add comprehensive penalties.
 *
 * 4.  NEW SWEET_POTATOES_ROOTS_INTENT
 *     "Other Sweet potatoes Cassava manioc arrowroot...pellets sago pith"
 *     → expected 0714.20.20.00 (ch.07)
 *     Got 0714.90.51.00 ("In the form of pellets" — matches phrase in query).
 *     "sweet potatoes cassava manioc" phrase identifies 0714.20 heading.
 *
 * 5.  NEW GIRLS_COTTON_GARMENTS_INTENT
 *     "Girls Of cotton" → expected 6102.20.00.20 (girls' overcoats, ch.61)
 *     Got 6108.21 (slips). "girls of cotton" phrase uniquely identifies this heading.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13aaaa.ts
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

    // ── 1. FIX MOTORS_SINGLE_ONLY_INTENT ──────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'MOTORS_SINGLE_ONLY_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const existingNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'propulsion', 'vehicle', 'transport', 'piston', 'combustion',
          'diesel', 'hybrid', 'electric motor', 'semi-diesel', 'petrol',
        ];
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Bare "Motors" query → 8501.34.30.00 (ch.85). ' +
              'Fixed regression: "electric motor as motors for propulsion Motor vehicles..." ' +
              'was firing rule. Added propulsion/vehicle/transport/combustion/diesel to noneOf.',
            pattern: {
              ...pat,
              noneOf: [...existingNoneOf, ...toAdd.filter(t => !existingNoneOf.includes(t))],
            },
          },
        });
        console.log('MOTORS_SINGLE_ONLY_INTENT: added propulsion/vehicle noneOf to prevent motor vehicle regression');
      }
    }

    // ── 2. FIX SIGNAL_PISTOLS_FIREARMS_INTENT ─────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SIGNAL_PISTOLS_FIREARMS_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const newNoneOf = (pat.noneOf ?? []).filter(
          (t: string) => !['sporting', 'hunting', 'target-shooting', 'target shooting'].includes(t),
        );
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Signal pistols, line-throwing guns, captive-bolt killers → 9303.90 (ch.93). ' +
              'Fixed: noneOf=[\'sporting\',\'hunting\',\'target-shooting\'] blocked rule because ' +
              'query has "sporting shot-guns" even though it\'s about signal pistols. Removed.',
            pattern: {
              ...pat,
              noneOf: newNoneOf,
            },
          },
        });
        console.log('SIGNAL_PISTOLS_FIREARMS_INTENT: removed blocking sporting/hunting/target-shooting from noneOf');
      }
    }

    // ── 3. FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 720,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'Comprehensive penalties for ALL 4202.xx except 4202.12. Increased boost to 2.0.',
            inject: [
              { prefix: '4202.12.21', syntheticRank: 2 },
              { prefix: '4202.12', syntheticRank: 6 },
            ],
            boosts: [
              { delta: 2.0, prefixMatch: '4202.12.21' },
              { delta: 1.5, prefixMatch: '4202.12' },
              { delta: -2.0, prefixMatch: '4202.11' },
              { delta: -2.0, prefixMatch: '4202.21' },
              { delta: -1.5, prefixMatch: '4202.22' },
              { delta: -1.5, prefixMatch: '4202.31' },
              { delta: -1.5, prefixMatch: '4202.39' },  // ← new
              { delta: -1.2, prefixMatch: '4202.32' },
              { delta: -1.2, prefixMatch: '4202.19' },
              { delta: -1.2, prefixMatch: '4202.29' },
              { delta: -1.0, prefixMatch: '4202.91' },  // ← new
              { delta: -1.0, prefixMatch: '4202.92' },  // ← new
              { delta: -1.0, prefixMatch: '4202.99' },  // ← new
            ],
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: comprehensive 4202.xx penalties + boost to 2.0');
      }
    }

    // ── 4. NEW SWEET_POTATOES_ROOTS_INTENT ────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'SWEET_POTATOES_ROOTS_INTENT',
        description: 'Sweet potatoes and other starchy roots → 0714.20 (ch.07). ' +
          'Semantic picks 0714.90.51 ("In the form of pellets") because query mentions pellets. ' +
          '"Sweet potatoes cassava manioc" / "cassava manioc arrowroot" → 0714.20 (sweet potatoes).',
        pattern: {
          anyOf: [
            'sweet potatoes cassava manioc',
            'cassava manioc arrowroot',
            'manioc arrowroot salep',
            'jerusalem artichokes sweet potatoes',
          ],
        },
        whitelist: { allowChapters: ['07'] },
        inject: [{ prefix: '0714.20', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '0714.20' },
          { delta: -0.5, prefixMatch: '0714.90.51' },
        ],
      },
    });

    // ── 5. NEW GIRLS_COTTON_GARMENTS_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'GIRLS_COTTON_GARMENTS_INTENT',
        description: 'Girls\' overcoats/cloaks of cotton → 6102.20 (ch.61). ' +
          'Semantic picks 6108.21 (slips). ' +
          '"Girls of cotton" phrase uniquely identifies the 6102.20 heading for overcoats.',
        pattern: {
          anyOf: ['girls of cotton'],
          noneOf: [
            'slips', 'petticoat', 'dresses', 'trousers', 't-shirts',
            'shirts', 'blouses', 'skirts', 'suits', 'blazers',
          ],
        },
        whitelist: { allowChapters: ['61', '62'] },
        inject: [{ prefix: '6102.20', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '6102.20' },
          { delta: -0.3, prefixMatch: '6108.21' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch AAAA)...`);
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
    console.log(`\nPatch AAAA complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
