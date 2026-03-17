#!/usr/bin/env ts-node
/**
 * Patch CC2 — 2026-03-14: Current: 157/5000 = 3.14%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14cc2.ts
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

    // 1. INDOOR_PLANT_INTENT: add ch.56/63/69; noneOf herb-tableware/herb-marker/plant-pot
    {
      const e = allRules.find(r => r.id === 'INDOOR_PLANT_INTENT');
      if (e) {
        const wl = addCh(e, '56', '63', '69');
        const pat = addNo(e,
          'herb tea towel', 'herb plate', 'herb marker', 'herb bookmark',
          'ceramic plant pot', 'pottery plant pot', 'plant pot intended',
          'shell plant holder', 'hanging plant holder',
          'botanical herb', 'herb garden sign',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('INDOOR_PLANT_INTENT: added ch.56/63/69, noneOf herb-tableware/plant-pot');
      }
    }

    // 2. BABY_CRIB_INTENT: add ch.61/62/63; noneOf singlet false-substring-match
    {
      const e = allRules.find(r => r.id === 'BABY_CRIB_INTENT');
      if (e) {
        const wl = addCh(e, '61', '62', '63');
        const pat = addNo(e, 'cotton singlet', 'baby singlet', 'singlet', 'crib set bedding', 'crib set linen');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('BABY_CRIB_INTENT: added ch.61/62/63, noneOf singlet');
      }
    }

    // 3. OILSEEDS_CH12_INTENT: noneOf sunflower-as-decorative-flower
    {
      const e = allRules.find(r => r.id === 'OILSEEDS_CH12_INTENT');
      if (e) {
        const pat = addNo(e,
          'crochet sunflower', 'sunflower bouquet', 'sunflower crochet',
          'sunflower handmade', 'sunflower flower', 'forever flowers',
          'sunflower decor', 'sunflower gift',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('OILSEEDS_CH12_INTENT: noneOf crochet/bouquet sunflower');
      }
    }

    // 4. DAIRY_INTENT: add ch.34/49/62/63/69/70/71/94; noneOf cream-as-color + milk-paint
    {
      const e = allRules.find(r => r.id === 'DAIRY_INTENT');
      if (e) {
        const wl = addCh(e, '34', '49', '62', '63', '69', '70', '71', '94');
        const pat = addNo(e,
          // 'cream' as color name
          'in cream', 'cream color', 'cream colour', 'cream white',
          'cream colored', 'cream eggshell', 'creamy blush',
          // 'milk' as material or color
          'milk glass', 'milk paint', 'milk paint colour', 'milk paint fan',
          // 'cheese' as non-food
          'cheese sticker',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('DAIRY_INTENT: added 8 chapters, noneOf cream-color/milk-paint/cheese-sticker');
      }
    }

    // 5. PAPER_BANNER_PENNANT_INTENT: add ch.63
    {
      const e = allRules.find(r => r.id === 'PAPER_BANNER_PENNANT_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '63') } });
        console.log('PAPER_BANNER_PENNANT_INTENT: added ch.63 (felt pennant flags, textile banners)');
      }
    }

    // 6. MAKEUP_BLUSH_INTENT: add ch.48/63/67/70/94; noneOf blush-as-color
    {
      const e = allRules.find(r => r.id === 'MAKEUP_BLUSH_INTENT');
      if (e) {
        const wl = addCh(e, '48', '63', '67', '70', '94');
        const pat = addNo(e,
          'blush pink', 'blush color', 'blush colour', 'blush ribbon',
          'blush bunny', 'blush butterfly', 'creamy blush',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('MAKEUP_BLUSH_INTENT: added ch.48/63/67/70/94, noneOf blush-as-color');
      }
    }

    // 7. BRONZER_BLUSH_INTENT: add ch.48/63/67/70/94; noneOf blush-as-color (same as above)
    {
      const e = allRules.find(r => r.id === 'BRONZER_BLUSH_INTENT');
      if (e) {
        const wl = addCh(e, '48', '63', '67', '70', '94');
        const pat = addNo(e,
          'blush pink', 'blush color', 'blush colour', 'blush ribbon',
          'blush bunny', 'blush butterfly', 'creamy blush',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('BRONZER_BLUSH_INTENT: added ch.48/63/67/70/94, noneOf blush-as-color');
      }
    }

    // 8. AI_CH89_INFLATABLE_BOAT: add ch.60/61/68/95; noneOf rib-knit/zodiac-sign/beach-ball
    {
      const e = allRules.find(r => r.id === 'AI_CH89_INFLATABLE_BOAT');
      if (e) {
        const wl = addCh(e, '60', '61', '68', '95');
        const pat = addNo(e,
          'rib knit', 'rib knitted', '2x2 rib', 'rib stitch',
          'zodiac sign', 'zodiac star', 'memory block zodiac',
          'beach ball', 'inflatable beach', 'inflatable toy',
          'rib navy', 'navy rib',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH89_INFLATABLE_BOAT: added ch.60/61/68/95, noneOf rib-knit/zodiac-sign/beach-ball');
      }
    }

    // 9. HANDMADE_WASHI_PAPER_INTENT: add ch.69/83
    {
      const e = allRules.find(r => r.id === 'HANDMADE_WASHI_PAPER_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '69', '83') } });
        console.log('HANDMADE_WASHI_PAPER_INTENT: added ch.69/83 (diorama, frame-with-paper)');
      }
    }

    // 10. CONDIMENT_SAUCE_INTENT: add ch.42/62/69/70; noneOf mustard-as-color
    {
      const e = allRules.find(r => r.id === 'CONDIMENT_SAUCE_INTENT');
      if (e) {
        const wl = addCh(e, '42', '62', '69', '70');
        const pat = addNo(e,
          'mustard color', 'mustard colour', 'in mustard', 'mustard yellow',
          'mustard print', 'mustard abstract', 'mustard checker',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CONDIMENT_SAUCE_INTENT: added ch.42/62/69/70, noneOf mustard-as-color');
      }
    }

    // 11. PERFUME_INTENT: add ch.70 (vintage/antique perfume bottles = glass)
    {
      const e = allRules.find(r => r.id === 'PERFUME_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '70') } });
        console.log('PERFUME_INTENT: added ch.70 (vintage/antique glass perfume bottles)');
      }
    }

    // 12. SODA_BEVERAGE_INTENT: add ch.70/76/94; noneOf perk-a-cola/empty-can/antique
    {
      const e = allRules.find(r => r.id === 'SODA_BEVERAGE_INTENT');
      if (e) {
        const wl = addCh(e, '70', '76', '94');
        const pat = addNo(e,
          'perk a cola', 'juggernog', 'call of duty', 'zombies lamp',
          'empty can', 'empty cola can',
          'antique coke', 'antique cola',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SODA_BEVERAGE_INTENT: added ch.70/76/94, noneOf perk-a-cola/empty-can');
      }
    }

    // 13. AI_CH19_PASTRY_CAKE: add ch.34/44/70/82/94/95; noneOf cake-topper
    {
      const e = allRules.find(r => r.id === 'AI_CH19_PASTRY_CAKE');
      if (e) {
        const wl = addCh(e, '34', '44', '70', '82', '94', '95');
        const pat = addNo(e,
          'cake topper', 'cupcake topper', 'cake toppers', 'cupcake toppers',
          'cake stand', 'cake server', 'cake box glass', 'cake dish',
          'donut pillow', 'piercing pillow',
          'soap in other forms', 'soap bars cakes',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH19_PASTRY_CAKE: added ch.34/44/70/82/94/95, noneOf cake-topper/donut-pillow');
      }
    }

    // 14. AI_CH19_TAPIOCA: add ch.07/71; noneOf freshwater-pearl
    {
      const e = allRules.find(r => r.id === 'AI_CH19_TAPIOCA');
      if (e) {
        const wl = addCh(e, '07', '71');
        const pat = addNo(e,
          'freshwater pearl', 'freshwater pearls', 'pearl jewelry', 'pearl earring',
          'pearl necklace', 'rice pearl', 'tasbih pearl',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH19_TAPIOCA: added ch.07/71, noneOf freshwater-pearl');
      }
    }

    // 15. AI_CH17_INVERT_SUGAR: add ch.50/72/83; noneOf golden-as-color/material
    {
      const e = allRules.find(r => r.id === 'AI_CH17_INVERT_SUGAR');
      if (e) {
        const wl = addCh(e, '50', '72', '83');
        const pat = addNo(e,
          'golden zari', 'golden border', 'golden colour', 'golden color',
          'golden rose', 'golden frame', 'golden trim', 'golden thread',
          'zari border', 'mysore silk',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH17_INVERT_SUGAR: added ch.50/72/83, noneOf golden-as-color');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch CC2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch CC2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
