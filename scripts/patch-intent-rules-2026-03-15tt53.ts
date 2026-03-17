#!/usr/bin/env ts-node
/**
 * Patch TT53 — 2026-03-15: Rubber desk mats + plastic garbage bags + tea cozy fix.
 * Current: ~34.21% (TT51-TT52 pending cache)
 *
 * New Rules:
 *  1. RUBBER_GAMING_DESKMAT_INTENT → 4016.10 (rubber floor coverings, desk mats)
 *     "gaming desk mat" → 4016.10; "Cloud Deskmats rubber" → 4016.10; ~3 miss entries
 *     BUG: "desk mat" → 3919.90 (self-adhesive plastics) and 4016.91 (wrong rubber sub-code)
 *     Fix: whitelist denyChapters: ['39'] + inject 4016.10 + denyPrefixes: ['4016.9']
 *  2. PLASTIC_GARBAGE_BAG_INTENT → 3923.29 (plastic bags, garbage bags, cone bags)
 *     "plastic garbage bags" → 3923.29; "kitchen garbage bag" → 3923.29; ~3 miss entries
 *     BUG: "plastic bags" → 4202.92 (handbags); "garbage bag" → wrong code
 *  3. TEA_COZY_TEXTILE_INTENT → 6307.90 (handmade textile tea cozies)
 *     "Tea Cozy" → 6307.90; "wool tea cozy" → 6307.90 (currently → 1211 medicinal plants!)
 *     BUG: "tea" in "tea cozy" triggers food/herbal (tea plant) HTS codes
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt53.ts
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

    // 1. RUBBER_GAMING_DESKMAT_INTENT → 4016.10 (vulcanised rubber floor coverings/mats)
    //    "B-Grade Cloud Deskmats - Sunrise" → 4016.10 (rubber gaming desk mat)
    //    "Birch Forest Desk Mat" → 4016.10 (extended gaming mouse pad with rubber base)
    //    "desk mat gaming rubber" → currently 3919.90 (self-adhesive plastic sheets)
    //    "Cloud Desk Mat rubber backing" → 4016.91 (wrong rubber sub-code)
    //    4016.10 = floor coverings and mats of vulcanised rubber (includes desk mats)
    //    NOTE: gaming desk mats have a rubber base + fabric top; classified as rubber article
    {
      const existing = allRules.find(r => r.id === 'RUBBER_GAMING_DESKMAT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RUBBER_GAMING_DESKMAT_INTENT',
          description: 'Gaming desk mats, rubber mouse pads, extended desk mats → ch.40 (4016.10)',
          pattern: {
            anyOf: [
              // Desk mats (gaming / office)
              'desk mat', 'deskmats', 'desk mats', 'deskmat',
              'gaming desk mat', 'gaming deskmat', 'gaming mouse pad',
              'extended mouse pad', 'extended mousepad', 'large mouse pad',
              'xl mouse pad', 'keyboard mat', 'keyboard desk mat',
              // Rubber backing explicitly mentioned
              'rubber desk mat', 'rubber mat desk', 'desk mat rubber',
              'cloud deskmat', 'birch desk mat',
              // Large rubber floor/desk mats
              'mousepad xl', 'gaming mat large',
            ],
            noneOf: [
              'yoga mat', 'exercise mat', 'bath mat', 'door mat', 'doormat',
              'car mat', 'floor mat car', 'gym mat',
            ],
          },
          inject: [
            { prefix: '4016.10', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['39'],
            denyPrefixes: ['4016.9'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '4016.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('RUBBER_GAMING_DESKMAT_INTENT: created (desk mats → 4016.10)');
      }
    }

    // 2. PLASTIC_GARBAGE_BAG_INTENT → 3923.29 (sacks and bags of plastics - not polyethylene)
    //    "Box of plastic bags, not for food storage, kitchen garbage bag" → 3923.29
    //    "Cone Plastic Bag" → 3923.29 (currently → 3923.21 polyethylene bags = close but wrong)
    //    BUG: "plastic bags" → 4202.92 (handbags chapter) - wrong
    //    3923.29 = sacks and bags of plastics, other than polyethylene
    //    3923.21 = sacks and bags of polyethylene
    //    NOTE: must distinguish from 4202 bags (luggage/handbag chapter)
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_GARBAGE_BAG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_GARBAGE_BAG_INTENT',
          description: 'Plastic garbage bags, trash bags, cone bags → ch.39 (3923.21 + 3923.29)',
          pattern: {
            anyOf: [
              // Garbage/trash bags
              'garbage bag', 'garbage bags', 'trash bag', 'trash bags',
              'kitchen garbage bag', 'kitchen trash bag', 'bin bag', 'bin bags',
              'refuse bag', 'waste bag', 'plastic garbage bag',
              // Plastic packaging bags
              'plastic bag packing', 'plastic packaging bag', 'plastic poly bag',
              'polybag', 'polybags', 'plastic produce bag', 'plastic shopping bag',
              // Cone bags and specialty plastic bags
              'cone bag', 'cone bags', 'plastic cone bag', 'funnel bag',
              // Cello bags (cellophane/plastic bags for packaging)
              'cello bag', 'cello bags', 'cellophane bag', 'cellophane bags',
              'clear plastic bag', 'clear poly bag',
            ],
            noneOf: [
              // Exclude fabric/cloth bags
              'fabric bag', 'canvas bag', 'cotton bag', 'tote bag', 'leather bag',
              // Exclude food storage specific
              'zip lock', 'ziplock', 'freezer bag', 'food storage bag',
            ],
          },
          inject: [
            { prefix: '3923.29', syntheticRank: 5 },
            { prefix: '3923.21', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['42'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '3923.2' }],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('PLASTIC_GARBAGE_BAG_INTENT: created (garbage/trash/cone bags → 3923.29)');
      }
    }

    // 3. TEA_COZY_TEXTILE_INTENT → 6307.90 (made-up textile articles)
    //    "Tea Cozy" → currently 1211.90 (medicinal plants!) — "tea" triggers plant/herbal HTS
    //    "Wool Tea Cozy" → 1211.90 (WRONG - should be textile article)
    //    "Tea cozy knit" → should be 6303.10 or 6307.90
    //    6307.90 = other made-up articles of textile materials (catch-all for textile crafts)
    //    NOTE: "tea" word triggers food/herbal category; must override for tea cozy product
    {
      const existing = allRules.find(r => r.id === 'TEA_COZY_TEXTILE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEA_COZY_TEXTILE_INTENT',
          description: 'Tea cozies (knitted/fabric teapot covers) → ch.63 (6307.90)',
          pattern: {
            anyOf: [
              'tea cozy', 'tea cozies', 'tea cosy', 'tea cosies',
              'wool tea cozy', 'knit tea cozy', 'crochet tea cozy',
              'teapot cozy', 'teapot cosy', 'mug cozy', 'mug cosy',
              'cup cozy knit', 'cup cosy', 'coffee cup cozy',
              'mason jar cozy', 'jar cozy knit',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['09', '12', '21'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '6307.9' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('TEA_COZY_TEXTILE_INTENT: created (tea cozies → 6307.90, deny food chapters)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT53)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT53 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
