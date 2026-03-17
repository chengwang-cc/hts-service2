#!/usr/bin/env ts-node
/**
 * Patch OOOO — 2026-03-14:
 *
 * noneOf fixes (8 rules):
 * 1. AI_CH91_MARINE_CHRONOMETER: add barometer/weather station → "Vintage Barometer" blocked by 'nautical'
 * 2. AI_CH91_DASHBOARD_CLOCK: add heater/climate/control → "Automotive Dash Heater Control" blocked by 'dash'
 * 3. AI_CH13_NATURAL_GUMS_RESINS: add earring/jewelry/stainless → "Earings resin stainless" blocked by 'resin'
 * 4. AI_CH45_CORK_RAW: add opal/gemstone/inlay → "crushed Bello Opal inlaying" blocked by 'crushed'
 * 5. AI_CH67_WIGS_HAIRPIECES: add cake/cupcake/party → "36 Toppers 6 Faces" blocked by 'toppers'
 * 6. AI_CH36_EXPLOSIVES: add horn/antique horn → "ANTIQUE POWDER HORN" blocked by 'powder'
 * 7. AI_CH75_NICKEL_POWDER_FLAKE: add horn/antique horn → same
 * 8. AI_CH45_CORK_RAW: add horn → same (already listed above but adding horn too)
 *
 * New rules (4):
 * 9. BAROMETER_WEATHER_INSTRUMENT_INTENT (ch.90): barometer/altimeter/weather station → 9025.10
 * 10. JEWELRY_EARRING_INTENT (ch.71): earring/earrings/stud earring → 7117.19
 * 11. GEMSTONE_CABOCHON_INTENT (ch.71): opal/gemstone/cabochon → 7103.91
 * 12. MOTOR_MOUNT_DRONE_INTENT (ch.39): motor mount/fpv/drone mount/vibration dampener → 3926.90
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14oooo.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed OOOO: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH91_MARINE_CHRONOMETER: 'nautical' fires for barometers ─────────
    addNoneOf('AI_CH91_MARINE_CHRONOMETER', [
      'barometer', 'barometers', 'weather station', 'altimeter', 'hygrometer',
      'thermometer', 'anemometer', 'weather instrument', 'aneroid',
      'pressure gauge', 'weather gauge',
    ], 'barometer/weather instrument context prevents marine chronometer rule from blocking ch.90 barometers');

    // ── 2. AI_CH91_DASHBOARD_CLOCK: 'dash' fires for dash heater controls ──────
    addNoneOf('AI_CH91_DASHBOARD_CLOCK', [
      'heater', 'heater control', 'hvac', 'climate control', 'heat control',
      'temperature control', 'ac control', 'air conditioning',
      'vent', 'blower', 'defrost', 'fan control',
    ], 'heater/climate context prevents dashboard clock rule from blocking ch.90 automotive controls');

    // ── 3. AI_CH13_NATURAL_GUMS_RESINS: 'resin' fires for resin jewelry ────────
    addNoneOf('AI_CH13_NATURAL_GUMS_RESINS', [
      'earring', 'earrings', 'jewelry', 'jewellery', 'stainless steel',
      'stainless', 'necklace', 'bracelet', 'pendant', 'ring', 'brooch',
      'resin jewelry', 'resin earring', 'epoxy jewelry',
    ], 'jewelry/earring context prevents natural gums rule from blocking resin jewelry in ch.71');

    // ── 4. AI_CH45_CORK_RAW: 'crushed' fires for crushed opal/gemstones ───────
    addNoneOf('AI_CH45_CORK_RAW', [
      'opal', 'gemstone', 'inlaying', 'inlay', 'crushed opal', 'crushed stone',
      'shell', 'mother of pearl', 'abalone', 'turquoise',
    ], 'opal/gemstone/inlaying context prevents cork raw rule from blocking gemstone materials in ch.71');

    // ── 5. AI_CH67_WIGS_HAIRPIECES: 'toppers' fires for cake/party toppers ──────
    addNoneOf('AI_CH67_WIGS_HAIRPIECES', [
      'cake topper', 'cupcake topper', 'party topper', 'wedding topper',
      'cupcake', 'cake', 'birthday', 'food topper', 'topper faces',
    ], 'cake/party context prevents wig rule from blocking edible/party toppers in ch.95');

    // ── 6-7-8. POWDER-based rules: add horn/antique context ──────────────────
    const powderHornTerms = [
      'horn', 'antique horn', 'powder horn', 'hunting horn', 'decorative horn',
      'musical horn', 'instrument',
    ];
    addNoneOf('AI_CH36_EXPLOSIVES', powderHornTerms,
      'horn/antique context prevents explosives rule from blocking antique powder horns in ch.96');
    addNoneOf('AI_CH75_NICKEL_POWDER_FLAKE', powderHornTerms,
      'horn/antique context prevents nickel powder rule from blocking antique powder horns');
    // AI_CH45_CORK_RAW already handles 'powder' as a trigger - add horn context
    addNoneOf('AI_CH45_CORK_RAW', [
      'horn', 'antique horn', 'powder horn',
    ], 'horn/antique context prevents cork raw rule from blocking antique powder horns');

    // ── 9. NEW BAROMETER_WEATHER_INSTRUMENT_INTENT ────────────────────────────
    // "Vintage Barometer, French Barometer, Nautical Barometer, Weather Station" → 9025.10 (ch.90)
    patches.push({
      priority: 569,
      rule: {
        id: 'BAROMETER_WEATHER_INSTRUMENT_INTENT',
        description: 'Barometers, altimeters, and weather instruments → ch.90 (9025.10). ' +
          '"Vintage barometer", "aneroid barometer", "weather station" → 9025.10. ' +
          'Without rule, AI_CH91_MARINE_CHRONOMETER blocks ch.90 for "nautical" barometers.',
        pattern: {
          anyOf: [
            'barometer', 'barometers', 'aneroid barometer', 'altimeter', 'altimeters',
            'weather station', 'weather instrument', 'hygrometer', 'anemometer',
            'rain gauge', 'weather gauge',
          ],
          noneOf: ['clock', 'watch', 'chronometer'],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [
          { prefix: '9025.10', syntheticRank: 9 }, // Thermometers/barometers
          { prefix: '9025.80', syntheticRank: 8 }, // Other instruments
          { prefix: '9015.80', syntheticRank: 7 }, // Other surveying/navigation instruments
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9025.10' },
          { delta: 0.4, chapterMatch: '90' },
        ],
      } as IntentRule,
    });

    // ── 10. NEW JEWELRY_EARRING_INTENT ────────────────────────────────────────
    // "Earings- resin and stainless steel" → 7117.19 (ch.71)
    // "Earings" (typo) not matched; blocked by AI_CH13_NATURAL_GUMS_RESINS for 'resin'
    patches.push({
      priority: 559,
      rule: {
        id: 'JEWELRY_EARRING_INTENT',
        description: 'Earrings, stud earrings, and fashion jewelry → ch.71 (7117.19). ' +
          '"Resin earrings", "stainless steel earrings", "drop earrings" → 7117.19. ' +
          'Without rule, AI_CH13 blocks ch.71 for resin earrings, AI_CH13 has allowChapters=["13"].',
        pattern: {
          anyOf: [
            'earring', 'earrings', 'earings', 'stud earring', 'drop earring',
            'hoop earring', 'dangle earring', 'ear stud', 'ear studs',
            'ear hook', 'threader earring',
          ],
          noneOf: ['hearing aid', 'earplug', 'earmuff'],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7117.19', syntheticRank: 9 }, // Imitation jewelry, other
          { prefix: '7117.11', syntheticRank: 8 }, // Cuff links and studs
          { prefix: '7113.19', syntheticRank: 7 }, // Articles of jewelry, other precious metal
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7117' },
          { delta: 0.4, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 11. NEW GEMSTONE_CABOCHON_INTENT ──────────────────────────────────────
    // "5 GRAMS crushed Bello Opal for inlaying" → 7103.91 (ch.71)
    // Blocked by AI_CH45_CORK_RAW for 'crushed' → ch.45
    patches.push({
      priority: 556,
      rule: {
        id: 'GEMSTONE_CABOCHON_INTENT',
        description: 'Gemstones, cabochons and inlay materials → ch.71 (7103.91). ' +
          '"Crushed opal inlaying", "turquoise cabochon", "gemstone chips" → 7103.91. ' +
          'Without rule, AI_CH45_CORK_RAW blocks ch.71 for "crushed" gemstone queries.',
        pattern: {
          anyOf: [
            'opal', 'cabochon', 'gemstone', 'gem stone', 'inlaying stone',
            'turquoise', 'malachite', 'lapis lazuli', 'labradorite',
            'chrysocolla', 'howlite', 'jasper', 'agate',
            'crushed opal', 'shell inlay', 'mother of pearl inlay',
          ],
          noneOf: ['synthetic', 'glass', 'plastic gem'],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7103.91', syntheticRank: 9 }, // Other precious/semi-precious stones, unworked
          { prefix: '7103.99', syntheticRank: 8 }, // Other precious/semi-precious stones, worked
          { prefix: '7116.10', syntheticRank: 7 }, // Articles of natural pearls
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7103' },
          { delta: 0.4, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 12. NEW MOTOR_MOUNT_DRONE_INTENT ─────────────────────────────────────
    // "22xx-23xx FPV Motor Soft Mounts" → 3926.90 (ch.39)
    // fused.size=0 because "fpv motor soft mounts" has no HTS vocabulary match
    patches.push({
      priority: 545,
      rule: {
        id: 'MOTOR_MOUNT_DRONE_INTENT',
        description: 'FPV drone motor mounts and vibration dampeners → ch.39 (3926.90). ' +
          '"FPV motor soft mounts", "drone motor mount", "silicone mount" → 3926.90. ' +
          'Without rule, fused.size=0 for drone part queries with model numbers.',
        pattern: {
          anyOf: [
            'motor mount', 'motor mounts', 'soft mount', 'soft mounts',
            'fpv', 'fpv motor', 'drone motor', 'quadcopter motor',
            'vibration dampener', 'vibration isolator', 'rubber mount',
            'standoff', 'fc stack', 'flight controller stack',
          ],
          noneOf: ['car motor', 'boat motor', 'automotive'],
        },
        whitelist: { allowChapters: ['39', '84', '85'] },
        inject: [
          { prefix: '3926.90', syntheticRank: 9 }, // Other articles of plastic
          { prefix: '8487.90', syntheticRank: 8 }, // Other parts for machinery
          { prefix: '8548.90', syntheticRank: 7 }, // Other electrical parts of machines
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3926.90' },
          { delta: 0.4, chapterMatch: '39' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch OOOO)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch OOOO complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
