#!/usr/bin/env ts-node
/**
 * Patch JJ2 — 2026-03-14: Current: 51/5000 = 1.02%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14jj2.ts
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

    // 1. AI_CH59_TEXTILE_WALL_COVERING: add ch.63; noneOf fabric-wall-hanging
    {
      const e = allRules.find(r => r.id === 'AI_CH59_TEXTILE_WALL_COVERING');
      if (e) {
        const wl = addCh(e, '63');
        const pat = addNo(e, 'fabric wall hanging', 'wall hanging textile', 'hanging textile');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH59_TEXTILE_WALL_COVERING: added ch.63, noneOf fabric-wall-hanging');
      }
    }

    // 2. AI_CH35_CASEIN: add ch.63; noneOf milk-knot-pillow (milk as color/name, not dairy protein)
    {
      const e = allRules.find(r => r.id === 'AI_CH35_CASEIN');
      if (e) {
        const wl = addCh(e, '63');
        const pat = addNo(e,
          'milk knot', 'knot pillow', 'knot pillows', 'sphere ball pillow',
          'decorative cushion', 'scandinavian decor',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH35_CASEIN: added ch.63, noneOf milk-knot-pillow');
      }
    }

    // 3. LANYARD_BADGE_REEL_INTENT: add ch.63 (polyester lanyard = ch.63 made-up textile)
    {
      const e = allRules.find(r => r.id === 'LANYARD_BADGE_REEL_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '63') } });
        console.log('LANYARD_BADGE_REEL_INTENT: added ch.63 (polyester lanyard)');
      }
    }

    // 4. WOODEN_DECORATIVE_ARTICLE_INTENT: add ch.63; noneOf embroidery-hoop/needlework-hoop
    {
      const e = allRules.find(r => r.id === 'WOODEN_DECORATIVE_ARTICLE_INTENT');
      if (e) {
        const wl = addCh(e, '63');
        const pat = addNo(e,
          'embroidery hoop', 'needlework hoop', 'punch needle hoop',
          'hoop for embroidery', 'hoop for needlework',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('WOODEN_DECORATIVE_ARTICLE_INTENT: added ch.63, noneOf embroidery-hoop');
      }
    }

    // 5. GOLF_CLUB_INTENT: add ch.63; noneOf headcover/golf-headcover
    {
      const e = allRules.find(r => r.id === 'GOLF_CLUB_INTENT');
      if (e) {
        const wl = addCh(e, '63');
        const pat = addNo(e,
          'headcover', 'head cover', 'golf headcover', 'club headcover',
          'golf club headcover', 'pu-coated textile',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('GOLF_CLUB_INTENT: added ch.63, noneOf headcover/golf-headcover');
      }
    }

    // 6. BLOUSE_WOVEN_GARMENT_INTENT: add ch.63 (worn/used clothing = ch.63)
    {
      const e = allRules.find(r => r.id === 'BLOUSE_WOVEN_GARMENT_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '63') } });
        console.log('BLOUSE_WOVEN_GARMENT_INTENT: added ch.63 (worn/used clothing ch.63)');
      }
    }

    // 7. AI_CH92_ELECTRIC_GUITAR: add ch.64; noneOf bass-shoe/loafer/weejun
    {
      const e = allRules.find(r => r.id === 'AI_CH92_ELECTRIC_GUITAR');
      if (e) {
        const wl = addCh(e, '64');
        const pat = addNo(e,
          'bass loafer', 'bass shoe', 'bass men', 'g.h. bass',
          'weejun', 'weejuns', 'bass leather shoe',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH92_ELECTRIC_GUITAR: added ch.64, noneOf bass-shoe/loafer/weejun');
      }
    }

    // 8. AI_CH22_LIQUEUR_CORDIAL: add ch.64; noneOf amaretto-shoe/boat-shoe-amaretto
    {
      const e = allRules.find(r => r.id === 'AI_CH22_LIQUEUR_CORDIAL');
      if (e) {
        const wl = addCh(e, '64');
        const pat = addNo(e,
          'amaretto shoe', 'amaretto boat', 'boat shoe', 'loafer amaretto',
          'sperry', 'sperry shoe',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_LIQUEUR_CORDIAL: added ch.64, noneOf amaretto-shoe/boat-shoe');
      }
    }

    // 9. AI_CH22_LIQUEURS_CORDIALS: add ch.64; noneOf amaretto-shoe/boat-shoe
    {
      const e = allRules.find(r => r.id === 'AI_CH22_LIQUEURS_CORDIALS');
      if (e) {
        const wl = addCh(e, '64');
        const pat = addNo(e,
          'amaretto shoe', 'amaretto boat', 'boat shoe', 'loafer amaretto',
          'sperry', 'sperry shoe',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_LIQUEURS_CORDIALS: added ch.64, noneOf amaretto-shoe');
      }
    }

    // 10. GEMSTONE_CABOCHON_INTENT: add ch.64; noneOf garnet-color/garnet-shoe
    {
      const e = allRules.find(r => r.id === 'GEMSTONE_CABOCHON_INTENT');
      if (e) {
        const wl = addCh(e, '64');
        const pat = addNo(e,
          'garnet color', 'in garnet', 'garnet shoe', 'garnet sneaker',
          'converse garnet', 'chuck garnet',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('GEMSTONE_CABOCHON_INTENT: added ch.64, noneOf garnet-color/garnet-shoe');
      }
    }

    // 11. SKI_SNOWBOARD_INTENT: add ch.65 (snowboard helmet = ch.65 headgear)
    {
      const e = allRules.find(r => r.id === 'SKI_SNOWBOARD_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '65') } });
        console.log('SKI_SNOWBOARD_INTENT: added ch.65 (snowboard helmet = headgear)');
      }
    }

    // 12. AI_CH69_ROOFING_TILE: add ch.68; noneOf slate-wall-hanging/antique-tile
    {
      const e = allRules.find(r => r.id === 'AI_CH69_ROOFING_TILE');
      if (e) {
        const wl = addCh(e, '68');
        const pat = addNo(e,
          'slate roof tile', 'slate tile wall', 'antique roof tile',
          'slate wall hanging', 'collectible tile',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH69_ROOFING_TILE: added ch.68, noneOf slate-wall-hanging/antique-tile');
      }
    }

    // 13. FRESH_FRUIT_INTENT: add ch.69; noneOf orange-as-color
    {
      const e = allRules.find(r => r.id === 'FRESH_FRUIT_INTENT');
      if (e) {
        const wl = addCh(e, '69');
        const pat = addNo(e,
          'blue and orange', 'orange set', 'orange color set', 'blue orange',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('FRESH_FRUIT_INTENT: added ch.69, noneOf orange-as-color');
      }
    }

    // 14. ARTWORK_CERTIFICATE_INTENT: add ch.69; noneOf collector-plate/limited-edition-plate
    {
      const e = allRules.find(r => r.id === 'ARTWORK_CERTIFICATE_INTENT');
      if (e) {
        const wl = addCh(e, '69');
        const pat = addNo(e,
          'collector plate', 'collector plates', 'limited edition plate',
          'collector item plate', 'bradford exchange',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('ARTWORK_CERTIFICATE_INTENT: added ch.69, noneOf collector-plate');
      }
    }

    // 15. AI_CH22_GIN_TEQUILA_OTHER_SPIRITS: add ch.70; noneOf glass-decanter/decanter-bottle
    {
      const e = allRules.find(r => r.id === 'AI_CH22_GIN_TEQUILA_OTHER_SPIRITS');
      if (e) {
        const wl = addCh(e, '70');
        const pat = addNo(e,
          'glass decanter', 'decanter bottle', 'decanter for spirits',
          'clear decanter', 'crystal decanter',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_GIN_TEQUILA_OTHER_SPIRITS: added ch.70, noneOf glass-decanter');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch JJ2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch JJ2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
