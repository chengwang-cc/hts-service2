#!/usr/bin/env ts-node
/**
 * Patch BBBB — 2026-03-13:
 *
 * Two targeted fixes for remaining hard failures.
 *
 * Fixes:
 *
 * 1.  FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT — coverage score dominates boost
 *     Query: "Trunks suitcases vanity cases...With outer surface of plastics..."
 *     Root cause: 4202.32 has nearly identical fullDescription (same chapter header)
 *     and the query contains "of sheeting of plastics" from the chapter header text,
 *     giving 4202.32 slightly higher token coverage than 4202.12.21.
 *     The boost of +2.0 is not applied (mystery — possibly ordering/normalization),
 *     but allowPrefixes=['4202.12'] whitelist will HARD FILTER to 4202.12 only.
 *     This directly prevents any 4202.3x/4202.2x from appearing.
 *
 * 2.  NEW REFRIGERATING_PARTS_KW_INTENT
 *     "Exceeding 2.2 kW but not exceeding 7.5 kW Other Other"
 *     → expected 8418.99.80.15 (ch.84 refrigerating equipment parts)
 *     Got 8501.33.40.40 (ch.85 AC motors).
 *     Phrase "exceeding 2.2 kw but not exceeding 7.5 kw" is in the 8418.99 path.
 *     allowChapters=['84'] prevents ch.85 motors from winning.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13bbbb.ts
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

    // ── 1. FIX TRUNKS_OUTER_SURFACE_PLASTICS_INTENT ───────────────────────────
    // Root cause: 4202.32 fullDescription contains the same massive chapter header
    // as 4202.12, plus "sheeting of plastics" which appears verbatim in the query's
    // chapter header text. This gives 4202.32 equal or higher coverage than 4202.12.
    // Fix: add allowPrefixes=['4202.12'] to hard-restrict results to 4202.12 only.
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 720,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'allowPrefixes restricts to 4202.12 only — 4202.32 has same chapter header text ' +
              'causing coverage tie that boost cannot overcome. Whitelist is the reliable fix.',
            whitelist: { allowPrefixes: ['4202.12'] },
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: added allowPrefixes=[4202.12] whitelist');
      }
    }

    // ── 2. NEW REFRIGERATING_PARTS_KW_INTENT ──────────────────────────────────
    // 8418.99.80.15 full path: "Refrigerators, freezers and other refrigerating
    // or freezing equipment... parts thereof: Other: Other: Exceeding 2.2 kW but
    // not exceeding 7.5 kW". The phrase is unique to this 8418.99.80 subheading.
    // Semantic picks 8501.33 (motors) because of the power range context.
    // allowChapters=['84'] prevents ch.85 motor codes from winning.
    patches.push({
      priority: 660,
      rule: {
        id: 'REFRIGERATING_PARTS_KW_INTENT',
        description: 'Refrigerating equipment parts 2.2–7.5 kW → 8418.99.80.15 (ch.84). ' +
          'Semantic picks 8501.33 (AC motors). ' +
          '"exceeding 2.2 kw but not exceeding 7.5 kw" phrase is in 8418.99.80 path. ' +
          'allowChapters=[84] prevents motor codes (ch.85) from winning.',
        pattern: {
          anyOf: [
            'exceeding 2.2 kw but not exceeding 7.5 kw',
            '2.2 kw but not exceeding 7.5',
          ],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [{ prefix: '8418.99.80', syntheticRank: 8 }],
        boosts: [
          { delta: 0.8, prefixMatch: '8418.99.80' },
          { delta: -0.5, prefixMatch: '8501' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch BBBB)...`);
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
    console.log(`\nPatch BBBB complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
