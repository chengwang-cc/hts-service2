#!/usr/bin/env ts-node
/**
 * Patch TT117 — 2026-03-16: Fix auto parts, bath mitt, HEPA filter intents.
 *
 * Fix 1: UPDATE LICENSE_PLATE_FRAME_PLASTIC_INTENT — inject 8708.99.81, add ch.87
 *   "Free replacement plate cover - warranty" → 6912.00 (ceramic plates!) WRONG (expected 8708.99.81.80)
 *   "lceinse plate frame" → 6912.00 WRONG (expected 8708.99.81.80)
 *   Root cause: LICENSE_PLATE_FRAME_PLASTIC_INTENT exists but:
 *   (a) Doesn't match "plate cover" without "license"/"number" prefix.
 *   (b) allowChapters excludes ch.87 (vehicle parts) — 8708.99 gets blocked!
 *   (c) Injects 3920 (raw plastic sheets), not 8708.99.81 (vehicle body parts).
 *   Fix: add "plate cover" to anyOf, inject 8708.99.81 rank 1, add ch.87 to allowChapters.
 *
 * Fix 2: NEW AUTOMOTIVE_SUN_VISOR_TRIM_INTENT → 8708.99.53.00
 *   "Automotive Sun Visor Vinyl" → 7009.91 (glass mirrors!) WRONG (expected 8708.99.53.00)
 *   "Automotive Sunvisor" → 7009.91 WRONG (expected 8708.99.55.00)
 *   Root cause: "visor" in automotive context triggers glass/mirror codes (7009).
 *   8708.99.53.00 = interior trim parts for motor vehicles (sun visor).
 *   Fix: new intent for "automotive sun visor" → inject 8708.99 + deny glass (ch.70, 7009).
 *
 * Fix 3: NEW ALLOY_CAR_PEDAL_FOOT_REST_INTENT → 8708.99.68.10
 *   "Alloy Foot Rest" → 6402.91 (footwear!) WRONG (expected 8708.99.68.10)
 *   "Alloy Accelerator Pedal" → 8708.99.03 (within ch.87, wrong sub-code)
 *   Root cause: "foot rest" triggers footwear; no intent for alloy auto pedals.
 *   8708.99.68.10 = other parts/accessories for motor vehicles.
 *   Fix: new intent for "alloy pedal/foot rest" context → 8708.99.68 + deny footwear.
 *
 * Fix 4: NEW BATH_MITT_LINEN_INTENT → 6302.93.20.00
 *   "bath mitt" → 6207.99.90 (men's underwear!) WRONG (expected 6302.93.20.00)
 *   "Seshin Korean Scrub Mitt" → 6116.10 (knit gloves) WRONG (expected 6302.93.20.00)
 *   Root cause: "mitt" triggers glove/mitten intent; "bath" isn't strong enough.
 *   6302.93.20.00 = toilet linen/bath linen of man-made fibers.
 *   Fix: new intent for "bath mitt", "scrub mitt" → 6302.93.
 *
 * Fix 5: NEW HEPA_TEXTILE_FILTER_INTENT → 6307.90.98.50
 *   "Replacement HEPA filter" → 8421.31 (filter equipment) WRONG (expected 6307.90.98.50)
 *   "Replacement Filter kit" → 8421.32 WRONG (expected 6307.90.98.50)
 *   Root cause: "HEPA filter" triggers industrial filter equipment (8421) codes.
 *   6307.90.98.50 = made-up textile articles (HEPA/textile air filters classified here in US HTS).
 *   Fix: new intent injecting 6307.90.98.50 at rank 1, deny ch.84 machinery.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt117.ts
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

    // 1. UPDATE LICENSE_PLATE_FRAME_PLASTIC_INTENT — add ch.87, inject 8708.99.81 rank 1
    //    "Free replacement plate cover" and "lceinse plate frame" get 6912 (ceramic plates).
    //    The intent existed but had allowChapters excluding ch.87 and injected 3920 (raw plastic),
    //    not the finished vehicle body part code 8708.99.81 (license plate frames/brackets).
    {
      const existing = allRules.find(r => r.id === 'LICENSE_PLATE_FRAME_PLASTIC_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentAllowChapters = (existing as any).whitelist?.allowChapters || [];
        const addAnyOf = [
          // Patterns without "license" prefix
          'plate cover', 'replacement plate cover', 'plate frame replacement',
          'auto plate frame', 'car plate cover', 'vehicle plate cover',
          'front plate frame', 'rear plate frame',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
          inject: [
            { prefix: '8708.99.81', syntheticRank: 1 },  // vehicle body parts (license plate frame)
            { prefix: '3920.63', syntheticRank: 5 },     // polycarbonate sheets (plastic frames)
            { prefix: '3920.10', syntheticRank: 8 },     // polyethylene plates/sheets
          ],
          whitelist: {
            ...(existing as any).whitelist,
            allowChapters: [...new Set([...currentAllowChapters, '87'])],  // add vehicle parts chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8708.99.81' },  // very strong boost for vehicle body parts
            { delta: 0.60, prefixMatch: '8708.' },        // moderate boost for vehicle parts
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 580, rule: updated });
        console.log('LICENSE_PLATE_FRAME_PLASTIC_INTENT: added 8708.99.81 inject, ch.87 allowChapters, more anyOf');
      } else {
        console.log('LICENSE_PLATE_FRAME_PLASTIC_INTENT: not found');
      }
    }

    // 2. NEW AUTOMOTIVE_SUN_VISOR_TRIM_INTENT → 8708.99.53.00 / 8708.99.55.00
    //    "Automotive Sun Visor Vinyl" → 7009.91 (glass mirrors) WRONG
    //    "visor" triggers glass/mirror codes; "automotive" context lost.
    //    8708.99.53.00 = motor vehicle interior trim (including sun visors).
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_SUN_VISOR_TRIM_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_SUN_VISOR_TRIM_INTENT',
          description: 'Automotive sun visors, interior trim → 8708.99.53 (vehicle trim parts)',
          pattern: {
            anyOf: [
              'automotive sun visor', 'car sun visor', 'automotive sunvisor',
              'sun visor vinyl', 'sun visor replacement', 'sun visor driver',
              'vehicle sun visor', 'auto sun visor',
              'car dash trim', 'dashboard trim panel', 'car dash panel',
              'interior trim panel', 'car interior trim',
              'car air vent panel', 'car vent panel',
            ],
            noneOf: [
              // Sun visor hats/headgear (ch.65)
              'sun visor hat', 'beach visor', 'golf visor', 'sport visor',
              'visor hat', 'visor cap',
            ],
          },
          inject: [
            { prefix: '8708.99', syntheticRank: 1 },    // vehicle parts/accessories
            { prefix: '8708.99.53', syntheticRank: 2 },  // interior trim
            { prefix: '8708.99.55', syntheticRank: 3 },  // other interior trim parts
          ],
          whitelist: {
            allowChapters: ['87'],    // only vehicle parts chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8708.99' },  // very strong boost for vehicle parts
            { delta: 0.60, prefixMatch: '8708.' },     // moderate boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7009.' },  // strong penalty for glass mirrors
            { delta: 0.90, prefixMatch: '7006.' },  // glass products
          ],
        } as IntentRule;
        patches.push({ priority: 581, rule: newRule });
        console.log('AUTOMOTIVE_SUN_VISOR_TRIM_INTENT: created (automotive sun visor → 8708.99, deny glass)');
      } else {
        console.log('AUTOMOTIVE_SUN_VISOR_TRIM_INTENT: already exists, skipping');
      }
    }

    // 3. NEW ALLOY_CAR_PEDAL_FOOT_REST_INTENT → 8708.99.68.10
    //    "Alloy Foot Rest" → 6402 (footwear) WRONG
    //    "Alloy Accelerator Pedal" → 8708.99.03 (wrong sub-code within ch.87)
    //    "Foot rest" + "alloy" should be vehicle parts (pedal/rest for driver's feet).
    {
      const existing = allRules.find(r => r.id === 'ALLOY_CAR_PEDAL_FOOT_REST_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ALLOY_CAR_PEDAL_FOOT_REST_INTENT',
          description: 'Alloy car pedals, foot rests → 8708.99.68.10 (vehicle parts/accessories)',
          pattern: {
            anyOf: [
              'alloy foot rest', 'alloy footrest', 'car foot rest',
              'car footrest', 'alloy pedal', 'alloy accelerator pedal',
              'alloy brake pedal', 'alloy clutch pedal',
              'pedal cover alloy', 'racing pedal alloy',
              'car pedal cover', 'alloy pedal cover',
              'aluminum foot rest car', 'alloy car accessories',
            ],
            noneOf: [
              // Boat/bicycle pedals
              'bicycle pedal', 'bike pedal', 'boat pedal', 'kayak pedal',
              // Musical instrument pedals
              'piano pedal', 'guitar pedal', 'drum pedal', 'sustain pedal',
            ],
          },
          inject: [
            { prefix: '8708.99.68', syntheticRank: 1 },  // vehicle parts/accessories (pedals)
            { prefix: '8708.99', syntheticRank: 4 },     // other vehicle accessories
          ],
          whitelist: {
            allowChapters: ['87'],    // only vehicle parts chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8708.99.68' },  // very strong boost
            { delta: 0.60, prefixMatch: '8708.' },        // moderate boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6402.' },  // strong penalty for footwear
            { delta: 0.90, prefixMatch: '6404.' },  // strong penalty for shoes
          ],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('ALLOY_CAR_PEDAL_FOOT_REST_INTENT: created (alloy foot rest/pedal → 8708.99.68, deny footwear)');
      } else {
        console.log('ALLOY_CAR_PEDAL_FOOT_REST_INTENT: already exists, skipping');
      }
    }

    // 4. NEW BATH_MITT_LINEN_INTENT → 6302.93.20.00
    //    "bath mitt" → 6207.99 (men's underwear!) WRONG
    //    "Seshin Korean Scrub Mitt" → 6116.10 (knit gloves) WRONG
    //    6302.93.20.00 = toilet/bath linen of man-made fibers.
    //    A bath mitt is a bathing accessory classified as linen/toilet article, not glove/knitwear.
    {
      const existing = allRules.find(r => r.id === 'BATH_MITT_LINEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BATH_MITT_LINEN_INTENT',
          description: 'Bath/scrub mitts → 6302.93.20.00 (toilet/bath linen of synthetic fibers)',
          pattern: {
            anyOf: [
              'bath mitt', 'bath mitts',
              'scrub mitt', 'scrub mitts',
              'exfoliating mitt', 'bathing mitt',
              'shower mitt', 'washcloth mitt',
              'korean scrub mitt', 'italy towel',
              'bath glove', 'bathing glove',
              'exfoliating glove', 'exfoliating cloth',
            ],
            noneOf: [
              // Oven mitts → different (4304 or 6307)
              'oven mitt', 'kitchen mitt', 'pot holder mitt', 'grill mitt',
              // Sports/work gloves → ch.62
              'baseball mitt', 'softball mitt', 'hockey mitt', 'work mitt',
            ],
          },
          inject: [
            { prefix: '6302.93', syntheticRank: 1 },    // toilet/bath linen of synthetic fibers
            { prefix: '6302.60', syntheticRank: 4 },    // toilet/bath linen (general)
          ],
          whitelist: {
            allowChapters: ['63'],    // only made-up textile articles chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '6302.93' },  // very strong boost for bath linen
            { delta: 0.60, prefixMatch: '6302.' },     // moderate boost for linen
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6116.' },  // penalty for knit gloves
            { delta: 0.90, prefixMatch: '6207.' },  // penalty for underwear
            { delta: 0.90, prefixMatch: '6104.' },  // penalty for knitwear
          ],
        } as IntentRule;
        patches.push({ priority: 569, rule: newRule });
        console.log('BATH_MITT_LINEN_INTENT: created (bath/scrub mitt → 6302.93, allowChapters:[63])');
      } else {
        console.log('BATH_MITT_LINEN_INTENT: already exists, skipping');
      }
    }

    // 5. NEW HEPA_TEXTILE_FILTER_INTENT → 6307.90.98.50
    //    "Replacement HEPA filter" → 8421.31 (centrifuges/filter equipment) WRONG
    //    "Replacement Filter kit" → 8421.32 WRONG
    //    6307.90.98.50 = other made-up textile articles — US HTS classifies textile HEPA/air
    //    filters (nonwoven textile media) here, not as industrial filter equipment (8421).
    {
      const existing = allRules.find(r => r.id === 'HEPA_TEXTILE_FILTER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HEPA_TEXTILE_FILTER_INTENT',
          description: 'HEPA/air filters (textile media) → 6307.90.98.50 (made-up textile articles)',
          pattern: {
            anyOf: [
              'hepa filter', 'hepa filters',
              'replacement hepa filter', 'hepa replacement filter',
              'hepa air filter', 'hepa filter replacement',
              'hepa filter kit', 'hepa filter set',
              'replacement filter kit', 'air purifier filter',
              'vacuum hepa filter', 'hepa vacuum filter',
              'nonwoven filter', 'non-woven filter',
            ],
            noneOf: [
              // Industrial/commercial filter systems
              'water filter', 'oil filter', 'fuel filter', 'pool filter',
              'aquarium filter', 'coffee filter',
            ],
          },
          inject: [
            { prefix: '6307.90.98', syntheticRank: 1 },  // made-up textile articles (HEPA filters)
            { prefix: '6307.90', syntheticRank: 4 },     // other made-up articles
          ],
          whitelist: {
            allowChapters: ['63'],    // only made-up textile articles chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '6307.90.98' },  // very strong boost
            { delta: 0.60, prefixMatch: '6307.' },        // moderate boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8421.' },  // strong penalty for filter/centrifuge machinery
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('HEPA_TEXTILE_FILTER_INTENT: created (HEPA filter → 6307.90.98.50, deny 8421)');
      } else {
        console.log('HEPA_TEXTILE_FILTER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT117)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT117 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
