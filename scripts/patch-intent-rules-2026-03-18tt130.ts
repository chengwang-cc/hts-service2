#!/usr/bin/env ts-node
/**
 * Patch TT130 — 2026-03-18:
 *
 * Fix 1: UPDATE PHONE_CASE_INTENT — inject 4202.12 at rank 1 (was generic 4202)
 *   "CUSTOM PHONE CASE" → 4202.92.94.00 WRONG (expected 4202.12.29.10)
 *   Root cause: inject was "4202" (whole chapter), 4202.92 won organically.
 *   4202.12 = camera cases, instrument cases, similar containers of textile materials.
 *   Fix: inject 4202.12 at rank 1, add boost for 4202.12.
 *
 * Fix 2: NEW VIDEO_GAME_CARTRIDGE_TV_GAME_INTENT → 9504.30
 *   "Duck Hunt - Nintendo NES" → 9504.50.00.00 WRONG (expected 9504.30.00.10)
 *   "Friday the 13th - Nintendo NES" → 9504.50 WRONG
 *   "God of War 2 (LN) Pre-Owned Playstation 2" → 9504.50 WRONG
 *   Root cause: game cartridges/discs (9504.30 = video games for TV) vs consoles (9504.50).
 *   Fix: new intent detecting game titles with platform suffix, inject 9504.30 rank 1.
 *
 * Fix 3: UPDATE INLINE_SKATE_SPORTS_INTENT → also inject 6402.12 for rollerblade boots
 *   "Vintage RollerBlade BravoBlade GLX Women-s Size 9 Inline Skates Rollerblades"
 *     → 9506.70.20.10 WRONG (expected 6402.12.00.00)
 *   Root cause: INLINE_SKATE_SPORTS_INTENT only injects 9506.70 (sports equipment).
 *   Rollerblade boots are footwear (6402.12) not equipment. Need footwear-specific rule.
 *   Fix: new ROLLERBLADE_BOOT_FOOTWEAR_INTENT with denyChapters:['95'] → 6402.12.
 *
 * Fix 4: NEW BRIDAL_VEIL_TULLE_LACE_INTENT → 5804.30
 *   "Ivory Birdcage Veil: Simple Bridal Veil with Bobby Pins" → 9615.90.30.00 WRONG (expected 5804.30.00.10)
 *   "handmade women tulle wedding cape" → 5804.10.90.10 WRONG (expected 5804.30.00.20)
 *   Root cause: Veils → hair accessories (9615) or generic tulle fabric (5804.10).
 *   5804.30 = hand-made lace (includes handmade bridal veils/tulle veils).
 *   Fix: new intent with allowChapters:['58'], denyChapters:['96'].
 *
 * Fix 5: NEW GLASS_PACKING_BOTTLE_SPIRIT_INTENT → 7010.90
 *   "Glass bottle dispenser" → 7013 WRONG (expected 7010.90.20.20)
 *   "clear glass decanter bottle for spirits" → 7013.99 WRONG (expected 7010.90.30.20)
 *   Root cause: "bottle/decanter" → table glassware (7013). Packing bottles are 7010.
 *   Fix: new intent for glass spirit/beverage/packing bottles with denyPrefixes:['7013.'].
 *
 * Fix 6: NEW BED_PILLOW_CUSHION_LINEN_INTENT → 6302.21 / 6302.10
 *   "Handmade pillows" → 6307.90.89.45 WRONG (expected 6302.21.30.40)
 *   Root cause: handmade pillows classified as made-up textile articles (6307).
 *   6302.21 = bed linen of cotton (includes pillow cases, pillow covers, sheets).
 *   Fix: new intent with allowChapters:['63'].
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-18tt130.ts
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

    // 1. UPDATE PHONE_CASE_INTENT — inject 4202.12 at rank 1
    //    "CUSTOM PHONE CASE" → 4202.92.94.00 WRONG (expected 4202.12.29.10)
    //    4202.12 = cases, covers for cameras/instruments/phones (textile surface)
    {
      const existing = allRules.find(r => r.id === 'PHONE_CASE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '4202.12', syntheticRank: 1 },  // camera/phone cases of textile surface
            { prefix: '4202.91', syntheticRank: 6 },  // similar containers of textile
            { prefix: '4202.92', syntheticRank: 9 },  // other containers
          ],
          boosts: [
            { delta: 0.85, prefixMatch: '4202.12' },  // strong boost for specific phone case code
            { delta: 0.60, chapterMatch: '42' },
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('PHONE_CASE_INTENT: updated inject→4202.12 rank1');
      } else {
        console.log('PHONE_CASE_INTENT: not found');
      }
    }

    // 2. NEW VIDEO_GAME_CARTRIDGE_TV_GAME_INTENT → 9504.30
    //    Game cartridges/discs (for NES/SNES/N64/PS1/PS2/Atari) are 9504.30.
    //    Currently getting 9504.50 (consoles) or wrong chapter codes.
    {
      const existing = allRules.find(r => r.id === 'VIDEO_GAME_CARTRIDGE_TV_GAME_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VIDEO_GAME_CARTRIDGE_TV_GAME_INTENT',
          description: 'Video game cartridges/discs (NES/SNES/PS2/etc.) → 9504.30 (TV video games)',
          pattern: {
            anyOf: [
              // Platform suffix patterns (game title + platform = cartridge)
              '- nintendo nes', '- nintendo snes', '- super nintendo',
              '- nintendo 64', '- n64', '- game boy', '- gameboy',
              '- playstation 2', '- playstation 1',
              '- sega genesis', '- sega saturn', '- sega dreamcast',
              '- atari 2600', '- atari 7800',
              // Explicit cartridge/game disc terms
              'nes cartridge', 'snes cartridge', 'nes game', 'snes game',
              'super nintendo game', 'n64 game', 'nintendo 64 game',
              'game cartridge', 'video game cartridge',
              'pre-owned playstation', 'playstation 2 game', 'ps2 game',
              'ps1 game', 'pre-owned sega', 'pre-owned nintendo',
              'game disc', 'game cd', 'game dvd',
              'atari cartridge', 'atari game cartridge',
              'game boy cartridge', 'gameboy game',
            ],
            noneOf: [
              // Consoles and hardware
              'console', 'system', 'hardware', 'controller only',
              'nes console', 'snes console', 'repair kit',
              // Accessories
              'memory card', 'power supply', 'av cable',
            ],
          },
          inject: [
            { prefix: '9504.30', syntheticRank: 1 },  // video games of a kind used with TV receiver
            { prefix: '9504.50', syntheticRank: 8 },  // other video game consoles (fallback)
          ],
          whitelist: {
            allowChapters: ['95'],  // only amusement/game chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '9504.30' },  // very strong boost for cartridge code
            { delta: 0.50, prefixMatch: '9504.' },     // general game boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9504.50' },  // penalize console/machine code
          ],
        } as IntentRule;
        patches.push({ priority: 621, rule: newRule });
        console.log('VIDEO_GAME_CARTRIDGE_TV_GAME_INTENT: created (→9504.30, denyConsoles)');
      } else {
        console.log('VIDEO_GAME_CARTRIDGE_TV_GAME_INTENT: already exists, skipping');
      }
    }

    // 3. NEW ROLLERBLADE_BOOT_FOOTWEAR_INTENT → 6402.12
    //    Rollerblade/inline skate boots are footwear (6402.12), not sports equipment (9506.70).
    //    INLINE_SKATE_SPORTS_INTENT injects 9506.70 which wins for boot queries.
    //    denyChapters:['95'] hard-blocks sports chapter for these boot-specific queries.
    {
      const existing = allRules.find(r => r.id === 'ROLLERBLADE_BOOT_FOOTWEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ROLLERBLADE_BOOT_FOOTWEAR_INTENT',
          description: 'Rollerblade/inline skate boots → 6402.12 (rubber/plastic footwear)',
          pattern: {
            anyOf: [
              'rollerblade', 'rollerblades', 'roller blade', 'roller blades',
              'inline skate boots', 'inline skates', 'inline skating boots',
              'roller skate boots', 'roller skates boots',
              'quad skate boots', 'speed skate boots',
            ],
            noneOf: [
              // Accessories/parts (stay in ch.95)
              'chassis', 'frame', 'wheel', 'bearing', 'brake pad', 'axle',
              'lace', 'strap only', 'buckle replacement',
              // Ice skates (different code)
              'ice skate', 'ice skates', 'hockey skate',
            ],
          },
          inject: [
            { prefix: '6402.12', syntheticRank: 1 },  // rubber/plastic sports footwear (inline skate boots)
            { prefix: '6404.11', syntheticRank: 4 },  // footwear with rubber sole and textile upper
          ],
          whitelist: {
            allowChapters: ['64'],   // only footwear chapter
            denyChapters: ['95'],    // hard-block sports equipment chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6402.12' },
            { delta: 0.60, prefixMatch: '6402.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9506.' },  // strong penalty for sports equipment
          ],
        } as IntentRule;
        patches.push({ priority: 622, rule: newRule });
        console.log('ROLLERBLADE_BOOT_FOOTWEAR_INTENT: created (→6402.12, denyChapters:[95])');
      } else {
        console.log('ROLLERBLADE_BOOT_FOOTWEAR_INTENT: already exists, skipping');
      }
    }

    // 4. NEW BRIDAL_VEIL_TULLE_LACE_INTENT → 5804.30
    //    Handmade bridal veils, birdcage veils, tulle wedding capes → 5804.30 (hand-made lace).
    //    Getting: hair accessories (9615), generic tulle (5804.10), or imitation jewelry (7117).
    {
      const existing = allRules.find(r => r.id === 'BRIDAL_VEIL_TULLE_LACE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BRIDAL_VEIL_TULLE_LACE_INTENT',
          description: 'Bridal veils, birdcage veils, tulle wedding accessories → 5804.30 (hand-made lace)',
          pattern: {
            anyOf: [
              // Bridal veils
              'bridal veil', 'bridal veils', 'wedding veil', 'wedding veils',
              'birdcage veil', 'birdcage veils', 'bird cage veil',
              'tulle veil', 'lace veil', 'cathedral veil', 'chapel veil',
              'fingertip veil', 'elbow veil', 'mantilla veil',
              'veil with comb', 'veil with bobby pins',
              // Tulle wedding accessories
              'tulle wedding cape', 'tulle cape wedding', 'bridal cape tulle',
              'tulle skirt wedding', 'tulle wrap wedding',
            ],
            noneOf: [
              // Islamic/religious covering
              'hijab', 'niqab', 'khimar',
              // Non-bridal
              'privacy veil', 'beekeeping veil', 'beekeeper veil',
            ],
          },
          inject: [
            { prefix: '5804.30', syntheticRank: 1 },  // hand-made lace (bridal veils)
            { prefix: '5804.10', syntheticRank: 5 },  // tulles and net fabrics
          ],
          whitelist: {
            allowChapters: ['58'],    // special textile fabrics
            denyChapters: ['96', '71'],  // block hair accessories, jewelry
          },
          boosts: [
            { delta: 0.90, prefixMatch: '5804.30' },
            { delta: 0.60, prefixMatch: '5804.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '9615.' },  // penalize hair accessories
            { delta: 0.80, prefixMatch: '7117.' },  // penalize imitation jewelry
          ],
        } as IntentRule;
        patches.push({ priority: 623, rule: newRule });
        console.log('BRIDAL_VEIL_TULLE_LACE_INTENT: created (→5804.30, denyChapters:[96,71])');
      } else {
        console.log('BRIDAL_VEIL_TULLE_LACE_INTENT: already exists, skipping');
      }
    }

    // 5. NEW GLASS_PACKING_BOTTLE_SPIRIT_INTENT → 7010.90
    //    Glass bottles/jars for packing spirits/beverages → 7010.90 (glass for packing).
    //    Getting: 7013 (table glassware = cups, vases, etc.) which is wrong for bottles.
    //    7010 = carboys, bottles, flasks, jars for packing; 7013 = drinking glassware.
    {
      const existing = allRules.find(r => r.id === 'GLASS_PACKING_BOTTLE_SPIRIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_PACKING_BOTTLE_SPIRIT_INTENT',
          description: 'Glass bottles/jars for spirits/beverages/packing → 7010.90 (glass containers)',
          pattern: {
            anyOf: [
              // Spirit/beverage bottles
              'glass bottle spirits', 'glass spirits bottle', 'glass wine bottle',
              'glass whiskey bottle', 'glass liquor bottle', 'glass beer bottle',
              'glass spirit bottle', 'decanter bottle', 'glass decanter bottle',
              'glass bottle dispenser', 'glass bottle for spirits',
              'clear glass bottle spirits', 'glass apothecary bottle',
              'apothecary jar glass', 'glass treat jar', 'glass mason jar',
              'glass canning jar', 'glass preserving jar', 'glass storage jar',
              'glass herb jar', 'glass spice jar', 'glass candy jar',
              // Generic glass containers
              'glass carboy', 'glass demijohn', 'glass flagon',
            ],
            noneOf: [
              // Drinking vessels (7013)
              'drinking glass', 'wine glass', 'shot glass', 'cocktail glass',
              'pint glass', 'beer glass', 'champagne glass', 'water glass',
              // Decorative glass
              'glass vase', 'glass bowl', 'glass sculpture',
              // Already covered
              'glass water bottle',  // GLASS_WATER_BOTTLE_CONTAINER_INTENT
            ],
          },
          inject: [
            { prefix: '7010.90', syntheticRank: 1 },  // glass containers for packing
            { prefix: '7010.20', syntheticRank: 5 },  // glass stoppers/closures
          ],
          whitelist: {
            allowChapters: ['70'],    // glass chapter
            denyPrefixes: ['7013.'],  // hard-block table glassware
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7010.90' },
            { delta: 0.60, prefixMatch: '7010.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7013.' },  // strong penalty for table glassware
          ],
        } as IntentRule;
        patches.push({ priority: 624, rule: newRule });
        console.log('GLASS_PACKING_BOTTLE_SPIRIT_INTENT: created (→7010.90, denyPrefixes:[7013.])');
      } else {
        console.log('GLASS_PACKING_BOTTLE_SPIRIT_INTENT: already exists, skipping');
      }
    }

    // 6. NEW BED_PILLOW_CUSHION_LINEN_INTENT → 6302.21 / 6302.10
    //    Handmade pillows, pillow cases, bed sheets classified as made-up textile (6307).
    //    6302.21 = bed linen of cotton (includes pillow cases, pillow shams, sheets).
    {
      const existing = allRules.find(r => r.id === 'BED_PILLOW_CUSHION_LINEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BED_PILLOW_CUSHION_LINEN_INTENT',
          description: 'Bed pillows, pillow cases, bed sheets, bed linen → 6302 (household linen)',
          pattern: {
            anyOf: [
              // Pillows
              'bed pillow', 'sleeping pillow', 'pillow case', 'pillow cases',
              'pillowcase', 'pillowcases', 'pillow cover', 'pillow sham',
              'pillow shams', 'standard pillowcase', 'king pillowcase',
              'throw pillow cover', 'decorative pillow cover',
              // Sheets
              'bed sheet', 'bed sheets', 'bed sheet set', 'fitted sheet',
              'flat sheet', 'cotton sheet', 'cotton sheets', 'bed linen set',
              'sheet set cotton', 'cotton bedding set',
              // Duvet/comforter covers
              'duvet cover', 'duvet covers', 'comforter cover',
              'quilt cover', 'bed cover cotton',
            ],
            noneOf: [
              // Actual stuffed pillows (different from covers/cases)
              'pillow insert', 'pillow stuffing', 'down pillow', 'feather pillow',
              'memory foam pillow', 'body pillow insert',
              // Non-bed uses
              'chair cushion', 'floor cushion', 'sofa cushion', 'couch cushion',
              'seat cushion', 'outdoor cushion',
              // Patterns/DIY
              'pillow pattern', 'sewing pattern',
            ],
          },
          inject: [
            { prefix: '6302.21', syntheticRank: 1 },  // bed linen of cotton (not knitted)
            { prefix: '6302.10', syntheticRank: 4 },  // bed linen of cotton (terry)
            { prefix: '6302.31', syntheticRank: 7 },  // bed linen of man-made fibers
          ],
          whitelist: {
            allowChapters: ['63'],  // household textile articles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6302.21' },
            { delta: 0.60, prefixMatch: '6302.' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '6307.' },  // penalize made-up textile articles
            { delta: 0.75, prefixMatch: '6211.' },  // penalize garments
          ],
        } as IntentRule;
        patches.push({ priority: 625, rule: newRule });
        console.log('BED_PILLOW_CUSHION_LINEN_INTENT: created (→6302.21, allowChapters:[63])');
      } else {
        console.log('BED_PILLOW_CUSHION_LINEN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT130)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT130 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
