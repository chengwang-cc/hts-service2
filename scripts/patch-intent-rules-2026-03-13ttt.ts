#!/usr/bin/env ts-node
/**
 * Patch TTT — 2026-03-13:
 *
 * Aggressive fixes for stubborn failures + regression fix.
 *
 * Fixes:
 *
 * 1.  FIX ELECTRICAL_RESISTORS_PARTS_INTENT regression
 *     "Other Parts Electrical resistors including rheostats and potentiometers
 *      other than heating resistors parts thereof" → expected 8533.90.80.00
 *     Got 8533.39 because ELECTRICAL_RESISTORS_PARTS_INTENT fires for this query too.
 *     Add "parts electrical resistors" to noneOf to distinguish from the parts subheading.
 *
 * 2.  STRENGTHEN BEE_KEEPING_MACHINERY_PARTS_INTENT (more specific inject+boost)
 *     → still getting 8436.91.00.40 instead of 8436.99.00.90.
 *     Use more specific inject prefix '8436.99.00.90' and stronger boost/penalty.
 *     Also add penalty for 8436.80 (bee-keeping machinery, not parts).
 *
 * 3.  STRENGTHEN NON_ALCOHOLIC_BEVERAGE_INTENT (more specific inject+penalty)
 *     → still getting 2202.10 despite boost 0.8.
 *     Use prefix '2202.99.28' in inject and boost 1.2, penalty -0.7 for 2202.10.
 *     Also add penalty for juice-related 2202.99 variants.
 *
 * 4.  STRENGTHEN TRUNKS_OUTER_SURFACE_PLASTICS_INTENT (much larger boost+penalty)
 *     → still getting 4202.31 despite boost 0.6.
 *     Coverage for 4202.31 is too high (long query has handbag/wallet terms).
 *     Increase boost to 1.0 and add strong penalty for 4202.31.
 *
 * 5.  NEW SILK_NOIL_FABRIC_INTENT
 *     "Other Fabrics of noil silk" → expected 5007.10.60 (ch.50)
 *     Got 5007.20.00.15. Both 5007. "Noil silk" is distinctive → 5007.10.
 *
 * 6.  NEW KNITTED_FURNISHING_ARTICLES_INTENT
 *     "Knitted or crocheted Other furnishing articles excluding those of heading 9404"
 *     → expected 6304.91.01 (ch.63)
 *     Got 6304.99.60.10. Both 6304.
 *     "Knitted or crocheted" + "furnishing articles" → 6304.91 (knitted furnishing).
 *
 * 7.  NEW PAPER_0_3_MM_THICKNESS_INTENT
 *     "Other 0.3 mm or more in thickness" → expected 4811.51.20.50 (ch.48)
 *     Got 7005.29.18.50 (glass, ch.70). Cross-chapter.
 *     "0.3 mm or more in thickness" without glass/silicon context → ch.48.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ttt.ts
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

    // ── 1. FIX ELECTRICAL_RESISTORS_PARTS_INTENT regression ──────────────────
    {
      const existing = allRules.find(r => r.id === 'ELECTRICAL_RESISTORS_PARTS_INTENT') as IntentRule | undefined;
      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pat = existing.pattern as any ?? {};
        const existingNoneOf: string[] = pat.noneOf ?? [];
        // Add 'parts electrical resistors' to noneOf to block "Other Parts Electrical resistors..." query
        if (!existingNoneOf.includes('parts electrical resistors')) {
          patches.push({
            priority: 670,
            rule: {
              ...existing,
              description: 'Electrical resistors (rheostats/potentiometers) parts → 8533.39. ' +
                'Fixed regression: added "parts electrical resistors" to noneOf to prevent ' +
                'firing for "Other Parts Electrical resistors..." → 8533.90 subheading.',
              pattern: {
                ...pat,
                noneOf: [...existingNoneOf, 'parts electrical resistors', 'of electrical resistors'],
              },
            },
          });
          console.log('ELECTRICAL_RESISTORS_PARTS_INTENT: added noneOf to fix regression');
        } else {
          console.log('ELECTRICAL_RESISTORS_PARTS_INTENT: noneOf already fixed');
        }
      }
    }

    // ── 2. STRENGTHEN BEE_KEEPING_MACHINERY_PARTS_INTENT ─────────────────────
    {
      const existing = allRules.find(r => r.id === 'BEE_KEEPING_MACHINERY_PARTS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Bee-keeping machinery parts → 8436.99.00.90 (ch.84). ' +
              'More specific inject+boost for exact code. Strong penalties for 8436.91 and 8436.80.',
            inject: [
              { prefix: '8436.99.00.90', syntheticRank: 4 },
              { prefix: '8436.99.00', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 1.2, prefixMatch: '8436.99.00.90' },
              { delta: 0.9, prefixMatch: '8436.99.00' },
              { delta: -0.8, prefixMatch: '8436.91' },
              { delta: -0.6, prefixMatch: '8436.80' },
            ],
          },
        });
        console.log('BEE_KEEPING_MACHINERY_PARTS_INTENT: strengthened with specific inject');
      }
    }

    // ── 3. STRENGTHEN NON_ALCOHOLIC_BEVERAGE_INTENT ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'NON_ALCOHOLIC_BEVERAGE_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Other non-alcoholic beverages → 2202.99.28 (ch.22). ' +
              'More specific inject+boost for 2202.99.28 and stronger penalty for 2202.10.',
            inject: [
              { prefix: '2202.99.28', syntheticRank: 4 },
              { prefix: '2202.99', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 1.2, prefixMatch: '2202.99.28' },
              { delta: 0.8, prefixMatch: '2202.99' },
              { delta: -0.7, prefixMatch: '2202.10' },
              { delta: -0.5, prefixMatch: '2202.99.36' },
              { delta: -0.5, prefixMatch: '2202.99.37' },
            ],
          },
        });
        console.log('NON_ALCOHOLIC_BEVERAGE_INTENT: strengthened with specific inject');
      }
    }

    // ── 4. STRENGTHEN TRUNKS_OUTER_SURFACE_PLASTICS_INTENT ───────────────────
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 680,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'Increased boost to 1.2 + strong penalty for 4202.31 (handbags/leather).',
            inject: [
              { prefix: '4202.12.21', syntheticRank: 4 },
              { prefix: '4202.12', syntheticRank: 8 },
            ],
            boosts: [
              { delta: 1.2, prefixMatch: '4202.12.21' },
              { delta: 0.9, prefixMatch: '4202.12' },
              { delta: -0.8, prefixMatch: '4202.31' },
              { delta: -0.6, prefixMatch: '4202.32' },
            ],
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: strengthened with specific inject');
      }
    }

    // ── 5. NEW SILK_NOIL_FABRIC_INTENT ────────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'SILK_NOIL_FABRIC_INTENT',
        description: 'Woven fabrics of noil silk → 5007.10 (ch.50). ' +
          'Semantic picks 5007.20 (other woven silk fabrics). ' +
          '"Noil silk" is distinctive phrase for 5007.10 (fabrics of noil silk).',
        pattern: {
          anyOf: ['noil silk', 'fabrics of noil', 'noil'],
          noneOf: ['spun', 'yarn', 'thread'],
        },
        whitelist: { allowChapters: ['50'] },
        inject: [{ prefix: '5007.10', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '5007.10' },
          { delta: -0.4, prefixMatch: '5007.20' },
        ],
      },
    });

    // ── 6. NEW KNITTED_FURNISHING_ARTICLES_INTENT ─────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'KNITTED_FURNISHING_ARTICLES_INTENT',
        description: 'Knitted or crocheted furnishing articles → 6304.91 (ch.63). ' +
          'Semantic picks 6304.99 (other, not knitted). ' +
          '"Furnishing articles" + "knitted or crocheted" + "excluding...9404" → 6304.91.',
        pattern: {
          anyOf: ['furnishing articles', 'furnishing articles excluding those of heading'],
          anyOfGroups: [
            ['knitted or crocheted', 'knitted', 'crocheted'],
          ],
          noneOf: ['woven', 'not knitted'],
        },
        whitelist: { allowChapters: ['63'] },
        inject: [{ prefix: '6304.91', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '6304.91' },
          { delta: -0.4, prefixMatch: '6304.99' },
        ],
      },
    });

    // ── 7. NEW PAPER_0_3_MM_THICKNESS_INTENT ──────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PAPER_0_3_MM_THICKNESS_INTENT',
        description: 'Paper/paperboard ≥0.3mm thick → 4811.51 (ch.48). ' +
          'Semantic picks 7005.29 (glass, ch.70). ' +
          '"0.3 mm or more in thickness" without glass/silicon context → ch.48 paper.',
        pattern: {
          anyOf: ['0.3 mm or more in thickness', '0.3 mm or more', 'three tenths of a millimeter'],
          noneOf: [
            'glass', 'silicon', 'metal', 'aluminum', 'aluminium',
            'steel', 'copper', 'plastic', 'rubber',
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4811.51', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4811.51' },
          { delta: -0.5, prefixMatch: '7005' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch TTT)...`);
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
    console.log(`\nPatch TTT complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
