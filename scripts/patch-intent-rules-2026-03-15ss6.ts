#!/usr/bin/env ts-node
/**
 * Patch SS6 — 2026-03-15: Boost inject syntheticRank for key motor/engine rules.
 * Problem: syntheticRank=22 produces too-low RRF score (~0.012) — gets beaten by
 * lexical/semantic results (rank 1-5 → 0.016+). Need rank 3-8 for injected candidates.
 *
 * Fixes:
 *  1. MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: inject 8501.20 at rank 3 (was 22)
 *     "Rotisserie bbq motor" → expected 8501.20.20, inject not surfacing in top 10
 *  2. ENGINE_BEARING_SET_INTENT: inject 8409.91/8409.99 at rank 5 (was 22)
 *     "bearing set" → 8409 should beat 8483
 *  3. MOTORCYCLE_ENGINE_PARTS_INTENT: inject 8409 at rank 5 (was 20)
 *     "motorcycle engine parts" → 8409.91.30 at rank 8 now, could be rank 1
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss6.ts
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

    const setInject = (e: IntentRule, specs: Array<{ prefix: string; syntheticRank: number }>) => {
      const existing = (e as any).inject ?? [];
      const prefixSet = new Set(specs.map(s => s.prefix));
      // Keep existing injections for other prefixes, replace specified ones
      const kept = existing.filter((s: any) => !prefixSet.has(s.prefix));
      return [...kept, ...specs];
    };

    // 1. MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: boost inject rank 22→3
    {
      const e = allRules.find(r => r.id === 'MOTOR_SMALL_BBQ_ROTISSERIE_INTENT');
      if (e) {
        const newInject = setInject(e, [{ prefix: '8501.20', syntheticRank: 3 }]);
        const newBoosts = [{ delta: 0.55, prefixMatch: '8501.20' }];
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: newInject, boosts: newBoosts } });
        console.log('MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: boosted inject 8501.20 rank=3');
      }
    }

    // 2. ENGINE_BEARING_SET_INTENT: boost inject rank 22→5
    {
      const e = allRules.find(r => r.id === 'ENGINE_BEARING_SET_INTENT');
      if (e) {
        const newInject = setInject(e, [
          { prefix: '8409.91', syntheticRank: 5 },
          { prefix: '8409.99', syntheticRank: 6 },
        ]);
        const newBoosts = [{ delta: 0.50, prefixMatch: '8409.' }];
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: newInject, boosts: newBoosts } });
        console.log('ENGINE_BEARING_SET_INTENT: boosted inject 8409.91 rank=5');
      }
    }

    // 3. MOTORCYCLE_ENGINE_PARTS_INTENT: boost inject rank 20→4
    {
      const e = allRules.find(r => r.id === 'MOTORCYCLE_ENGINE_PARTS_INTENT');
      if (e) {
        const newInject = setInject(e, [
          { prefix: '8409.91', syntheticRank: 4 },
          { prefix: '8409.99', syntheticRank: 5 },
        ]);
        const newBoosts = [{ delta: 0.50, prefixMatch: '8409.' }];
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, inject: newInject, boosts: newBoosts } });
        console.log('MOTORCYCLE_ENGINE_PARTS_INTENT: boosted inject 8409 rank=4');
      }
    }

    // 4. ENGINE_PCV_VALVE_INTENT: add inject 8409 for engine valves
    {
      const e = allRules.find(r => r.id === 'ENGINE_PCV_VALVE_INTENT');
      if (e) {
        const newInject = setInject(e, [
          { prefix: '8409.91', syntheticRank: 5 },
          { prefix: '8409.99', syntheticRank: 6 },
        ]);
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: newInject } });
        console.log('ENGINE_PCV_VALVE_INTENT: added inject 8409');
      }
    }

    // 5. NATURAL_GEMSTONE_BEAD_INTENT + SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT:
    //    boost inject 7103 rank 20→5 for better top-3 position
    {
      for (const ruleId of ['NATURAL_GEMSTONE_BEAD_INTENT', 'SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT']) {
        const e = allRules.find(r => r.id === ruleId);
        if (e) {
          const newInject = setInject(e, [{ prefix: '7103', syntheticRank: 5 }]);
          patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, inject: newInject } });
          console.log(`${ruleId}: boosted inject 7103 rank=5`);
        }
      }
    }

    // 6. INFLATABLE_TOY_BALL_INTENT + BEACH_BALL_SAND_TOY_INTENT:
    //    already has rank 12/10 — check if good enough, keep as-is
    //    But CROCHET_KNIT_TOY_INTENT: boost inject 9503 rank 22→8
    {
      const e = allRules.find(r => r.id === 'CROCHET_KNIT_TOY_INTENT');
      if (e) {
        const newInject = setInject(e, [{ prefix: '9503', syntheticRank: 8 }]);
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, inject: newInject } });
        console.log('CROCHET_KNIT_TOY_INTENT: boosted inject 9503 rank=8');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch SS6)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS6 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
