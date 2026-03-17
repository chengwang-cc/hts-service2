#!/usr/bin/env ts-node
/**
 * Patch TT6 — 2026-03-15: Fix v1 blocks from TT5.
 *  1. HAIR_STYLING_IRON_WAND_INTENT: add 'holder'/'pouch'/'case' to noneOf
 *     "Hot Pouch - Hair straightener or curling iron holder" → ch.42 (pouch/holder)
 *  2. AUTOMOTIVE_HVAC_CLIMATE_INTENT: add 'panel'/'trim'/'face' to noneOf
 *     "Car HVAC Control Panel Plastic" → ch.85 (8537 = control panels)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt6.ts
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

    const addNoneOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    const patches: Array<{ rule: IntentRule; priority: number }> = [];

    // 1. HAIR_STYLING_IRON_WAND_INTENT: add holder/pouch/case/cover to noneOf
    {
      const e = allRules.find(r => r.id === 'HAIR_STYLING_IRON_WAND_INTENT');
      if (e) {
        const updated = addNoneOf(e,
          'holder', 'pouch', 'case', 'cover', 'bag', 'travel bag', 'mat',
          'protector', 'organizer', 'storage', 'accessory',
        );
        patches.push({ priority: (e as any).priority ?? 570, rule: { ...e, pattern: updated } });
        console.log('HAIR_STYLING_IRON_WAND_INTENT: added holder/pouch/case to noneOf');
      }
    }

    // 2. AUTOMOTIVE_HVAC_CLIMATE_INTENT: add panel/trim/face/housing to noneOf
    {
      const e = allRules.find(r => r.id === 'AUTOMOTIVE_HVAC_CLIMATE_INTENT');
      if (e) {
        const updated = addNoneOf(e,
          'panel', 'trim', 'trim panel', 'face', 'housing', 'plastic trim',
          'switch', 'control panel',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: updated } });
        console.log('AUTOMOTIVE_HVAC_CLIMATE_INTENT: added panel/trim/switch to noneOf');
      }
    }

    console.log(`\nApplying ${patches.length} patches (batch TT6)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT6 complete`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
