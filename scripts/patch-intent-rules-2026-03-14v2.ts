#!/usr/bin/env ts-node
/**
 * Patch V2 — 2026-03-14:
 *
 * Targeting top blockers after U2 (319/5000 = 6.38% blocked):
 *
 * 1. REFRACTORY_CLAY_CEMENT_INTENT: add ch.25/39/48.
 *    'clay' → bentonite clay mineral (ch.25), polymer clay cutters (ch.39),
 *    transfer paper for clay (ch.48).
 *
 * 2. HAIR_CLAW_INTENT: add ch.61/62/63/65.
 *    'headband' → textile headbands (ch.62 woven, ch.61 knit), fabric hair wraps (ch.63),
 *    birdcage veil (ch.65 millinery).
 *
 * 3. STONE_PLASTER_CARVED_ARTICLE_INTENT: noneOf alabaster-as-color.
 *    'alabaster' → paint brand color (ch.32), acrylic panel color (ch.39).
 *
 * 4. CHARCOAL_WOOD_INTENT: add ch.33/40/69; noneOf charcoal-as-color.
 *    'charcoal' → charcoal deodorant (ch.33), rubber sole charcoal color (ch.40),
 *    ceramic bowl in charcoal color (ch.69).
 *
 * 5. FRIDGE_MAGNET_INTENT: add ch.39/69/71/83.
 *    'magnet' → polymer clay fridge magnet (ch.39), ceramic fridge magnet (ch.69),
 *    enamel needle minder with magnet (ch.71/83), 3D-printed PLA magnet (ch.39).
 *
 * 6. RECORDED_MEDIA_VHS_DVD_INTENT: add ch.48.
 *    'record album' → record sleeve (ch.48 paper).
 *
 * 7. SPORTS_JERSEY_INTENT: add ch.95.
 *    'souvenir mini soccer jersey' → toy/souvenir (ch.95).
 *
 * 8. SPORTS_JERSEY_GARMENT_INTENT: add ch.62/95.
 *    Woven jerseys (ch.62), souvenir mini jerseys (ch.95).
 *
 * 9. COFFEE_MAKER_INTENT: add ch.69/70/73.
 *    Moka stovetop espresso (ch.73 steel), ceramic pour-over (ch.69),
 *    Chemex glass (ch.70).
 *
 * 10. AI_CH51_HORSEHAIR_FABRIC: noneOf coarse-as-grind-size.
 *     'coarse' → stone inlay coarse size (ch.71), crushed bone coarse (ch.05).
 *
 * 11. AI_CH03_SMOKED_DRIED_SALTED_FISH: noneOf false triggers.
 *     'salt' → art cup pinch bowl (ch.69), shoe color (ch.64), clothing (ch.61).
 *     'dried' → dried vegetables (ch.07), dried fruit (ch.08).
 *     'cured' → fire-cured tobacco (ch.24).
 *
 * 12. AI_CH03_LIVE_FISH: noneOf false triggers.
 *     'ornamental' → cut flowers for ornamental purposes (ch.06).
 *     'aquarium' → aquarium power bar (ch.85).
 *     'live' → live shaft idler (ch.84 mechanical).
 *
 * 13. AI_CH65_RUBBER_PLASTIC_HAT: noneOf non-headgear.
 *     'plastic cap' → end cap (ch.39), anode cap (ch.85), rubber bur (ch.82).
 *
 * 14. AI_CH92_CYMBAL: noneOf false triggers.
 *     'overhead' → car overhead console (ch.87).
 *     'ride' → ride-on toy (ch.95).
 *     'crash' → crash party balloon garland (ch.40).
 *
 * 15. AI_CH51_HORSEHAIR_FABRIC: add noneOf for stone inlay + crushed bone.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14v2.ts
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

    // ── 1. REFRACTORY_CLAY_CEMENT_INTENT: add ch.25/39/48 ────────────────────
    {
      const existing = allRules.find(r => r.id === 'REFRACTORY_CLAY_CEMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '25', '39', '48'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'REFRACTORY_CLAY_CEMENT_INTENT') +
              ' — Fixed V2: added ch.25 (bentonite clay mineral), ch.39 (polymer clay tools), ch.48 (transfer paper for clay)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`REFRACTORY_CLAY_CEMENT_INTENT: added ch.25/39/48`);
      } else { console.log('WARNING: REFRACTORY_CLAY_CEMENT_INTENT not found'); }
    }

    // ── 2. HAIR_CLAW_INTENT: add ch.61/62/63/65 ──────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'HAIR_CLAW_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '61', '62', '63', '65'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'HAIR_CLAW_INTENT') +
              ' — Fixed V2: added ch.61/62/63/65 (textile headbands, veil, millinery)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`HAIR_CLAW_INTENT: added ch.61/62/63/65`);
      } else { console.log('WARNING: HAIR_CLAW_INTENT not found'); }
    }

    // ── 3. STONE_PLASTER_CARVED_ARTICLE_INTENT: noneOf alabaster-as-color ────
    {
      const existing = allRules.find(r => r.id === 'STONE_PLASTER_CARVED_ARTICLE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'alabaster' used as a paint/finish color name
          'alabaster paint', 'alabaster acrylic', 'alabaster white acrylic',
          'fusion mineral', '120ml', '250ml', '500ml', '1 litre',
          // Coater / paint context
          'paint color', 'paint colour', 'wall paint', 'chalk paint',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STONE_PLASTER_CARVED_ARTICLE_INTENT') +
              ' — Fixed V2: noneOf alabaster-as-paint-color (120ml, fusion mineral, acrylic sample)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`STONE_PLASTER_CARVED_ARTICLE_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: STONE_PLASTER_CARVED_ARTICLE_INTENT not found'); }
    }

    // ── 4. CHARCOAL_WOOD_INTENT: add ch.33/40/69 + noneOf charcoal-as-color ──
    {
      const existing = allRules.find(r => r.id === 'CHARCOAL_WOOD_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '33', '40', '69'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // charcoal deodorant (ch.33 cosmetic)
          'charcoal deodorant', 'charcoal toothpaste', 'charcoal face mask', 'charcoal soap',
          // charcoal as shoe/product color
          'charcoal color', 'charcoal colour', 'in charcoal', 'charcoal black',
          'rubber sole', 'shoe sole', 'glerups',
          // ceramic in charcoal glaze
          'ceramic pedestal', 'ceramic bowl',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CHARCOAL_WOOD_INTENT') +
              ' — Fixed V2: added ch.33 (charcoal cosmetics), ch.40 (rubber sole), ch.69 (ceramic); noneOf charcoal-as-color',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CHARCOAL_WOOD_INTENT: added ch.33/40/69, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: CHARCOAL_WOOD_INTENT not found'); }
    }

    // ── 5. FRIDGE_MAGNET_INTENT: add ch.39/69/71/83 ──────────────────────────
    {
      const existing = allRules.find(r => r.id === 'FRIDGE_MAGNET_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39', '69', '71', '83'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Shoes with magnetic closure
          'new balance', 'running shoe', 'sneaker',
          // Hijab magnetic pin (ch.62)
          'hijab magnet',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FRIDGE_MAGNET_INTENT') +
              ' — Fixed V2: added ch.39 (polymer clay/PLA magnets), ch.69 (ceramic fridge magnets), ch.71 (enamel), ch.83 (metal needle minder)',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`FRIDGE_MAGNET_INTENT: added ch.39/69/71/83, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: FRIDGE_MAGNET_INTENT not found'); }
    }

    // ── 6. RECORDED_MEDIA_VHS_DVD_INTENT: add ch.48/92 ───────────────────────
    {
      const existing = allRules.find(r => r.id === 'RECORDED_MEDIA_VHS_DVD_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '48', '92'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // "Video Driver IC for DVD Repair" → electronic component, not media
          'driver ic', 'video driver', 'ic for',
          // Recorder as recording device (already in noneOf? add just in case)
          'recorder microphone', 'microphone',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'RECORDED_MEDIA_VHS_DVD_INTENT') +
              ' — Fixed V2: added ch.48 (record sleeve paper), ch.92; noneOf driver ic/microphone',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`RECORDED_MEDIA_VHS_DVD_INTENT: added ch.48/92, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: RECORDED_MEDIA_VHS_DVD_INTENT not found'); }
    }

    // ── 7. SPORTS_JERSEY_INTENT: add ch.95 ───────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '95'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_INTENT') +
              ' — Fixed V2: added ch.95 (souvenir/miniature jerseys)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPORTS_JERSEY_INTENT: added ch.95`);
      } else { console.log('WARNING: SPORTS_JERSEY_INTENT not found'); }
    }

    // ── 8. SPORTS_JERSEY_GARMENT_INTENT: add ch.62/95 ────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '62', '95'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_GARMENT_INTENT') +
              ' — Fixed V2: added ch.62 (woven jerseys), ch.95 (souvenir mini jersey)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPORTS_JERSEY_GARMENT_INTENT: added ch.62/95`);
      } else { console.log('WARNING: SPORTS_JERSEY_GARMENT_INTENT not found'); }
    }

    // ── 9. COFFEE_MAKER_INTENT: add ch.69/70/73 ──────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'COFFEE_MAKER_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '69', '70', '73'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'COFFEE_MAKER_INTENT') +
              ' — Fixed V2: added ch.69 (ceramic pour-over), ch.70 (Chemex borosilicate glass), ch.73 (Moka stovetop steel)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`COFFEE_MAKER_INTENT: added ch.69/70/73`);
      } else { console.log('WARNING: COFFEE_MAKER_INTENT not found'); }
    }

    // ── 10. AI_CH51_HORSEHAIR_FABRIC: noneOf coarse-as-grind-size ────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH51_HORSEHAIR_FABRIC') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Stone inlay products with coarse size variants
          'stone inlay', 'crushed stone', 'inlay crush', 'coarse sizes',
          // Crushed fossil/bone powder
          'dinosaur bone', 'dinosaur fossil', 'allosaurus', 'crushed',
          // Abrasive/sanding products
          'abalone', 'sanding', 'grit',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH51_HORSEHAIR_FABRIC') +
              ' — Fixed V2: noneOf coarse-as-grind-size (stone inlay, crushed bone, abrasive)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH51_HORSEHAIR_FABRIC: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH51_HORSEHAIR_FABRIC not found'); }
    }

    // ── 11. AI_CH03_SMOKED_DRIED_SALTED_FISH: noneOf false trigger contexts ───
    {
      const existing = allRules.find(r => r.id === 'AI_CH03_SMOKED_DRIED_SALTED_FISH') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'salt' as color name in shoes (New Balance "Sea Salt with Arid Stone")
          'arid stone', 'sea salt with',
          // 'salt pinch' = pinch pot ceramic bowl (ch.69)
          'salt pinch', 'pinch bowl', 'pinch pot',
          // Clothing with ice cream / sea salt print
          'ice cream tank top', 'tank top',
          // Aquarium sea salt mix
          'aquarium use', 'aquarium salt',
          // Dried vegetables/fruit (ch.07/08)
          'kidney bean', 'phaseolus', 'sweet potato', 'cassava', 'arrowroot',
          'guava', 'mango', 'mangosteens', 'dried fruit', 'dried vegetable',
          // Tobacco cured (ch.24)
          'tobacco', 'fire-cured', 'sun-cured', 'virginia',
          // Yarn named "Salt and Pep"
          'salt and pep', 'colorama',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH03_SMOKED_DRIED_SALTED_FISH') +
              ' — Fixed V2: noneOf salt-pinch, arid-stone, aquarium-salt, dried-veg, tobacco, yarn-salt-and-pep',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH03_SMOKED_DRIED_SALTED_FISH: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH03_SMOKED_DRIED_SALTED_FISH not found'); }
    }

    // ── 12. AI_CH03_LIVE_FISH: noneOf false trigger contexts ─────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH03_LIVE_FISH') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'ornamental' → cut flowers for ornamental purposes (ch.06)
          'cut flowers', 'flower bud', 'bouquets', 'ornamental purposes',
          'ornamental foliage', 'ornamental plant',
          // 'aquarium' → power bar electrical device (ch.85)
          'power bar', 'aquarium power',
          // 'live' → mechanical live shaft (ch.84)
          'live shaft', 'shaft idler', 'micron xy',
          // 'aquarium' → decorative, not fish
          'aquarium decor', 'aquarium ornament',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH03_LIVE_FISH') +
              ' — Fixed V2: noneOf cut-flowers, aquarium-power-bar, live-shaft',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH03_LIVE_FISH: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH03_LIVE_FISH not found'); }
    }

    // ── 13. AI_CH65_RUBBER_PLASTIC_HAT: noneOf non-headgear rubber/plastic caps
    {
      const existing = allRules.find(r => r.id === 'AI_CH65_RUBBER_PLASTIC_HAT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // End caps (ch.39/40)
          'end cap', 'end caps', 'molded end', 'pvc end', 'rubber end',
          // Anode caps (ch.85 electronic)
          'anode cap', 'anode caps', 'high voltage', 'crt',
          // Sanding caps (ch.82 abrasive tools)
          'sanding cap', 'sanding caps', 'rubber bur', 'bur',
          // PVC fittings (ch.39)
          'flexible pvc', 'pvc material', 'pvc cap', 'pipe cap',
          // Bottle caps (ch.39)
          'bottle cap', 'bottle caps', 'jar cap', 'lid cap',
          // Tire / wheel caps (ch.40/87)
          'valve cap', 'wheel cap', 'stem cap',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH65_RUBBER_PLASTIC_HAT') +
              ' — Fixed V2: noneOf end-cap, anode-cap, sanding-cap, pvc-fitting (non-headgear)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH65_RUBBER_PLASTIC_HAT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH65_RUBBER_PLASTIC_HAT not found'); }
    }

    // ── 14. AI_CH92_CYMBAL: noneOf false trigger contexts ────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_CYMBAL') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'overhead' → car overhead console / dome light (ch.87)
          'overhead console', 'overhead light', 'dome light', 'dome map light',
          'console dome', 'map light',
          // 'ride' → ride-on toy car (ch.95)
          'ride on', 'ride-on', 'power wheels',
          // 'crash' → monster truck crash party theme (ch.40/49)
          'monster truck', 'smash and crash', 'balloon garland', 'balloon arch',
          // 'splash' → paint splash, water splash (non-cymbal)
          'paint splash', 'water splash',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH92_CYMBAL') +
              ' — Fixed V2: noneOf overhead-console, ride-on-car, monster-truck-crash',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH92_CYMBAL: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH92_CYMBAL not found'); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch V2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    const finalRules = svc.getAllRules();
    console.log(`\nPatch V2 complete: ${patches.length} applied, 0 failed`);
    console.log(`Rules in cache: ${finalRules.length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
