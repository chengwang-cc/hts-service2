#!/usr/bin/env ts-node
/**
 * Patch ZZZZ — 2026-03-14:
 *
 * Adding penalties to existing rules (2):
 * 1. SILVER_BULLION_SCRAP_INTENT: add penalty for 7114 (silverware) prefix
 *    "Sterling silver shavings" → 7106.10 expected; 7114.11 (silverware) wins due to
 *    "sterling silver" token overlap in 7114 description vs "Powder" in 7106.10.
 *    Solution: penalize 7114 entries when silver bullion/scrap intent fires.
 *    Also: revert inject ranks from 28/26/24 back to 9/8/7 (lower rank = higher rrf).
 *
 * 2. POLYSTYRENE_FOAM_RAW_INTENT: add penalty for 3923 (plastic containers) prefix
 *    "HDPE Plastic Block" → 3901.10 expected; 3923.21 (plastic boxes) wins due to
 *    'plastic' token match in 3923 descriptions vs technical 3901 description.
 *    Solution: penalize 3923 entries (plastic containers) when raw material intent fires.
 *    Also: increase boost delta for 3901 prefix from default to 1.0.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14zzzz.ts
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

    // ── 1. SILVER_BULLION_SCRAP_INTENT: add penalty for 7114 silverware ───────
    // Problem: "sterling silver shavings" → 7114.11 wins because:
    //   - 7114.11 description: "With sterling silver handles" → 'sterling'+'silver' tokens match → high coverage
    //   - 7106.10 description: "Powder" → zero token overlap with "sterling silver shavings"
    //   - intentBoost for 7106.10 = 1.1 (0.5+0.4+0.2) not enough to overcome coverage advantage
    // Fix: penalize 7114 by 1.5 when silver bullion intent fires + revert inject to rank=9
    {
      const existing = allRules.find(r => r.id === 'SILVER_BULLION_SCRAP_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SILVER_BULLION_SCRAP_INTENT') + ' — Fixed ZZZZ: add 7114 penalty + revert inject ranks to 9',
            inject: [
              { prefix: '7106.10', syntheticRank: 9 }, // Silver powder - lower rank = higher rrf
              { prefix: '7106.91', syntheticRank: 8 }, // Unwrought silver
              { prefix: '7106.92', syntheticRank: 7 }, // Semi-manufactured silver
            ],
            boosts: [
              { delta: 1.0, prefixMatch: '7106' }, // Higher boost for silver powder/bullion codes
              { delta: 0.4, chapterMatch: '71' },
            ],
            penalties: [
              { delta: 1.5, prefixMatch: '7114' }, // Penalize silverware when shavings/powder intent
              { delta: 1.0, prefixMatch: '7113' }, // Penalize fine jewelry when bullion intent
            ],
          } as IntentRule,
        });
        console.log('SILVER_BULLION_SCRAP_INTENT: adding 7114 penalty + revert inject ranks + boost 1.0');
      } else {
        console.log('WARNING: SILVER_BULLION_SCRAP_INTENT not found');
      }
    }

    // ── 2. POLYSTYRENE_FOAM_RAW_INTENT: add penalty for 3923 containers ───────
    // Problem: "HDPE Plastic Block" → 3923.21 (plastic boxes) wins because:
    //   - 3923.21 description has 'plastic' token that matches query
    //   - 3901.10 description: "Polyethylene having a specific gravity less than 0.94" — no 'hdpe'/'plastic'
    //   - inject for 3901.10 rank=26 not enough to beat 3923's coverage advantage
    // Fix: penalize 3923 (plastic containers/boxes) when raw plastic material intent fires
    {
      const existing = allRules.find(r => r.id === 'POLYSTYRENE_FOAM_RAW_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'POLYSTYRENE_FOAM_RAW_INTENT') + ' — Fixed ZZZZ: add 3923/3924/3922 penalties for plastic containers',
            inject: [
              { prefix: '3903.19', syntheticRank: 9 }, // Polystyrene, other
              { prefix: '3901.10', syntheticRank: 8 }, // Polyethylene, ≤0.94 density
              { prefix: '3901.20', syntheticRank: 7 }, // Polyethylene, >0.94 density
              { prefix: '3902.10', syntheticRank: 6 }, // Polypropylene
            ],
            boosts: [
              { delta: 1.0, prefixMatch: '3903.1' }, // Polystyrene codes
              { delta: 1.0, prefixMatch: '3901' }, // Polyethylene codes
              { delta: 0.4, chapterMatch: '39' },
            ],
            penalties: [
              { delta: 1.5, prefixMatch: '3923' }, // Plastic containers/boxes/bottles
              { delta: 1.0, prefixMatch: '3924' }, // Plastic tableware/kitchenware
              { delta: 1.0, prefixMatch: '3922' }, // Plastic baths/shower trays
            ],
          } as IntentRule,
        });
        console.log('POLYSTYRENE_FOAM_RAW_INTENT: adding 3923/3924 penalties + boost 1.0');
      } else {
        console.log('WARNING: POLYSTYRENE_FOAM_RAW_INTENT not found');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch ZZZZ)...`);
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
    console.log(`\nPatch ZZZZ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
