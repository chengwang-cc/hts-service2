#!/usr/bin/env ts-node
/**
 * Patch AA2 — 2026-03-14: Current: 213/5000 = 4.26%.
 *
 * 1. AUTOMOTIVE_INTERIOR_PARTS_INTENT: add ch.39/90.
 *    'sun visor' → plastic sun visor (ch.39); sun visor with light sensor (ch.90 optical).
 *
 * 2. PRINTED_MATTER_CATALOGUE_INTENT: add ch.39/48.
 *    'trading card' → plastic artwork card case (ch.39); cardboard card sleeves (ch.48).
 *
 * 3. AI_CH92_WHISTLE_DECOY: add ch.39/73/95; noneOf emergency/game/duck-ornament.
 *    'whistle' → plastic safety whistle (ch.39), whistle-shaped enamel pin (ch.73).
 *    'duck' → Duck Hunt NES game (ch.95), AFLAC Santa Duck ornament (ch.95).
 *
 * 4. FAN_VENTILATION_COOLING_INTENT: add ch.39/85; noneOf static-air-vent.
 *    'air vent' → plastic ventilation grille (ch.39); automotive dash vent trim (ch.85).
 *
 * 5. AI_CH69_CERAMIC_DINNERWARE_SET: add ch.39/44/63.
 *    'dinnerware' → plastic kitchen bowls (ch.39). 'place setting' → wooden place cards (ch.44),
 *    textile placemat/napkin set (ch.63).
 *
 * 6. PLASTIC_TOY_FIGURINE_INTENT: add ch.39/49; noneOf display-frame.
 *    'plastic toy' → plastic toy display frame (ch.39). 'action figure' → licensed figure book (ch.49).
 *
 * 7. APOTHECARY_GLASS_CONTAINER_INTENT: add ch.39/44; noneOf standee/cabinet.
 *    'apothecary' → Apothecary Diaries standee (ch.39 plastic), wood apothecary cabinet (ch.44).
 *
 * 8. PLUSH_STUFFED_TOY_INTENT: add ch.39/54/58.
 *    'plushie' → plastic/silicone plush coin purse (ch.39). 'soft toy' → nylon fiber (ch.54).
 *    'stuffed toy' → woven fabric stuffed toy (ch.58).
 *
 * 9. CLUTCH_BAG_INTENT: add ch.39/48/63.
 *    'wristlet' → plastic jelly wristlet (ch.39), phone connector patch (ch.48), cotton wristlet (ch.63).
 *    'evening clutch' → beaded satin clutch classified as ch.39.
 *
 * 10. AI_CH03_MOLLUSCS: add ch.25/39/73/82; noneOf periwinkle-as-color + razor.
 *     'abalone' → abalone stone inlay material (ch.25). 'periwinkle' → color name (ch.39/73).
 *     'razor' → Gillette shaving razor (ch.82).
 *
 * 11. COFFEE_MAKER_INTENT: add ch.39/82.
 *     'coffee maker' → plastic funnel stand (ch.39); hand-cranked coffee maker (ch.82).
 *
 * 12. JEWELRY_RING_INTENT: add ch.40/42/44/69/82/91/92/94/95/96/97.
 *     'pendant' → pendant light (ch.94), watch pendant (ch.91), base metal pendant (ch.82).
 *     'charm' → ceramic charm (ch.69), anime keychain charm (ch.95), antique silver charm (ch.97).
 *     'ring' → pet collar ring (ch.42); noneOf pendant-light, guitar-knob.
 *
 * 13. AI_CH89_INFLATABLE_RAFT: add ch.34/40/62/85; noneOf tube-contexts.
 *     'tube' → soap tube (ch.34), tire inner tube (ch.40), tube skirt (ch.62), radio vacuum tube (ch.85).
 *
 * 14. SOCCER_BALL_INTENT: add ch.41.
 *     'football ball' → leather football ball (ch.41 leather article = vintage/display).
 *
 * 15. AI_CH22_BRANDY_COGNAC: add ch.42; noneOf cognac-leather.
 *     'cognac' → Cognac Leather Journal (ch.42 leather good).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14aa2.ts
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

    const addChapters = (existing: IntentRule, ...chs: string[]) => {
      const wl = (existing.whitelist as any) ?? {};
      return { ...wl, allowChapters: [...new Set([...(wl.allowChapters ?? []), ...chs])] };
    };
    const addNoneOf = (existing: IntentRule, ...terms: string[]) => {
      const pat = (existing.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // ── 1. AUTOMOTIVE_INTERIOR_PARTS_INTENT ───────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'AUTOMOTIVE_INTERIOR_PARTS_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '39', '90') } });
        console.log('AUTOMOTIVE_INTERIOR_PARTS_INTENT: added ch.39/90');
      }
    }

    // ── 2. PRINTED_MATTER_CATALOGUE_INTENT ────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'PRINTED_MATTER_CATALOGUE_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '39', '48') } });
        console.log('PRINTED_MATTER_CATALOGUE_INTENT: added ch.39/48');
      }
    }

    // ── 3. AI_CH92_WHISTLE_DECOY ──────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'AI_CH92_WHISTLE_DECOY');
      if (e) {
        const wl = addChapters(e, '39', '73', '95');
        const pat = addNoneOf(e,
          'emergency whistle', 'safety whistle', 'plastic whistle',
          'duck hunt', 'nintendo', 'nes game',
          'santa duck', 'aflac', 'christopher radko',
          'enamel pin whistle', 'whistle pin',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH92_WHISTLE_DECOY: added ch.39/73/95, noneOf safety-whistle/duck-hunt/ornament');
      }
    }

    // ── 4. FAN_VENTILATION_COOLING_INTENT ─────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'FAN_VENTILATION_COOLING_INTENT');
      if (e) {
        const wl = addChapters(e, '39', '85');
        const pat = addNoneOf(e,
          'plastic air vent', 'air vent grille', 'dash vent', 'vent trim',
          'vent cover', 'vent grille',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('FAN_VENTILATION_COOLING_INTENT: added ch.39/85, noneOf static-air-vent');
      }
    }

    // ── 5. AI_CH69_CERAMIC_DINNERWARE_SET ─────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'AI_CH69_CERAMIC_DINNERWARE_SET');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '39', '44', '63') } });
        console.log('AI_CH69_CERAMIC_DINNERWARE_SET: added ch.39/44/63');
      }
    }

    // ── 6. PLASTIC_TOY_FIGURINE_INTENT ────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'PLASTIC_TOY_FIGURINE_INTENT');
      if (e) {
        const wl = addChapters(e, '39', '49');
        const pat = addNoneOf(e, 'display frame', 'toy display frame', 'toy stand');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('PLASTIC_TOY_FIGURINE_INTENT: added ch.39/49, noneOf display-frame');
      }
    }

    // ── 7. APOTHECARY_GLASS_CONTAINER_INTENT ──────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'APOTHECARY_GLASS_CONTAINER_INTENT');
      if (e) {
        const wl = addChapters(e, '39', '44');
        const pat = addNoneOf(e,
          'apothecary diaries', 'standee', 'apothecary cabinet', 'apothecary spice',
          'spice cabinet', 'spice rack',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('APOTHECARY_GLASS_CONTAINER_INTENT: added ch.39/44, noneOf standee/cabinet');
      }
    }

    // ── 8. PLUSH_STUFFED_TOY_INTENT ───────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'PLUSH_STUFFED_TOY_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '39', '54', '58') } });
        console.log('PLUSH_STUFFED_TOY_INTENT: added ch.39/54/58');
      }
    }

    // ── 9. CLUTCH_BAG_INTENT ──────────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'CLUTCH_BAG_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '39', '48', '63') } });
        console.log('CLUTCH_BAG_INTENT: added ch.39/48/63');
      }
    }

    // ── 10. AI_CH03_MOLLUSCS ──────────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'AI_CH03_MOLLUSCS');
      if (e) {
        const wl = addChapters(e, '25', '39', '73', '82');
        const pat = addNoneOf(e,
          // 'periwinkle' as color
          'periwinkle color', 'periwinkle blue', 'in periwinkle', 'periwinkle bone',
          'periwinkle grip',
          // 'razor' as shaving razor
          'razor blade', 'razor blades', 'razor handle', 'disposable razor',
          'gillette', 'schick',
          // 'abalone' as shell inlay material
          'abalone inlay', 'abalone extra large', 'crushed abalone',
          'stone inlay abalone',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH03_MOLLUSCS: added ch.25/39/73/82, noneOf periwinkle-color/razor/abalone-inlay');
      }
    }

    // ── 11. COFFEE_MAKER_INTENT ───────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'COFFEE_MAKER_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '39', '82') } });
        console.log('COFFEE_MAKER_INTENT: added ch.39/82');
      }
    }

    // ── 12. JEWELRY_RING_INTENT ───────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'JEWELRY_RING_INTENT');
      if (e) {
        const wl = addChapters(e, '40', '42', '44', '69', '82', '91', '92', '94', '95', '96', '97');
        const pat = addNoneOf(e,
          // 'pendant' as pendant light fixture
          'pendant light', 'pendant lamp', 'pendant lampshade', 'pendant fixture',
          // 'knob ring' = guitar tuner
          'knob ring', 'knob rings',
          // 'ring' in pet collar context
          'pet necklace ring', 'collar ring',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('JEWELRY_RING_INTENT: added ch.40/42/44/69/82/91/92/94/95/96/97, noneOf pendant-light/knob-ring');
      }
    }

    // ── 13. AI_CH89_INFLATABLE_RAFT ───────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'AI_CH89_INFLATABLE_RAFT');
      if (e) {
        const wl = addChapters(e, '34', '40', '62', '85');
        const pat = addNoneOf(e,
          // 'tube' as soap/cosmetic container
          'brush soap', 'soap tube', '150ml tube', 'tube soap',
          // 'tube' as tire inner tube
          'tire and tube', 'tube set tire', 'liberty tire',
          // 'tube' as skirt style
          'tube skirt', 'midi tube', 'tube top', 'tube dress',
          // 'tube' as vacuum/radio tube (electronics)
          'vacuum tube', 'radio tube', 'tube set radio', 'partial tube set',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH89_INFLATABLE_RAFT: added ch.34/40/62/85, noneOf tube-skirt/soap/tire/radio');
      }
    }

    // ── 14. SOCCER_BALL_INTENT ────────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'SOCCER_BALL_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addChapters(e, '41') } });
        console.log('SOCCER_BALL_INTENT: added ch.41 (leather vintage football)');
      }
    }

    // ── 15. AI_CH22_BRANDY_COGNAC ─────────────────────────────────────────────
    {
      const e = allRules.find(r => r.id === 'AI_CH22_BRANDY_COGNAC');
      if (e) {
        const wl = addChapters(e, '41', '42');
        const pat = addNoneOf(e,
          'cognac leather', 'in cognac', 'cognac color', 'cognac colour',
          'cognac brown', 'cognac journal',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH22_BRANDY_COGNAC: added ch.41/42, noneOf cognac-leather');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch AA2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch AA2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
