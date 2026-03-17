#!/usr/bin/env ts-node
/**
 * Patch WWWW — 2026-03-13:
 *
 * Fix TSHIRT_INTENT: add boosts so injected 6109 entries score above 0.25 threshold.
 *
 * Problem: "50% polyester 38% cotton 12% rayon t-shirt" → EMPTY.
 * TSHIRT_INTENT fires on 'tshirt' token and inject adds 6109 codes.
 * But after normalization, 6109 entries score ~0.24 (just below 0.25 threshold) → EMPTY.
 *
 * Fix: Add prefixMatch boosts for 6109/6110 to push scores above threshold.
 *
 * Also fix similar issue with HOODIE_SWEATSHIRT_INTENT which has allowChapters=['61']
 * but no inject/boosts. Hoodies/sweatshirts that don't semantically match well → EMPTY.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13wwww.ts
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

    // ── TSHIRT_INTENT: add boosts for 6109 codes ─────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'TSHIRT_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 6,
          rule: {
            ...existing,
            description: (existing.description ?? 'TSHIRT_INTENT') +
              ' — Fixed WWWW: added boosts for 6109/6110 codes to push above 0.25 score threshold.',
            boosts: [
              { delta: 0.5, prefixMatch: '6109' }, // T-shirts, singlets, tank tops (knit)
              { delta: 0.3, prefixMatch: '6110' }, // Jerseys, pullovers, sweatshirts (knit)
            ],
          },
        });
        console.log('TSHIRT_INTENT: adding boosts for 6109/6110');
      } else {
        console.log('WARNING: TSHIRT_INTENT not found');
      }
    }

    // ── HOODIE_SWEATSHIRT_INTENT: add inject + boosts ────────────────────────
    {
      const existing = allRules.find(r => r.id === 'HOODIE_SWEATSHIRT_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 404,
          rule: {
            ...existing,
            description: (existing.description ?? 'HOODIE_SWEATSHIRT_INTENT') +
              ' — Fixed WWWW: added inject/boosts for 6110 codes.',
            inject: [
              { prefix: '6110.30.30', syntheticRank: 9 }, // MMF sweatshirts/hoodies
              { prefix: '6110.20.20', syntheticRank: 8 }, // Cotton sweatshirts/hoodies
              { prefix: '6110.30.10', syntheticRank: 7 }, // MMF overcoats/jerseys knit
            ],
            boosts: [
              { delta: 0.5, prefixMatch: '6110' },
            ],
          },
        });
        console.log('HOODIE_SWEATSHIRT_INTENT: adding inject + boosts for 6110');
      } else {
        console.log('WARNING: HOODIE_SWEATSHIRT_INTENT not found');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch WWWW)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch WWWW complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
