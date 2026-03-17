#!/usr/bin/env ts-node
/**
 * Patch TT7 — 2026-03-15: Minor fixes.
 *  1. UV_FLASHLIGHT_TORCH_INTENT: add 'uv led' to anyOf (for "UV LED lights and Flashlights")
 *  2. AUTOMOTIVE_HVAC_CLIMATE_INTENT: add more patterns for Jeep/Ford HVAC units
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt7.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };

    const patches: Array<{ rule: IntentRule; priority: number }> = [];

    // 1. UV_FLASHLIGHT_TORCH_INTENT: broader pattern matching
    {
      const e = allRules.find(r => r.id === 'UV_FLASHLIGHT_TORCH_INTENT');
      if (e) {
        const updated = addAnyOf(e,
          'uv led light', 'uv led', 'uv lamp portable', 'uv lights flashlights',
          'led flashlight', 'led lantern', 'portable flashlight', 'mini flashlight',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: updated } });
        console.log('UV_FLASHLIGHT_TORCH_INTENT: added uv led / led flashlight to anyOf');
      }
    }

    // 2. AUTOMOTIVE_HVAC_CLIMATE_INTENT: add Jeep/vehicle AC unit patterns
    {
      const e = allRules.find(r => r.id === 'AUTOMOTIVE_HVAC_CLIMATE_INTENT');
      if (e) {
        const updated = addAnyOf(e,
          'ac heater climate', 'vehicle ac unit', 'car ac heater', 'automotive ac heater',
          'blower motor automotive', 'automtive blower', 'car heater unit',
          'vehicle hvac', 'vehicle climate',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: updated } });
        console.log('AUTOMOTIVE_HVAC_CLIMATE_INTENT: added ac heater climate patterns');
      }
    }

    console.log(`\nApplying ${patches.length} patches (batch TT7)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT7 complete`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
