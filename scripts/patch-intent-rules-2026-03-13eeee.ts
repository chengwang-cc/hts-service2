#!/usr/bin/env ts-node
/**
 * Patch EEEE — 2026-03-13:
 *
 * Final trunks fix: add allowChapters=['42'] to TRUNKS rule.
 *
 * Root cause recap:
 *   Multiple rules fire for the long trunks query, each with restrictive
 *   allowChapters (e.g., AI_CH59 allows only ch.59/39). Since the OR logic
 *   requires the entry to pass at least one rule's allow filter, and no fired
 *   rule allows ch.42, ALL ch.42 entries (including 4202.12.21) are blocked.
 *
 * Fix:
 *   Add allowChapters=['42'] to TRUNKS_OUTER_SURFACE_PLASTICS_INTENT.
 *   This ensures 4202.12.xx entries pass the allow check via the TRUNKS rule.
 *   Combined with denyPrefixes for 4202.3x/4202.2x/4202.9x, only 4202.12.xx
 *   will survive from ch.42, and the inject+boost ensures 4202.12.21 wins.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13eeee.ts
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

    // ── FIX TRUNKS: add allowChapters=['42'] to the whitelist ─────────────────
    // Problem: other rules (AI_CH59, etc.) fire with allowChapters=['59','39'],
    // and since OR logic requires at least one allow-rule to pass, ch.42 entries
    // are all blocked (no fired rule explicitly allows ch.42).
    // Solution: add allowChapters=['42'] to TRUNKS whitelist so ch.42 entries
    // pass the allow check via the TRUNKS rule. Combined with denyPrefixes, only
    // 4202.12.xx entries from ch.42 survive.
    {
      const existing = allRules.find(r => r.id === 'TRUNKS_OUTER_SURFACE_PLASTICS_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 720,
          rule: {
            ...existing,
            description: 'Trunks/suitcases outer surface plastics/textile → 4202.12.21 (ch.42). ' +
              'allowChapters=[42] ensures ch.42 entries pass OR-logic allow check even when ' +
              'other fired rules restrict to different chapters. ' +
              'denyPrefixes blocks all 4202.xx except 4202.12.',
            whitelist: {
              allowChapters: ['42'],
              denyPrefixes: [
                '4202.11', '4202.19',
                '4202.21', '4202.22', '4202.29',
                '4202.31', '4202.32', '4202.39',
                '4202.91', '4202.92', '4202.99',
              ],
            },
          },
        });
        console.log('TRUNKS_OUTER_SURFACE_PLASTICS_INTENT: added allowChapters=[42] + denyPrefixes');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch EEEE)...`);
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
    console.log(`\nPatch EEEE complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
