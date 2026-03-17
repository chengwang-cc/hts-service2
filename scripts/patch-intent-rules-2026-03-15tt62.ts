#!/usr/bin/env ts-node
/**
 * Patch TT62 — 2026-03-15: Fix TT60 regression + worked stone bugs + wrought iron + whisky tin.
 *
 * Fixes:
 *  1. UPDATE DOWSING_DIVINATION_TOOL_INTENT — remove rod terms causing regression
 *     "bober dowsing rod" → 9017.30 (TT60 REGRESSION!) — should be 7407.21 (copper rods)
 *     "biotensor" → TT60 routes to 9017 but dataset expects 7407.21 for wire form rods
 *     Pendulums (brass) → 9017 is correct; rods → 7407 is correct; keeping only pendulums
 *  2. NEW WORKED_STONE_ARTICLE_INTENT → 6802.XX (worked monumental/building stone)
 *     "Marble Ashtray" → 2515.12 (raw marble!) WRONG — should be 6802.91 (worked stone)
 *     "stone dish" → 6802.91 WRONG
 *     BUG: "marble" triggers raw marble chapter (25) not worked stone (68)
 *  3. NEW SLATE_STONE_PRODUCT_INTENT → 6815.99 (articles of stone)
 *     "Set of 4 Slate Coasters" → 8471.30 (computers!) WRONG — "slate" triggers tablet PC
 *     BUG: "slate" word matches tablet computers (Apple Slate/Kindle Slate descriptions in HTS)
 *  4. NEW WROUGHT_IRON_PRODUCT_INTENT → deny iron ores for finished wrought iron goods
 *     "Pre-owned wood and wrought iron stool" → 2601.20 (iron ores!) WRONG
 *     "Hand Forged Iron" items → sometimes go to ch.26 (ores)
 *     BUG: "wrought iron" triggers iron ore chapter (26) instead of finished goods (72/73/94)
 *  5. NEW WHISKY_TIN_CONTAINER_INTENT → 7310.29 (iron/steel containers)
 *     "GLENMORANGIE Highland Malt Scotch Whisky Tin" → 8001 (tin metal!) WRONG
 *     BUG: "tin" as material triggers tin metal (ch.80) instead of container (ch.73)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt62.ts
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

    // 1. UPDATE DOWSING_DIVINATION_TOOL_INTENT — remove rod-specific terms
    //    "bober dowsing rod" → expected 7407.21 (copper rods) but TT60 routes to 9017.30 WRONG
    //    "dowsing rod -biotensor wire form" → expected 7407.21 but gets 9017.30 WRONG
    //    FIX: Keep only pendulum terms in anyOf (pendulums go to 9017, rods go to 7407)
    {
      const existing = allRules.find(r => r.id === 'DOWSING_DIVINATION_TOOL_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        // Remove rod-specific terms that conflict with copper rod expected codes
        const rodTerms = new Set([
          'dowsing rod', 'dowsing rods', 'l rod dowsing', 'divining rod',
          'water divining rod', 'biotensor',
        ]);
        const filteredAnyOf = currentAnyOf.filter((t: string) => !rodTerms.has(t));
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: filteredAnyOf,
          },
        } as IntentRule;
        patches.push({ priority: 578, rule: updated });
        console.log('DOWSING_DIVINATION_TOOL_INTENT: removed rod terms (rods→7407, pendulums→9017)');
      } else {
        console.log('DOWSING_DIVINATION_TOOL_INTENT: not found (apply TT60 first)');
      }
    }

    // 2. WORKED_STONE_MARBLE_ARTICLE_INTENT → 6802.XX (worked monumental/building stone)
    //    "Marble Ashtray" → 2515.12 (raw marble block!) WRONG — should be 6802.91 (worked marble)
    //    "stone dish" → 6802.91 WRONG (was going to wrong chapter)
    //    BUG: "marble" triggers ch.25 (raw stone/mineral) not ch.68 (worked stone articles)
    //    6802.91 = marble/travertine, worked (tabletops, ashtrays, decorative)
    //    6802.93 = granite, worked (carved figurines)
    //    6802.99 = other stone, worked (soapstone, alabaster items)
    {
      const existing = allRules.find(r => r.id === 'WORKED_STONE_MARBLE_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WORKED_STONE_MARBLE_ARTICLE_INTENT',
          description: 'Marble ashtrays, soapstone carvings, stone dishes → ch.68 (6802.XX)',
          pattern: {
            anyOf: [
              // Marble articles
              'marble ashtray', 'marble bowl', 'marble dish', 'marble tray',
              'marble plate', 'marble coaster', 'marble serving board',
              'marble cheese board', 'marble mortar', 'marble pestle',
              // Stone dishes/bowls/trays
              'stone dish', 'stone bowl', 'stone ashtray', 'stone tray',
              'onyx ashtray', 'onyx bowl', 'onyx dish',
              // Soapstone articles
              'soapstone figurine', 'soapstone carving', 'soapstone statue',
              'soapstone bowl', 'soapstone animal',
              // Granite/alabaster articles
              'granite ashtray', 'granite bowl', 'alabaster figurine',
              'alabaster vase', 'alabaster lamp',
              // Marble/stone decorative items
              'marble statue', 'marble figurine', 'carved marble',
              'travertine tile coaster', 'stone coaster natural',
            ],
            noneOf: [
              // Exclude construction/flooring marble (different HTS)
              'marble tile', 'marble floor', 'marble slab', 'marble countertop',
              // Exclude glass marbles (toys)
              'glass marble', 'toy marble',
            ],
          },
          inject: [
            { prefix: '6802.91', syntheticRank: 5 },
            { prefix: '6802.99', syntheticRank: 5 },
            { prefix: '6802.93', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['25', '69'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '6802.' }],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('WORKED_STONE_MARBLE_ARTICLE_INTENT: created (marble/stone articles → 6802, deny ch.25 raw)');
      }
    }

    // 3. SLATE_STONE_PRODUCT_INTENT → 6815.99 (articles of stone/mineral substances)
    //    "Set of 4 Slate Coasters" → 8471.30 (computers!) WRONG — "slate" = tablet PC
    //    "Slate Coaster" → expected 6815.99.41.70 (stone/mineral articles)
    //    "Personalized Slate Trophy" → 8471.30 WRONG
    //    BUG: "slate" triggers computer tablet (Apple slate, Amazon Fire tablet descriptions)
    //    6815.99 = other articles of stone or other mineral substances
    {
      const existing = allRules.find(r => r.id === 'SLATE_STONE_PRODUCT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SLATE_STONE_PRODUCT_INTENT',
          description: 'Slate coasters, slate trophy, slate stone articles → ch.68 (6815.99)',
          pattern: {
            anyOf: [
              // Slate coasters and trivets
              'slate coaster', 'slate coasters', 'slate trivet', 'slate set',
              'set of slate', 'personalized slate', 'engraved slate',
              // Slate decorative items
              'slate plaque', 'slate sign', 'slate trophy',
              'slate board', 'slate serving board', 'slate cheese board',
              // Slate stone raw/craft (not computer tablets)
              'natural slate', 'real slate', 'slate stone',
              // Quartzite/mineral stone products (not computer)
              'quartzite coaster', 'limestone coaster', 'sandstone coaster',
            ],
            noneOf: [
              // Exclude computer tablets
              'tablet computer', 'android tablet', 'ipad', 'e-reader',
            ],
          },
          inject: [
            { prefix: '6815.99', syntheticRank: 5 },
            { prefix: '6802.29', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['84'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '6815.' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('SLATE_STONE_PRODUCT_INTENT: created (slate coasters → 6815.99, deny ch.84 computers)');
      }
    }

    // 4. WROUGHT_IRON_FURNITURE_HARDWARE_INTENT → deny iron ores for wrought iron products
    //    "Pre-owned wood and wrought iron stool" → 2601.20 (iron ores!) WRONG — should be 9401.79
    //    BUG: "wrought iron" triggers iron ore chapter (26) instead of furniture/hardware (72/73/94)
    //    "wrought iron" = worked iron = finished product, NOT raw ore
    {
      const existing = allRules.find(r => r.id === 'WROUGHT_IRON_FURNITURE_HARDWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WROUGHT_IRON_FURNITURE_HARDWARE_INTENT',
          description: 'Wrought iron furniture, gates, garden items → ch.94/73/83 (not ch.26 ores)',
          pattern: {
            anyOf: [
              // Wrought iron furniture
              'wrought iron stool', 'wrought iron chair', 'wrought iron table',
              'wrought iron bench', 'wrought iron bed',
              'wrought iron furniture', 'iron furniture wrought',
              // Wrought iron garden/outdoor
              'wrought iron garden', 'wrought iron gate', 'wrought iron fence',
              'wrought iron railing', 'wrought iron trellis',
              // Wrought iron decorative
              'wrought iron wall art', 'wrought iron candelabra',
              'wrought iron candle holder', 'wrought iron chandelier',
              'wrought iron curtain rod',
              // Hand forged iron items
              'hand forged iron', 'hand-forged iron', 'blacksmith iron',
              'forged iron decor',
            ],
            noneOf: [
              'iron ore', 'pig iron', 'iron ingot',
            ],
          },
          inject: [
            { prefix: '9401.79', syntheticRank: 5 }, // chairs/seats of other metal
            { prefix: '7323.99', syntheticRank: 4 }, // other household articles of iron
            { prefix: '8302.41', syntheticRank: 4 }, // fittings/hardware of base metal
          ],
          whitelist: {
            denyChapters: ['26'],
          },
          boosts: [
            { delta: 0.55, prefixMatch: '9401.' },
            { delta: 0.50, prefixMatch: '7323.' },
          ],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('WROUGHT_IRON_FURNITURE_HARDWARE_INTENT: created (wrought iron → 9401/7323, deny ch.26)');
      }
    }

    // 5. WHISKY_TIN_METAL_CONTAINER_INTENT → 7310.29 (iron/steel containers)
    //    "GLENMORANGIE Highland Malt Scotch Whisky Tin Vintage" → 8001 (tin metal!) WRONG
    //    BUG: "tin" as material descriptor triggers tin metal chapter (ch.80)
    //    "whisky tin" = decorative tin container for whisky (not the whisky, not raw tin metal)
    //    7310.29 = casks, drums, cans, boxes of iron/steel ≥ 50 liters to containers
    //    7310.10 = iron/steel containers > 50 liters capacity
    {
      const existing = allRules.find(r => r.id === 'WHISKY_TIN_METAL_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WHISKY_TIN_METAL_CONTAINER_INTENT',
          description: 'Decorative whisky tins, spirit tins, collectible metal containers → ch.73 (7310.29)',
          pattern: {
            anyOf: [
              // Whisky/spirit decorative tins
              'whisky tin', 'whiskey tin', 'scotch tin', 'bourbon tin',
              'spirit tin', 'whisky collector tin',
              'glenmorangie tin', 'laphroaig tin',
              // Other collectible metal tins (not food/tea)
              'vintage tin container', 'antique tin box',
              'collectible tin', 'decorative tin can',
            ],
            noneOf: [
              'tin toy', 'toy tin',
              'tea tin', 'coffee tin', 'cookie tin', // these go to 7310 too but common
            ],
          },
          inject: [
            { prefix: '7310.29', syntheticRank: 5 },
            { prefix: '7310.10', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['80', '22', '10'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '7310.' }],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('WHISKY_TIN_METAL_CONTAINER_INTENT: created (whisky tin → 7310.29, deny ch.80 tin metal)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT62)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT62 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
