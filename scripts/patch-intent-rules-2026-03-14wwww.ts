#!/usr/bin/env ts-node
/**
 * Patch WWWW — 2026-03-14:
 *
 * Fixes to existing rules (3):
 * 1. POLYPROPYLENE_TOUGH_COAT_INTENT anyOf: add 'ultra grip' so "Fusion Ultra Grip" matches
 *    Currently gets 8714.99 (bicycle parts); rule doesn't fire because no anyOf term matches
 * 2. SILVER_BULLION_SCRAP_INTENT inject: increase syntheticRank 9→28 to boost 7106.10 above semantic
 *    "Sterling silver shavings" → 7106.10 expected; inject rank=9 too weak to beat semantic 7114.11
 * 3. JEWELRY_RING_INTENT anyOf: add charm/pendant/brooch to catch "Silver Religious Charm"
 *    "Silver Religious Charm" → 7111.00; currently no rule fires → gets 7106.92 (silver wire)
 *
 * New rules (2):
 * 4. MOTORCYCLE_ENGINE_PARTS_INTENT (ch.84): motorcycle engine/kickstart shaft → 8409.91
 *    "kickstarter shaft", "motorcycle engine parts" → 8409.91; semantic gets 8483 (bearings)
 * 5. ELECTRIC_MOTOR_ACTUATOR_INTENT (ch.85): actuator/servo motor/gear motor → 8501.10
 *    "Resideo M847A1031 Actuator" → 8501.10; semantic gets 8481 (valves)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14wwww.ts
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

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed WWWW: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. Fix POLYPROPYLENE_TOUGH_COAT_INTENT: add 'ultra grip' ──────────────
    // "Fusion Ultra Grip" doesn't match any current anyOf terms:
    //   'fusion grip' → "fusion ultra grip".includes("fusion grip") = false (not adjacent)
    //   'ultra grip coating' → "fusion ultra grip".includes("ultra grip coating") = false
    // Fix: add 'ultra grip' which will match via includes("ultra grip") = true
    addToAnyOf('POLYPROPYLENE_TOUGH_COAT_INTENT', [
      'ultra grip', 'grip material', 'grip tape sport', 'fusion mineral',
    ], 'add ultra grip so "Fusion Ultra Grip" matches and injects 3902.10 polypropylene');

    // ── 2. Fix SILVER_BULLION_SCRAP_INTENT: increase syntheticRank ────────────
    // "Genuine Sterling silver .925 shavings" still gets 7114.11 (silverware)
    // SILVER_BULLION_SCRAP_INTENT fires and allows ch.71, injects 7106.10 rank=9
    // rrf(9)=0.017 too weak; 7114.11 semantic score wins; need rank=28 (like jewelry rules)
    {
      const existing = allRules.find(r => r.id === 'SILVER_BULLION_SCRAP_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SILVER_BULLION_SCRAP_INTENT') + ' — Fixed WWWW: increase inject rank to 28',
            inject: [
              { prefix: '7106.10', syntheticRank: 28 }, // Silver powder - much higher rank
              { prefix: '7106.91', syntheticRank: 26 }, // Unwrought silver
              { prefix: '7106.92', syntheticRank: 24 }, // Semi-manufactured silver
            ],
          } as IntentRule,
        });
        console.log('SILVER_BULLION_SCRAP_INTENT: increasing inject syntheticRank from 9 to 28');
      } else {
        console.log('WARNING: SILVER_BULLION_SCRAP_INTENT not found');
      }
    }

    // ── 3. Fix JEWELRY_RING_INTENT anyOf: add charm/pendant ───────────────────
    // "Silver Religious Charm" → 7111.00 expected; no rule fires
    // JEWELRY_RING_INTENT exists but has no 'charm' or 'pendant' in anyOf
    addToAnyOf('JEWELRY_RING_INTENT', [
      'charm', 'charms', 'religious charm', 'silver charm', 'gold charm',
      'pendant', 'pendants', 'jewelry pendant', 'charm pendant',
      'brooch', 'brooches', 'lapel pin',
    ], 'add charm/pendant/brooch so silver charm and pendant queries inject 7113/7117/7111');

    // ── 4. NEW MOTORCYCLE_ENGINE_PARTS_INTENT ─────────────────────────────────
    // "kickstarter shaft" → 8409.91.99 (engine parts for spark-ignition engines)
    // "motorcycle engine parts" → 8409.91; semantic gets 8483 (crankshafts/bearings)
    // Also: "kickstarter" itself is a specific motorcycle engine component
    patches.push({
      priority: 547,
      rule: {
        id: 'MOTORCYCLE_ENGINE_PARTS_INTENT',
        description: 'Motorcycle and small engine parts → ch.84 (8409.91). ' +
          '"Kickstarter shaft", "motorcycle engine parts", "piston kit" → 8409.91. ' +
          'Without rule, semantic returns 8483 (bearings/gears) instead of 8409 (engine parts).',
        pattern: {
          anyOf: [
            'kickstarter', 'kick starter', 'kickstart shaft', 'kickstarter shaft',
            'engine parts', 'engine part', 'piston kit', 'piston ring set',
            'connecting rod', 'con rod', 'crankcase', 'engine cylinder',
            'engine head', 'cylinder head', 'valve spring', 'engine gasket',
          ],
          noneOf: ['rocket engine', 'jet engine', 'aircraft engine', 'turbine', 'steam engine'],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [
          { prefix: '8409.91', syntheticRank: 9 }, // Parts for spark-ignition engines
          { prefix: '8409.99', syntheticRank: 8 }, // Parts for other engines
          { prefix: '8708.99', syntheticRank: 7 }, // Other parts/accessories for motor vehicles
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8409' },
          { delta: 0.4, chapterMatch: '84' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW ELECTRIC_MOTOR_ACTUATOR_INTENT ─────────────────────────────────
    // "Resideo M847A1031 Actuator" → 8501.10.40 (motor, <37.5W)
    // Semantic gets 8481.80 (valves/taps) instead of 8501 (electric motors)
    // Actuators for HVAC/dampers are typically small electric motors
    patches.push({
      priority: 548,
      rule: {
        id: 'ELECTRIC_MOTOR_ACTUATOR_INTENT',
        description: 'Electric motor actuators and gear motors → ch.85 (8501.10). ' +
          '"HVAC actuator", "damper actuator", "gear motor", "servo motor" → 8501.10. ' +
          'Without rule, semantic returns 8481 (valves) instead of 8501 (motors) for actuators.',
        pattern: {
          anyOf: [
            'actuator', 'actuators', 'damper actuator', 'hvac actuator', 'zone actuator',
            'gear motor', 'geared motor', 'gear reducer motor', 'servo motor',
            'torque motor', 'dc gear motor', 'ac gear motor',
            'rotisserie motor', 'rotisserie drive motor',
          ],
          noneOf: ['pneumatic actuator', 'hydraulic actuator', 'linear actuator', 'valve actuator'],
        },
        whitelist: { allowChapters: ['85', '84'] },
        inject: [
          { prefix: '8501.10', syntheticRank: 9 }, // Motors <37.5W
          { prefix: '8501.20', syntheticRank: 8 }, // Universal AC/DC motors, ≤37.5W
          { prefix: '8501.31', syntheticRank: 7 }, // DC motors, ≤750W
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8501' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

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
