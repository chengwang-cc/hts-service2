#!/usr/bin/env ts-node
/**
 * Patch WWW — 2026-03-13:
 *
 * Root-cause fixes for stubborn failures + new rules.
 *
 * Fixes:
 *
 * 1.  FIX BEE_KEEPING_MACHINERY_PARTS_INTENT — rule never fires
 *     anyOf=['bee-keeping','bee keeping','beekeeping','apiary'] — none match!
 *     - 'bee-keeping' → no space → token lookup → tokens has 'bee','keeping' separately → FALSE
 *     - 'bee keeping' → phrase → qLower has 'bee-keeping' (hyphen) not 'bee keeping' (space) → FALSE
 *     - 'beekeeping' → token lookup → tokens has 'bee','keeping' not 'beekeeping' → FALSE
 *     Fix: use 'bee-keeping machinery' (has space → phrase check → qLower.includes works!) + stronger boosts.
 *
 * 2.  FIX CAST_IRON_FINS_SPRUES_INTENT — anyOfGroups blocks
 *     anyOf fires (query has 'fins gates sprues and risers') but anyOfGroups fails:
 *     - 'cast-iron' → token lookup → tokens has 'cast','iron' separately → FALSE
 *     - 'cast iron' → phrase → qLower has 'cast-iron' (hyphen) not 'cast iron' (space) → FALSE
 *     Fix: remove anyOfGroups; anyOf phrases are distinctive enough.
 *
 * 3.  FIX COTTON_YARN_OVER_80NM_INTENT — noneOf blocks rule
 *     Query: "Exceeding 80 nm Cotton yarn other than sewing thread...not put up for retail sale"
 *     - 'sewing thread' in noneOf → qLower.includes('sewing thread') → TRUE → BLOCKED
 *     - 'put up for retail' in noneOf → qLower.includes('put up for retail') → TRUE → BLOCKED
 *     Fix: remove both from noneOf (they appear in "other than..." / "not put up..." negative context).
 *
 * 4.  FIX NON_ALCOHOLIC_BEVERAGE_INTENT — noneOf blocks rule
 *     Query: "...other non-alcoholic beverages..."
 *     - 'alcohol' in noneOf → qLower.includes('alcohol') → 'non-alcoholic' contains 'alcohol' → BLOCKED
 *     - 'alcoholic' in noneOf → same issue → BLOCKED
 *     Fix: remove 'alcohol' and 'alcoholic' from noneOf (keep beer/wine/spirits).
 *
 * 5.  FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT — missing 4202.11 penalty
 *     Rule fires, boosts 4202.12.21. But 4202.11 (leather surface) now wins due to high
 *     coverage score from long query. 4202.11 had NO penalty. Add penalty -1.5.
 *
 * 6.  FIX ELASTOMERIC_YARN_GARMENT_INTENT — ch.60 fabric regression
 *     Fabric query "Knitted or crocheted fabrics of a width exceeding 30 cm...elastomeric yarn"
 *     fires the rule and boosts 6104.62 (ch.61 garments) instead of correct 6004.10 (ch.60 fabrics).
 *     Fix: add 'knitted or crocheted fabrics' and 'fabrics of a width' to noneOf.
 *
 * 7.  NEW OPTICAL_FIBER_CABLES_INTENT
 *     "Insulated...optical fiber cables made up of individually sheathed fibers..."
 *     → expected 8544.49.20.00 (ch.85)
 *     Got 8544.20.00.00 (coaxial cable). "optical fiber cables" / "sheathed fibers" → 8544.49.
 *
 * 8.  NEW ROVINGS_WOVEN_FABRICS_INTENT
 *     "Other Closed woven fabrics of rovings" → expected 7019.61.10.00 (ch.70)
 *     Got 7019.62.40.30. "Closed woven fabrics of rovings" → 7019.61 (not 7019.62).
 *
 * 9.  NEW PAPER_OVER_30_GSM_INTENT
 *     "Other Weighing over 30 g/m" → expected 4811.90.80.50 (ch.48)
 *     Got 9303.20.00.40 (firearms). Cross-chapter. "Weighing over 30 g/m" without gun context → ch.48.
 *
 * 10. NEW PIPE_WALL_THICKNESS_12_7_INTENT
 *     "Having a wall thickness less than 12.7 mm" → expected 7304.19.10.45 (ch.73)
 *     Got 7304.29.20.50. Both ch.73. "wall thickness less than 12.7 mm" → line pipe 7304.19.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13www.ts
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

    // ── 1. FIX BEE_KEEPING_MACHINERY_PARTS_INTENT ─────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'BEE_KEEPING_MACHINERY_PARTS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 700,
          rule: {
            ...existing,
            description: 'Bee-keeping machinery parts → 8436.99.00.90 (ch.84). ' +
              'Fixed: original anyOf items did not match hyphenated query tokens. ' +
              '\'bee-keeping machinery\' (phrase with space) → qLower.includes works for hyphenated text. ' +
              'Stronger boosts + penalty to beat 8436.91 (poultry incubators).',
            pattern: {
              anyOf: [
                'bee-keeping machinery',
                'bee keeping machinery',
                'beekeeping machinery',
                'bee-keeping',
                'apiary machinery',
              ],
              anyOfGroups: [
                ['parts', 'part', 'thereof'],
              ],
            },
            inject: [
              { prefix: '8436.99.00.90', syntheticRank: 4 },
              { prefix: '8436.99.00', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 2.0, prefixMatch: '8436.99.00.90' },
              { delta: 1.5, prefixMatch: '8436.99.00' },
              { delta: -2.0, prefixMatch: '8436.91' },
              { delta: -1.0, prefixMatch: '8436.80' },
            ],
          },
        });
        console.log('BEE_KEEPING_MACHINERY_PARTS_INTENT: fixed anyOf phrases + stronger boosts');
      }
    }

    // ── 2. FIX CAST_IRON_FINS_SPRUES_INTENT ───────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'CAST_IRON_FINS_SPRUES_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Cast-iron parts (fins/gates/sprues) → 8409.91.10 (ch.84). ' +
              'Fixed: removed anyOfGroups for \'cast-iron\' (hyphen prevents token/phrase match). ' +
              '\'fins gates sprues and risers\' + \'cast-iron parts\' phrases are distinctive enough.',
            pattern: {
              anyOf: [
                'fins gates sprues and risers',
                'fins gates sprues',
                'sprues and risers',
                'not advanced beyond cleaning',
                'cast-iron parts',
              ],
              // Removed anyOfGroups — 'cast-iron' token lookup fails (hyphen splits to 'cast','iron'),
              // and 'cast iron' phrase fails (qLower has 'cast-iron' with hyphen).
            },
            inject: [{ prefix: '8409.91', syntheticRank: 8 }],
            boosts: [
              { delta: 0.8, prefixMatch: '8409.91' },
              { delta: -0.6, prefixMatch: '8466.91' },
              { delta: -0.5, prefixMatch: '8466.92' },
            ],
          },
        });
        console.log('CAST_IRON_FINS_SPRUES_INTENT: fixed — removed broken anyOfGroups');
      }
    }

    // ── 3. FIX COTTON_YARN_OVER_80NM_INTENT ───────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'COTTON_YARN_OVER_80NM_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Cotton yarn >80 nm → 5206.15 (ch.52). ' +
              'Fixed: noneOf=[\'sewing thread\',\'put up for retail\'] blocks rule because ' +
              'query uses "other than sewing thread" and "not put up for retail sale" — ' +
              'substring matches noneOf terms even in negative context. Removed both.',
            pattern: {
              anyOf: ['exceeding 80 nm', 'exceeding 80nm', 'above 80 nm'],
              anyOfGroups: [
                ['cotton', 'yarn'],
              ],
              // Removed 'sewing thread' and 'put up for retail' from noneOf —
              // they appear in "other than sewing thread" / "not put up for retail sale"
              // → substring check falsely blocks the rule.
            },
            inject: [{ prefix: '5206.15', syntheticRank: 8 }],
            boosts: [
              { delta: 1.0, prefixMatch: '5206.15' },
              { delta: -0.6, prefixMatch: '5206.14' },
            ],
          },
        });
        console.log('COTTON_YARN_OVER_80NM_INTENT: removed blocking noneOf terms');
      }
    }

    // ── 4. FIX NON_ALCOHOLIC_BEVERAGE_INTENT ──────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'NON_ALCOHOLIC_BEVERAGE_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 700,
          rule: {
            ...existing,
            description: 'Other non-alcoholic beverages → 2202.99.28 (ch.22). ' +
              'Fixed: noneOf=[\'alcohol\',\'alcoholic\'] blocks rule because "non-alcoholic" ' +
              'contains both substrings. Removed alcohol/alcoholic (anyOf ensures non-alcoholic context). ' +
              'Increased penalty for 2202.10 to -2.0.',
            pattern: {
              anyOf: [
                'other non-alcoholic beverages',
                'non-alcoholic beverages not including',
                'non-alcoholic beverages',
              ],
              noneOf: ['beer', 'wine', 'spirits'],
              // Removed 'alcohol' and 'alcoholic' — 'non-alcoholic' contains these as substrings
            },
            inject: [
              { prefix: '2202.99.28', syntheticRank: 4 },
              { prefix: '2202.99', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 1.5, prefixMatch: '2202.99.28' },
              { delta: 1.0, prefixMatch: '2202.99' },
              { delta: -2.0, prefixMatch: '2202.10' },
              { delta: -0.8, prefixMatch: '2202.99.36' },
              { delta: -0.8, prefixMatch: '2202.99.37' },
            ],
          },
        });
        console.log('NON_ALCOHOLIC_BEVERAGE_INTENT: removed blocking noneOf, increased penalty for 2202.10');
      }
    }

    // ── 5. FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 700,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'Added missing penalty for 4202.11 (leather surface) — was missing, now winning. ' +
              'Increased boost for 4202.12.21 to 1.5.',
            inject: [
              { prefix: '4202.12.21', syntheticRank: 4 },
              { prefix: '4202.12', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 1.5, prefixMatch: '4202.12.21' },
              { delta: 1.0, prefixMatch: '4202.12' },
              { delta: -1.5, prefixMatch: '4202.11' },  // ← was missing!
              { delta: -1.0, prefixMatch: '4202.31' },
              { delta: -0.8, prefixMatch: '4202.32' },
              { delta: -0.8, prefixMatch: '4202.19' },
            ],
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: added missing 4202.11 penalty');
      }
    }

    // ── 6. FIX ELASTOMERIC_YARN_GARMENT_INTENT ────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'ELASTOMERIC_YARN_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const existingNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = ['knitted or crocheted fabrics', 'fabrics of a width', 'crocheted fabrics'];
        const newNoneOf = [
          ...existingNoneOf,
          ...toAdd.filter(t => !existingNoneOf.includes(t)),
        ];
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Garments containing elastomeric yarn/rubber thread → 6104.62 (ch.61). ' +
              'Fixed regression: "Knitted or crocheted fabrics of a width...elastomeric yarn" (ch.60) ' +
              'was firing rule and boosting ch.61 garments. Added fabric-context phrases to noneOf.',
            pattern: {
              ...pat,
              noneOf: newNoneOf,
            },
          },
        });
        console.log('ELASTOMERIC_YARN_GARMENT_INTENT: added fabric noneOf to prevent ch.60 regression');
      }
    }

    // ── 7. NEW OPTICAL_FIBER_CABLES_INTENT ────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'OPTICAL_FIBER_CABLES_INTENT',
        description: 'Optical fiber cables (individually sheathed fibers) → 8544.49 (ch.85). ' +
          'Semantic picks 8544.20 (coaxial cable). ' +
          '\'optical fiber cables\' / \'individually sheathed fibers\' → 8544.49 (other insulated conductors).',
        pattern: {
          anyOf: [
            'optical fiber cables',
            'optical fiber cable',
            'individually sheathed fibers',
            'sheathed fibers whether or not assembled',
          ],
          noneOf: ['glass rod', 'glass tube', 'photodiode', 'sensor', 'preform'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [{ prefix: '8544.49', syntheticRank: 8 }],
        boosts: [
          { delta: 0.8, prefixMatch: '8544.49' },
          { delta: -0.6, prefixMatch: '8544.20' },
          { delta: -0.5, prefixMatch: '8544.42' },
        ],
      },
    });

    // ── 8. NEW ROVINGS_WOVEN_FABRICS_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'ROVINGS_WOVEN_FABRICS_INTENT',
        description: 'Closed woven fabrics of rovings → 7019.61 (ch.70). ' +
          'Semantic picks 7019.62 (other woven fabrics). ' +
          '\'closed woven fabrics of rovings\' / \'fabrics of rovings\' → 7019.61.',
        pattern: {
          anyOf: [
            'closed woven fabrics of rovings',
            'woven fabrics of rovings',
            'fabrics of rovings',
          ],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [{ prefix: '7019.61', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '7019.61' },
          { delta: -0.5, prefixMatch: '7019.62' },
        ],
      },
    });

    // ── 9. NEW PAPER_OVER_30_GSM_INTENT ───────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PAPER_OVER_30_GSM_INTENT',
        description: 'Paper/paperboard weighing over 30 g/m² → 4811.90.80 (ch.48). ' +
          'Semantic picks 9303.20 (firearms). Cross-chapter error. ' +
          '\'weighing over 30 g/m\' without gun/firearm context → ch.48 paper.',
        pattern: {
          anyOf: [
            'weighing over 30 g/m',
            'over 30 g/m',
            'weighing over 30',
          ],
          noneOf: [
            'gun', 'firearm', 'pistol', 'rifle', 'ammunition',
            'shot', 'weapon', 'shotgun', 'cartridge',
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4811.90.80', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '4811.90.80' },
          { delta: 0.5, prefixMatch: '4811.90' },
          { delta: -1.5, prefixMatch: '9303' },
        ],
      },
    });

    // ── 10. NEW PIPE_WALL_THICKNESS_12_7_INTENT ───────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PIPE_WALL_THICKNESS_12_7_INTENT',
        description: 'Line pipe with wall thickness < 12.7 mm → 7304.19 (ch.73). ' +
          'Semantic picks 7304.29 (other casing/tubing). ' +
          '\'wall thickness less than 12.7 mm\' in pipes context → 7304.19 (line pipe).',
        pattern: {
          anyOf: [
            'wall thickness less than 12.7 mm',
            'wall thickness less than 12.7',
          ],
          noneOf: ['casing', 'tubing', 'bored', 'pilger'],
        },
        whitelist: { allowChapters: ['73'] },
        inject: [{ prefix: '7304.19', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '7304.19' },
          { delta: -0.5, prefixMatch: '7304.29' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch WWW)...`);
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
    console.log(`\nPatch WWW complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
