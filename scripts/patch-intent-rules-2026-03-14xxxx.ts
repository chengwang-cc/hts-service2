#!/usr/bin/env ts-node
/**
 * Patch XXXX — 2026-03-14:
 *
 * Updates to existing rules (3):
 * 1. COFFEE_SINGLE_ORIGIN_INTENT anyOf: add 'washed', 'honey process', roast terms
 *    "Ecuador, Angamaza Washed (300g)" → ch.9; no rule fires, EMPTY result
 * 2. 3D_PRINT_PLASTIC_INTENT inject: add ch.39 injection (currently has no inject at all)
 *    "3D Printed Dremel/Proxxon Organizer" → ch.39 expected; 3D_PRINT fires but injects nothing
 * 3. POLYSTYRENE_FOAM_RAW_INTENT inject: increase syntheticRank for 3901.10 HDPE
 *    "HDPE Plastic Block" → 3901.10 expected; current rank=8 too weak vs semantic 3923.21
 *
 * New rules (2):
 * 4. SERVO_MOTOR_CONTROLLER_INTENT (ch.85): motor controller/servo driver/OSSM → 8503.00
 *    "OSSM DIY kit with printed parts" → 8503.00 (motor parts); gets 9110 (clock movements)
 * 5. GLASSWORKING_TORCH_TOOL_INTENT (ch.84): glassworking torch/unitorch/lampwork torch → 8468.10
 *    "Nortel Unitorch for Glassworking" → EMPTY; ch.84 (hand torches for soldering/glasswork)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14xxxx.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed XXXX: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. COFFEE_SINGLE_ORIGIN_INTENT: add washed/process/roast terms ────────
    // "Ecuador, Angamaza Washed (300g)" → specialty coffee (ch.9)
    // No terms match since only 'coffee', 'arabica', 'espresso' etc. in anyOf
    // Specialty coffee often described by processing: washed, natural, honey
    addToAnyOf('COFFEE_SINGLE_ORIGIN_INTENT', [
      'washed', 'honey process', 'natural process', 'washed process',
      'light roast', 'medium roast', 'dark roast', 'light roasted', 'medium roasted',
      'coffee roast', 'roasted coffee', 'coffee blend', 'coffee farm',
      'whole bean', 'ground coffee', 'pour over coffee', 'drip coffee',
      'ethiopia', 'colombia', 'kenya', 'guatemala', 'nicaragua', 'honduras',
    ], 'add washed/process/roast terms so specialty coffee by processing method matches ch.9');

    // ── 2. 3D_PRINT_PLASTIC_INTENT: add inject for ch.39 ─────────────────────
    // "3D Printed Dremel/Proxxon Organizer - 168 Slot" → ch.39 (3926.90 plastic articles)
    // 3D_PRINT_PLASTIC_INTENT fires but has NO inject → no ch.39 candidates injected
    {
      const existing = allRules.find(r => r.id === '3D_PRINT_PLASTIC_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentInject: any[] = (existing as any).inject ?? [];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? '3D_PRINT_PLASTIC_INTENT') + ' — Fixed XXXX: add inject 3926.90 for 3D printed plastic articles',
            whitelist: { allowChapters: ['39', '84'] },
            inject: [
              { prefix: '3926.90', syntheticRank: 22 }, // Other articles of plastic
              { prefix: '3926.40', syntheticRank: 20 }, // Statuettes/ornaments of plastic
              { prefix: '8448.90', syntheticRank: 18 }, // Machine parts
              ...currentInject,
            ],
            boosts: [
              { delta: 0.4, prefixMatch: '3926' },
              { delta: 0.3, chapterMatch: '39' },
            ],
          } as IntentRule,
        });
        console.log('3D_PRINT_PLASTIC_INTENT: adding inject + whitelist');
      } else {
        console.log('WARNING: 3D_PRINT_PLASTIC_INTENT not found');
      }
    }

    // ── 3. POLYSTYRENE_FOAM_RAW_INTENT: increase inject ranks ─────────────────
    // "HDPE Plastic Block" → 3901.10 (polyethylene) expected
    // Current inject rank=8 for 3901.10 → rrf(8)=0.017 too weak vs semantic 3923.21
    {
      const existing = allRules.find(r => r.id === 'POLYSTYRENE_FOAM_RAW_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'POLYSTYRENE_FOAM_RAW_INTENT') + ' — Fixed XXXX: increase inject ranks to 26-28',
            inject: [
              { prefix: '3903.19', syntheticRank: 28 }, // Polystyrene, other
              { prefix: '3901.10', syntheticRank: 26 }, // Polyethylene, ≤0.94 density (HDPE/LDPE)
              { prefix: '3901.20', syntheticRank: 24 }, // Polyethylene, >0.94 density
              { prefix: '3902.10', syntheticRank: 22 }, // Polypropylene
            ],
          } as IntentRule,
        });
        console.log('POLYSTYRENE_FOAM_RAW_INTENT: increasing inject ranks to 26-28');
      } else {
        console.log('WARNING: POLYSTYRENE_FOAM_RAW_INTENT not found');
      }
    }

    // ── 4. NEW SERVO_MOTOR_CONTROLLER_INTENT ──────────────────────────────────
    // "OSSM: COMPLETE DIY KIT - Includes printed parts / Wired / Unwired" → 8503.00.65
    // OSSM = Open Source Servo Motor; DIY kit for a motor controller
    // Semantic gets 9110 (clock movements) due to 'parts' embedding
    patches.push({
      priority: 549,
      rule: {
        id: 'SERVO_MOTOR_CONTROLLER_INTENT',
        description: 'Servo motor controllers, motor drivers, and motor DIY kits → ch.85 (8503.00). ' +
          '"OSSM DIY kit", "servo controller", "motor driver board" → 8503.00. ' +
          'Without rule, semantic returns 9110 (clock movements) for motor kit queries.',
        pattern: {
          anyOf: [
            'servo motor', 'servo controller', 'servo driver', 'motor controller',
            'motor driver', 'motor control board', 'ossm', 'open source servo',
            'stepper motor', 'stepper driver', 'motor module',
            'bldc motor', 'brushless motor controller',
          ],
          noneOf: ['car motor mount', 'boat motor', 'fan motor'],
        },
        whitelist: { allowChapters: ['85', '84'] },
        inject: [
          { prefix: '8503.00', syntheticRank: 22 }, // Parts for motors/generators
          { prefix: '8543.70', syntheticRank: 20 }, // Other electrical machines/apparatus
          { prefix: '8537.10', syntheticRank: 18 }, // Boards/panels/consoles for ≤1000V
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8503' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW GLASSWORKING_TORCH_TOOL_INTENT ─────────────────────────────────
    // "Nortel Unitorch for Glassworking" → ch.84 (8468.10 hand torches for soldering)
    // No rules fire → EMPTY result
    // Unitorch = professional torches for lampwork/glasswork/jewelry
    patches.push({
      priority: 550,
      rule: {
        id: 'GLASSWORKING_TORCH_TOOL_INTENT',
        description: 'Glassworking torches, lampwork torches, and hand torches → ch.84 (8468.10). ' +
          '"Unitorch", "lampwork torch", "glassworking torch", "soldering torch" → 8468.10. ' +
          'Without rule, EMPTY result for specialized torch/glassworking tool queries.',
        pattern: {
          anyOf: [
            'unitorch', 'glassworking torch', 'lampwork torch', 'lampworking torch',
            'glass torch', 'propane torch', 'oxy-acetylene torch', 'torch tip',
            'soldering torch', 'brazing torch', 'bernzomatic',
            'hand torch', 'torch burner', 'torch flame',
          ],
          noneOf: ['flashlight', 'led torch', 'torch light', 'headtorch'],
        },
        whitelist: { allowChapters: ['84', '82'] },
        inject: [
          { prefix: '8468.10', syntheticRank: 22 }, // Hand torches for soldering, brazing, tempering
          { prefix: '8468.20', syntheticRank: 20 }, // Other gas-fueled soldering irons
          { prefix: '8468.90', syntheticRank: 18 }, // Other machinery for soldering/brazing
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8468' },
          { delta: 0.4, chapterMatch: '84' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch XXXX)...`);
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
    console.log(`\nPatch XXXX complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
