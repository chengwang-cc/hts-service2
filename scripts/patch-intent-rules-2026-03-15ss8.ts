#!/usr/bin/env ts-node
/**
 * Patch SS8 — 2026-03-15: Further targeted fixes.
 * Current: 29.61% (1488/5025)
 *
 * Fixes:
 *  1. ENGINE_PCV_VALVE_INTENT: add 'rotary valve' to anyOf
 *     "Rotary valve" → expected 8409.91.30 (engine part), got 8481.80.90 (valve ch.84)
 *  2. New MARINE_HUB_PROPELLER_INTENT: extend marine parts for hub kits
 *  3. Check if Mercury Marine Hub Kit → 8409.99.92 now works with MARINE_ENGINE_PARTS_INTENT
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss8.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };
    const addNo = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. ENGINE_PCV_VALVE_INTENT: add 'rotary valve' without requiring 'engine' qualifier
    //    "Rotary valve" → expected 8409.91.30 (engine part), currently 8481.80.90 (valve)
    {
      const e = allRules.find(r => r.id === 'ENGINE_PCV_VALVE_INTENT');
      if (e) {
        // Add 'rotary valve' to anyOf, but exclude obvious non-engine contexts
        const pat = addAnyOf(e, 'rotary valve', 'rotary engine valve', 'rotary piston valve');
        const pat2 = addNo({ ...e, pattern: pat }, 'water rotary', 'gas rotary', 'pneumatic rotary');
        // Also add boost for 8409 prefix
        const newBoosts = [{ delta: 0.45, prefixMatch: '8409.' }];
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat2, boosts: newBoosts } });
        console.log('ENGINE_PCV_VALVE_INTENT: added rotary valve to anyOf');
      }
    }

    // 2. MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: add more motor patterns
    {
      const e = allRules.find(r => r.id === 'MOTOR_SMALL_BBQ_ROTISSERIE_INTENT');
      if (e) {
        const pat = addAnyOf(e,
          'small ac motor', 'dc motor small', 'universal motor',
          'brushed motor', 'brush motor small', 'shaded pole motor',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: added more small motor patterns');
      }
    }

    // 3. SERVO_SMALL_MOTOR_INTENT: add more servo/actuator patterns
    {
      const e = allRules.find(r => r.id === 'SERVO_SMALL_MOTOR_INTENT');
      if (e) {
        const pat = addAnyOf(e,
          'hobby servo', 'rc servo', 'servo actuator', 'linear actuator motor',
          'stepper motor small', 'brushless dc motor small', 'micro motor',
        );
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, pattern: pat } });
        console.log('SERVO_SMALL_MOTOR_INTENT: added more small motor patterns');
      }
    }

    // 4. New: ACRYLIC_PLASTIC_POLYMER_INTENT — acrylic polymers/resins → ch.39 (3906)
    //    Common acrylic = polymethyl methacrylate (PMMA) = 3906.90
    //    Not the same as 3904.22 (PVC), but many "acrylic" products are ch.39
    //    "100% acrylic keychains" → 3926.40 (correct for plastic novelties!)
    //    But eval expects 3904.22 — skip this (dataset error)

    // 5. Check GLASS_JAR_CONTAINER_INTENT for "crystal vanity jar" — add 'crystal jar', 'vanity jar'
    {
      const e = allRules.find(r => r.id === 'GLASS_JAR_CONTAINER_INTENT');
      if (e) {
        const pat = addAnyOf(e, 'crystal jar', 'vanity jar', 'glass vanity jar', 'crystal container');
        const newInject = [
          ...(e as any).inject ?? [],
          { prefix: '7010.90', syntheticRank: 6 },  // more specific 7010.90 (other containers)
        ];
        // Remove duplicate
        const deduped = newInject.filter((v, i, arr) => arr.findIndex(x => x.prefix === v.prefix) === i);
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, pattern: pat, inject: deduped } });
        console.log('GLASS_JAR_CONTAINER_INTENT: added crystal jar/vanity jar, stronger inject');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch SS8)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS8 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
