#!/usr/bin/env ts-node
/**
 * Patch QQQ — 2026-03-13:
 *
 * Continue improving accuracy. More targeted fixes.
 *
 * Fixes:
 *
 * 1.  NEW GOODS_VEHICLE_5_9T_DIESEL_INTENT
 *     "G.V.W. exceeding 5 metric tons but not exceeding 9 metric tons"
 *     → expected 8704.22.11.20 (ch.87)
 *     Got 8704.22.51.20. Both in 8704.22 (diesel goods trucks).
 *     "not exceeding 9 metric tons" is the key discriminator for 8704.22.11.
 *
 * 2.  NEW PAPER_SHEETS_A4_SIZE_INTENT
 *     "Weighing 40 g/m or more but not more than 150 g/m in sheets with one side
 *      not exceeding 435 mm and the other side not exceeding 297 mm in the unfolded state"
 *     → expected 4802.56.40.00 (ch.48)
 *     Got 4802.56.70.20. Both 4802.56.
 *     "not exceeding 435 mm" and "not exceeding 297 mm" (≈A4/B4 size bounds) → 4802.56.40.
 *
 * 3.  NEW KNITTED_SHIRTS_ARTIFICIAL_FIBERS_INTENT
 *     "Shirts Of artificial fibers" → expected 6103.29.10.50 (ch.61 knitted)
 *     Got 6211.43.05.60 (ch.62 special garments). Cross-chapter.
 *     6103.29 = knitted men's shirts of artificial fibers.
 *     6211.43 = women's/girls' special garments of artificial fibers.
 *     Need to steer short "Shirts Of artificial fibers" → 6103 (knitted shirts).
 *     noneOf women/girls context.
 *
 * 4.  NEW AC_GENERATOR_OVER_50W_INTENT
 *     "Other Of an output exceeding 50 W" → expected 8501.72.90.00 (ch.85)
 *     Got 8504.40.95.20 (static converters).
 *     Context: this comes from AC generators heading. "output exceeding 50 W" +
 *     no inverter/converter/transformer context → 8501.72 (AC generators >75kVA).
 *     Skip — too ambiguous without parent context.
 *
 * 5.  NEW STAINLESS_STEEL_ANGLES_HOT_ROLLED_INTENT
 *     "Other Hot-rolled not drilled not punched and not otherwise advanced
 *      Angles shapes and sections" → expected 7222.40.30.45 (ch.72 stainless)
 *     Got 7228.70.30.10 (other alloy steel).
 *     7222 = stainless steel; 7228 = other alloy steel.
 *     "not drilled not punched and not otherwise advanced" is a distinctive phrase
 *     for hot-rolled stainless steel angles 7222.40.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13qqq.ts
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

    // ── 1. NEW GOODS_VEHICLE_5_9T_DIESEL_INTENT ───────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'GOODS_VEHICLE_5_9T_DIESEL_INTENT',
        description: 'Diesel goods trucks 5-9 metric tons GVW → 8704.22.11 (ch.87). ' +
          'Semantic picks 8704.22.51 (same heading, different weight range). ' +
          '"Not exceeding 9 metric tons" within goods vehicle context → 8704.22.11.',
        pattern: {
          anyOf: [
            'not exceeding 9 metric tons',
            'exceeding 5 metric tons but not exceeding 9',
            'but not exceeding 9 metric tons',
          ],
          anyOfGroups: [
            ['g.v.w.', 'gvw', 'gross vehicle', 'metric tons', 'goods'],
          ],
          noneOf: ['electric', 'electrically', 'battery', 'exceeding 20'],
        },
        whitelist: { allowChapters: ['87'] },
        inject: [{ prefix: '8704.22.11', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '8704.22.11' },
          { delta: -0.4, prefixMatch: '8704.22.51' },
        ],
      },
    });

    // ── 2. NEW PAPER_SHEETS_A4_SIZE_INTENT ────────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PAPER_SHEETS_A4_SIZE_INTENT',
        description: 'Uncoated writing paper in A4-size sheets → 4802.56.40 (ch.48). ' +
          'Semantic picks 4802.56.70. Both 4802.56. ' +
          '"Not exceeding 435 mm" and "not exceeding 297 mm" (A4/B4 bounds) → 4802.56.40.',
        pattern: {
          anyOf: [
            'not exceeding 435 mm',
            'one side not exceeding 435',
            '435 mm and the other side not exceeding 297',
            'not exceeding 297 mm in the unfolded state',
          ],
          anyOfGroups: [
            ['sheets', 'paper', 'paperboard'],
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4802.56.40', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4802.56.40' },
          { delta: -0.4, prefixMatch: '4802.56.70' },
        ],
      },
    });

    // ── 3. NEW KNITTED_SHIRTS_ARTIFICIAL_FIBERS_INTENT ────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'KNITTED_SHIRTS_ARTIFICIAL_FIBERS_INTENT',
        description: 'Men\'s knitted shirts of artificial fibers → 6103.29 (ch.61). ' +
          'Semantic picks 6211.43 (ch.62 special garments). ' +
          '"Shirts Of artificial fibers" without women/woven context → 6103.29.',
        pattern: {
          anyOf: ['artificial fibers', 'artificial fiber', 'of artificial'],
          anyOfGroups: [
            ['shirts', 'shirt'],
          ],
          noneOf: [
            'women', 'girls', 'woven', 'not knitted',
            'special garments', 'swimwear', 'ski suits', 'tracksuits',
          ],
        },
        whitelist: { allowChapters: ['61'] },
        inject: [{ prefix: '6103.29', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '6103.29' }],
      },
    });

    // ── 4. NEW STAINLESS_ANGLES_HOT_ROLLED_INTENT ─────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'STAINLESS_ANGLES_HOT_ROLLED_INTENT',
        description: 'Stainless steel angles/shapes/sections, hot-rolled, not advanced → 7222.40 (ch.72). ' +
          'Semantic picks 7228.70 (other alloy steel). ' +
          '"Not drilled not punched and not otherwise advanced" + "angles shapes sections" → 7222.40.',
        pattern: {
          anyOf: [
            'not drilled not punched and not otherwise advanced',
            'not drilled not punched',
            'not punched and not otherwise advanced',
          ],
          anyOfGroups: [
            ['angles', 'shapes', 'sections'],
          ],
        },
        whitelist: { allowChapters: ['72'] },
        inject: [{ prefix: '7222.40', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '7222.40' },
          { delta: -0.4, prefixMatch: '7228.70' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch QQQ)...`);
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
    console.log(`\nPatch QQQ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
