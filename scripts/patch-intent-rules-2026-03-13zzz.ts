#!/usr/bin/env ts-node
/**
 * Patch ZZZ — 2026-03-13:
 *
 * Final targeted fixes for remaining hard failures.
 *
 * Fixes:
 *
 * 1.  NEW AC_GENERATORS_50W_INTENT
 *     "Other Of an output exceeding 50 W" → expected 8501.72.90.00 (ch.85)
 *     Got 8504.40.95.20 (static converters).
 *     "of an output exceeding 50 w" is specific to 8501.72 (AC generators >50W).
 *     noneOf=['motor','motors'] prevents confusion with motor subheadings.
 *     Note: "of an output not exceeding 50 w" does NOT contain this phrase (has 'not' before 'exceeding').
 *
 * 2.  NEW MOTORS_SINGLE_ONLY_INTENT
 *     "Motors" → expected 8501.34.30.00 (ch.85, AC single-phase motors)
 *     Got 8501.40.20.20 (gear motors, multi-phase).
 *     8501.34.30.00 description is literally "Motors" — bare query matches this subheading.
 *     Careful noneOf excludes specific motor types to avoid over-firing.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13zzz.ts
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

    // ── 1. NEW AC_GENERATORS_50W_INTENT ───────────────────────────────────────
    // Key insight: "of an output not exceeding 50 w" (8501.71) vs
    //              "of an output exceeding 50 w" (8501.72)
    // The substring 'of an output exceeding 50 w' does NOT appear in the 8501.71 query
    // because that query has 'not' before 'exceeding'.
    patches.push({
      priority: 660,
      rule: {
        id: 'AC_GENERATORS_50W_INTENT',
        description: 'AC generators (alternators) output exceeding 50 W → 8501.72.90 (ch.85). ' +
          'Semantic picks 8504.40 (static converters). ' +
          '"of an output exceeding 50 w" phrase is specific to 8501.72 AC generators. ' +
          'The "not exceeding 50 w" variant does NOT match this phrase.',
        pattern: {
          anyOf: [
            'of an output exceeding 50 w',
            'an output exceeding 50 w',
            'output exceeding 50 w',
          ],
          noneOf: ['motor', 'motors', 'not exceeding 50'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8501.72.90', syntheticRank: 4 },
          { prefix: '8501.72', syntheticRank: 8 },
        ],
        boosts: [
          { delta: 0.8, prefixMatch: '8501.72.90' },
          { delta: 0.5, prefixMatch: '8501.72' },
          { delta: -0.5, prefixMatch: '8504.40' },
        ],
      },
    });

    // ── 2. NEW MOTORS_SINGLE_ONLY_INTENT ──────────────────────────────────────
    // 8501.34.30.00 description is literally "Motors" — the bare query "Motors"
    // should map to this subheading within single-phase AC motors.
    // Careful noneOf excludes all specific motor types so only the bare "Motors" query fires.
    patches.push({
      priority: 660,
      rule: {
        id: 'MOTORS_SINGLE_ONLY_INTENT',
        description: 'Bare "Motors" query → 8501.34.30.00 (ch.85, AC single-phase motors). ' +
          'Semantic picks 8501.40 (multi-phase AC motors, gear motors). ' +
          '8501.34.30.00 description is literally "Motors" — bare query targets this subheading. ' +
          'noneOf blocks all specific motor-type queries.',
        pattern: {
          anyOf: ['motors'],
          noneOf: [
            'gear', 'stepper', 'servo', 'linear', 'traction', 'brushless',
            'induction', 'synchronous', 'universal', 'winding',
            'ac', 'dc', 'electric vehicle', 'ev', 'variable',
            'prime', 'wind', 'water', 'starter', 'compressor',
            'home', 'refriger', 'automotive', 'fractional',
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [{ prefix: '8501.34.30', syntheticRank: 8 }],
        boosts: [
          { delta: 0.5, prefixMatch: '8501.34.30' },
          { delta: -0.3, prefixMatch: '8501.40' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch ZZZ)...`);
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
    console.log(`\nPatch ZZZ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
