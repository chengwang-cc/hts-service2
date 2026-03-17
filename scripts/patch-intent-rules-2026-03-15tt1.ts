#!/usr/bin/env ts-node
/**
 * Patch TT1 — 2026-03-15: High-impact ch.85 cluster fixes.
 * Current: 29.61% (1488/5025)
 *
 * Key clusters found in ch.85 failures:
 *  - Fridge magnets: 15+ entries → 8505.11/8505.19
 *  - Replacement batteries: 10+ entries → 8506/8507
 *  - Dog grooming clippers: 3+ entries → 8510.20
 *  - Needle minders with magnet: 5+ entries → 8505.11/8505.19
 *
 * Fixes:
 *  1. New FRIDGE_MAGNET_DECORATIVE_INTENT: fridge/decorative magnets → 8505.11 (metal) / 8505.19 (other)
 *  2. New REPLACEMENT_BATTERY_LITHIUM_INTENT: cellphone/tablet/lithium replacement battery → 8507.60
 *  3. New BUTTON_CELL_WATCH_BATTERY_INTENT: button cell / coin battery / watch battery → 8506.50
 *  4. New DOG_GROOMING_CLIPPER_INTENT: dog grooming clippers/trimmers → 8510.20
 *  5. New ELECTRIC_SHAVER_HAIR_CLIPPER_INTENT: electric shavers/razors → 8510.10/8510.20
 *  6. New TOY_CAR_BATTERY_CHARGER_INTENT: kids car battery / toy car battery → 8507.20
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt1.ts
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

    // 1. FRIDGE_MAGNET_DECORATIVE_INTENT — decorative/fridge magnets → 8505.11 (metal) / 8505.19 (other)
    //    Covers: fridge magnets, needle minders with magnet, 3D printed magnets
    {
      const existing = allRules.find(r => r.id === 'FRIDGE_MAGNET_DECORATIVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FRIDGE_MAGNET_DECORATIVE_INTENT',
          description: 'Fridge/decorative magnets → ch.85 (8505.11 metal, 8505.19 other permanent magnets)',
          pattern: {
            anyOf: [
              'fridge magnet', 'fridge magnets', 'refrigerator magnet', 'magnetic decoration',
              'needle minder', 'needle minder magnet', 'magnet fridge',
              'decorative magnet', '3d printed magnet', 'pla magnet',
              'souvenir magnet', 'souvenir fridge magnet', 'tourist magnet',
              'magnetic bookmark', 'magnetic pin', 'resin magnet', 'epoxy magnet',
            ],
            noneOf: ['magnetic tool', 'magnetic sheet', 'magnetic strip', 'magnetic tape',
                     'magnetic base', 'magnetic base mount', 'whiteboard magnet strip'],
          },
          inject: [
            { prefix: '8505.11', syntheticRank: 5 },
            { prefix: '8505.19', syntheticRank: 6 },
          ],
          whitelist: { allowChapters: ['85', '83', '39', '44', '70', '71'] },
          boosts: [
            { delta: 0.60, prefixMatch: '8505.1' },
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('FRIDGE_MAGNET_DECORATIVE_INTENT: created (fridge magnet → 8505.11/8505.19)');
      }
    }

    // 2. REPLACEMENT_BATTERY_LITHIUM_INTENT — cellphone/tablet lithium replacement battery → 8507.60
    {
      const existing = allRules.find(r => r.id === 'REPLACEMENT_BATTERY_LITHIUM_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'REPLACEMENT_BATTERY_LITHIUM_INTENT',
          description: 'Lithium replacement batteries (phone/tablet/laptop/RC) → ch.85 (8507.60)',
          pattern: {
            anyOf: [
              'replacement battery', 'cellphone replacement battery', 'phone replacement battery',
              'tablet replacement battery', 'laptop replacement battery',
              'lipo battery', 'lipo battery pack', 'lithium battery pack',
              'lithium polymer battery', 'li-po battery', 'li-ion replacement',
              'lithium ion replacement', 'rc lipo', 'drone lipo battery',
            ],
            noneOf: ['button cell', 'coin battery', 'aa battery', 'aaa battery',
                     'alkaline battery', 'disposable battery', 'battery charger'],
          },
          inject: [{ prefix: '8507.60', syntheticRank: 6 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.55, prefixMatch: '8507.60' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('REPLACEMENT_BATTERY_LITHIUM_INTENT: created (replacement lithium battery → 8507.60)');
      }
    }

    // 3. BUTTON_CELL_WATCH_BATTERY_INTENT — button cell/coin battery → 8506.50
    {
      const existing = allRules.find(r => r.id === 'BUTTON_CELL_WATCH_BATTERY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BUTTON_CELL_WATCH_BATTERY_INTENT',
          description: 'Button cell/coin/watch batteries → ch.85 (8506.50)',
          pattern: {
            anyOf: [
              'button cell', 'button cell battery', 'coin battery', 'coin cell',
              'watch battery', 'hearing aid battery', 'calculator battery',
              'cr2032', 'cr2016', 'cr2025', 'ag13', 'ag3', 'lr44 battery',
              'cr123', 'cr2 battery',
            ],
          },
          inject: [{ prefix: '8506.50', syntheticRank: 5 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.60, prefixMatch: '8506.50' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('BUTTON_CELL_WATCH_BATTERY_INTENT: created (button cell → 8506.50)');
      }
    }

    // 4. DOG_GROOMING_CLIPPER_INTENT — dog grooming clippers/trimmers → 8510.20
    {
      const existing = allRules.find(r => r.id === 'DOG_GROOMING_CLIPPER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DOG_GROOMING_CLIPPER_INTENT',
          description: 'Dog/pet grooming clippers → ch.85 (8510.20)',
          pattern: {
            anyOf: [
              'dog grooming', 'pet grooming clipper', 'dog clipper', 'dog trimmer',
              'dog hair clipper', 'dog shearing', 'grooming clipper dog',
              'dog grooming comb', 'grooming attachment dog', 'pet hair clipper',
            ],
          },
          inject: [{ prefix: '8510.20', syntheticRank: 6 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.55, prefixMatch: '8510.20' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('DOG_GROOMING_CLIPPER_INTENT: created (dog grooming → 8510.20)');
      }
    }

    // 5. ELECTRIC_SHAVER_RAZOR_INTENT — electric shaver/foil shaver → 8510.10
    {
      const existing = allRules.find(r => r.id === 'ELECTRIC_SHAVER_RAZOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ELECTRIC_SHAVER_RAZOR_INTENT',
          description: 'Electric shavers/razors → ch.85 (8510.10)',
          pattern: {
            anyOf: [
              'electric shaver', 'electric razor', 'foil shaver', 'rotary shaver',
              'electric foil razor', 'cordless shaver', 'men electric razor',
              'electric face shaver', 'electric beard shaver',
            ],
            noneOf: ['dog', 'pet', 'animal', 'horse', 'sheep'],
          },
          inject: [{ prefix: '8510.10', syntheticRank: 6 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.60, prefixMatch: '8510.10' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('ELECTRIC_SHAVER_RAZOR_INTENT: created (electric shaver → 8510.10)');
      }
    }

    // 6. TOY_RIDE_ON_CAR_BATTERY_INTENT — kids toy car battery → 8507.20 (lead-acid)
    {
      const existing = allRules.find(r => r.id === 'TOY_RIDE_ON_CAR_BATTERY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TOY_RIDE_ON_CAR_BATTERY_INTENT',
          description: 'Toy car/ride-on vehicle battery → ch.85 (8507.20)',
          pattern: {
            anyOf: [
              'kids car battery', 'kids car replacement battery', 'ride on car battery',
              'toy car battery', 'power wheels battery', 'peg perego battery',
              'kids ride on battery', 'electric kids car battery', 'toy vehicle battery',
              'replacement charger toy car', 'kids car charger',
            ],
          },
          inject: [{ prefix: '8507.20', syntheticRank: 6 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.55, prefixMatch: '8507.20' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('TOY_RIDE_ON_CAR_BATTERY_INTENT: created (kids car battery → 8507.20)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT1)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT1 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
