#!/usr/bin/env ts-node
/**
 * Patch GG2 — 2026-03-14: Current: 89/5000 = 1.78%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14gg2.ts
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

    // 1. FURNITURE_WOOD_TABLE_INTENT: add ch.44; noneOf wooden-sign/place-card/seating-decor
    {
      const e = allRules.find(r => r.id === 'FURNITURE_WOOD_TABLE_INTENT');
      if (e) {
        const wl = addCh(e, '44');
        const pat = addNo(e,
          'table seating', 'seating decor', 'place card', 'placecard',
          'wedding sign', 'table sign', 'table number sign',
          'wooden sign', 'engraved sign',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('FURNITURE_WOOD_TABLE_INTENT: added ch.44, noneOf wooden-sign/place-card');
      }
    }

    // 2. AI_CH36_MATCHES: add ch.48; noneOf mix-and-match/greeting-card
    {
      const e = allRules.find(r => r.id === 'AI_CH36_MATCHES');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e, 'mix and match', 'greeting card', 'note card', 'art card');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH36_MATCHES: added ch.48, noneOf mix-and-match/greeting-card');
      }
    }

    // 3. FRESH_FLOWER_INTENT: add ch.48; noneOf decal/butterfly-decal/dusty-rose-decal
    {
      const e = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e,
          'butterflies decal', 'butterfly decal', 'wall decal', 'decal',
          'dusty rose', 'nursery decal', '3d butterfly',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('FRESH_FLOWER_INTENT: added ch.48, noneOf butterfly-decal/dusty-rose');
      }
    }

    // 4. AI_CH24_RAW_LEAF_TOBACCO: add ch.48; noneOf loose-leaf-binder/loose-leaf-notebook
    {
      const e = allRules.find(r => r.id === 'AI_CH24_RAW_LEAF_TOBACCO');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e, 'loose leaf binder', 'loose leaf notebook', 'loose leaf paper', 'binder');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH24_RAW_LEAF_TOBACCO: added ch.48, noneOf loose-leaf-binder');
      }
    }

    // 5. PHOTO_ALBUM_INTENT: add ch.48 (fabric-covered/vintage paper photo album)
    {
      const e = allRules.find(r => r.id === 'PHOTO_ALBUM_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '48') } });
        console.log('PHOTO_ALBUM_INTENT: added ch.48 (fabric-covered wedding album = paper/paperboard)');
      }
    }

    // 6. AI_CH88_AIRPLANE: add ch.48; noneOf decal/model-decal/aircraft-decal
    {
      const e = allRules.find(r => r.id === 'AI_CH88_AIRPLANE');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e,
          'decal', 'decals', 'model decal', 'aircraft decal', 'airplane decal',
          'scale model decal',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH88_AIRPLANE: added ch.48, noneOf decal/model-decal');
      }
    }

    // 7. AIR_FRYER_INTENT: add ch.48; noneOf paper-tray/paper-liner
    {
      const e = allRules.find(r => r.id === 'AIR_FRYER_INTENT');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e, 'paper tray', 'paper liner', 'parchment tray', 'air fryer liner', 'air fryer paper');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AIR_FRYER_INTENT: added ch.48, noneOf paper-tray/paper-liner');
      }
    }

    // 8. BABY_CHILDREN_GARMENT_INTENT: add ch.48; noneOf paper-favour/baby-shower-favor
    {
      const e = allRules.find(r => r.id === 'BABY_CHILDREN_GARMENT_INTENT');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e,
          'paper favour', 'paper favor', 'paper favours', 'paper favors',
          'baby shower favor', 'baby shower favour',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('BABY_CHILDREN_GARMENT_INTENT: added ch.48, noneOf paper-favour');
      }
    }

    // 9. BABY_INFANT_GARMENT_INTENT: add ch.48; noneOf paper-favour/baby-shower-favor
    {
      const e = allRules.find(r => r.id === 'BABY_INFANT_GARMENT_INTENT');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e,
          'paper favour', 'paper favor', 'paper favours', 'paper favors',
          'baby shower favor', 'baby shower favour',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('BABY_INFANT_GARMENT_INTENT: added ch.48, noneOf paper-favour');
      }
    }

    // 10. AI_CH35_PEPTONES_PROTEIN: add ch.49 (art book = ch.49 printed matter)
    {
      const e = allRules.find(r => r.id === 'AI_CH35_PEPTONES_PROTEIN');
      if (e) {
        const wl = addCh(e, '49');
        const pat = addNo(e, 'art book', 'anthology', 'graphic novel', 'illustrated book');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH35_PEPTONES_PROTEIN: added ch.49, noneOf art-book/anthology');
      }
    }

    // 11. CONSTRUCTION_TOY_INTENT: add ch.49; noneOf encyclopedia/instruction-book
    {
      const e = allRules.find(r => r.id === 'CONSTRUCTION_TOY_INTENT');
      if (e) {
        const wl = addCh(e, '49');
        const pat = addNo(e, 'encyclopedia', 'instruction book', 'lego book', 'set printed');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CONSTRUCTION_TOY_INTENT: added ch.49, noneOf encyclopedia/instruction-book');
      }
    }

    // 12. ANIMAL_FEED_CH23_INTENT: add ch.49; noneOf sword/novel/book-title
    {
      const e = allRules.find(r => r.id === 'ANIMAL_FEED_CH23_INTENT');
      if (e) {
        const wl = addCh(e, '49');
        const pat = addNo(e, 'sword of', 'samurai', 'novel', 'paperback book', 'anthology');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('ANIMAL_FEED_CH23_INTENT: added ch.49, noneOf sword/samurai/novel');
      }
    }

    // 13. NUMISMATIC_COIN_INTENT: add ch.49; noneOf banknote/paper-currency
    {
      const e = allRules.find(r => r.id === 'NUMISMATIC_COIN_INTENT');
      if (e) {
        const wl = addCh(e, '49');
        const pat = addNo(e, 'banknote', 'bank note', 'paper currency', 'paper money', 'collectable banknote');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('NUMISMATIC_COIN_INTENT: added ch.49, noneOf banknote/paper-currency');
      }
    }

    // 14. ACCORDION_ORGAN_WIND_INSTRUMENT_INTENT: add ch.49; noneOf accordion-card/accordion-fold
    {
      const e = allRules.find(r => r.id === 'ACCORDION_ORGAN_WIND_INSTRUMENT_INTENT');
      if (e) {
        const wl = addCh(e, '49');
        const pat = addNo(e,
          'accordion card', 'accordion fold', 'accordion book', 'accordion style card',
          'accordion baby', 'baby bump accordion',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('ACCORDION_ORGAN_WIND_INSTRUMENT_INTENT: added ch.49, noneOf accordion-card/fold');
      }
    }

    // 15. SILK_SCARF_INTENT: add ch.50 (cotton-silk blend = ch.50 woven silk fabrics)
    {
      const e = allRules.find(r => r.id === 'SILK_SCARF_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '50') } });
        console.log('SILK_SCARF_INTENT: added ch.50 (cotton silk blend scarf)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch GG2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch GG2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
