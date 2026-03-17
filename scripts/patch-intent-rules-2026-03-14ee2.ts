#!/usr/bin/env ts-node
/**
 * Patch EE2 — 2026-03-14: Current: 116/5000 = 2.32%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14ee2.ts
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

    // 1. TEXTILE_LOOM_MACHINE_INTENT: add ch.51; noneOf loom-width (fabric made ON a loom, not a loom machine)
    {
      const e = allRules.find(r => r.id === 'TEXTILE_LOOM_MACHINE_INTENT');
      if (e) {
        const wl = addCh(e, '51');
        const pat = addNo(e, 'loom width', 'loom woven', 'hand-woven');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('TEXTILE_LOOM_MACHINE_INTENT: added ch.51, noneOf loom-width/hand-woven');
      }
    }

    // 2. AI_CH54_FILAMENT_YARN_RETAIL: add ch.55 (synthetic staple fiber ≠ filament)
    {
      const e = allRules.find(r => r.id === 'AI_CH54_FILAMENT_YARN_RETAIL');
      if (e) {
        const wl = addCh(e, '55');
        const pat = addNo(e, 'staple fiber', 'staple fibers', 'pva fiber', 'polyvinyl alcohol');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH54_FILAMENT_YARN_RETAIL: added ch.55, noneOf staple-fiber/pva');
      }
    }

    // 3. AI_CH11_SEMOLINA_GROATS: noneOf food-sample/evaluation
    {
      const e = allRules.find(r => r.id === 'AI_CH11_SEMOLINA_GROATS');
      if (e) {
        const pat = addNo(e, 'food sample', 'product evaluation', 'not for resale', 'sample evaluation');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('AI_CH11_SEMOLINA_GROATS: noneOf food-sample/evaluation');
      }
    }

    // 4. TRAVEL_MUG_INTENT: add ch.29; noneOf travel-mug-in-vinyl-decal-listing
    {
      const e = allRules.find(r => r.id === 'TRAVEL_MUG_INTENT');
      if (e) {
        const wl = addCh(e, '29');
        const pat = addNo(e, 'vinyl decal', 'bumper sticker', 'vinyl sticker', 'decal sticker');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('TRAVEL_MUG_INTENT: added ch.29, noneOf vinyl-decal/bumper-sticker');
      }
    }

    // 5. AI_CH17_GLUCOSE_SYRUP: add ch.30; noneOf glucose-monitor/cgm
    {
      const e = allRules.find(r => r.id === 'AI_CH17_GLUCOSE_SYRUP');
      if (e) {
        const wl = addCh(e, '30');
        const pat = addNo(e,
          'glucose monitor', 'glucose meter', 'cgm set', 'continuous glucose',
          'dexcom', 'omnipod', 'freestyle libre',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH17_GLUCOSE_SYRUP: added ch.30, noneOf glucose-monitor/cgm');
      }
    }

    // 6. BLOOD_GLUCOSE_MONITOR_INTENT: add ch.30 (medical accessories = ch.30)
    {
      const e = allRules.find(r => r.id === 'BLOOD_GLUCOSE_MONITOR_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '30') } });
        console.log('BLOOD_GLUCOSE_MONITOR_INTENT: added ch.30 (medical CGM accessories)');
      }
    }

    // 7. AI_CH09_VANILLA: add ch.33; noneOf vanilla-body-butter
    {
      const e = allRules.find(r => r.id === 'AI_CH09_VANILLA');
      if (e) {
        const wl = addCh(e, '33');
        const pat = addNo(e,
          'vanilla body', 'body butter', 'body lotion', 'body cream',
          'vanilla fragrance', 'vanilla scent', 'vanilla candle',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH09_VANILLA: added ch.33, noneOf vanilla-body-butter/fragrance');
      }
    }

    // 8. AI_CH18_COCOA_BUTTER: add ch.33; noneOf cocoa-body-butter/cocoa-cosmetic
    {
      const e = allRules.find(r => r.id === 'AI_CH18_COCOA_BUTTER');
      if (e) {
        const wl = addCh(e, '33');
        const pat = addNo(e,
          'cocoa body', 'body butter', 'body lotion', 'body cream',
          'cocoa fragrance', 'cocoa scent', 'cocoa candle',
          'vanilla cocoa', 'cocoa vanilla',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH18_COCOA_BUTTER: added ch.33, noneOf cocoa-body-butter/cosmetic');
      }
    }

    // 9. WAX_MELT_INTENT: add ch.33; noneOf wax-melt-warmer (wax melt warmer = air freshener = ch.33)
    {
      const e = allRules.find(r => r.id === 'WAX_MELT_INTENT');
      if (e) {
        const wl = addCh(e, '33');
        const pat = addNo(e,
          'wax melt warmer', 'wax warmer', 'electric wax warmer',
          'air freshener', 'scent warmer',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('WAX_MELT_INTENT: added ch.33, noneOf wax-melt-warmer/air-freshener');
      }
    }

    // 10. AI_CH35_ENZYMES: add ch.34; noneOf dishwasher-cleaning (enzyme cleaning product ≠ isolated enzyme)
    {
      const e = allRules.find(r => r.id === 'AI_CH35_ENZYMES');
      if (e) {
        const wl = addCh(e, '34');
        const pat = addNo(e,
          'dishwasher sheet', 'dishwasher pod', 'dishwasher tab',
          'cleaning sheet', 'laundry sheet', 'eco sheet',
          'plastic-free', 'enzyme cleaning',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH35_ENZYMES: added ch.34, noneOf dishwasher-sheet/cleaning-sheet');
      }
    }

    // 11. AI_CH03_LIVE_FISH: add ch.38/94; noneOf artificial-sea-salt/live-edge
    {
      const e = allRules.find(r => r.id === 'AI_CH03_LIVE_FISH');
      if (e) {
        const wl = addCh(e, '38', '94');
        const pat = addNo(e,
          'artificial sea salt', 'sea salt mix', 'aquarium salt', 'aquarium use',
          'live edge', 'live edge wood', 'live edge walnut', 'live edge slab',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH03_LIVE_FISH: added ch.38/94, noneOf sea-salt-mix/live-edge');
      }
    }

    // 12. NAIL_POLISH_COSMETIC_INTENT: add ch.39 (cellulose nitrate nail polish = ch.39)
    {
      const e = allRules.find(r => r.id === 'NAIL_POLISH_COSMETIC_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '39') } });
        console.log('NAIL_POLISH_COSMETIC_INTENT: added ch.39 (cellulose nitrate-based lacquer)');
      }
    }

    // 13. CIRCULAR_SAW_INTENT: add ch.39; noneOf dust-adapter/plastic-accessory
    {
      const e = allRules.find(r => r.id === 'CIRCULAR_SAW_INTENT');
      if (e) {
        const wl = addCh(e, '39');
        const pat = addNo(e, 'dust adapter', 'dust port', 'dust collection adapter', 'plastic adapter');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CIRCULAR_SAW_INTENT: added ch.39, noneOf dust-adapter');
      }
    }

    // 14. SNEAKER_ATHLETIC_FOOTWEAR_INTENT: add ch.39; noneOf shoe-box/sneaker-box
    {
      const e = allRules.find(r => r.id === 'SNEAKER_ATHLETIC_FOOTWEAR_INTENT');
      if (e) {
        const wl = addCh(e, '39');
        const pat = addNo(e, 'shoe box', 'sneaker box', 'mini shoe box', 'shoe container');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SNEAKER_ATHLETIC_FOOTWEAR_INTENT: added ch.39, noneOf shoe-box/sneaker-box');
      }
    }

    // 15. EYE_COSMETIC_INTENT: add ch.39; noneOf case-for-eyeshadow (plastic cosmetic case ≠ cosmetic)
    {
      const e = allRules.find(r => r.id === 'EYE_COSMETIC_INTENT');
      if (e) {
        const wl = addCh(e, '39');
        const pat = addNo(e, 'case for eyeshadow', 'eyeshadow case', 'eyeshadow box', 'makeup case');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('EYE_COSMETIC_INTENT: added ch.39, noneOf eyeshadow-case');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch EE2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch EE2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
