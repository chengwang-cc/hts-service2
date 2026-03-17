#!/usr/bin/env ts-node
/**
 * Patch BB2 — 2026-03-14: Current: 184/5000 = 3.68%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14bb2.ts
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

    // 1. LOUDSPEAKER_AUDIO_ACCESSORY_INTENT: add ch.42/84
    {
      const e = allRules.find(r => r.id === 'LOUDSPEAKER_AUDIO_ACCESSORY_INTENT');
      if (e) { patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '42', '84') } }); console.log('LOUDSPEAKER_AUDIO_ACCESSORY_INTENT: added ch.42/84'); }
    }

    // 2. PET_FOOD_INTENT: add ch.42 (silicone treat pouches = plastic bags)
    {
      const e = allRules.find(r => r.id === 'PET_FOOD_INTENT');
      if (e) { patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '42') } }); console.log('PET_FOOD_INTENT: added ch.42 (silicone treat pouch)'); }
    }

    // 3. POLYESTER_FABRIC_INTENT: add ch.42/52/60
    {
      const e = allRules.find(r => r.id === 'POLYESTER_FABRIC_INTENT');
      if (e) { patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '42', '52', '60') } }); console.log('POLYESTER_FABRIC_INTENT: added ch.42/52/60'); }
    }

    // 4. AI_CH91_MARINE_CHRONOMETER: noneOf nautical-as-adjective
    {
      const e = allRules.find(r => r.id === 'AI_CH91_MARINE_CHRONOMETER');
      if (e) {
        const pat = addNo(e,
          'nautical pattern', 'nautical fish', 'nautical design', 'nautical theme',
          'texture roller', 'rolling pin', 'pottery tool',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('AI_CH91_MARINE_CHRONOMETER: noneOf nautical-adjective/texture-roller');
      }
    }

    // 5. JIGSAW_PUZZLE_INTENT: add ch.44/70; noneOf growth-chart/puzzle-piece-shaped
    {
      const e = allRules.find(r => r.id === 'JIGSAW_PUZZLE_INTENT');
      if (e) {
        const wl = addCh(e, '44', '70');
        const pat = addNo(e,
          'growth chart', 'wall decor chart', 'engraved wall decor', 'babyshower gift',
          'puzzle piece soap', 'puzzle piece shaped', 'puzzle piece dish',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('JIGSAW_PUZZLE_INTENT: added ch.44/70, noneOf growth-chart/puzzle-piece-dish');
      }
    }

    // 6. BOOKSHELF_INTENT: add ch.44
    {
      const e = allRules.find(r => r.id === 'BOOKSHELF_INTENT');
      if (e) { patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '44') } }); console.log('BOOKSHELF_INTENT: added ch.44 (wood floating shelf)'); }
    }

    // 7. STETHOSCOPE_INTENT: add ch.48; noneOf name-tag
    {
      const e = allRules.find(r => r.id === 'STETHOSCOPE_INTENT');
      if (e) {
        const wl = addCh(e, '48');
        const pat = addNo(e, 'stethoscope name tag', 'name tag', 'personalized tag', 'engraved tag');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('STETHOSCOPE_INTENT: added ch.48, noneOf name-tag');
      }
    }

    // 8. AI_CH56_NONWOVEN_FABRIC: add ch.39/60/87; noneOf stabilizer-bar/landscape
    {
      const e = allRules.find(r => r.id === 'AI_CH56_NONWOVEN_FABRIC');
      if (e) {
        const wl = addCh(e, '39', '60', '87');
        const pat = addNo(e,
          'stabilizer bar', 'suspension stabilizer', 'sway bar',
          'landscape paver', 'landscape edging',
          'pva stabilizer', 'water soluble stabilizer',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH56_NONWOVEN_FABRIC: added ch.39/60/87, noneOf stabilizer-bar/landscape');
      }
    }

    // 9. GRANOLA_CEREAL_INTENT: add ch.39/49/63; noneOf cereal-graphic/card/color
    {
      const e = allRules.find(r => r.id === 'GRANOLA_CEREAL_INTENT');
      if (e) {
        const wl = addCh(e, '39', '49', '63');
        const pat = addNo(e,
          'cereal sticker', 'affirmation cereal', 'vinyl sticker',
          'quaker oats card', 'parkhurst quaker', 'hockey card',
          'oatmeal color', 'oatmeal square', 'oatmeal colored',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('GRANOLA_CEREAL_INTENT: added ch.39/49/63, noneOf cereal-sticker/hockey-card/oatmeal-color');
      }
    }

    // 10. AI_CH11_OAT_PRODUCTS: add ch.49/63; noneOf oatmeal-color/hockey-card
    {
      const e = allRules.find(r => r.id === 'AI_CH11_OAT_PRODUCTS');
      if (e) {
        const wl = addCh(e, '49', '63');
        const pat = addNo(e,
          'oatmeal color', 'oatmeal square', 'oatmeal colored', 'oatmeal linen',
          'quaker oats card', 'parkhurst quaker', 'hockey card',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH11_OAT_PRODUCTS: added ch.49/63, noneOf oatmeal-color/hockey-card');
      }
    }

    // 11. NECKTIE_SCARF_FASHION_ACCESSORY_INTENT: add ch.50/56; noneOf tie-out-cordage
    {
      const e = allRules.find(r => r.id === 'NECKTIE_SCARF_FASHION_ACCESSORY_INTENT');
      if (e) {
        const wl = addCh(e, '50', '56');
        const pat = addNo(e, 'tie out', 'tie out cordage', 'guyline', 'reflective guyline', 'bear essentials');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('NECKTIE_SCARF_FASHION_ACCESSORY_INTENT: added ch.50/56, noneOf tie-out/guyline');
      }
    }

    // 12. AI_CH75_NICKEL_MATTE: add ch.39/54/58/70; noneOf matte-as-finish
    {
      const e = allRules.find(r => r.id === 'AI_CH75_NICKEL_MATTE');
      if (e) {
        const wl = addCh(e, '39', '54', '58', '70');
        const pat = addNo(e,
          'matte paint', 'matte finish', 'matte coat', 'matte wipe',
          'matte seed bead', 'matte bead', 'matte clear bead',
          'matte yarn', 'matte cotton',
          'matte glass', 'opaque matte',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH75_NICKEL_MATTE: added ch.39/54/58/70, noneOf matte-as-finish');
      }
    }

    // 13. DOOR_HARDWARE_KNOCKER_INTENT: add ch.55/84; noneOf door-stop/door-hook
    {
      const e = allRules.find(r => r.id === 'DOOR_HARDWARE_KNOCKER_INTENT');
      if (e) {
        const wl = addCh(e, '55', '84');
        const pat = addNo(e,
          'door stop', 'doorstop', 'weighted door stop', 'amigurumi door stop',
          'door hook', 'towel door hook', 'over the door hook', 'over-the-door',
          'towel rack', 'towel holder',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('DOOR_HARDWARE_KNOCKER_INTENT: added ch.55/84, noneOf door-stop/towel-hook');
      }
    }

    // 14. TELESCOPE_BINOCULARS_INTENT: add ch.56/85; noneOf cleaning-cloth/power-pack
    {
      const e = allRules.find(r => r.id === 'TELESCOPE_BINOCULARS_INTENT');
      if (e) {
        const wl = addCh(e, '56', '85');
        const pat = addNo(e,
          'microfiber cloth', 'cleaning cloth', 'glasses wipe', 'lens cloth',
          'power pack', 'lifepo', 'battery pack',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('TELESCOPE_BINOCULARS_INTENT: added ch.56/85, noneOf cleaning-cloth/power-pack');
      }
    }

    // 15. JEWELRY_NECKLACE_INTENT: add ch.56/58/62/73/91/96
    {
      const e = allRules.find(r => r.id === 'JEWELRY_NECKLACE_INTENT');
      if (e) {
        patches.push({
          priority: (e as any).priority ?? 500,
          rule: { ...e, whitelist: addCh(e, '56', '58', '62', '73', '91', '96') },
        });
        console.log('JEWELRY_NECKLACE_INTENT: added ch.56/58/62/73/91/96');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch BB2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch BB2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
