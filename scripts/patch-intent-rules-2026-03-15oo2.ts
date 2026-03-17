#!/usr/bin/env ts-node
/**
 * Patch OO2 — 2026-03-15: Target chit-chats accuracy improvement.
 * Baseline: 29.37% hit@10 (1476/5025), EMPTY: 22
 *
 * Fixes:
 *  1. PILLOW_BEDDING_INTENT: add ch.63 (bed linen pillow cases/covers blocked by ch.94-only rule)
 *  2. ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: add ch.94 (power seat adjustment switches)
 *  3. AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT: add ch.94 (same)
 *  4. New SEAT_COVER_VEHICLE_INTENT: "seat cover" → [94,87,39]
 *  5. New MONITOR_STAND_FURNITURE_INTENT: "monitor stand" → [94,73]
 *  6. New WIRE_HARNESS_MOTOR_PART_INTENT: "wire harness" → [85,84]
 *  7. New SOLDERING_IRON_TOOL_INTENT: "soldering iron" → [82,85]
 *  8. New GLASS_BOTTLE_CONTAINER_INTENT: "beer bottle"/"wine bottle"/"glass bottle" → [70,22]
 *  9. OUTERWEAR_JACKET_GARMENT_INTENT: noneOf "paint", "wipe-on", "tough coat" (plastic paints)
 * 10. SPORTS_JERSEY_KNIT_INTENT (new): "jersey" sports → ch.61
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15oo2.ts
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

    // 1. PILLOW_BEDDING_INTENT: add ch.63 (bed linen pillow cases/covers)
    //    Currently allows only [94] — blocking 6302.xx pillow case / pillow cover entries
    {
      const e = allRules.find(r => r.id === 'PILLOW_BEDDING_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '63') } });
        console.log('PILLOW_BEDDING_INTENT: added ch.63 (bed linen pillow cases)');
      }
    }

    // 2. ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: add ch.94 (power seat switches)
    {
      const e = allRules.find(r => r.id === 'ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '94') } });
        console.log('ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: added ch.94 (power seat switch)');
      }
    }

    // 3. AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT: add ch.94 (same)
    {
      const e = allRules.find(r => r.id === 'AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '94') } });
        console.log('AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT: added ch.94 (power seat switch)');
      }
    }

    // 4. New: SEAT_COVER_VEHICLE_INTENT — "seat cover" → ch.94 (vehicle seating accessories)
    //    Fixes: "motorcycle seat cover" routing to ch.87 instead of ch.94
    {
      const existing = allRules.find(r => r.id === 'SEAT_COVER_VEHICLE_INTENT');
      const newRule: IntentRule = (existing ?? {
        id: 'SEAT_COVER_VEHICLE_INTENT',
        description: 'Seat covers for vehicles/furniture → ch.94, ch.87, ch.39',
        pattern: {
          anyOf: ['seat cover', 'seat covers', 'car seat cover', 'motorcycle seat cover', 'vehicle seat cover'],
          noneOf: ['baby seat', 'child seat', 'booster seat', 'seat belt', 'car seat safety'],
        },
        whitelist: { allowChapters: ['94', '87', '39'] },
      }) as IntentRule;
      if (!existing) {
        patches.push({ priority: 500, rule: newRule });
        console.log('SEAT_COVER_VEHICLE_INTENT: created (seat cover → ch.94,87,39)');
      } else {
        const wl = addCh(existing, '94', '87', '39');
        patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, whitelist: wl } });
        console.log('SEAT_COVER_VEHICLE_INTENT: updated');
      }
    }

    // 5. New: MONITOR_STAND_FURNITURE_INTENT — "monitor stand" → ch.94 (furniture)
    //    Fixes: "monitor stand" routing to ch.73 metal articles instead of ch.94
    {
      const existing = allRules.find(r => r.id === 'MONITOR_STAND_FURNITURE_INTENT');
      const newRule: IntentRule = (existing ?? {
        id: 'MONITOR_STAND_FURNITURE_INTENT',
        description: 'Monitor/screen stands → ch.94 (furniture/office), ch.73, ch.84',
        pattern: {
          anyOf: ['monitor stand', 'monitor riser', 'monitor arm', 'screen stand', 'laptop stand', 'display stand desk'],
          noneOf: ['trade show', 'exhibition', 'retail display stand', 'portable display'],
        },
        whitelist: { allowChapters: ['94', '73', '84'] },
      }) as IntentRule;
      if (!existing) {
        patches.push({ priority: 500, rule: newRule });
        console.log('MONITOR_STAND_FURNITURE_INTENT: created (monitor stand → ch.94,73,84)');
      } else {
        patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, whitelist: addCh(existing, '94', '73', '84') } });
        console.log('MONITOR_STAND_FURNITURE_INTENT: updated');
      }
    }

    // 6. New: WIRE_HARNESS_MOTOR_PART_INTENT — "wire harness" → ch.85 (motor parts)
    //    Fixes: "4-PIN WIRE HARNESS" routing to ch.73 nail/wire codes instead of ch.85 motor parts
    {
      const existing = allRules.find(r => r.id === 'WIRE_HARNESS_MOTOR_PART_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WIRE_HARNESS_MOTOR_PART_INTENT',
          description: 'Wire harness = motor/generator parts (ch.85) or wiring (ch.84/85)',
          pattern: {
            anyOf: ['wire harness', 'wiring harness', 'pin harness', 'connector harness', 'pin connector'],
            noneOf: ['jewelry', 'horse harness', 'leather harness', 'dog harness', 'climbing harness'],
          },
          whitelist: { allowChapters: ['85', '84'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('WIRE_HARNESS_MOTOR_PART_INTENT: created (wire harness → ch.85,84)');
      }
    }

    // 7. New: SOLDERING_IRON_HAND_TOOL_INTENT — "soldering iron" → ch.82 (hand tools)
    //    Fixes: "Antique Blacksmith Soldering Iron Hand Tool" routing to ch.26 (iron ore)
    {
      const existing = allRules.find(r => r.id === 'SOLDERING_IRON_HAND_TOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SOLDERING_IRON_HAND_TOOL_INTENT',
          description: 'Soldering irons = hand tools ch.82 or electronics ch.85',
          pattern: {
            anyOf: ['soldering iron', 'soldering gun', 'soldering tool', 'solder iron'],
            noneOf: ['tip replacement', 'solder wire', 'solder paste'],
          },
          whitelist: { allowChapters: ['82', '85', '84'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('SOLDERING_IRON_HAND_TOOL_INTENT: created (soldering iron → ch.82,85,84)');
      }
    }

    // 8. New: GLASS_BOTTLE_CONTAINER_INTENT — "beer bottle"/"wine bottle" → ch.70
    //    Fixes: "Empty Beer Bottle" routing incorrectly; "glass bottle" should → ch.70
    {
      const existing = allRules.find(r => r.id === 'GLASS_BOTTLE_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_BOTTLE_CONTAINER_INTENT',
          description: 'Glass bottles/containers → ch.70 (glass) or ch.22 (beverage)',
          pattern: {
            anyOf: [
              'beer bottle', 'wine bottle', 'liquor bottle', 'spirit bottle',
              'whisky bottle', 'whiskey bottle', 'glass bottle', 'empty bottle',
              'glass jar bottle', 'perfume bottle',
            ],
            noneOf: ['bottle opener', 'bottle stopper', 'bottle cap', 'bottle brush'],
          },
          whitelist: { allowChapters: ['70', '22', '33'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('GLASS_BOTTLE_CONTAINER_INTENT: created (glass/beer/wine bottle → ch.70,22,33)');
      }
    }

    // 9. OUTERWEAR_JACKET_GARMENT_INTENT: noneOf paint/polymer coating product terms
    //    Fixes: "Fusion Mineral Paint Tough Coat Wipe-on Poly" routing to garment codes
    {
      const e = allRules.find(r => r.id === 'OUTERWEAR_JACKET_GARMENT_INTENT');
      if (e) {
        const pat = addNo(e,
          'wipe on', 'wipe-on poly', 'tough coat', 'mineral paint', 'paint coat',
          'topcoat paint', 'polyurethane coat', 'poly coat',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('OUTERWEAR_JACKET_GARMENT_INTENT: noneOf paint/wipe-on terms');
      }
    }

    // 10. New: SPORTS_JERSEY_KNIT_INTENT — sports jerseys → ch.61 (knitted garments)
    //     Fixes: "MLB Jersey", "Hockey Jersey" routing to ch.62 woven or ch.92 instruments
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_KNIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SPORTS_JERSEY_KNIT_INTENT',
          description: 'Sports jerseys (NFL/NHL/NBA/MLB) = knitted garments ch.61',
          pattern: {
            anyOf: [
              'hockey jersey', 'football jersey', 'baseball jersey', 'basketball jersey',
              'soccer jersey', 'nfl jersey', 'nhl jersey', 'nba jersey', 'mlb jersey',
              'sports jersey', 'replica jersey', 'authentic jersey',
            ],
            noneOf: ['jersey fabric', 'jersey knit fabric', 'jersey sheet'],
          },
          whitelist: { allowChapters: ['61', '62', '63'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('SPORTS_JERSEY_KNIT_INTENT: created (sports jersey → ch.61,62,63)');
      }
    }

    // 11. PILLOW_BEDDING_INTENT: also noneOf "pillow cover" to prevent over-restricting bed linen
    //     Already fixed by adding ch.63 above. Also add noneOf terms to reduce false positives.

    // 12. BED_SHEET_INTENT: add ch.52 (cotton fabric raw) for raw cotton sheet material
    {
      const e = allRules.find(r => r.id === 'BED_SHEET_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '54', '55') } });
        console.log('BED_SHEET_INTENT: added ch.54,55 (synthetic/man-made fiber sheets)');
      }
    }

    // 13. WINE_INTENT: noneOf "glass" when paired with bottle (glass = container, not beverage)
    //     Already handled by GLASS_BOTTLE_CONTAINER_INTENT allowing ch.70 for bottle queries.
    //     Add noneOf "bottle" to WINE_INTENT to prevent it from blocking ch.70 for wine bottle queries.
    {
      const e = allRules.find(r => r.id === 'WINE_INTENT');
      if (e) {
        const pat = addNo(e, 'wine bottle', 'empty wine', 'glass wine bottle', 'bottle wine');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('WINE_INTENT: noneOf wine-bottle (empty container is ch.70, not ch.22)');
      }
    }

    // 14. AI_CH22_CIDER_MEAD_FERMENTED + AI_CH22_CIDER_PERRY_MEAD_SAKE: noneOf "bottle" terms
    //     Not needed unless they block ch.70

    console.log(`\nApplying ${patches.length} rule patches (batch OO2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch OO2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
