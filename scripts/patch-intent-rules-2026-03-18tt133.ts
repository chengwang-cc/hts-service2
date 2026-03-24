#!/usr/bin/env ts-node
/**
 * Patch TT133 — 2026-03-18: Automotive and bicycle parts
 *
 * Fix 1: NEW MOTORCYCLE_SEAT_PARTS_INTENT → 8714.10
 *   "HONDA CB500 CB550K REPLACEMENT SEAT FOAM NO COVER" → 8714.10.00.10 WRONG (expected saddles/seats)
 *   Getting ch87 car parts (8708) instead of ch87 motorcycle parts (8714.10)
 *   Root cause: Motorcycle-specific seat/saddle parts need separate routing to 8714.10
 *
 * Fix 2: NEW BICYCLE_BRAKE_DISC_ROTOR_INTENT → 8714.94
 *   "Bicycle Rim Brake Set" → 8714.94.90.00 WRONG (getting 8714.99 other accessories)
 *   "Bicycle rotor" → 8714.94.90.00 WRONG (getting 8712.00 bicycles)
 *   Root cause: Bicycle braking components getting classified as whole bicycles or generic accessories
 *
 * Fix 3: NEW AUTOMOTIVE_BUMPER_BODY_PANEL_INTENT → 8708.10/8708.99
 *   "vintage vw bumper guard" → 8708.10.30.20 WRONG (getting 8807 aircraft parts!)
 *   "Car Dash Plastic Trim Panel" → 8708.99.53.00 WRONG (getting 8708.29)
 *   "Car Air Vent Panel Plastic" → 8708.99.55.00 WRONG (getting 8414 fans)
 *   Root cause: Automotive interior/exterior body panels getting routed to aircraft (8807) or fan codes
 *
 * Fix 4: NEW AUTOMOTIVE_WHEEL_SUSPENSION_INTENT → 8708.70/8708.80
 *   "vintage vw hub cap" → 8708.70.60.45 WRONG (getting 8708.29)
 *   "Suspension system stabilizer bar Link" → 8708.80.16.00 WRONG (getting close but wrong 8-digit)
 *   Root cause: Wheel and suspension parts not routed to correct 8708 subcategories
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-18tt133.ts
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

    // 1. NEW MOTORCYCLE_SEAT_PARTS_INTENT → 8714.10
    //    Honda CB-series and other motorcycle seat foam/saddle replacements
    //    Getting classified as car parts (8708.29) instead of motorcycle parts (8714.10)
    {
      const existing = allRules.find(r => r.id === 'MOTORCYCLE_SEAT_PARTS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MOTORCYCLE_SEAT_PARTS_INTENT',
          description: 'Motorcycle saddle/seat foam and moped parts → 8714.10 (motorcycle parts)',
          pattern: {
            anyOf: [
              // Seat foam replacements
              'motorcycle seat foam', 'replacement seat foam', 'seat foam no cover',
              'seat foam replacement', 'moto seat foam', 'motorcycle saddle replacement',
              // Honda CB series specific patterns
              'honda cb350 seat', 'honda cb450 seat', 'honda cb500 seat', 'honda cb550 seat',
              'honda cb750 seat', 'honda cl350 seat', 'honda sl350 seat',
              'cb350 scrambler seat', 'cb450 scrambler seat',
              // General motorcycle seat
              'motorcycle seat cover foam', 'motorcycle saddle foam', 'motorcycle seat pan',
            ],
            noneOf: [
              // Car seats
              'car seat', 'auto seat', 'vehicle seat', 'truck seat', 'van seat',
              // Child seats
              'child seat', 'baby seat', 'infant seat', 'booster seat',
              // Automotive seats (ch94)
              'office chair seat', 'wheelchair seat',
            ],
          },
          inject: [
            { prefix: '8714.10', syntheticRank: 1 },  // motorcycle saddles/seats
            { prefix: '8714.', syntheticRank: 6 },    // other motorcycle parts
          ],
          whitelist: {
            allowChapters: ['87'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8714.10' },
            { delta: 0.50, prefixMatch: '8714.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '8708.' },  // penalize car parts
            { delta: 0.90, prefixMatch: '9401.' },  // penalize furniture seats
          ],
        } as IntentRule;
        patches.push({ priority: 615, rule: newRule });
        console.log('MOTORCYCLE_SEAT_PARTS_INTENT: created (→8714.10)');
      } else {
        console.log('MOTORCYCLE_SEAT_PARTS_INTENT: already exists, skipping');
      }
    }

    // 2. NEW BICYCLE_BRAKE_DISC_ROTOR_INTENT → 8714.94
    //    Bicycle brake sets, rotors, and disc brake components
    //    Getting classified as whole bicycles (8712) or generic accessories (8714.99)
    {
      const existing = allRules.find(r => r.id === 'BICYCLE_BRAKE_DISC_ROTOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BICYCLE_BRAKE_DISC_ROTOR_INTENT',
          description: 'Bicycle brakes/rotors/disc brake parts → 8714.94',
          pattern: {
            anyOf: [
              // Brake sets
              'bicycle rim brake', 'bike rim brake', 'bicycle disc brake', 'bike disc brake',
              'bicycle brake set', 'bike brake set', 'bicycle brake caliper', 'bike brake caliper',
              'bicycle brake lever', 'bike brake lever', 'bicycle cantilever brake',
              'bicycle v-brake', 'bicycle vbrake', 'bicycle brake pad', 'bicycle brake pads',
              // Rotors
              'bicycle rotor', 'bike rotor', 'bicycle disc rotor', 'bike disc rotor',
              'bicycle brake rotor', 'bike brake rotor', 'bicycle disc',
              // Coaster brakes
              'bicycle coaster brake', 'coaster brake', 'bicycle hub brake',
            ],
            noneOf: [
              // Whole bikes
              'bicycle complete', 'complete bike', 'full bicycle',
              // Non-bicycle vehicles
              'motorcycle brake', 'car brake', 'auto brake', 'truck brake',
            ],
          },
          inject: [
            { prefix: '8714.94', syntheticRank: 1 },  // bicycle brakes and parts
            { prefix: '8714.99', syntheticRank: 6 },  // other bicycle accessories
          ],
          whitelist: {
            allowChapters: ['87'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8714.94' },
            { delta: 0.50, prefixMatch: '8714.' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '8712.' },  // penalize whole bicycles
            { delta: 0.60, prefixMatch: '8714.99' },  // softer penalty for near-match
          ],
        } as IntentRule;
        patches.push({ priority: 616, rule: newRule });
        console.log('BICYCLE_BRAKE_DISC_ROTOR_INTENT: created (→8714.94)');
      } else {
        console.log('BICYCLE_BRAKE_DISC_ROTOR_INTENT: already exists, skipping');
      }
    }

    // 3. NEW AUTOMOTIVE_BUMPER_BODY_PANEL_INTENT → 8708.10/8708.99
    //    Car bumpers, interior trim panels, dash panels, air vent panels
    //    "vintage vw bumper guard" getting 8807 (aircraft) due to semantic confusion
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_BUMPER_BODY_PANEL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_BUMPER_BODY_PANEL_INTENT',
          description: 'Car bumpers and interior/exterior body panels → 8708.10/8708.99',
          pattern: {
            anyOf: [
              // Bumpers
              'car bumper', 'auto bumper', 'vehicle bumper', 'bumper guard',
              'front bumper', 'rear bumper', 'bumper cover', 'bumper trim',
              'vw bumper', 'vintage bumper', 'auto bumper guard',
              // Interior trim
              'car dash plastic trim', 'automotive dash trim', 'car interior trim',
              'auto trim panel', 'car trim panel', 'interior trim panel',
              'automotive interior panel', 'dash trim panel', 'car dash trim',
              // Air vents and visors
              'car air vent panel', 'auto air vent', 'automotive vent panel',
              'automotive sun visor', 'car sun visor', 'auto sun visor',
              'car vent panel', 'car vent trim', 'automotive vent',
              // Grilles
              'car grille', 'auto grille', 'front grille', 'grill insert',
            ],
            noneOf: [
              // Aircraft (key fix: prevent 8807 misclassification)
              'aircraft', 'airplane', 'helicopter', 'drone', 'propeller',
              // HVAC/appliance vents (not automotive)
              'wall vent', 'ceiling vent', 'hvac vent', 'dryer vent', 'bathroom vent',
              // Motorcycle
              'motorcycle trim', 'bike trim',
            ],
          },
          inject: [
            { prefix: '8708.99', syntheticRank: 1 },  // other parts of motor vehicles
            { prefix: '8708.10', syntheticRank: 3 },  // bumpers and parts
            { prefix: '8708.29', syntheticRank: 7 },  // other body parts
          ],
          whitelist: {
            allowChapters: ['87'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8708.99' },
            { delta: 0.80, prefixMatch: '8708.10' },
            { delta: 0.50, prefixMatch: '8708.' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '8807.' },  // strong penalty for aircraft parts
            { delta: 0.80, prefixMatch: '8414.' },  // penalize HVAC fans
            { delta: 0.80, prefixMatch: '9508.' },  // penalize amusement rides
          ],
        } as IntentRule;
        patches.push({ priority: 617, rule: newRule });
        console.log('AUTOMOTIVE_BUMPER_BODY_PANEL_INTENT: created (→8708.99/8708.10)');
      } else {
        console.log('AUTOMOTIVE_BUMPER_BODY_PANEL_INTENT: already exists, skipping');
      }
    }

    // 4. NEW AUTOMOTIVE_WHEEL_HUB_CAP_INTENT → 8708.70
    //    Hub caps, wheel center caps, wheel trim rings
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_WHEEL_HUB_CAP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_WHEEL_HUB_CAP_INTENT',
          description: 'Automotive hub caps, wheel center caps → 8708.70',
          pattern: {
            anyOf: [
              'hub cap', 'hubcap', 'hub caps', 'hubcaps', 'wheel hub cap',
              'wheel center cap', 'wheel centre cap', 'center cap wheel',
              'wheel trim ring', 'wheel trim', 'rim hub cover', 'wheel cover',
              'vintage hub cap', 'vw hub cap', 'classic hub cap',
            ],
            noneOf: [
              // Non-automotive wheels
              'bicycle hub', 'bike hub', 'motorcycle hub cap', 'wagon wheel cap',
            ],
          },
          inject: [
            { prefix: '8708.70', syntheticRank: 1 },  // road wheels and parts
          ],
          whitelist: {
            allowChapters: ['87'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8708.70' },
            { delta: 0.50, prefixMatch: '8708.' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '3926.' },  // penalize plastic articles
            { delta: 0.80, prefixMatch: '6506.' },  // penalize headwear (caps)
          ],
        } as IntentRule;
        patches.push({ priority: 618, rule: newRule });
        console.log('AUTOMOTIVE_WHEEL_HUB_CAP_INTENT: created (→8708.70)');
      } else {
        console.log('AUTOMOTIVE_WHEEL_HUB_CAP_INTENT: already exists, skipping');
      }
    }

    // 5. NEW AUTOMOTIVE_SUSPENSION_SHOCK_INTENT → 8708.80
    //    Suspension parts, shock absorbers, stabilizer bars
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_SUSPENSION_SHOCK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_SUSPENSION_SHOCK_INTENT',
          description: 'Automotive suspension parts, shocks, stabilizer bars → 8708.80',
          pattern: {
            anyOf: [
              // Shock absorbers
              'car shock', 'auto shock', 'shock absorber', 'shock absorbers',
              'koni shock', 'adjustable shock', 'rear shock', 'front shock',
              'strut assembly', 'coilover', 'coilovers',
              // Stabilizer/sway bars
              'stabilizer bar', 'sway bar', 'sway bar link', 'stabilizer link',
              'end link', 'anti roll bar', 'anti-roll bar', 'h brace bar',
              // Springs
              'car spring', 'auto spring', 'coil spring automotive',
              'spring suspension', 'leaf spring auto',
            ],
            noneOf: [
              // Non-automotive
              'bicycle shock', 'bike shock', 'motorcycle shock absorber',
              'furniture spring', 'mattress spring',
            ],
          },
          inject: [
            { prefix: '8708.80', syntheticRank: 1 },  // suspension including shock absorbers
          ],
          whitelist: {
            allowChapters: ['87'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8708.80' },
            { delta: 0.50, prefixMatch: '8708.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '8431.' },  // penalize construction equipment parts
            { delta: 0.70, prefixMatch: '3204.' },  // penalize paint colors
          ],
        } as IntentRule;
        patches.push({ priority: 619, rule: newRule });
        console.log('AUTOMOTIVE_SUSPENSION_SHOCK_INTENT: created (→8708.80)');
      } else {
        console.log('AUTOMOTIVE_SUSPENSION_SHOCK_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT133)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT133 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
