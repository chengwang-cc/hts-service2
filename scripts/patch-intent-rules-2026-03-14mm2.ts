#!/usr/bin/env ts-node
/**
 * Patch MM2 — 2026-03-14: Current: 14/5000 = 0.28%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14mm2.ts
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

    const addCh = (e: IntentRule, ...chs: string[]) => {
      const wl = (e.whitelist as any) ?? {};
      return { ...wl, allowChapters: [...new Set([...(wl.allowChapters ?? []), ...chs])] };
    };
    const addNo = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. MEAT_POULTRY_INTENT: add ch.45; noneOf goose-coaster (goose = poultry but coaster = ch.45 cork)
    {
      const e = allRules.find(r => r.id === 'MEAT_POULTRY_INTENT');
      if (e) {
        const wl = addCh(e, '45');
        const pat = addNo(e, 'goose coaster', 'coaster set', 'coasters tin', 'coaster tin');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('MEAT_POULTRY_INTENT: added ch.45, noneOf goose-coaster');
      }
    }

    // 2. AI_CH04_FRESH_CHEESE: add ch.45; noneOf cottage-coaster/goose-coaster
    {
      const e = allRules.find(r => r.id === 'AI_CH04_FRESH_CHEESE');
      if (e) {
        const wl = addCh(e, '45');
        const pat = addNo(e,
          'goose coaster', 'coaster set', 'cottage coasters', 'coasters tin',
          'cottage tin', 'coaster cork',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH04_FRESH_CHEESE: added ch.45, noneOf goose-coaster/cottage-coaster');
      }
    }

    // 3. AUTOMOTIVE_SMALL_MOTOR_INTENT: add ch.84 (blower motor = ch.84 air conditioning parts)
    {
      const e = allRules.find(r => r.id === 'AUTOMOTIVE_SMALL_MOTOR_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '84') } });
        console.log('AUTOMOTIVE_SMALL_MOTOR_INTENT: added ch.84 (blower motor = ch.84)');
      }
    }

    // 4. AI_CH04_EDIBLE_INSECTS: add ch.84; noneOf bee-feeder/insect-drink-bar
    {
      const e = allRules.find(r => r.id === 'AI_CH04_EDIBLE_INSECTS');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e,
          'bee feeder', 'insect drink bar', 'bee drink bar', 'insect feeder',
          'bee life raft', 'floating bee',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH04_EDIBLE_INSECTS: added ch.84, noneOf bee-feeder/insect-drink-bar');
      }
    }

    // 5. AI_CH51_WOOL_YARN_RETAIL: add ch.84; noneOf winding-machine/yarn-winder
    {
      const e = allRules.find(r => r.id === 'AI_CH51_WOOL_YARN_RETAIL');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e,
          'winding machine', 'yarn winder', 'wool winder', 'cord winder',
          'drill adapter winding', 'cable winder',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH51_WOOL_YARN_RETAIL: added ch.84, noneOf winding-machine/yarn-winder');
      }
    }

    // 6. ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: add ch.84; noneOf water-level-switch/pressure-switch
    {
      const e = allRules.find(r => r.id === 'ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e,
          'water level switch', 'pressure switch', 'washer switch',
          'water level pressure', 'level pressure switch',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: added ch.84, noneOf water-level-switch');
      }
    }

    // 7. HAMMER_TOOL_INTENT: add ch.84 (pneumatic/air hammer = ch.84 machine tool)
    {
      const e = allRules.find(r => r.id === 'HAMMER_TOOL_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '84') } });
        console.log('HAMMER_TOOL_INTENT: added ch.84 (pneumatic air hammer)');
      }
    }

    // 8. SANDING_ABRASIVE_PAD_INTENT: add ch.84 (power tool sanding pad = ch.84)
    {
      const e = allRules.find(r => r.id === 'SANDING_ABRASIVE_PAD_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '84') } });
        console.log('SANDING_ABRASIVE_PAD_INTENT: added ch.84 (power tool sanding pad)');
      }
    }

    // 9. WOOD_CHISEL_INTENT: add ch.84; noneOf antique-plane/block-planer (plane = machine tool ch.84)
    {
      const e = allRules.find(r => r.id === 'WOOD_CHISEL_INTENT');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e,
          'knuckle plane', 'block plane', 'block planer', 'antique plane',
          'stanley plane', 'shoulder plane',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('WOOD_CHISEL_INTENT: added ch.84, noneOf antique-plane/block-planer');
      }
    }

    // 10. WIFI_ROUTER_INTENT: add ch.84; noneOf wifi-card/airport-card (card = ch.84 computer part)
    {
      const e = allRules.find(r => r.id === 'WIFI_ROUTER_INTENT');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e,
          'wifi card', 'airport card', 'bluetooth card', 'wireless card',
          'network card', 'macbook card',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('WIFI_ROUTER_INTENT: added ch.84, noneOf wifi-card/airport-card');
      }
    }

    // 11. MOUSEPAD_DESK_PAD_INTENT: add ch.84 (mousepad = computer accessory = ch.84)
    {
      const e = allRules.find(r => r.id === 'MOUSEPAD_DESK_PAD_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '84') } });
        console.log('MOUSEPAD_DESK_PAD_INTENT: added ch.84 (mousepad = computer accessory)');
      }
    }

    // 12. AI_CH40_PNEUMATIC_TIRES: add ch.84; noneOf tire-valve/valve-stem-cap
    {
      const e = allRules.find(r => r.id === 'AI_CH40_PNEUMATIC_TIRES');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e, 'valve stem cap', 'tire valve', 'valve cap', 'stem cap');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_PNEUMATIC_TIRES: added ch.84, noneOf tire-valve/valve-stem-cap');
      }
    }

    // 13. AI_CH40_RUBBER_TIRES: add ch.84; noneOf valve-stem-cap
    {
      const e = allRules.find(r => r.id === 'AI_CH40_RUBBER_TIRES');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e, 'valve stem cap', 'tire valve', 'valve cap', 'stem cap');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_RUBBER_TIRES: added ch.84, noneOf valve-stem-cap');
      }
    }

    // 14. AI_CH40_RUBBER_TIRES_PASSENGER: add ch.84; noneOf valve-stem-cap
    {
      const e = allRules.find(r => r.id === 'AI_CH40_RUBBER_TIRES_PASSENGER');
      if (e) {
        const wl = addCh(e, '84');
        const pat = addNo(e, 'valve stem cap', 'tire valve', 'valve cap', 'stem cap');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_RUBBER_TIRES_PASSENGER: added ch.84, noneOf valve-stem-cap');
      }
    }

    // 15. AI_CH56_WADDING_BATTING: add ch.85; noneOf felt-slipmat/turntable-mat
    {
      const e = allRules.find(r => r.id === 'AI_CH56_WADDING_BATTING');
      if (e) {
        const wl = addCh(e, '85');
        const pat = addNo(e, 'slipmat', 'felt slipmat', 'turntable slipmat', 'turntable mat', 'record slipmat');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH56_WADDING_BATTING: added ch.85, noneOf felt-slipmat/turntable-mat');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch MM2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch MM2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
