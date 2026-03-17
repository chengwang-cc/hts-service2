#!/usr/bin/env ts-node
/**
 * Patch DD2 — 2026-03-14: Current: 131/5000 = 2.62%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14dd2.ts
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

    // 1. AI_CH47_RECOVERED_PAPER: add ch.48/56/73/90/96; noneOf recycled-non-paper/corrugated-nail
    {
      const e = allRules.find(r => r.id === 'AI_CH47_RECOVERED_PAPER');
      if (e) {
        const wl = addCh(e, '48', '56', '73', '90', '96');
        const pat = addNo(e,
          'recycled cotton', 'recycled polyester', 'recycled plastic', 'recycled ocean',
          'recycled bottle', 'recycled material', 'corrugated nail',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH47_RECOVERED_PAPER: added ch.48/56/73/90/96, noneOf recycled-non-paper');
      }
    }

    // 2. LAPEL_PIN_BROOCH_INTENT: add ch.83/96
    {
      const e = allRules.find(r => r.id === 'LAPEL_PIN_BROOCH_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '83', '96') } });
        console.log('LAPEL_PIN_BROOCH_INTENT: added ch.83/96 (badge pins, button/seashell)');
      }
    }

    // 3. AI_CH92_DRUM_STAND_ACCESSORY: noneOf guitar/auto/bicycle pedal; add ch.85/87
    {
      const e = allRules.find(r => r.id === 'AI_CH92_DRUM_STAND_ACCESSORY');
      if (e) {
        const wl = addCh(e, '85', '87');
        const pat = addNo(e,
          'guitar pedal', 'effects pedal', 'effect pedal', 'guitar effects',
          'brake pedal', 'accelerator pedal', 'gas pedal', 'clutch pedal',
          'bicycle pedal', 'bike pedal', 'cycling pedal',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH92_DRUM_STAND_ACCESSORY: added ch.85/87, noneOf guitar/auto/bicycle pedal');
      }
    }

    // 4. AI_CH40_ORINGS_GASKETS_SEALS: add ch.71/82/84/90; noneOf o-ring-jewelry/day-collar
    {
      const e = allRules.find(r => r.id === 'AI_CH40_ORINGS_GASKETS_SEALS');
      if (e) {
        const wl = addCh(e, '71', '82', '84', '90');
        const pat = addNo(e,
          'o ring necklace', 'o ring choker', 'day collar', 'eternity collar',
          'collar necklace',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_ORINGS_GASKETS_SEALS: added ch.71/82/84/90, noneOf o-ring-jewelry');
      }
    }

    // 5. JAM_PRESERVE_INTENT: add ch.33/39/82; noneOf jam-nut/jelly-plastic/baby-jelly
    {
      const e = allRules.find(r => r.id === 'JAM_PRESERVE_INTENT');
      if (e) {
        const wl = addCh(e, '33', '39', '82');
        const pat = addNo(e,
          'jam nut', 'jam-free', 'jam free', 'jam bit',
          'baby jelly', 'petroleum jelly', 'jelly sample',
          'jelly color', 'jelly wristlet', 'jelly phone',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('JAM_PRESERVE_INTENT: added ch.33/39/82, noneOf jam-nut/jelly-plastic/baby-jelly');
      }
    }

    // 6. PRESERVED_FOOD_CH20_INTENT: add ch.33/39/82; same jelly/jam false positives
    {
      const e = allRules.find(r => r.id === 'PRESERVED_FOOD_CH20_INTENT');
      if (e) {
        const wl = addCh(e, '33', '39', '82');
        const pat = addNo(e,
          'jam nut', 'jam-free', 'jam free', 'jam bit',
          'baby jelly', 'petroleum jelly', 'jelly sample',
          'jelly color', 'jelly wristlet', 'jelly phone',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('PRESERVED_FOOD_CH20_INTENT: added ch.33/39/82, noneOf jam-nut/jelly-plastic');
      }
    }

    // 7. AI_CH89_ROWBOAT_PADDLEBOAT: noneOf guitar/auto/bicycle pedal; add ch.85/87
    {
      const e = allRules.find(r => r.id === 'AI_CH89_ROWBOAT_PADDLEBOAT');
      if (e) {
        const wl = addCh(e, '85', '87');
        const pat = addNo(e,
          'guitar pedal', 'effects pedal', 'effect pedal', 'guitar effects',
          'brake pedal', 'accelerator pedal', 'gas pedal',
          'bicycle pedal', 'bike pedal',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH89_ROWBOAT_PADDLEBOAT: added ch.85/87, noneOf guitar/auto/bicycle pedal');
      }
    }

    // 8. AI_CH89_BUOY_BEACON: noneOf marker-as-stationery/golf/bookmark; add ch.32/58/95/96
    {
      const e = allRules.find(r => r.id === 'AI_CH89_BUOY_BEACON');
      if (e) {
        const wl = addCh(e, '32', '58', '95', '96');
        const pat = addNo(e,
          'art marker', 'paint marker', 'paint art marker', 'permanent marker',
          'dry erase marker', 'whiteboard marker', 'chalk marker',
          'book marker', 'bookmark marker', 'golf ball marker', 'golf marker',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH89_BUOY_BEACON: added ch.32/58/95/96, noneOf marker-as-stationery/golf');
      }
    }

    // 9. AI_CH66_TELESCOPIC_UMBRELLA: noneOf travel-as-modifier; add ch.29/42
    {
      const e = allRules.find(r => r.id === 'AI_CH66_TELESCOPIC_UMBRELLA');
      if (e) {
        const wl = addCh(e, '29', '42');
        const pat = addNo(e,
          'travel mug', 'travel mugs', 'travel case', 'travel folio',
          'travel jewelry', 'travel wallet', 'travel bag', 'travel pouch',
          'travel organizer', 'travel accessory',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH66_TELESCOPIC_UMBRELLA: added ch.29/42, noneOf travel-as-modifier');
      }
    }

    // 10. AI_CH17_MAPLE_SUGAR_SYRUP: add ch.39/44; noneOf maple-wood/charcuterie
    {
      const e = allRules.find(r => r.id === 'AI_CH17_MAPLE_SUGAR_SYRUP');
      if (e) {
        const wl = addCh(e, '39', '44');
        const pat = addNo(e,
          'maple wood', 'birds eye maple', 'maple veneered', 'maple mdf',
          'charcuterie', 'cutting board', 'serving board', 'stabilized wood',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH17_MAPLE_SUGAR_SYRUP: added ch.39/44, noneOf maple-wood/charcuterie');
      }
    }

    // 11. GEMSTONE_CRYSTAL_MINERAL_INTENT: add ch.25 (raw/natural crystals/minerals)
    {
      const e = allRules.find(r => r.id === 'GEMSTONE_CRYSTAL_MINERAL_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '25') } });
        console.log('GEMSTONE_CRYSTAL_MINERAL_INTENT: added ch.25 (raw natural crystal/agate minerals)');
      }
    }

    // 12. PEN_PENCIL_INTENT: add ch.40/42/95; noneOf pencil-mark/pen-case/golf-marker
    {
      const e = allRules.find(r => r.id === 'PEN_PENCIL_INTENT');
      if (e) {
        const wl = addCh(e, '40', '42', '95');
        const pat = addNo(e,
          'pencil mark', 'pencil eraser', 'mark remover',
          'pen case', 'pen pouch', 'pen holder',
          'golf ball marker', 'golf marker',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('PEN_PENCIL_INTENT: added ch.40/42/95, noneOf pencil-mark/pen-case/golf-marker');
      }
    }

    // 13. SKINCARE_MOISTURIZER_INTENT: add ch.30/35
    {
      const e = allRules.find(r => r.id === 'SKINCARE_MOISTURIZER_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '30', '35') } });
        console.log('SKINCARE_MOISTURIZER_INTENT: added ch.30/35 (pharmaceutical/collagen face cream)');
      }
    }

    // 14. MEAT_BEEF_INTENT: add ch.15/39; noneOf beef-illustration/tallow
    {
      const e = allRules.find(r => r.id === 'MEAT_BEEF_INTENT');
      if (e) {
        const wl = addCh(e, '15', '39');
        const pat = addNo(e,
          'illustration', 'keychain beef', 'beef illustration',
          'tallow', 'animal fat', 'lard',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('MEAT_BEEF_INTENT: added ch.15/39, noneOf illustration/tallow');
      }
    }

    // 15. RESIN_EPOXY_LIQUID_POLYMER_INTENT: add ch.35/96; noneOf applicator-sponge
    {
      const e = allRules.find(r => r.id === 'RESIN_EPOXY_LIQUID_POLYMER_INTENT');
      if (e) {
        const wl = addCh(e, '35', '96');
        const pat = addNo(e,
          'applicator sponge', 'tough coat', 'coat applicator', 'sponge applicator',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('RESIN_EPOXY_LIQUID_POLYMER_INTENT: added ch.35/96, noneOf applicator-sponge');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch DD2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch DD2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
