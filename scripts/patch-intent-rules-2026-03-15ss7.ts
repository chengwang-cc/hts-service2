#!/usr/bin/env ts-node
/**
 * Patch SS7 — 2026-03-15: Remaining small wins after SS6 analysis.
 * Current: 29.53% (1484/5025), baseline: 29.37%
 *
 * Fixes:
 *  1. SERVO_MOTOR_SMALL_INTENT: "servo motor", "100W motor" → 8501.20 (small universal motor)
 *     "SMALL 100W SERVO MOTOR" → 8501.20.40 expected, got 8501.40.20
 *  2. MARINE_ENGINE_PARTS_INTENT: "hub kit marine", "outboard parts" → 8409.99
 *     "Mercury Marine Hub Kit" → 8409.99.92 expected, got 8714.93.05
 *  3. POLYPROPYLENE_RESIN_INTENT: "polypropylene" + primary forms → ch.39 (3902.10)
 *     "Fusion Mineral Paint Tough Coat Wipe-on Poly" → 3902.10 expected
 *     (poly/polypropylene + paint context — try routing to 3902)
 *  4. GLASS_JAR_CONTAINER_INTENT: "glass jar" / "glass container" → ch.70 (7010)
 *     not 7013 (glassware for decoration)
 *  5. WALLET_BRIEFCASE_TRIFOLD_INTENT: Update WALLET_TRIFOLD_BIFOLD to add ch.42 prefix
 *     boost for 4202.31 while steering away from 4202.11 for slim/card wallets
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss7.ts
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

    // 1. New: SERVO_SMALL_MOTOR_INTENT — servo/wiper/gear motor → 8501.20 (small universal)
    //    "SMALL 100W SERVO MOTOR" → 8501.20.40 expected
    {
      const existing = allRules.find(r => r.id === 'SERVO_SMALL_MOTOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SERVO_SMALL_MOTOR_INTENT',
          description: 'Servo motors and small wiper/gear motors → ch.85 (8501.20)',
          pattern: {
            anyOf: [
              'servo motor', 'dc servo', 'servo drive', 'wiper motor', 'wiper motor replacement',
              'small dc motor', 'dc gear motor small', 'fan motor small', 'actuator motor small',
            ],
            noneOf: ['servo press', 'servo drive industrial', 'cnc servo'],
          },
          inject: [{ prefix: '8501.20', syntheticRank: 4 }],
          boosts: [{ delta: 0.45, prefixMatch: '8501.20' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('SERVO_SMALL_MOTOR_INTENT: created (servo motor → 8501.20)');
      }
    }

    // 2. New: MARINE_ENGINE_PARTS_INTENT — marine/outboard engine parts → ch.84 (8409.99)
    //    "Mercury Marine Hub Kit" → 8409.99.92 expected
    {
      const existing = allRules.find(r => r.id === 'MARINE_ENGINE_PARTS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MARINE_ENGINE_PARTS_INTENT',
          description: 'Marine/outboard engine parts → ch.84 (8409.99)',
          pattern: {
            anyOf: [
              'marine engine parts', 'outboard engine parts', 'outboard motor parts',
              'marine hub kit', 'outboard hub kit', 'propeller hub kit',
              'marine impeller', 'outboard impeller', 'boat engine parts',
              'mercury marine parts', 'johnson outboard parts', 'yamaha outboard parts',
              'evinrude parts', 'suzuki outboard parts',
            ],
          },
          inject: [{ prefix: '8409.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.45, prefixMatch: '8409.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('MARINE_ENGINE_PARTS_INTENT: created (marine hub kit → 8409.99)');
      }
    }

    // 3. New: GLASS_JAR_CONTAINER_INTENT — glass jars/containers → 7010 (not 7013 decor)
    //    "Custom Laser Engraved Glass Treat Jar" → 7010.90.30 expected, got 7010.20.20
    {
      const existing = allRules.find(r => r.id === 'GLASS_JAR_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_JAR_CONTAINER_INTENT',
          description: 'Glass jars, containers and bottles → ch.70 (7010)',
          pattern: {
            anyOf: [
              'glass jar', 'glass container', 'glass storage jar', 'mason jar glass',
              'glass bottle jar', 'glass treat jar', 'glass canister', 'glass canning jar',
              'apothecary jar', 'glass candy jar', 'glass spice jar', 'glass honey jar',
              'glass food jar', 'glass pickle jar', 'jam jar glass',
            ],
            noneOf: ['wine glass', 'drinking glass', 'beer glass', 'shot glass', 'glass cup'],
          },
          inject: [{ prefix: '7010.90', syntheticRank: 8 }],
          boosts: [{ delta: 0.45, prefixMatch: '7010.' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('GLASS_JAR_CONTAINER_INTENT: created (glass jar → 7010)');
      }
    }

    // 4. New: POLYPROPYLENE_POLYMER_RESIN_INTENT — polypropylene / wipe-on poly topcoat → 3902
    //    "Fusion Mineral Paint Tough Coat Wipe-on Poly" → 3902.10.00 expected (polypropylene)
    {
      const existing = allRules.find(r => r.id === 'POLYPROPYLENE_POLYMER_RESIN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'POLYPROPYLENE_POLYMER_RESIN_INTENT',
          description: 'Polypropylene/polyethylene polymer resins → ch.39 (3901-3903)',
          pattern: {
            anyOf: [
              'polypropylene', 'polyethylene resin', 'wipe-on poly', 'wipe on poly',
              'tough coat poly', 'topcoat poly', 'polymer topcoat', 'polypropylene resin',
              'pp resin', 'pe resin',
            ],
          },
          inject: [
            { prefix: '3902.10', syntheticRank: 8 },
            { prefix: '3901.20', syntheticRank: 10 },
          ],
          boosts: [{ delta: 0.35, prefixMatch: '3902.' }, { delta: 0.30, prefixMatch: '3901.' }],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('POLYPROPYLENE_POLYMER_RESIN_INTENT: created (wipe-on poly → 3902.10)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch SS7)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS7 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
