#!/usr/bin/env ts-node
/**
 * Patch KK2 — 2026-03-14: Current: 37/5000 = 0.74%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14kk2.ts
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

    // 1. WATER_BOTTLE_INTENT2: add ch.70 (glass water bottle = ch.70)
    {
      const e = allRules.find(r => r.id === 'WATER_BOTTLE_INTENT2');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '70') } });
        console.log('WATER_BOTTLE_INTENT2: added ch.70 (glass water bottle)');
      }
    }

    // 2. STONE_PLASTER_CARVED_ARTICLE_INTENT: add ch.70; noneOf slate-coaster/whiskey-glasses
    {
      const e = allRules.find(r => r.id === 'STONE_PLASTER_CARVED_ARTICLE_INTENT');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e,
          'slate coaster', 'whiskey glasses', 'whisky glasses',
          'coaster set', 'slate set',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('STONE_PLASTER_CARVED_ARTICLE_INTENT: added ch.70, noneOf slate-coaster/whiskey-glasses');
      }
    }

    // 3. SAUCE_CONDIMENT_INTENT: add ch.70; noneOf sauce-pot/corning-glass
    {
      const e = allRules.find(r => r.id === 'SAUCE_CONDIMENT_INTENT');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e,
          'sauce pot', 'sauce pan glass', 'corning', 'pyrex',
          'glass cookware', 'glass pot',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SAUCE_CONDIMENT_INTENT: added ch.70, noneOf sauce-pot/corning-glass');
      }
    }

    // 4. AI_CH35_ALBUMIN: add ch.70; noneOf egg-platter/deviled-egg
    {
      const e = allRules.find(r => r.id === 'AI_CH35_ALBUMIN');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e,
          'egg platter', 'deviled egg', 'egg tray glass', 'egg plate',
          'hobnail platter', 'scalloped tray',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH35_ALBUMIN: added ch.70, noneOf egg-platter/deviled-egg');
      }
    }

    // 5. PASTA_NOODLE_INTENT: add ch.70; noneOf pasta-bowl/pasta-salad-bowl
    {
      const e = allRules.find(r => r.id === 'PASTA_NOODLE_INTENT');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e,
          'pasta bowl', 'pasta salad bowl', 'pasta serving bowl',
          'corelle', 'corelle bowl',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('PASTA_NOODLE_INTENT: added ch.70, noneOf pasta-bowl/salad-bowl');
      }
    }

    // 6. AI_CH22_CIDER_PERRY_MEAD_SAKE: add ch.70; noneOf glass-sake-set
    {
      const e = allRules.find(r => r.id === 'AI_CH22_CIDER_PERRY_MEAD_SAKE');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e, 'glass sake', 'sake set', 'sake glass', 'glass sake set');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_CIDER_PERRY_MEAD_SAKE: added ch.70, noneOf glass-sake-set');
      }
    }

    // 7. AI_CH22_CIDER_MEAD_FERMENTED: add ch.70; noneOf glass-sake-set
    {
      const e = allRules.find(r => r.id === 'AI_CH22_CIDER_MEAD_FERMENTED');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e, 'glass sake', 'sake set', 'sake glass', 'glass sake set');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_CIDER_MEAD_FERMENTED: added ch.70, noneOf glass-sake-set');
      }
    }

    // 8. PINEAPPLES_FROZEN_INTENT: add ch.70; noneOf glass-pineapple/pineapple-vase
    {
      const e = allRules.find(r => r.id === 'PINEAPPLES_FROZEN_INTENT');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e,
          'glass pineapple', 'pineapple vase', 'pineapple glass', 'pineapple shaped vase',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('PINEAPPLES_FROZEN_INTENT: added ch.70, noneOf glass-pineapple/vase');
      }
    }

    // 9. AI_CH54_ARAMID_FIBER: add ch.70; noneOf bowden-sleeving/kevlar-sleeving
    {
      const e = allRules.find(r => r.id === 'AI_CH54_ARAMID_FIBER');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e, 'bowden sleeving', 'kevlar sleeving', 'bowden cable sleeving');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH54_ARAMID_FIBER: added ch.70, noneOf bowden-sleeving/glass-fiber');
      }
    }

    // 10. MECHANICAL_WATCH_INTENT: add ch.71; noneOf cocktail-watch/vintage-watch-jewelry
    {
      const e = allRules.find(r => r.id === 'MECHANICAL_WATCH_INTENT');
      if (e) {
        const wl = addCh(e, '71');
        const pat = addNo(e,
          'cocktail watch', 'vintage ladies watch', 'vintage watch silver',
          'marcasite watch', 'flower watch jewelry',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('MECHANICAL_WATCH_INTENT: added ch.71, noneOf cocktail-watch');
      }
    }

    // 11. WRISTWATCH_ANALOG_INTENT: add ch.71; noneOf cocktail-watch
    {
      const e = allRules.find(r => r.id === 'WRISTWATCH_ANALOG_INTENT');
      if (e) {
        const wl = addCh(e, '71');
        const pat = addNo(e,
          'cocktail watch', 'vintage ladies watch', 'vintage watch silver',
          'marcasite watch', 'flower watch jewelry',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('WRISTWATCH_ANALOG_INTENT: added ch.71, noneOf cocktail-watch');
      }
    }

    // 12. AI_CH04_FRESH_CHEESE: add ch.71; noneOf silverplate-tray/serving-tray
    {
      const e = allRules.find(r => r.id === 'AI_CH04_FRESH_CHEESE');
      if (e) {
        const wl = addCh(e, '71');
        const pat = addNo(e,
          'silverplate tray', 'silverplate serving', 'serving tray', 'decorative platter',
          'vintage silverplate', 'old english',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH04_FRESH_CHEESE: added ch.71, noneOf silverplate-tray');
      }
    }

    // 13. BASKETBALL_INTENT: add ch.71; noneOf sports-keychain/personalized-keychain
    {
      const e = allRules.find(r => r.id === 'BASKETBALL_INTENT');
      if (e) {
        const wl = addCh(e, '71');
        const pat = addNo(e,
          'sports keychain', 'personalized keychain', 'keychain gift',
          'custom name keychain', 'sports keychain gift',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('BASKETBALL_INTENT: added ch.71, noneOf sports-keychain');
      }
    }

    // 14. AI_CH64_BASKETBALL_CLEAT_SHOE: add ch.71; noneOf sports-keychain
    {
      const e = allRules.find(r => r.id === 'AI_CH64_BASKETBALL_CLEAT_SHOE');
      if (e) {
        const wl = addCh(e, '71');
        const pat = addNo(e,
          'sports keychain', 'personalized keychain', 'keychain gift',
          'custom name keychain',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH64_BASKETBALL_CLEAT_SHOE: added ch.71, noneOf sports-keychain');
      }
    }

    // 15. SIKH_TURBAN_ACCESSORY_INTENT: add ch.72; noneOf car-hanging/truck-hanging
    {
      const e = allRules.find(r => r.id === 'SIKH_TURBAN_ACCESSORY_INTENT');
      if (e) {
        const wl = addCh(e, '72');
        const pat = addNo(e,
          'car hanging', 'truck hanging', 'car hang', 'hanging accessories',
          'metal hanging', 'metal car',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SIKH_TURBAN_ACCESSORY_INTENT: added ch.72, noneOf car-hanging/truck-hanging');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch KK2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch KK2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
