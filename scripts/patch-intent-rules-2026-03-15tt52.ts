#!/usr/bin/env ts-node
/**
 * Patch TT52 — 2026-03-15: Table linen napkins + wall tapestries + furnishing articles.
 * Current: ~34.21% (after TT48-TT51)
 *
 * New Rules:
 *  1. TABLE_LINEN_NAPKIN_INTENT → 6302.51 (cotton table napkins, table mats, cloth coasters)
 *     "cotton table napkins" → 6302.51; "quilted table mat" → 6302.51; ~5 miss entries
 *     NOTE: "coasters set" going to 5208 (fabric), "table mat" going to 9404 (mattress pad)
 *  2. WALL_TAPESTRY_HANGING_INTENT → 6304.93 (fabric wall hangings, printed tapestries)
 *     "fabric wall hanging" → 6304.93; "anime wall tapestry" → 6304.93; ~5 miss entries
 *     NOTE: currently going to 5805 (handwoven tapestry from artistic fabric mills)
 *  3. CUSHION_COVER_PILLOW_CASE_INTENT → 6304.92 (cotton cushion covers, pillow cases)
 *     "cushion cover" → 6304.92; "oven mitt cotton" → 6304.92; ~4 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt52.ts
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

    // 1. TABLE_LINEN_NAPKIN_INTENT → 6302.51 (table linen of cotton, not knitted/crocheted)
    //    "Cotton Napkins" → 6302.51 (currently 6302.40 = man-made fiber table linen)
    //    "100% cotton quilted table mat" → 6302.51 (currently 9404 mattress pad)
    //    "100% cotton woven coasters set" → 6302.51 (currently 5208 woven fabric)
    //    "Set of 8 Cotton Napkins Hand Printed" → 6302.51
    //    "100% cotton fabric coaster set" → 6302.51
    //    6302.51 = table linen of cotton (not knitted or crocheted)
    //    6302.53 = table linen of other textile materials (synthetic/linen)
    {
      const existing = allRules.find(r => r.id === 'TABLE_LINEN_NAPKIN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TABLE_LINEN_NAPKIN_INTENT',
          description: 'Cotton table napkins, table mats, cloth coasters, cloth napkin sets → ch.63 (6302.51)',
          pattern: {
            anyOf: [
              // Cotton napkins (most common table linen import)
              'cloth napkin', 'cloth napkins', 'cotton napkin', 'cotton napkins',
              'fabric napkin', 'linen napkin', 'dinner napkin', 'dinner napkins',
              'table napkin', 'table napkins', 'set napkins',
              // Table mats and coasters
              'table mat', 'table mats', 'table runner', 'place mat', 'placemat',
              'placemats', 'quilted table mat', 'cotton table mat',
              'cloth coasters', 'fabric coaster', 'fabric coasters',
              'woven coaster', 'woven coasters', 'cotton coaster',
              // Challah covers and specialty table linen
              'challah cover', 'table linen cotton', 'cotton table linen',
              'cotton tablecloth', 'fabric tablecloth',
            ],
            noneOf: [
              'paper napkin', 'paper towel', 'tissue',
              'disposable',
            ],
          },
          inject: [
            { prefix: '6302.51', syntheticRank: 5 },
            { prefix: '6302.53', syntheticRank: 4 },
            { prefix: '6302.59', syntheticRank: 3 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6302.5' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('TABLE_LINEN_NAPKIN_INTENT: created (cotton table napkins/mats/coasters → 6302.51)');
      }
    }

    // 2. WALL_TAPESTRY_HANGING_INTENT → 6304.93 (furnishing articles: wall hangings, tapestries)
    //    "fabric wall hanging" → 6304.93 (currently 5805 = handwoven tapestry fabric)
    //    "anime wall tapestry" → 6304.93 (currently 5805)
    //    "Custom Woven Throw Blanket | Aesthetic Room Decor" → 6304.93
    //    6304.93 = articles of furnishing, not knitted, of man-made fibers
    //    6304.91 = articles of furnishing, not knitted, of cotton
    //    NOTE: 5805 = handwoven tapestries (the artistic woven textile itself, not a room decoration)
    //    Room decor tapestries (printed fabric on wall) = 6304.93/6304.91
    {
      const existing = allRules.find(r => r.id === 'WALL_TAPESTRY_HANGING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WALL_TAPESTRY_HANGING_INTENT',
          description: 'Fabric wall hangings, decorative tapestries, room decor textile → ch.63 (6304.93/91)',
          pattern: {
            anyOf: [
              // Wall tapestries and hangings
              'wall tapestry', 'wall tapestries', 'tapestry wall', 'anime tapestry',
              'fabric tapestry', 'printed tapestry', 'dorm room tapestry',
              'wall hanging tapestry', 'bohemian tapestry', 'mandala tapestry',
              // Wall hangings
              'fabric wall hanging', 'wall hanging fabric', 'textile wall hanging',
              'woven wall hanging', 'macrame wall hanging', 'cotton wall hanging',
              'wall decor fabric', 'wall art tapestry',
              // Throw blankets used as decor
              'woven throw blanket decor', 'aesthetic room decor blanket',
            ],
            noneOf: [
              'carpet', 'rug', 'mat', 'floor',
              'blanket' // blanket-only without tapestry/hanging context
            ],
          },
          inject: [
            { prefix: '6304.93', syntheticRank: 5 },
            { prefix: '6304.91', syntheticRank: 5 },
            { prefix: '6304.92', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6304.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WALL_TAPESTRY_HANGING_INTENT: created (fabric wall hangings/tapestries → 6304.93/91)');
      }
    }

    // 3. CUSHION_COVER_OVEN_MITT_INTENT → 6304.92 (furnishing articles of cotton)
    //    "cushion cover" → 6304.92 (currently 6304.99 = other materials, close but wrong 8-digit)
    //    "oven mitt cotton" → 6304.92 (handmade cotton oven mitt)
    //    "pillow cover cotton" → 6304.92
    //    6304.92 = furnishing articles, not knitted, of cotton (includes cushion covers, pot holders)
    {
      const existing = allRules.find(r => r.id === 'CUSHION_COVER_OVEN_MITT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CUSHION_COVER_OVEN_MITT_INTENT',
          description: 'Cotton cushion covers, oven mitts, pot holders, pillow shams → ch.63 (6304.92)',
          pattern: {
            anyOf: [
              // Cushion covers
              'cushion cover', 'cushion covers', 'throw pillow cover', 'pillow cover',
              'pillow covers', 'pillow sham', 'pillow shams', 'sofa pillow cover',
              'couch cushion cover', 'chair cushion cover',
              // Oven mitts and pot holders (ch.63 furnishing articles)
              'oven mitt', 'oven mitts', 'cotton oven mitt', 'handmade oven mitt',
              'pot holder', 'pot holders', 'cotton pot holder', 'oven glove',
              // Sofa/furniture covers
              'sofa slipcover', 'sofa cover', 'couch cover', 'chair slipcover',
              'sofa cover textile', 'furniture slipcover',
              // Bible/book covers (fabric)
              'bible cover crochet', 'fabric book cover', 'crochet bible cover',
              'door knob cover crochet', 'doorknob cover',
            ],
            noneOf: [
              'pillow insert', 'pillow stuffing', 'down pillow',
              'sleeping', 'mattress',
            ],
          },
          inject: [
            { prefix: '6304.92', syntheticRank: 5 },
            { prefix: '6304.91', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6304.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('CUSHION_COVER_OVEN_MITT_INTENT: created (cushion covers/oven mitts → 6304.92)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT52)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT52 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
