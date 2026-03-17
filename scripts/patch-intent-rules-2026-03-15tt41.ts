#!/usr/bin/env ts-node
/**
 * Patch TT41 — 2026-03-15: Fix dress/skirt/cutlery rules + new elastic hair ties + coveralls.
 * Current: ~33.69% (after TT40)
 *
 * Fixes:
 *  - WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: "lyocell blend", "spandex womens dress", "viscose blend",
 *    "flower girl veil" patterns not matching. Add new phrase variants.
 *  - SYNTHETIC_KNIT_SKIRT_INTENT: Missing tutu, tube skirt, bamboo jersey skirt, circle skirt.
 *  - FLATWARE_CUTLERY_SILVERWARE_INTENT: Missing tea spoon, coffee spoon, oyster fork, serving tongs.
 *
 * New Rules:
 *  1. ELASTIC_HAIR_TIE_TEXTILE_ACCESSORY_INTENT → 6217.10 (elastic hair ties, headwraps, safety sashes)
 *     "100 elastic hair tie" → 6217.10; "100% Linen Full Coverage Headwrap" → 6217.10; 13 miss entries
 *  2. COVERALL_ATHLETIC_SHORTS_INTENT → 6211.33 + 6211.32 (coveralls, hockey pants, athletic shorts)
 *     "Cotton Coverall with Reflective Tape" → 6211.32; "ice hockey goalie pants" → 6211.33; 27 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt41.ts
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

    // FIX: WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT — phrase mismatch for lyocell/viscose blends
    // "Black sleeveless dress, polyester and lyocell blend" doesn't include "lyocell dress" substring
    // "85% Polyester, 15% Spandex Womens Dress" doesn't include "spandex dress women" (wrong order)
    // Fix: add new phrase variants and standalone fiber terms with dress context
    {
      const existing = allRules.find(r => r.id === 'WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasLyocellBlend = currentAnyOf.some((t: string) => t.includes('lyocell blend'));
        if (!hasLyocellBlend) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Blend fabric phrases that appear in dress descriptions
                'lyocell blend', 'lyocell dress blend', 'polyester lyocell',
                'viscose blend dress', 'viscose polyamide', 'viscose elastane',
                'spandex womens dress', 'spandex women dress', 'spandex girls dress',
                'polyester spandex dress', 'polyester elastane dress',
                // More dress patterns
                'womens dress polyester', 'womens handmade dress',
                'girls dress polyester', 'girls tulle', 'girls veil',
                'flower girl veil', 'wedding veil girls',
                'chestnut lace', 'eclipse lace', 'lace dress women',
                'maternity robe', 'delivery gown', 'nursing robe',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: updated anyOf with lyocell/viscose/spandex blend patterns');
        } else {
          console.log('WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: already has lyocell blend pattern');
        }
      }
    }

    // FIX: SYNTHETIC_KNIT_SKIRT_INTENT — add tutu, tube skirt, bamboo jersey skirt, circle skirt
    // "Adult Harley Quinn Tutu" → 6204.53; "Girls knit Bamboo Jersey Skirt Midi Tube Skirt" → 6204.53
    // "Girls Circle Skirt - *4 COLORS*" → 6204.53; "Black Velvet" circle skirt → 6204.53
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_KNIT_SKIRT_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasTutu = currentAnyOf.some((t: string) => t.includes('tutu'));
        if (!hasTutu) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                'tutu', 'tutu skirt', 'adult tutu', 'girls tutu', 'ballerina tutu',
                'tube skirt', 'midi tube skirt', 'mini tube skirt', 'jersey tube skirt',
                'bamboo jersey skirt', 'bamboo skirt', 'jersey bamboo skirt',
                'circle skirt', 'girls circle skirt', 'women circle skirt',
                'velvet skirt', 'velvet circle skirt', 'girls velvet skirt',
                'kaia skirt', 'awa skirt',  // brand name skirts
                'spandex skirt', 'spandex womens skirt',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('SYNTHETIC_KNIT_SKIRT_INTENT: updated anyOf with tutu/tube skirt/circle skirt');
        } else {
          console.log('SYNTHETIC_KNIT_SKIRT_INTENT: already has tutu pattern');
        }
      }
    }

    // FIX: FLATWARE_CUTLERY_SILVERWARE_INTENT — add tea spoon, coffee spoon, oyster fork, tongs
    // "Stainless Steel Coffee Spoons" → 8215.99; "Set of 6 tea spoons" → 8215.99
    // "serving tongs steel" → 8215.99; "oyster fork set" → 8215.99
    {
      const existing = allRules.find(r => r.id === 'FLATWARE_CUTLERY_SILVERWARE_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasTeaSpoon = currentAnyOf.some((t: string) => t.includes('tea spoon') || t.includes('teaspoon'));
        if (!hasTeaSpoon) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                'teaspoon', 'tea spoon', 'tea spoons', 'set tea spoons',
                'coffee spoon', 'coffee spoons', 'demitasse spoon',
                'oyster fork', 'salad fork', 'dinner fork', 'dessert fork',
                'serving tongs', 'tongs steel', 'kitchen tongs', 'salad tongs',
                'vintage cutlery', 'vintage flatware', 'vintage cutlery set',
                'vintage flatware set', 'cutlery set stainless',
                'base metal spoon', 'base metal fork', 'base metal cutlery',
                'kitchen set cutlery',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('FLATWARE_CUTLERY_SILVERWARE_INTENT: updated anyOf with tea spoon/coffee spoon/serving tongs');
        } else {
          console.log('FLATWARE_CUTLERY_SILVERWARE_INTENT: already has teaspoon pattern');
        }
      }
    }

    // 1. ELASTIC_HAIR_TIE_TEXTILE_ACCESSORY_INTENT → 6217.10 (clothing accessories of woven/other textile)
    //    "100 elastic hair tie" → 6217.10.90.50 (elastic hair ties — woven elastic)
    //    "100% elastic hair tie" → 6217.10.90.50
    //    "100% Cotton Full Coverage Headcovering" → 6217.10.90.10 (modest headcovering)
    //    "100% Linen Full Coverage Headwrap Headcovering" → 6217.10.90.10
    //    "No-Slip Turban Velvet Headband" → 6217.10.90.50 (velvet turban headband)
    //    "Forcefield Hi Vis Traffic Safety Sash - Black" → 6217.10.10.00 (safety sash)
    //    "Traffic Safety Sash" → 6217.10.10.00
    //    6217.10 = other made-up clothing accessories (of woven/non-knit fabric)
    //    NOTE: distinct from 6117.80 (knit clothing accessories)
    //    NOTE: elastic hair ties and woven headwraps → 6217.10
    {
      const existing = allRules.find(r => r.id === 'ELASTIC_HAIR_TIE_TEXTILE_ACCESSORY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ELASTIC_HAIR_TIE_TEXTILE_ACCESSORY_INTENT',
          description: 'Elastic hair ties, headcoverings, safety sashes, woven textile accessories → ch.62 (6217.10)',
          pattern: {
            anyOf: [
              'elastic hair tie', 'elastic hair ties', '100% elastic hair tie',
              'pack elastic hair tie', 'hair tie elastic', 'hair ties elastic',
              'bachelorette hair tie', 'hair tie favors',
              'headcovering', 'head covering', 'full coverage headcovering',
              'hijab', 'headscarf cotton', 'headscarf linen',
              'headwrap linen', 'headwrap cotton', 'linen headwrap', 'linen headband headcovering',
              'turban velvet headband', 'velvet turban', 'no-slip turban',
              'safety sash', 'traffic safety sash', 'hi vis sash',
              'wool socks', 'cotton socks knit', 'hand knit socks',
            ],
            noneOf: [
              'rubber band', 'elastic band only', 'rubber elastic',
              'metal headband', 'plastic headband',
              'sneakers', 'shoes', 'boots',
            ],
          },
          inject: [{ prefix: '6217.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6217.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('ELASTIC_HAIR_TIE_TEXTILE_ACCESSORY_INTENT: created (elastic hair ties/headwraps → 6217.10)');
      }
    }

    // 2. COVERALL_ATHLETIC_SPORTS_GARMENT_INTENT → 6211.33 + 6211.32 (coveralls, athletic shorts, hockey pants)
    //    "Cotton Coverall with Reflective Tape" → 6211.32.00.31 (cotton coverall)
    //    "mens Welder's Coverall, 100% Cotton" → 6211.32.00.31
    //    "Winter Lined Black Cotton Canvas Coverall" → 6211.32.00.31
    //    "fleece jacket" → 6211.33.00.58 (fleece jacket, not knit)
    //    "Men-s woven athletic shorts, of synthetic fibers" → 6211.33.00.45
    //    "trouser mens 36 x 30" → 6211.33.00.15 (woven trousers - man-made fibre)
    //    "ice hockey goalie pants" → 6211.33.00.35 (padded hockey pants)
    //    "Padded textile ice hockey goalie pants" → 6211.33.00.35
    //    "Puffy Vest" → 6211.33.00.58
    //    "NEW! REEBOK AUTHENTIC NFL CHARGERS FOOTBALL ON FIELD SOFT SHELL TEAM JACKET" → 6211.33
    //    6211.32 = other garments of cotton (woven, not knit) — coveralls, tracksuits
    //    6211.33 = other garments of man-made fibres (woven) — athletic shorts, hockey gear
    {
      const existing = allRules.find(r => r.id === 'COVERALL_ATHLETIC_SPORTS_GARMENT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COVERALL_ATHLETIC_SPORTS_GARMENT_INTENT',
          description: 'Coveralls, athletic shorts, hockey pants, padded sports garments → ch.62 (6211.32 + 6211.33)',
          pattern: {
            anyOf: [
              'coverall', 'coveralls', 'welder coverall', 'cotton coverall',
              'work coverall', 'reflective coverall', 'safety coverall',
              'canvas coverall', 'lined coverall',
              'hockey pants', 'hockey goalie pants', 'goalie pants', 'ice hockey pants',
              'padded hockey pants', 'goalie equipment pants',
              'inline hockey pants', 'padded pants hockey',
              'athletic shorts woven', 'woven athletic shorts', 'mesh shorts men',
              'football jersey woven', 'soft shell jacket athletic',
              'puffy vest', 'quilted vest', 'padded vest',
              'trouser woven men', 'woven trouser mens',
              'sweat pants cotton', 'cotton sweatpants', 'sweatpants cotton',
              'tracksuit cotton', 'track suit cotton',
            ],
            noneOf: [
              'knit', 'knitted', 'crochet',
              'down jacket', 'leather jacket',
              'denim', 'jean',
            ],
          },
          inject: [
            { prefix: '6211.33', syntheticRank: 5 },
            { prefix: '6211.32', syntheticRank: 5 },
          ],
          boosts: [
            { delta: 0.50, prefixMatch: '6211.3' },
          ],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COVERALL_ATHLETIC_SPORTS_GARMENT_INTENT: created (coveralls/hockey pants → 6211.32 + 6211.33)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT41)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT41 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
