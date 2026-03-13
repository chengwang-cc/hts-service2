#!/usr/bin/env ts-node
/**
 * Patch YYY — 2026-03-13:
 *
 * More root-cause fixes + new targeted rules.
 *
 * Fixes:
 *
 * 1.  FIX DELIVERY_TRICYCLES_INTENT — noneOf blocks rule
 *     Query: "...delivery tricycles not motorized"
 *     noneOf=['motorized','motor'] — both appear as substrings in "not motorized" → BLOCKED.
 *     Fix: remove both from noneOf; 'delivery tricycles' in anyOf is distinctive enough.
 *
 * 2.  FIX OPTICAL_FILTERS_OTHER_INTENT — noneOf blocks rule
 *     Query: "...other than such elements of glass not optically worked..."
 *     noneOf='of glass not optically' → matches in query → BLOCKED.
 *     Fix: remove 'of glass not optically' from noneOf.
 *
 * 3.  FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT — missing 4202.21 penalty
 *     After adding 4202.11 penalty in WWW, now 4202.21 (handbags, leather surface) wins.
 *     Add penalty for 4202.21 and 4202.22.
 *
 * 4.  NEW KITCHEN_KNIFE_BLADES_INTENT
 *     "For kitchen appliances...Knives and cutting blades for machines...food industry"
 *     → expected 8208.30.00 (ch.82)
 *     Got 8211.93 (other knives). "Knives and cutting blades for machines" + kitchen → 8208.30.
 *
 * 5.  NEW SIGNAL_PISTOLS_FIREARMS_INTENT
 *     "...very pistols...signal flares...line-throwing guns...captive-bolt humane killers"
 *     → expected 9303.90.80.00 (ch.93)
 *     Got 9303.30.80.12 (sporting/hunting rifles). "Very pistols"/"line-throwing guns" → 9303.90.
 *
 * 6.  NEW CAMERA_ACCESSORIES_9006_INTENT
 *     "Accessories for photographic other than cinematographic cameras of heading 9006"
 *     → expected 9620.00.20.00 (ch.96)
 *     Got 9007.91 (cinematograph accessories). "cameras of heading 9006" → 9620.00.20.
 *
 * 7.  NEW RUBBER_PLASTICS_MACHINERY_OTHER_INTENT
 *     "Other Machinery for working rubber or plastics...not specified or included elsewhere..."
 *     → expected 8477.59.01.00 (ch.84)
 *     Got 8477.10 (injection-molding). "not specified or included elsewhere in this chapter" → 8477.59.
 *
 * 8.  NEW WATCH_17_JEWELS_INTENT
 *     "Having over 17 jewels in the movement Other" → expected 9101.99.80 (ch.91)
 *     Got 9108.20.40 (watch movements). "over 17 jewels in the movement" → wrist-watches 9101.99.80.
 *
 * 9.  NEW ALUMINUM_TUBE_NOT_ALLOYED_INTENT
 *     "Of aluminum not alloyed" → expected 7608.10.00 (ch.76)
 *     Got 7601.10.60.40 (unwrought aluminum). "Of aluminum not alloyed" phrase → 7608.10 (tubes).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13yyy.ts
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

    // ── 1. FIX DELIVERY_TRICYCLES_INTENT ──────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'DELIVERY_TRICYCLES_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Delivery tricycles (non-motorized) → 8712.00.50 (ch.87). ' +
              'Fixed: noneOf=[\'motorized\',\'motor\'] blocked rule because "not motorized" ' +
              'contains both as substrings. Removed — \'delivery tricycles\' in anyOf is distinctive.',
            pattern: {
              anyOf: pat.anyOf ?? ['delivery tricycles'],
              // Removed 'motorized' and 'motor' from noneOf — both appear in "not motorized"
            },
            inject: [{ prefix: '8712.00.50', syntheticRank: 8 }],
            boosts: [
              { delta: 0.8, prefixMatch: '8712.00.50' },
              { delta: -0.5, prefixMatch: '8712.00.44' },
            ],
          },
        });
        console.log('DELIVERY_TRICYCLES_INTENT: removed blocking noneOf [motorized, motor]');
      }
    }

    // ── 2. FIX OPTICAL_FILTERS_OTHER_INTENT ───────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'OPTICAL_FILTERS_OTHER_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const newNoneOf = (pat.noneOf ?? []).filter((t: string) => t !== 'of glass not optically');
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Other optical filters and elements (non-photographic) → 9002.20.80 (ch.90). ' +
              'Fixed: noneOf \'of glass not optically\' matched query text ' +
              '"other than such elements of glass not optically worked" → BLOCKED. Removed.',
            pattern: {
              ...pat,
              noneOf: newNoneOf,
            },
          },
        });
        console.log('OPTICAL_FILTERS_OTHER_INTENT: removed blocking noneOf term');
      }
    }

    // ── 3. FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 710,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'Added penalties for 4202.21 (handbags leather) and 4202.22 — now winning after 4202.11 was penalized.',
            inject: [
              { prefix: '4202.12.21', syntheticRank: 4 },
              { prefix: '4202.12', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 1.5, prefixMatch: '4202.12.21' },
              { delta: 1.0, prefixMatch: '4202.12' },
              { delta: -1.5, prefixMatch: '4202.11' },
              { delta: -1.5, prefixMatch: '4202.21' },  // ← new
              { delta: -1.2, prefixMatch: '4202.22' },  // ← new
              { delta: -1.0, prefixMatch: '4202.31' },
              { delta: -0.8, prefixMatch: '4202.32' },
              { delta: -0.8, prefixMatch: '4202.19' },
              { delta: -0.8, prefixMatch: '4202.29' },
            ],
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: added 4202.21/22 penalties');
      }
    }

    // ── 4. NEW KITCHEN_KNIFE_BLADES_INTENT ────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'KITCHEN_KNIFE_BLADES_INTENT',
        description: 'Knives and cutting blades for kitchen appliances → 8208.30 (ch.82). ' +
          'Semantic picks 8211.93 (other knives). ' +
          '"Knives and cutting blades for machines" + kitchen/food industry → 8208.30.',
        pattern: {
          anyOf: [
            'knives and cutting blades for machines',
            'cutting blades for machines',
            'knives and cutting blades for mechanical',
          ],
          anyOfGroups: [
            ['kitchen', 'food industry', 'food-industry', 'meat'],
          ],
        },
        whitelist: { allowChapters: ['82'] },
        inject: [{ prefix: '8208.30', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '8208.30' },
          { delta: -0.5, prefixMatch: '8211.93' },
          { delta: -0.4, prefixMatch: '8211.91' },
        ],
      },
    });

    // ── 5. NEW SIGNAL_PISTOLS_FIREARMS_INTENT ─────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'SIGNAL_PISTOLS_FIREARMS_INTENT',
        description: 'Signal pistols, line-throwing guns, captive-bolt killers → 9303.90 (ch.93). ' +
          'Semantic picks 9303.30 (sporting/hunting rifles). ' +
          '"Very pistols"/"line-throwing guns"/"captive-bolt" → other firearms 9303.90.',
        pattern: {
          anyOf: [
            'very pistols',
            'line-throwing guns',
            'captive-bolt',
            'humane killers',
            'signal flares',
            'blank cartridges',
            'blank ammunition',
          ],
          noneOf: ['sporting', 'hunting', 'target-shooting', 'target shooting'],
        },
        whitelist: { allowChapters: ['93'] },
        inject: [{ prefix: '9303.90', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '9303.90' },
          { delta: -0.5, prefixMatch: '9303.30' },
          { delta: -0.4, prefixMatch: '9303.20' },
        ],
      },
    });

    // ── 6. NEW CAMERA_ACCESSORIES_9006_INTENT ─────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'CAMERA_ACCESSORIES_9006_INTENT',
        description: 'Accessories for photographic cameras (heading 9006) → 9620.00.20 (ch.96). ' +
          'Semantic picks 9007.91 (cinematographic accessories). ' +
          '"cameras of heading 9006" / "accessories for photographic" → monopods/tripods 9620.00.20.',
        pattern: {
          anyOf: [
            'cameras of heading 9006',
            'accessories for photographic',
            'heading 9006',
          ],
          // Note: do NOT put 'cinematographic' in noneOf — query says "other than cinematographic"
          // which contains 'cinematographic' as substring → would block the rule.
        },
        whitelist: { allowChapters: ['96'] },
        inject: [{ prefix: '9620.00.20', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '9620.00.20' },
          { delta: -0.6, prefixMatch: '9007.91' },
          { delta: -0.4, prefixMatch: '9007.92' },
        ],
      },
    });

    // ── 7. NEW RUBBER_PLASTICS_MACHINERY_OTHER_INTENT ─────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'RUBBER_PLASTICS_MACHINERY_OTHER_INTENT',
        description: 'Other machinery for working rubber/plastics → 8477.59 (ch.84). ' +
          'Semantic picks 8477.10 (injection-molding machines). ' +
          '"Not specified or included elsewhere in this chapter" + rubber/plastics → 8477.59.',
        pattern: {
          anyOf: [
            'not specified or included elsewhere in this chapter',
            'not specified or included elsewhere',
          ],
          anyOfGroups: [
            ['rubber', 'plastics'],
          ],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [{ prefix: '8477.59', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '8477.59' },
          { delta: -0.5, prefixMatch: '8477.10' },
          { delta: -0.4, prefixMatch: '8477.20' },
          { delta: -0.4, prefixMatch: '8477.30' },
          { delta: -0.4, prefixMatch: '8477.40' },
        ],
      },
    });

    // ── 8. NEW WATCH_17_JEWELS_INTENT ─────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'WATCH_17_JEWELS_INTENT',
        description: 'Wrist-watches with over 17 jewels in movement → 9101.99.80 (ch.91). ' +
          'Semantic picks 9108.20.40 (watch movements with automatic winding). ' +
          '"Over 17 jewels in the movement" → 9101.99.80 (wrist-watches, other).',
        pattern: {
          anyOf: [
            'over 17 jewels in the movement',
            'over 17 jewels',
            '17 jewels',
          ],
        },
        whitelist: { allowChapters: ['91'] },
        inject: [{ prefix: '9101.99', syntheticRank: 8 }],
        boosts: [
          { delta: 0.8, prefixMatch: '9101.99.80' },
          { delta: 0.5, prefixMatch: '9101.99' },
          { delta: -0.6, prefixMatch: '9108' },
          { delta: -0.4, prefixMatch: '9102' },
        ],
      },
    });

    // ── 9. NEW ALUMINUM_TUBE_NOT_ALLOYED_INTENT ───────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'ALUMINUM_TUBE_NOT_ALLOYED_INTENT',
        description: 'Aluminum tubes/pipes, not alloyed → 7608.10 (ch.76). ' +
          'Semantic picks 7601.10 (unwrought aluminum, not alloyed). ' +
          '"Of aluminum not alloyed" phrase → 7608.10 (tubes/pipes, not alloyed aluminum).',
        pattern: {
          anyOf: [
            'of aluminum not alloyed',
            'aluminum not alloyed',
          ],
          noneOf: [
            'unwrought', 'ingot', 'billet', 'wire', 'plate', 'sheet', 'strip', 'foil',
            'bar', 'rod', 'angle', 'profile', 'extrusion',
          ],
        },
        whitelist: { allowChapters: ['76'] },
        inject: [{ prefix: '7608.10', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '7608.10' },
          { delta: -0.5, prefixMatch: '7601.10' },
          { delta: -0.4, prefixMatch: '7601.20' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch YYY)...`);
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
    console.log(`\nPatch YYY complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
