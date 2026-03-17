#!/usr/bin/env ts-node
/**
 * Patch TT49 — 2026-03-15: Dish cloths + woven patches + textile keychains.
 * Current: ~34.13% (TT48 pending cache)
 *
 * Fixes:
 *  - "dish cloth" → 6911.10 (ceramic) BUG — "dish" triggers ceramic dishware
 *    → Need explicit DISHCLOTH_TEXTILE_INTENT to route "dish cloth" to ch.63 textile
 *
 * New Rules:
 *  1. DISHCLOTH_FLOORCLOTH_INTENT → 6307.10 (dish cloths, floor cloths, dusters)
 *     "Swedish dish cloth" → 6307.10; "cotton dish cloth" → 6307.10; ~5 miss entries
 *     Note: "dish cloth" currently routes to 6911.10 (ceramic) due to "dish" word
 *  2. WOVEN_BADGE_PATCH_INTENT → 5807.10 (textile badges, patches, emblems)
 *     "cloth patch iron on" → 5807.10; "embroidered patch sew on" → 5807.10; ~4 miss entries
 *     Note: "cloth patch iron on" currently → 2601 (iron ore!) due to "iron" word
 *  3. HANDMADE_TEXTILE_ARTICLE_INTENT → 6307.90 (handmade textile articles)
 *     "Handmade Crochet Textile Keychain" → 6307.90; "handmade crochet bookmark" → 6307.90
 *     Note: textile keychains going to 7326.20 (metal keychain) is wrong
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt49.ts
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

    // 1. DISHCLOTH_FLOORCLOTH_INTENT → 6307.10 (floor cloths, dish cloths, dusters)
    //    "Swedish dish cloth" → 6307.10.00.20 (currently goes to 6911.10 ceramic!)
    //    "Cotton Dish Cloth" → 6307.10 (currently goes to 6911.10)
    //    "crochet dish cloth" → 6307.10
    //    "2 KD Cloth Bundle" → 6307.10
    //    BUG: "dish" in "dish cloth" triggers ceramic dishware (6911.10)
    //    6307.10 = floor cloths, dish cloths, dusters and similar cleaning cloths
    {
      const existing = allRules.find(r => r.id === 'DISHCLOTH_FLOORCLOTH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DISHCLOTH_FLOORCLOTH_INTENT',
          description: 'Dish cloths, floor cloths, dusters, cleaning cloths → ch.63 (6307.10)',
          pattern: {
            anyOf: [
              // Dish cloths (common search terms)
              'dish cloth', 'dishcloth', 'dish cloths', 'dishcloths',
              'dish rag', 'dish rags', 'dishrag',
              'swedish dish cloth', 'swedish dishcloth',
              'cotton dish cloth', 'crochet dish cloth',
              // Floor cloths and general cleaning cloths
              'floor cloth', 'floor cloths', 'cleaning cloth', 'cleaning cloths',
              'duster cloth', 'dust cloth', 'dust cloths',
              // Cellulose/synthetic cleaning cloths
              'cellulose cloth', 'sponge cloth', 'reusable cleaning cloth',
              'microfiber cloth', 'polishing cloth',
              // Dusters
              'feather duster', 'lambswool duster',
            ],
            noneOf: [
              'ceramic', 'porcelain', 'pottery',
              'bag', 'tote', 'apron',
            ],
          },
          inject: [
            { prefix: '6307.10', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6307.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('DISHCLOTH_FLOORCLOTH_INTENT: created (dish cloths/floor cloths → 6307.10)');
      }
    }

    // 2. WOVEN_BADGE_PATCH_INTENT → 5807.10 (woven/embroidered badges, patches, emblems)
    //    "cloth patch iron on" → 5807.10 (currently → 2601.20 iron ore! due to "iron" word)
    //    "embroidered patch" → 5807.10 (currently → 5810.10 embroidery piece, close but wrong)
    //    "cloth patch" → 5807.10
    //    "button badge" → 5807.10 (woven label/badge)
    //    "Turkish Bookmark woven carpet-style" → 5807.10 (woven bookmark)
    //    5807.10 = woven labels, badges, emblems and similar articles of textile materials
    //    NOTE: "iron on" patch currently triggers iron/steel HTS (2601) — need to override
    {
      const existing = allRules.find(r => r.id === 'WOVEN_BADGE_PATCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOVEN_BADGE_PATCH_INTENT',
          description: 'Woven/embroidered patches, badges, emblems, bookmarks → ch.58 (5807.10)',
          pattern: {
            anyOf: [
              // Clothing patches (iron-on or sew-on)
              'cloth patch', 'fabric patch', 'textile patch',
              'iron on patch', 'iron-on patch', 'sew on patch', 'sew-on patch',
              'embroidered patch', 'woven patch', 'custom patch',
              'jacket patch', 'hat patch', 'backpack patch',
              // Badges and emblems
              'woven badge', 'fabric badge', 'cloth badge',
              'woven label', 'cloth label', 'garment label',
              // Bookmarks (woven)
              'woven bookmark', 'textile bookmark', 'fabric bookmark',
              // Morale patches, sport patches
              'morale patch', 'military patch', 'sports patch',
              'team patch', 'scout patch',
            ],
            noneOf: [
              'metal badge', 'pin badge', 'button badge', 'plastic badge',
              'sticker patch', 'vinyl patch',
            ],
          },
          inject: [
            { prefix: '5807.10', syntheticRank: 5 },
            { prefix: '5807.90', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '5807.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOVEN_BADGE_PATCH_INTENT: created (textile patches/badges → 5807.10)');
      }
    }

    // 3. HANDMADE_TEXTILE_ARTICLE_INTENT → 6307.90 (made-up textile articles NES)
    //    "Handmade Crochet Textile Keychain" → 6307.90 (currently → 7326.20 metal keychain!)
    //    "handmade Wristlet made with cotton" → 6307.90 (small textile wristlet)
    //    "Handmade wool felt decorative figure" → 6307.90 (felt textile figure)
    //    "handmade photo frame using cotton cords" → 6307.90
    //    6307.90 = other made-up articles of textile materials NES (catch-all for textile crafts)
    {
      const existing = allRules.find(r => r.id === 'HANDMADE_TEXTILE_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HANDMADE_TEXTILE_ARTICLE_INTENT',
          description: 'Handmade textile articles, crochet/felt keychains, cord crafts → ch.63 (6307.90)',
          pattern: {
            anyOf: [
              // Textile keychains (going to metal keychain - wrong)
              'crochet keychain', 'textile keychain', 'knit keychain',
              'fabric keychain', 'macrame keychain', 'fiber keychain',
              // Felt/fabric decorative figures
              'wool felt figure', 'felt figure', 'felt decor', 'felt toy',
              'fabric figure', 'textile figure', 'crochet figure',
              // Cord/macramé textile items
              'cotton cord craft', 'macrame cord', 'macrame wall hanging',
              'macrame plant hanger', 'jute rope craft', 'hemp cord craft',
              // Crochet/knit textile accessories
              'crochet wristlet', 'knit wristlet', 'fabric wristlet',
              'crochet bag', 'knit pouch', 'crochet wallet',
              // Handmade textile photo frames
              'textile photo frame', 'fabric photo frame', 'crochet frame',
              // Other handmade textile articles
              'handmade textile article', 'fabric bookmark',
            ],
            noneOf: [
              'metal', 'steel', 'iron', 'brass', 'silver', 'gold',
              'plastic', 'acrylic', 'vinyl',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.50, prefixMatch: '6307.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('HANDMADE_TEXTILE_ARTICLE_INTENT: created (handmade textile articles → 6307.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT49)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT49 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
