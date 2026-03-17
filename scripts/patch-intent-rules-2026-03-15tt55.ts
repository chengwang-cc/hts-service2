#!/usr/bin/env ts-node
/**
 * Patch TT55 — 2026-03-15: Glass drinkware, wooden kitchen utensils, tape player fixes.
 * Current: ~34.53% (TT54 just applied)
 *
 * New Rules:
 *  1. GLASS_DRINKING_VESSEL_INTENT → 7013.XX (glass tableware)
 *     "2 glass mugs" → 6911.10 (ceramic!) BUG — "mug" triggers ceramic
 *     "Jersey Shore Stemless Wine Glass" → 7018.10 (glass beads!) BUG
 *     "16oz glass beer mug" → 7013.37 (correct!) but wrong sub-code sometimes
 *     Fix: inject 7013.XX + denyChapters: ['69'] (deny ceramic)
 *  2. WOODEN_KITCHEN_UTENSIL_INTENT → 4419.XX (wooden kitchen utensils/kitchenware)
 *     "Cookie Molds Wooden" → 3926.10 (plastic!) BUG — "Mold" triggers plastic
 *     "Handmade Olive Wood Bowl" → 6912.00 (ceramic!) BUG — "bowl" triggers ceramic
 *     "Wooden salad spoons" → ? likely wrong
 *     Fix: inject 4419.XX + denyChapters: ['69', '39']
 *  3. CASSETTE_TAPE_PLAYER_INTENT → 8519.81 (sound reproducing apparatus)
 *     "Tape Player" → 8527.13 (car cassette player!) BUG
 *     "We Are Rewind Portable Cassette Player" → 8523.29 (tapes) BUG
 *     "used tape player plastic" → 3919.10 (plastic film!) BUG
 *     Fix: inject 8519.81 + denyChapters: ['39']
 *  4. GLASS_BOTTLE_CONTAINER_INTENT → 7010.90 (glass containers/bottles)
 *     "Empty Beer Bottle" → 2203.00 (beer!) BUG — "beer" triggers beverage
 *     Fix: inject 7010.90 + denyChapters: ['22', '20', '21']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt55.ts
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

    // 1. GLASS_DRINKING_VESSEL_INTENT → 7013.XX (glass tableware, drinking vessels)
    //    "2 glass mugs" → 6911.10 (ceramic!) — "mug" triggers ceramic HTS
    //    "Jersey Shore Stemless Wine Glass Set" → 7018.10 (glass beads!) WRONG
    //    "18 oz glass tumbler" → 7013.37 (correct at 6-digit) but wrong sub-code
    //    "glass sake set" → 7013.99 ✓ but might miss at 8-digit
    //    7013.10 = glass stemware (wine glasses, champagne flutes)
    //    7013.22 = lead crystal drinking glasses (not stemware)
    //    7013.28 = other drinking glasses (not lead crystal)
    //    7013.37 = beer mugs and other glass beverage containers
    //    7013.42 = glass mugs (without handles)
    //    7013.49 = glassware for indoor use (candle holders, vases)
    //    7013.99 = other glassware
    {
      const existing = allRules.find(r => r.id === 'GLASS_DRINKING_VESSEL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_DRINKING_VESSEL_INTENT',
          description: 'Glass mugs, tumblers, beer glasses, wine glasses, glass cups → ch.70 (7013.XX)',
          pattern: {
            anyOf: [
              // Glass mugs (with or without handles)
              'glass mug', 'glass mugs', 'glass beer mug', 'glass coffee mug',
              'glass tea mug', 'glass cup',
              // Wine glasses
              'wine glass', 'wine glasses', 'stemless wine glass', 'stemless wine glasses',
              'wine goblet', 'champagne glass', 'champagne flute',
              // Beer glasses and tumblers
              'glass tumbler', 'glass tumblers', 'beer glass', 'beer glasses',
              'pint glass', 'pint glasses', 'glass pint',
              // Shot glasses
              'shot glass', 'shot glasses', 'glass shot',
              // Cocktail glasses
              'cocktail glass', 'cocktail glasses', 'martini glass',
              'highball glass', 'lowball glass', 'rocks glass',
              // Sake and specialty glass
              'sake glass', 'sake set glass', 'glass sake',
              // Sets
              'glassware set', 'drinking glass set', 'glass drinking set',
            ],
            noneOf: [
              'ceramic', 'porcelain', 'stainless steel', 'plastic cup',
              'travel mug', 'thermos', 'insulated',
            ],
          },
          inject: [
            { prefix: '7013.28', syntheticRank: 5 },
            { prefix: '7013.42', syntheticRank: 5 },
            { prefix: '7013.37', syntheticRank: 5 },
            { prefix: '7013.99', syntheticRank: 4 },
            { prefix: '7013.49', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['69', '73', '84'],
            denyPrefixes: ['7018'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '7013.' }],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('GLASS_DRINKING_VESSEL_INTENT: created (glass drinkware → 7013.XX)');
      }
    }

    // 2. WOODEN_KITCHEN_UTENSIL_INTENT → 4419.XX (wooden kitchen/table utensils)
    //    "Cookie Molds Wooden" → 3926.10 (plastic office supplies!) WRONG — "mold" triggers plastic
    //    "Wooden Cookie Mold" → 3926.10 WRONG
    //    "Handmade Olive Wood Bowl" → 6912.00 (ceramic stoneware!) WRONG — "bowl" triggers ceramic
    //    "wooden salad spoons" → probably 3926 or wrong
    //    4419.10 = wooden tableware/kitchenware of bamboo
    //    4419.20 = wooden tableware/kitchenware, other (includes cookie molds, utensil holders)
    //    4419.90 = other wooden kitchenware (includes carved bowls, spice grinders)
    {
      const existing = allRules.find(r => r.id === 'WOODEN_KITCHEN_UTENSIL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_KITCHEN_UTENSIL_INTENT',
          description: 'Wooden bowls, cookie molds, spoons, olive wood utensils → ch.44 (4419.XX)',
          pattern: {
            anyOf: [
              // Wooden cookie/baking molds
              'wooden cookie mold', 'wood cookie mold', 'wooden cookie molds',
              'cookie mold wood', 'cookie molds wooden', 'wood baking mold',
              'wooden speculaas mold', 'carved cookie mold',
              // Wooden bowls
              'wooden bowl', 'wood bowl', 'olive wood bowl', 'olive wood bowls',
              'wooden salad bowl', 'wood salad bowl', 'carved wood bowl',
              'handmade wood bowl', 'wooden serving bowl',
              // Wooden spoons and utensils
              'wooden spoon', 'wooden spoons', 'wood spoon', 'wood spoons',
              'wooden spatula', 'wooden fork', 'wooden ladle',
              'wooden salad spoon', 'wooden salad servers',
              'wooden utensil', 'wooden utensils', 'wood utensil',
              // Wooden utensil holders/organizers
              'wooden utensil holder', 'wood utensil holder',
              'wooden pepper mill', 'wood pepper mill', 'olive wood pepper mill',
              // Wooden cutting boards (already in ch.44 generally)
              'wood cutting board', 'wooden cutting board',
            ],
            noneOf: [
              'plastic', 'silicone', 'metal', 'steel', 'stainless',
              'bamboo cutting board', // bamboo is different sub-code
            ],
          },
          inject: [
            { prefix: '4419.20', syntheticRank: 5 },
            { prefix: '4419.90', syntheticRank: 5 },
            { prefix: '4419.10', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['39', '69', '73'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '4419.' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('WOODEN_KITCHEN_UTENSIL_INTENT: created (wooden kitchenware → 4419.XX)');
      }
    }

    // 3. CASSETTE_TAPE_PLAYER_INTENT → 8519.81 (sound reproducing apparatus)
    //    "Tape Player" → 8527.13.11 (car cassette player) WRONG — should be portable player
    //    "used tape player plastic" → 3919.10 (plastic film!) WRONG — "plastic" triggers plastic
    //    "We Are Rewind ELVIS Portable Cassette Player" → 8523.29 (tapes) WRONG — "cassette" triggers media
    //    8519.81 = sound reproducing apparatus (tape decks, CD players)
    //    8527.13 = car cassette players
    {
      const existing = allRules.find(r => r.id === 'CASSETTE_TAPE_PLAYER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CASSETTE_TAPE_PLAYER_INTENT',
          description: 'Portable tape players, cassette players, cassette decks → ch.85 (8519.81)',
          pattern: {
            anyOf: [
              // Tape players
              'tape player', 'tape players', 'cassette player', 'cassette players',
              'portable tape player', 'portable cassette player',
              'walkman cassette', 'cassette walkman',
              // Cassette decks
              'cassette deck', 'tape deck', 'reel to reel player',
              // Microcassette
              'microcassette recorder', 'microcassette player',
            ],
            noneOf: [
              // Car-specific cassette players have different HTS
              'car cassette', 'car tape', 'automotive cassette',
            ],
          },
          inject: [
            { prefix: '8519.81', syntheticRank: 5 },
            { prefix: '8519.89', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['39'],
            denyPrefixes: ['8527.13', '8523'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '8519.8' }],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('CASSETTE_TAPE_PLAYER_INTENT: created (tape/cassette players → 8519.81)');
      }
    }

    // 4. GLASS_BOTTLE_CONTAINER_INTENT → 7010.90 (glass containers, jars, bottles)
    //    "Empty Beer Bottle" → 2203.00 (beer!) WRONG — "beer" triggers beverage chapter
    //    "Decanter Set" → 7010.90 ✓ (working) but sub-code mismatch
    //    7010.90 = glass bottles, jars, flasks for packaging (commercial glass containers)
    {
      const existing = allRules.find(r => r.id === 'GLASS_BOTTLE_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_BOTTLE_CONTAINER_INTENT',
          description: 'Glass bottles, beer bottles, decanters, glass jars (empty) → ch.70 (7010.90)',
          pattern: {
            anyOf: [
              // Empty glass bottles
              'empty beer bottle', 'empty wine bottle', 'empty glass bottle',
              'glass beer bottle', 'beer bottle glass', 'empty bottle glass',
              // Decanters
              'glass decanter', 'whisky decanter', 'wine decanter',
              'decanter set glass', 'crystal decanter',
              // Glass jars (empty)
              'empty glass jar', 'glass mason jar', 'empty mason jar',
              'glass storage jar', 'empty apothecary jar',
            ],
            noneOf: [
              'ceramic', 'porcelain', 'plastic bottle', 'stainless', 'aluminum',
            ],
          },
          inject: [
            { prefix: '7010.90', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['22', '20', '21'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '7010.9' }],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('GLASS_BOTTLE_CONTAINER_INTENT: created (glass bottles/decanters → 7010.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT55)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT55 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
