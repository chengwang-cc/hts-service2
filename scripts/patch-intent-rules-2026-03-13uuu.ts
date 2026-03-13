#!/usr/bin/env ts-node
/**
 * Patch UUU — 2026-03-13:
 *
 * More targeted accuracy improvements.
 *
 * Fixes:
 *
 * 1.  NEW COTTON_YARN_OVER_80NM_INTENT
 *     "Exceeding 80 nm Cotton yarn other than sewing thread containing less than
 *      85 percent by weight of cotton not put up for retail sale"
 *     → expected 5206.15.00.00 (ch.52)
 *     Got 5206.14.00.00. Both 5206. "Exceeding 80 nm" is the distinctive signal
 *     for 5206.15 (above 80 nm vs 5206.14 which is 52.86-80 nm range).
 *
 * 2.  NEW ELASTOMERIC_YARN_GARMENT_INTENT
 *     "Containing 5 percent or more by weight of elastomeric yarn or rubber thread Other"
 *     → expected 6104.62.20.06 (women's trousers of cotton, ch.61)
 *     Got 5205.11.10.00 (cotton yarn, ch.52). Cross-chapter error.
 *     "Elastomeric yarn or rubber thread" as composition of a garment → ch.61.
 *     anyOf + allowChapters=['61'] → inject+boost for 6104.62.
 *
 * 3.  NEW FOOTWEAR_VALUED_OVER_2_50_INTENT
 *     "Other Valued over 2.50/pair" → expected 6403.99.90.31 (ch.64)
 *     Got 6402.19.50.31. Both ch.64. "Valued over $2.50/pair" — price breakpoint
 *     distinguishing 6403.99 (rubber/plastics soled leather upper, over $2.50)
 *     from 6402.19 (rubber outer sole). Need to check 6403 vs 6402 distinction.
 *     Actually: 6403 = footwear with leather uppers; 6402 = rubber/plastics uppers.
 *     "Valued over 2.50/pair" appears in both 6402.19 and 6403.99.
 *     The distinguishing context (leather vs rubber uppers) is missing in the query.
 *     Skip — too risky.
 *
 * 4.  NEW PAPER_LIGHT_UNDER_15_GSM_INTENT
 *     "Other Weighing not over 15 g/m" → expected 4811.90.40.90 (ch.48)
 *     Got 4805.24.50.00. Both ch.48. "Weighing not over 15 g/m" = very lightweight
 *     paper that is coated/treated (4811 = treated paper). 4805 = other paper.
 *     "Not over 15 g/m" + no kraft/sulfate/tissue context → 4811.90 (other treated).
 *
 * 5.  NEW ELECTRICAL_RESISTORS_PARTS_ONLY_INTENT
 *     "Other Parts Electrical resistors including rheostats and potentiometers
 *      other than heating resistors parts thereof"
 *     → expected 8533.90.80.00 (parts of electrical resistors, ch.85)
 *     After TTT fix, ELECTRICAL_RESISTORS_PARTS_INTENT won't fire for this query.
 *     Still need to inject+boost 8533.90 for this specific "Other Parts" context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13uuu.ts
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

    // ── 1. NEW COTTON_YARN_OVER_80NM_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'COTTON_YARN_OVER_80NM_INTENT',
        description: 'Cotton yarn (not sewing thread) >80 nm → 5206.15 (ch.52). ' +
          'Semantic picks 5206.14 (52.86-80 nm). ' +
          '"Exceeding 80 nm" is the distinctive signal for 5206.15 vs 5206.14.',
        pattern: {
          anyOf: ['exceeding 80 nm', 'exceeding 80nm', 'above 80 nm'],
          anyOfGroups: [
            ['cotton', 'yarn'],
          ],
          noneOf: ['sewing thread', 'put up for retail'],
        },
        whitelist: { allowChapters: ['52'] },
        inject: [{ prefix: '5206.15', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '5206.15' },
          { delta: -0.4, prefixMatch: '5206.14' },
        ],
      },
    });

    // ── 2. NEW ELASTOMERIC_YARN_GARMENT_INTENT ────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'ELASTOMERIC_YARN_GARMENT_INTENT',
        description: 'Garments containing elastomeric yarn/rubber thread → 6104.62 (ch.61). ' +
          'Semantic picks 5205 (cotton yarn, ch.52). Cross-chapter error. ' +
          '"Elastomeric yarn or rubber thread" + percent/weight → ch.61 garments.',
        pattern: {
          anyOf: ['elastomeric yarn', 'rubber thread'],
          anyOfGroups: [
            ['percent', 'weight', 'by weight'],
          ],
          noneOf: ['spun', 'twisted', 'doubling', 'carded', 'combed'],
        },
        whitelist: { allowChapters: ['61', '62'] },
        inject: [{ prefix: '6104.62', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '6104.62' }],
      },
    });

    // ── 3. NEW PAPER_LIGHT_UNDER_15_GSM_INTENT ────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PAPER_LIGHT_UNDER_15_GSM_INTENT',
        description: 'Lightweight paper (≤15 g/m²) → 4811.90.40 (ch.48, coated/treated paper). ' +
          'Semantic picks 4805.24 (other paper). ' +
          '"Weighing not over 15 g/m" or "not over 15 g/m²" → lightweight treated paper 4811.90.',
        pattern: {
          anyOf: [
            'weighing not over 15 g/m',
            'not over 15 g/m',
            'weighing not over 15',
          ],
          noneOf: [
            'kraft', 'sulfate', 'tissue', 'newsprint', 'coated',
            'mechanical fiber', 'chemical fiber',
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4811.90.40', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4811.90.40' },
          { delta: -0.4, prefixMatch: '4805.24' },
        ],
      },
    });

    // ── 4. NEW ELECTRICAL_RESISTORS_PARTS_ONLY_INTENT ────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'ELECTRICAL_RESISTORS_PARTS_ONLY_INTENT',
        description: 'Parts of electrical resistors (heading 8533) → 8533.90 (ch.85). ' +
          'The "Parts" heading subheading (8533.90) for resistors/rheostats/potentiometers. ' +
          '"Parts electrical resistors" phrase (query heading context) → 8533.90.',
        pattern: {
          anyOf: [
            'parts electrical resistors',
            'of electrical resistors',
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [{ prefix: '8533.90', syntheticRank: 8 }],
        boosts: [
          { delta: 0.7, prefixMatch: '8533.90' },
          { delta: -0.4, prefixMatch: '8533.39' },
          { delta: -0.4, prefixMatch: '8533.40' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch UUU)...`);
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
    console.log(`\nPatch UUU complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
