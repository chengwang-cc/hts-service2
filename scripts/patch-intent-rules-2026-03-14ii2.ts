#!/usr/bin/env ts-node
/**
 * Patch II2 — 2026-03-14: Current: 65/5000 = 1.30%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14ii2.ts
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

    // 1. THREAD_EMBROIDERY_CORD_INTENT: add ch.58 (DMC embroidery floss skeins = ch.58)
    {
      const e = allRules.find(r => r.id === 'THREAD_EMBROIDERY_CORD_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '58') } });
        console.log('THREAD_EMBROIDERY_CORD_INTENT: added ch.58 (embroidery skeins)');
      }
    }

    // 2. AI_CH91_TIME_RECORDER: add ch.58/63; noneOf embroidery-hoop/punch-needle-hoop
    {
      const e = allRules.find(r => r.id === 'AI_CH91_TIME_RECORDER');
      if (e) {
        const wl = addCh(e, '58', '63');
        const pat = addNo(e,
          'embroidery hoop', 'punch needle hoop', 'needlework hoop',
          'hoop for embroidery', 'no-slip hoop', 'no slip hoop',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH91_TIME_RECORDER: added ch.58/63, noneOf embroidery-hoop');
      }
    }

    // 3. GYM_BAG_INTENT: add ch.58; noneOf quilted-bag/quilted-duffel
    {
      const e = allRules.find(r => r.id === 'GYM_BAG_INTENT');
      if (e) {
        const wl = addCh(e, '58');
        const pat = addNo(e, 'quilted bag', 'quilted duffel', 'handmade quilted', 'quilted tote');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('GYM_BAG_INTENT: added ch.58, noneOf quilted-bag/duffel');
      }
    }

    // 4. CHRISTMAS_TREE_INTENT: add ch.58; noneOf quilted-christmas/quilted-decoration
    {
      const e = allRules.find(r => r.id === 'CHRISTMAS_TREE_INTENT');
      if (e) {
        const wl = addCh(e, '58');
        const pat = addNo(e,
          'quilted christmas', 'quilted decoration', 'quilted ornament',
          'quilted cotton christmas',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CHRISTMAS_TREE_INTENT: added ch.58, noneOf quilted-christmas');
      }
    }

    // 5. CHOCOLATE_FOOD_INTENT: add ch.61; noneOf chocolate-as-color/trousers
    {
      const e = allRules.find(r => r.id === 'CHOCOLATE_FOOD_INTENT');
      if (e) {
        const wl = addCh(e, '61');
        const pat = addNo(e,
          'chocolate trousers', 'chocolate pants', 'chocolate high-waist',
          'chocolate color', 'chocolate brown', 'chocolate colored',
          'high-waist trousers', 'high waist trousers',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CHOCOLATE_FOOD_INTENT: added ch.61, noneOf chocolate-as-color/trousers');
      }
    }

    // 6. AI_CH19_WAFFLE_WAFER: add ch.61; noneOf waffle-top/waffle-knit
    {
      const e = allRules.find(r => r.id === 'AI_CH19_WAFFLE_WAFER');
      if (e) {
        const wl = addCh(e, '61');
        const pat = addNo(e,
          'waffle top', 'waffle knit', 'waffle fabric', 'waffle texture',
          'waffle shirt', 'waffle sweater',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH19_WAFFLE_WAFER: added ch.61, noneOf waffle-top/knit');
      }
    }

    // 7. BLANKET_INTENT: add ch.61 (crochet/knit baby blanket = ch.61 knitted)
    {
      const e = allRules.find(r => r.id === 'BLANKET_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '61') } });
        console.log('BLANKET_INTENT: added ch.61 (crochet acrylic baby blanket)');
      }
    }

    // 8. OILSEEDS_CH12_INTENT: add ch.61; noneOf crochet-flower-bouquet (separate from sunflower food)
    {
      const e = allRules.find(r => r.id === 'OILSEEDS_CH12_INTENT');
      if (e) {
        const wl = addCh(e, '61');
        const pat = addNo(e,
          'crochet flowers', 'crochet flower', 'flowers bouquet', 'flower bouquet',
          'handmade gift bouquet', 'crochet bouquet',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('OILSEEDS_CH12_INTENT: added ch.61, noneOf crochet-flower-bouquet');
      }
    }

    // 9. GIFT_BOX_INTENT: add ch.62 (gift box set = ch.62 garment set)
    {
      const e = allRules.find(r => r.id === 'GIFT_BOX_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '62') } });
        console.log('GIFT_BOX_INTENT: added ch.62 (lingerie/garment gift box set)');
      }
    }

    // 10. AI_CH65_VISOR: add ch.62 (turban visor / woven hat = ch.62)
    {
      const e = allRules.find(r => r.id === 'AI_CH65_VISOR');
      if (e) {
        const wl = addCh(e, '62');
        const pat = addNo(e, 'turban visor', 'lycra hat', 'upf hat', 'sun protection hat', 'beach hat');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH65_VISOR: added ch.62, noneOf turban-visor/lycra-hat');
      }
    }

    // 11. AI_CH65_HAT_PARTS: add ch.62; noneOf turban-visor
    {
      const e = allRules.find(r => r.id === 'AI_CH65_HAT_PARTS');
      if (e) {
        const wl = addCh(e, '62');
        const pat = addNo(e, 'turban visor', 'lycra hat', 'upf hat', 'sun protection hat');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH65_HAT_PARTS: added ch.62, noneOf turban-visor');
      }
    }

    // 12. AI_CH88_FLIGHT_SIMULATOR: add ch.62; noneOf waist-trainer/body-shaper
    {
      const e = allRules.find(r => r.id === 'AI_CH88_FLIGHT_SIMULATOR');
      if (e) {
        const wl = addCh(e, '62');
        const pat = addNo(e, 'waist trainer', 'waist shaper', 'body shaper', 'corset trainer');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH88_FLIGHT_SIMULATOR: added ch.62, noneOf waist-trainer');
      }
    }

    // 13. AI_CH51_RAW_WOOL: add ch.62 (100% wool woven garment/scarf = ch.62)
    {
      const e = allRules.find(r => r.id === 'AI_CH51_RAW_WOOL');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '62') } });
        console.log('AI_CH51_RAW_WOOL: added ch.62 (wool woven garment)');
      }
    }

    // 14. AI_CH58_TULLE_NET_FABRIC: add ch.62 (lace-bordered tulle as garment/accessory = ch.62)
    {
      const e = allRules.find(r => r.id === 'AI_CH58_TULLE_NET_FABRIC');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '62') } });
        console.log('AI_CH58_TULLE_NET_FABRIC: added ch.62 (lace-bordered tulle garment)');
      }
    }

    // 15. SOFA_COUCH_INTENT: add ch.63; noneOf slipcover/furniture-cover
    {
      const e = allRules.find(r => r.id === 'SOFA_COUCH_INTENT');
      if (e) {
        const wl = addCh(e, '63');
        const pat = addNo(e,
          'slipcover', 'sofa slipcover', 'sofa cover', 'furniture cover',
          'chair cover', 'couch cover',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SOFA_COUCH_INTENT: added ch.63, noneOf slipcover/furniture-cover');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch II2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch II2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
