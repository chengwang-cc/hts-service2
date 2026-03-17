#!/usr/bin/env ts-node
/**
 * Patch LL2 — 2026-03-14: Current: 25/5000 = 0.50%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14ll2.ts
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

    // 1. SILVER_BULLION_SCRAP_INTENT: add ch.72/74 (copper/aluminum shavings = ferrous/non-ferrous scrap)
    {
      const e = allRules.find(r => r.id === 'SILVER_BULLION_SCRAP_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '72', '74') } });
        console.log('SILVER_BULLION_SCRAP_INTENT: added ch.72/74 (metal shavings/scrap)');
      }
    }

    // 2. AI_CH22_SPIRITS_WHISKEY: add ch.73; noneOf whisky-tin/whiskey-tin
    {
      const e = allRules.find(r => r.id === 'AI_CH22_SPIRITS_WHISKEY');
      if (e) {
        const wl = addCh(e, '73');
        const pat = addNo(e, 'whisky tin', 'whiskey tin', 'spirits tin', 'scotch tin');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_SPIRITS_WHISKEY: added ch.73, noneOf whisky-tin');
      }
    }

    // 3. AI_CH19_MALT_EXTRACT: add ch.73; noneOf whisky-tin (scotch whisky tin = metal container)
    {
      const e = allRules.find(r => r.id === 'AI_CH19_MALT_EXTRACT');
      if (e) {
        const wl = addCh(e, '73');
        const pat = addNo(e, 'whisky tin', 'whiskey tin', 'scotch tin', 'malt tin');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH19_MALT_EXTRACT: added ch.73, noneOf whisky-tin');
      }
    }

    // 4. AI_CH45_CORK_MISC_ARTICLES: add ch.73; noneOf drink-coaster/metal-coaster
    {
      const e = allRules.find(r => r.id === 'AI_CH45_CORK_MISC_ARTICLES');
      if (e) {
        const wl = addCh(e, '73');
        const pat = addNo(e, 'drink coaster', 'metal coaster', 'coaster set', 'coasters metal');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH45_CORK_MISC_ARTICLES: added ch.73, noneOf drink-coaster/metal-coaster');
      }
    }

    // 5. AI_CH64_CORK_PLATFORM: add ch.73; noneOf drink-coaster
    {
      const e = allRules.find(r => r.id === 'AI_CH64_CORK_PLATFORM');
      if (e) {
        const wl = addCh(e, '73');
        const pat = addNo(e, 'drink coaster', 'metal coaster', 'coaster set', 'coasters metal');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH64_CORK_PLATFORM: added ch.73, noneOf drink-coaster');
      }
    }

    // 6. AI_CH45_CORK_STOPPERS: add ch.73; noneOf wine-stopper/metal-stopper
    {
      const e = allRules.find(r => r.id === 'AI_CH45_CORK_STOPPERS');
      if (e) {
        const wl = addCh(e, '73');
        const pat = addNo(e, 'wine stopper', 'beadable stopper', 'metal stopper', 'bottle stopper metal');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH45_CORK_STOPPERS: added ch.73, noneOf wine-stopper/metal-stopper');
      }
    }

    // 7. AI_CH02_GAME_EXOTIC: add ch.73; noneOf deer-sign/metal-decor
    {
      const e = allRules.find(r => r.id === 'AI_CH02_GAME_EXOTIC');
      if (e) {
        const wl = addCh(e, '73');
        const pat = addNo(e,
          'deer sign', 'deer name sign', 'deer family sign',
          'metal cabin', 'metal decor sign', 'name sign',
          'cabin decor', 'family name sign',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH02_GAME_EXOTIC: added ch.73, noneOf deer-sign/metal-decor');
      }
    }

    // 8. INCENSE_AROMATHERAPY_INTENT: add ch.74 (copper incense holder = ch.74)
    {
      const e = allRules.find(r => r.id === 'INCENSE_AROMATHERAPY_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '74') } });
        console.log('INCENSE_AROMATHERAPY_INTENT: added ch.74 (copper incense holder)');
      }
    }

    // 9. FOOD_PROCESSOR_INTENT: add ch.82; noneOf julienne-disc/food-processor-disc
    {
      const e = allRules.find(r => r.id === 'FOOD_PROCESSOR_INTENT');
      if (e) {
        const wl = addCh(e, '82');
        const pat = addNo(e, 'julienne disc', 'sous chef disc', 'food processor disc', 'processor blade');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('FOOD_PROCESSOR_INTENT: added ch.82, noneOf julienne-disc/sous-chef-disc');
      }
    }

    // 10. ESPRESSO_COFFEE_APPLIANCE_INTENT: add ch.82; noneOf julienne-disc
    {
      const e = allRules.find(r => r.id === 'ESPRESSO_COFFEE_APPLIANCE_INTENT');
      if (e) {
        const wl = addCh(e, '82');
        const pat = addNo(e, 'julienne disc', 'sous chef disc', 'food processor disc');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('ESPRESSO_COFFEE_APPLIANCE_INTENT: added ch.82, noneOf julienne-disc');
      }
    }

    // 11. CHRISTMAS_FESTIVE_ARTICLE_INTENT: add ch.82; noneOf nutcracker/brass-nutcracker
    {
      const e = allRules.find(r => r.id === 'CHRISTMAS_FESTIVE_ARTICLE_INTENT');
      if (e) {
        const wl = addCh(e, '82');
        const pat = addNo(e, 'nutcracker', 'brass nutcracker', 'alligator nutcracker', 'metal nutcracker');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CHRISTMAS_FESTIVE_ARTICLE_INTENT: added ch.82, noneOf nutcracker');
      }
    }

    // 12. AI_CH40_CONDOM: add ch.82; noneOf scissors-sheath/scissors-case
    {
      const e = allRules.find(r => r.id === 'AI_CH40_CONDOM');
      if (e) {
        const wl = addCh(e, '82');
        const pat = addNo(e,
          'scissors sheath', 'scissors case', 'scissor sheath',
          'embroidery scissors', 'scissors protection',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_CONDOM: added ch.82, noneOf scissors-sheath/scissors-case');
      }
    }

    // 13. BREAD_FOOD_INTENT: add ch.82; noneOf bread-basket (metal basket = ch.82)
    {
      const e = allRules.find(r => r.id === 'BREAD_FOOD_INTENT');
      if (e) {
        const wl = addCh(e, '82');
        const pat = addNo(e, 'bread basket', 'metal basket', 'wire basket');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('BREAD_FOOD_INTENT: added ch.82, noneOf bread-basket/metal-basket');
      }
    }

    // 14. SUITCASE_INTENT: add ch.83; noneOf bag-frame/metal-bag-frame
    {
      const e = allRules.find(r => r.id === 'SUITCASE_INTENT');
      if (e) {
        const wl = addCh(e, '83');
        const pat = addNo(e,
          'bag frame', 'metal bag frame', 'doctor bag frame',
          'diy bag frame', 'tote frame', 'purse frame',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SUITCASE_INTENT: added ch.83, noneOf bag-frame/purse-frame');
      }
    }

    // 15. AI_CH92_XYLOPHONE_MARIMBA: add ch.83; noneOf wind-chimes (metal wind chimes = ch.83)
    {
      const e = allRules.find(r => r.id === 'AI_CH92_XYLOPHONE_MARIMBA');
      if (e) {
        const wl = addCh(e, '83');
        const pat = addNo(e, 'wind chimes', 'wind chime', 'metal wind chimes', 'vintage wind chimes');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH92_XYLOPHONE_MARIMBA: added ch.83, noneOf wind-chimes');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch LL2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch LL2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
