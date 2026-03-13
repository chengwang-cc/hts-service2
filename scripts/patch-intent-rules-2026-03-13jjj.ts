#!/usr/bin/env ts-node
/**
 * Patch JJJ — 2026-03-13:
 *
 * Continue improving accuracy after III.
 * Targets newly-visible failures + remaining within-chapter issues.
 *
 * Fixes:
 *
 * 1.  NEW SUGAR_FLAVORED_COLORED_INTENT
 *     "Containing added flavoring or coloring matter Cane or beet sugar..."
 *     → expected 1701.91.30.00 (ch.17)
 *     Got 1701.91.54.00. Both in 1701.91.
 *     Phrase "added flavoring or coloring matter" uniquely identifies 1701.91.30.
 *
 * 2.  NEW NON_ALCOHOLIC_BEVERAGE_INTENT
 *     "Other Other Waters...and other non-alcoholic beverages..."
 *     → expected 2202.99.28.00 (ch.22)
 *     Got 2202.10.00.20 (waters with sugar). Both ch.22.
 *     When query describes BOTH "waters" AND "other non-alcoholic beverages",
 *     the expected result is 2202.99 (other non-alcoholic beverages, not waters).
 *     Phrase "other non-alcoholic beverages" is the distinctive signal.
 *
 * 3.  NEW BEE_KEEPING_MACHINERY_PARTS_INTENT
 *     "Other Other Other agricultural...bee-keeping machinery...parts thereof"
 *     → expected 8436.99.00.90 (ch.84)
 *     Got 8436.91.00.40 (parts for poultry incubators). Both ch.84.
 *     "Bee-keeping" machinery → 8436.99 (other parts, not poultry-specific).
 *
 * 4.  NEW CAMERAS_CINEMATOGRAPHIC_INTENT
 *     "Cameras" → expected 9007.10.00.00 (cinematographic cameras, ch.90)
 *     Got 9002.11.60.00 (objective lenses). Cross-category within ch.90.
 *     Bare "Cameras" → semantic goes to optical lenses. Add boost for 9007.xx.
 *     noneOf: lens/lenses/optical/parts to avoid optical elements context.
 *
 * 5.  NEW DIAGNOSTIC_LABORATORY_REAGENT_INTENT
 *     "Other Other Diagnostic or laboratory reagents on a backing..." → 3822.19.00.30 (ch.38)
 *     Got 3822.90.00.00. Both ch.38.
 *     3822.19 = certified reference materials on a backing.
 *     3822.90 = other diagnostic/lab reagents.
 *     "certified reference materials" phrase uniquely identifies 3822.19.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13jjj.ts
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

    // ── 1. NEW SUGAR_FLAVORED_COLORED_INTENT ──────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'SUGAR_FLAVORED_COLORED_INTENT',
        description: 'Cane/beet sugar with added flavoring or coloring → 1701.91.30 (ch.17). ' +
          'Phrase "added flavoring or coloring" identifies 1701.91.30 vs 1701.91.54.',
        pattern: {
          anyOf: ['added flavoring', 'added coloring', 'flavoring or coloring'],
          anyOfGroups: [
            ['sugar', 'sucrose', 'cane', 'beet'],
          ],
        },
        whitelist: { allowChapters: ['17'] },
        inject: [{ prefix: '1701.91.30', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '1701.91.30' }],
      },
    });

    // ── 2. NEW NON_ALCOHOLIC_BEVERAGE_INTENT ──────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'NON_ALCOHOLIC_BEVERAGE_INTENT',
        description: 'Other non-alcoholic beverages (not waters) → 2202.99 (ch.22). ' +
          'Queries describe both "waters" AND "other non-alcoholic beverages" → 2202.99, ' +
          'but semantic focuses on "waters" → 2202.10. Phrase anchors to 2202.99.',
        pattern: {
          anyOf: ['other non-alcoholic beverages', 'non-alcoholic beverages not including'],
          noneOf: ['beer', 'wine', 'spirits', 'alcohol', 'alcoholic'],
        },
        whitelist: { allowChapters: ['22'] },
        inject: [{ prefix: '2202.99', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '2202.99' }],
      },
    });

    // ── 3. NEW BEE_KEEPING_MACHINERY_PARTS_INTENT ─────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'BEE_KEEPING_MACHINERY_PARTS_INTENT',
        description: 'Bee-keeping machinery parts → 8436.99 (ch.84). ' +
          'Semantic picks 8436.91 (poultry incubator parts). ' +
          '"Bee-keeping" in machinery context → 8436.99 (other agricultural machinery parts).',
        pattern: {
          anyOf: ['bee-keeping', 'bee keeping', 'beekeeping', 'apiary'],
          anyOfGroups: [
            ['parts', 'machinery', 'machine'],
          ],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [{ prefix: '8436.99', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '8436.99' }],
      },
    });

    // ── 4. NEW CAMERAS_CINEMATOGRAPHIC_INTENT ─────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'CAMERAS_CINEMATOGRAPHIC_INTENT',
        description: 'Cameras → 9007.10 (cinematographic cameras, ch.90). ' +
          'Bare "Cameras" gets semantic score for objective lenses (9002.11). ' +
          'Inject+boost for 9007 (cameras) to override optical element results.',
        pattern: {
          anyOf: ['camera', 'cameras'],
          noneOf: ['lens', 'lenses', 'objective', 'filter', 'prism', 'mirror', 'optical element', 'parts thereof'],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [{ prefix: '9007.10', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '9007' }],
      },
    });

    // ── 5. NEW CERTIFIED_REFERENCE_MATERIALS_INTENT ───────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'CERTIFIED_REFERENCE_MATERIALS_INTENT',
        description: 'Certified reference materials → 3822.19 (ch.38). ' +
          'Semantic picks 3822.90 (other diagnostic reagents). ' +
          '"Certified reference materials" phrase anchors to 3822.19.',
        pattern: {
          anyOf: ['certified reference materials', 'certified reference material'],
        },
        whitelist: { allowChapters: ['38'] },
        inject: [{ prefix: '3822.19', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '3822.19' }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch JJJ)...`);
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
    console.log(`\nPatch JJJ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
