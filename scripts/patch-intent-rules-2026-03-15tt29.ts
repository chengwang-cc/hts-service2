#!/usr/bin/env ts-node
/**
 * Patch TT29 — 2026-03-15: Synthetic skirts + coated gloves + slippers + O-rings + herbal oils.
 * Current: ~32.38% (after TT27; TT28 pending eval)
 *
 * Targets:
 *  1. SYNTHETIC_KNIT_SKIRT_INTENT → 6204.53 (bamboo/viscose tube skirts, jersey knit skirts)
 *     "Girls knit Bamboo Jersey Skirt Kids Midi Tube Skirt" → 6204.53; 12 entries
 *  2. COATED_RUBBER_WORK_GLOVE_INTENT → 6116.10 (coated/rubber work gloves, insulated gloves)
 *     "Fleece Lined Split Leather Work Gloves" → 6116.10; "Ragg Wool Flip-top Insulated gloves" → 6116.10; 11 entries
 *  3. LEATHER_SOLE_SLIPPER_INTENT → 6405.20 (house slippers, moccasins, leather-sole footwear)
 *     "CosySoles Microwave Heated Slippers" → 6405.20; "pair of shoes" → 6405.20; 11 entries
 *  4. RUBBER_ORING_GASKET_SEAL_INTENT → 4016.93 (O-rings, rubber seals, rubber gaskets)
 *     "Automotive Rubber Oring Kit" → 4016.93; 10 entries
 *  5. HERBAL_ESSENTIAL_OIL_INTENT → 3301.29 (herbal oils, ayurvedic oils, plant extract oils)
 *     "Ayurvedic Herbal Hair Oil - For External Use Only" → 3301.29; 13 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt29.ts
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

    // 1. SYNTHETIC_KNIT_SKIRT_INTENT → 6204.53 (bamboo/viscose tube skirts, jersey knit skirts)
    //    "Girls knit Bamboo Jersey Skirt Kids Midi Tube Skirt" → 6204.53.xx
    //    "Woman's knit Bamboo Jersey Skirt Ladies Midi Tube Skirt" → 6204.53.xx
    //    6204.53 = women's/girls' skirts of synthetic fibers (woven or knit)
    //    Bamboo fabric is classified as synthetic (rayon/viscose)
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_KNIT_SKIRT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SYNTHETIC_KNIT_SKIRT_INTENT',
          description: 'Bamboo/viscose/synthetic knit tube skirts, jersey skirts → ch.62 (6204.53)',
          pattern: {
            anyOf: [
              'bamboo skirt', 'bamboo jersey skirt', 'bamboo midi skirt',
              'tube skirt', 'midi tube skirt', 'mini tube skirt',
              'jersey skirt', 'jersey midi skirt', 'jersey tube skirt', 'jersey knit skirt',
              'knit tube skirt', 'knit midi skirt', 'stretchy tube skirt',
              'viscose skirt', 'rayon skirt', 'bamboo rayon skirt', 'bamboo viscose skirt',
              'synthetic skirt', 'polyester skirt', 'spandex blend skirt',
              'bodycon skirt', 'bandage skirt', 'pencil skirt',
            ],
            noneOf: ['cotton skirt', 'denim skirt', 'linen skirt', 'wool skirt', 'leather skirt'],
          },
          inject: [{ prefix: '6204.53', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6204.5' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SYNTHETIC_KNIT_SKIRT_INTENT: created (bamboo/viscose tube skirts → 6204.53)');
      }
    }

    // 2. COATED_RUBBER_WORK_GLOVE_INTENT → 6116.10 (coated/insulated work gloves, safety gloves)
    //    "Forcefield Ragg Wool Flip-top Thinsulate Insulated gloves" → 6116.10.xx
    //    "Fleece Lined Split Leather Work Gloves" → 6116.10.xx
    //    6116.10 = gloves, mittens and mitts, impregnated/coated/covered with plastics or rubber
    //    NOTE: noneOf for sport/hockey to avoid conflict with SPORT_GLOVE_PROTECTIVE_KNIT_INTENT
    {
      const existing = allRules.find(r => r.id === 'COATED_RUBBER_WORK_GLOVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COATED_RUBBER_WORK_GLOVE_INTENT',
          description: 'Coated/rubber work gloves, insulated gloves, winter work gloves → ch.61 (6116.10)',
          pattern: {
            anyOf: [
              'work gloves', 'work glove', 'coated gloves', 'coated work gloves',
              'rubber coated gloves', 'rubber work gloves', 'grip gloves', 'anti-slip gloves',
              'insulated gloves', 'insulated work gloves', 'thinsulate gloves',
              'winter work gloves', 'fleece lined gloves', 'fleece lined work gloves',
              'cut resistant gloves', 'mechanics gloves', 'mechanic gloves',
              'gardening gloves rubber', 'rubber garden gloves', 'nitrile gloves',
              'safety gloves', 'protective work gloves', 'heavy duty gloves',
            ],
            noneOf: ['hockey gloves', 'cycling gloves', 'ski gloves', 'driving gloves',
                     'dress gloves', 'formal gloves', 'evening gloves', 'baseball gloves'],
          },
          inject: [{ prefix: '6116.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6116.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COATED_RUBBER_WORK_GLOVE_INTENT: created (coated work gloves → 6116.10)');
      }
    }

    // 3. LEATHER_SOLE_SLIPPER_INTENT → 6405.20 (slippers, house shoes with leather/composition sole)
    //    "CosySoles Microwave Heated Slippers - Large / Grey" → 6405.20.xx
    //    "pair of shoes" → 6405.20 (leather soled shoes with textile upper)
    //    6405.20 = other footwear with outer soles of leather or composition leather
    {
      const existing = allRules.find(r => r.id === 'LEATHER_SOLE_SLIPPER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LEATHER_SOLE_SLIPPER_INTENT',
          description: 'House slippers, moccasins, heated slippers, leather-sole footwear → ch.64 (6405.20)',
          pattern: {
            anyOf: [
              'house slippers', 'house slipper', 'indoor slippers', 'bedroom slippers',
              'moccasin slippers', 'moccasin slipper', 'slip on slippers',
              'heated slippers', 'microwave slippers', 'heated moccasin',
              'slipper moccasin', 'fleece slippers', 'sherpa slippers',
              'leather sole slippers', 'leather soled slippers', 'leather soled shoes',
              'ballet flats', 'ballet flat shoes', 'loafer shoes',
              'espadrille shoes', 'espadrilles',
            ],
            noneOf: ['rubber sole', 'synthetic sole', 'sneaker', 'athletic shoe', 'boot', 'sandal'],
          },
          inject: [{ prefix: '6405.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6405.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('LEATHER_SOLE_SLIPPER_INTENT: created (slippers/leather sole footwear → 6405.20)');
      }
    }

    // 4. RUBBER_ORING_GASKET_SEAL_INTENT → 4016.93 (O-rings, rubber seals, rubber gaskets)
    //    "Automotive Rubber Oring Kit" → 4016.93.xx
    //    "motorcycle electrical parts" → 4016.93 (maybe O-ring seals for bike)
    //    4016.93 = gaskets, washers and other seals of vulcanized rubber
    {
      const existing = allRules.find(r => r.id === 'RUBBER_ORING_GASKET_SEAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RUBBER_ORING_GASKET_SEAL_INTENT',
          description: 'Rubber O-rings, gaskets, seals, rubber washers → ch.40 (4016.93)',
          pattern: {
            anyOf: [
              'o-ring', 'o-rings', 'oring', 'orings', 'o ring', 'o rings',
              'rubber o-ring', 'rubber o ring', 'rubber oring', 'silicone o-ring',
              'rubber gasket', 'rubber gaskets', 'rubber seal', 'rubber seals',
              'rubber washer', 'rubber washers', 'rubber plug', 'rubber stopper',
              'automotive o-ring', 'automotive oring', 'oring kit', 'o-ring kit',
              'plumbing o-ring', 'plumbing gasket', 'rubber ring seal',
            ],
            noneOf: ['metal gasket', 'cork gasket', 'paper gasket', 'copper gasket'],
          },
          inject: [{ prefix: '4016.93', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4016.9' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('RUBBER_ORING_GASKET_SEAL_INTENT: created (O-rings/rubber gaskets → 4016.93)');
      }
    }

    // 5. HERBAL_ESSENTIAL_OIL_INTENT → 3301.29 (herbal oils, ayurvedic oils, plant extracts)
    //    "Ayurvedic Herbal Hair Oil - For External Use Only" → 3301.29.xx
    //    "Ayurvedic Herbal Oil - For External Use Only" → 3301.29.xx
    //    3301.29 = other essential oils (plant extracts, herbal infusions, herbal oils)
    //    "For External Use Only" typically indicates essential oil classification
    {
      const existing = allRules.find(r => r.id === 'HERBAL_ESSENTIAL_OIL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HERBAL_ESSENTIAL_OIL_INTENT',
          description: 'Herbal oils, ayurvedic oils, plant extract oils → ch.33 (3301.29)',
          pattern: {
            anyOf: [
              'ayurvedic hair oil', 'herbal hair oil', 'ayurvedic herbal oil',
              'herbal oil external use', 'plant extract oil', 'botanical extract oil',
              'ayurvedic oil', 'herbal infused oil', 'herbal extract oil',
              'essential oil blend', 'essential oil pure', 'pure essential oil',
              'lemon grass oil', 'bergamot oil', 'ylang ylang oil', 'vetiver oil',
              'lavender essential oil', 'eucalyptus oil', 'tea tree oil',
              'carrier oil', 'rosehip oil', 'argan oil pure', 'jojoba oil pure',
            ],
            noneOf: ['hair serum', 'hair conditioner', 'shampoo', 'body lotion', 'cream', 'perfume spray'],
          },
          inject: [{ prefix: '3301.29', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '3301.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('HERBAL_ESSENTIAL_OIL_INTENT: created (herbal/ayurvedic oils → 3301.29)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT29)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT29 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
