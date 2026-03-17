#!/usr/bin/env ts-node
/**
 * Patch TT51 — 2026-03-15: Wooden furniture + plastic furniture (ch.94) routing.
 * Current: ~34.21% (after TT48-TT50)
 *
 * New Rules:
 *  1. WOODEN_FURNITURE_HOUSEHOLD_INTENT → 9403.30/9403.40/9403.50/9403.60 (wooden furniture)
 *     "wooden phone holder" → 9403.30; "wooden spice rack" → 9403.60; ~8 miss entries
 *     "wooden bench for home" → 9403.50; "clothing rack wood" → 9403.60
 *     BUG: "wooden phone holder" → 3926.90 (plastic badge holder); "wooden spice rack" → food
 *     Fix: whitelist allowChapters: ['94'] when wooden furniture intent fires
 *  2. PLASTIC_FURNITURE_DISPLAY_INTENT → 9403.70 (plastic furniture, display items)
 *     "3D printed home decor plastic" → 9403.70; "plastic stand" → 9403.70; ~8 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt51.ts
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

    // 1. WOODEN_FURNITURE_HOUSEHOLD_INTENT → 9403.30 + 9403.40 + 9403.50 + 9403.60 (wooden furniture)
    //    "wooden phone holder" → 9403.30 (currently 3926.90 plastic badge holder — WRONG)
    //    "wooden bench indoor" → 9403.50 (currently 4421.91 bamboo article — WRONG)
    //    "wooden spice rack kitchen" → 9403.60 (currently 0910 spice — WRONG)
    //    "wood clothing rack household" → 9403.60 (currently tissue paper — WRONG)
    //    "monitor stand wooden" → 9403.30 (currently 7326 steel article — WRONG)
    //    9403.30 = wooden furniture for bedroom/bathroom/office
    //    9403.40 = wooden kitchen furniture
    //    9403.50 = wooden bedroom/dining furniture
    //    9403.60 = wooden furniture: other (includes clothing racks, floating shelves)
    //    Fix: whitelist allowChapters: ['94'] forces results to furniture chapter only
    {
      const existing = allRules.find(r => r.id === 'WOODEN_FURNITURE_HOUSEHOLD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_FURNITURE_HOUSEHOLD_INTENT',
          description: 'Wooden household furniture: shelves, benches, racks, stands → ch.94 (9403.30/40/50/60)',
          pattern: {
            anyOf: [
              // Phone/tablet/device holders (wooden desk accessories = 9403.30)
              'wooden phone holder', 'wood phone holder', 'phone stand wood',
              'tablet stand wood', 'wooden tablet stand', 'wooden monitor stand',
              'monitor stand wood', 'wooden monitor riser', 'wood monitor riser',
              'wooden laptop stand', 'wood desk organizer',
              // Shelves (wooden = 9403.40/60)
              'wooden shelf', 'wood shelf', 'wooden shelves', 'wood shelves',
              'wooden wall shelf', 'wood floating shelf', 'floating wood shelf',
              'wooden display shelf', 'wooden spice rack', 'wood spice rack',
              'wooden kitchen shelf', 'wooden kitchen rack', 'wood kitchen shelf',
              // Benches and tables (wooden = 9403.50)
              'wooden bench', 'wood bench', 'indoor wooden bench',
              'wooden side table', 'wood side table', 'wooden end table',
              'wooden step stool', 'wooden footstool', 'wooden stool',
              'wooden doll cradle', 'wood cradle', 'wooden toy cradle',
              // Clothing racks (wooden = 9403.60)
              'wood clothing rack', 'wooden clothing rack', 'wooden garment rack',
              'wood garment rack', 'wooden coat rack', 'wood coat rack',
              'wooden hanging rack', 'wood drying rack',
              // Magazine/book racks (9403.60)
              'wooden magazine rack', 'wood magazine rack', 'wooden book rack',
              'wooden display stand wood', 'wooden display rack',
              // Trophy/display shelves
              'wooden trophy shelf', 'wood trophy display', 'wooden award display',
            ],
            noneOf: [
              'plastic', 'metal', 'steel', 'iron', 'aluminum',
            ],
          },
          inject: [
            { prefix: '9403.30', syntheticRank: 5 },
            { prefix: '9403.40', syntheticRank: 5 },
            { prefix: '9403.50', syntheticRank: 5 },
            { prefix: '9403.60', syntheticRank: 5 },
          ],
          whitelist: {
            allowChapters: ['94'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '9403.' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOODEN_FURNITURE_HOUSEHOLD_INTENT: created (wooden furniture → 9403.30-9403.60)');
      }
    }

    // 2. PLASTIC_FURNITURE_DISPLAY_INTENT → 9403.70 (plastic furniture)
    //    "3D printed home decor plastic" → 9403.70 (plastic furniture/display stand)
    //    "plastic stand with metal" → 9403.70 (plastic display stand)
    //    "Desk Clamp-On Cup/Mug/Bottle Holder (3D Printed)" → 9403.70
    //    "plastic paint holder" → 9403.70 ✓ (already working)
    //    9403.70 = furniture of plastics
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_FURNITURE_DISPLAY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_FURNITURE_DISPLAY_INTENT',
          description: 'Plastic furniture, display stands, plastic organizer stands → ch.94 (9403.70)',
          pattern: {
            anyOf: [
              // 3D printed furniture/display items
              '3d printed bookshelf', '3d printed display', '3d printed stand',
              '3d printed furniture', '3d printed shelf item', '3d printed home decor',
              '3d printed organizer',
              // Plastic display stands
              'plastic display stand', 'plastic stand display', 'acrylic display stand',
              'plastic easel', 'acrylic easel', 'plastic book stand',
              // Desk plastic accessories
              'desk clamp plastic', 'clamp on cup holder', 'clamp on bottle holder',
              'desk clamp cup', 'monitor arm plastic', 'clip on cup holder',
              // Automotive plastic interior furniture
              'automotive dash plastic', 'dash plastic molding', 'dash plastic trim',
              'automotive console lid', 'center console lid', 'console lid plastic',
              'automotive kick panel', 'kick panel trim', 'door panel trim plastic',
              'dash trim panel', 'dash trim set',
              // Plastic paint holder
              'plastic paint holder', 'paint holder plastic',
            ],
            noneOf: [
              'wood', 'wooden', 'metal', 'steel', 'iron',
            ],
          },
          inject: [
            { prefix: '9403.70', syntheticRank: 5 },
          ],
          whitelist: {
            allowChapters: ['94'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '9403.7' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('PLASTIC_FURNITURE_DISPLAY_INTENT: created (plastic furniture → 9403.70)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT51)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT51 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
