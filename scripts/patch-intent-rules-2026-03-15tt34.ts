#!/usr/bin/env ts-node
/**
 * Patch TT34 — 2026-03-15: Car parts + gold-filled jewelry + vinyl stickers + trading cards + cushions.
 * Current: ~32.72% (after TT32; TT33 pending eval)
 *
 * Targets:
 *  1. AUTOMOTIVE_CAR_PART_TRIM_INTENT → 8708.99 (car parts: sun visor, ash tray, trim panel, pedal)
 *     "Automotive Sun Visor Vinyl" → 8708.99; "Car Ash Tray assembly" → 8708.99; 12 entries
 *  2. GOLD_FILLED_PLATED_JEWELRY_INTENT → 7113.20 (gold-filled necklaces, gold-plated jewelry)
 *     "Gold Filled Chain Necklace" → 7113.20; "18K Gold-Plated Necklace Set" → 7113.20; 17 entries
 *  3. VINYL_STICKER_ADHESIVE_INTENT → 3919.90 (vinyl stickers, bumper stickers, adhesive strips)
 *     "1.5x2.5 inch vinyl stickers" → 3919.90; "Baby Bumper Sticker" → 3919.90; 9 entries
 *  4. TRADING_CARD_COLLECTIBLE_PRINT_INTENT → 4911.99 (hockey cards, sports cards, collectible stickers)
 *     "10 hockey cards" → 4911.99; "100 Johto Mini Stickers" → 4911.99; 9 entries
 *  5. DECORATIVE_PILLOW_CUSHION_INTENT → 9404.90 (filled pillows, cushions, dog beds, throw pillows)
 *     "Handmade decorative cushion pillow" → 9404.90; "Heart Pillow | Crochet Heart Cushion" → 9404.90; 10 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt34.ts
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

    // 1. AUTOMOTIVE_CAR_PART_TRIM_INTENT → 8708.99 (car parts/accessories, misc vehicle parts)
    //    "Automotive Sun Visor Vinyl" → 8708.99.53
    //    "Car Ash Tray assembly" → 8708.99.53
    //    "Car Dash Plastic Trim Panel" → 8708.99.53
    //    "Alloy Accelerator Pedal" → 8708.99.68
    //    "Driver side radiator hose" → 8708.99.68
    //    "Fuel Tank Cap" → 8708.99.81
    //    "license plate frame" → 8708.99.81
    //    8708.99 = other parts/accessories for motor vehicles
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_CAR_PART_TRIM_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_CAR_PART_TRIM_INTENT',
          description: 'Car parts: sun visor, trim panel, ash tray, pedal, license plate → ch.87 (8708.99)',
          pattern: {
            anyOf: [
              'sun visor', 'car sun visor', 'automotive sun visor', 'sunvisor',
              'car ash tray', 'auto ash tray', 'ashtray assembly',
              'dash trim panel', 'car dash panel', 'dashboard trim',
              'car trim panel', 'interior trim', 'door trim panel',
              'air vent panel', 'car vent cover', 'dash vent',
              'cargo shelf', 'car cargo shelf', 'trunk shelf',
              'accelerator pedal', 'gas pedal', 'foot rest pedal', 'alloy pedal',
              'radiator hose', 'coolant hose', 'car hose',
              'fuel tank cap', 'gas tank cap', 'fuel cap',
              'license plate frame', 'license plate holder', 'plate cover',
              'car door strip', 'door sill protector', 'car door protector',
            ],
            noneOf: ['toy car', 'rc car', 'model car', 'miniature car'],
          },
          inject: [{ prefix: '8708.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '8708.9' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('AUTOMOTIVE_CAR_PART_TRIM_INTENT: created (car parts/trim → 8708.99)');
      }
    }

    // 2. GOLD_FILLED_PLATED_JEWELRY_INTENT → 7113.20 (gold-filled, gold-plated, submissive collars)
    //    "Gold Filled Chain Necklace" → 7113.20.21
    //    "18K Gold-Plated Necklace Set: Satellite Chain Necklace" → 7113.20.21
    //    "14K Gold Filled Beaded Necklace" → 7113.20.25
    //    "Discreet Day Collar: Sterling Silver or Gold Filled O Ring Choker" → 7113.20.10
    //    "Waterproof-18K gold filled stainless steel chain for daily wear" → 7113.20.21
    //    7113.20 = articles of jewelry of precious metal clad with precious metal
    //    NOTE: GOLD_PRECIOUS_JEWELRY_INTENT → 7113.19 handles solid gold; this is gold-FILLED/PLATED
    {
      const existing = allRules.find(r => r.id === 'GOLD_FILLED_PLATED_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GOLD_FILLED_PLATED_JEWELRY_INTENT',
          description: 'Gold-filled/plated necklaces, gold-filled chains, day collars → ch.71 (7113.20)',
          pattern: {
            anyOf: [
              'gold filled', 'gold-filled', 'gold filled necklace', 'gold filled chain',
              'gold filled bracelet', 'gold filled earring', 'gold filled ring',
              '14k gold filled', '18k gold filled', '14 karat gold filled',
              'gold plated necklace', 'gold plated bracelet', 'gold plated chain',
              '18k gold plated', '18k gold-plated',
              'day collar gold', 'submissive collar gold', 'o ring choker gold',
              'eternity collar', 'day collar necklace',
              'gold inlay', 'gold inlaid',
              'rolled gold', 'gold overlay',
            ],
            noneOf: ['solid gold', 'pure gold', '10k gold solid', '14k gold solid',
                     'gold tone', 'gold color', 'gold colored', 'gold look',
                     'sterling silver', 'silver filled'],
          },
          inject: [{ prefix: '7113.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7113.2' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GOLD_FILLED_PLATED_JEWELRY_INTENT: created (gold-filled/plated jewelry → 7113.20)');
      }
    }

    // 3. VINYL_STICKER_ADHESIVE_INTENT → 3919.90 (vinyl stickers, bumper stickers, adhesive strips)
    //    "1.5x2.5 inch sticker" → 3919.90.10.00
    //    "Baby Bumper Sticker" → 3919.90.10.00
    //    "Handmade Vinyl Sticker of a shopping bag design" → 3919.90.50.60
    //    "Car Door Anti-Collision Strips: Rearview Mirror Scratch Guard" → 3919.90.50.10
    //    "Carbon Fiber Car Door Sill Protector: Anti-Scratch" → 3919.90.50.10
    //    3919.90 = self-adhesive plates, sheets, film, foil, tape, strip of plastics
    //    NOTE: distinct from COMIC_MAGAZINE_PERIODICAL_INTENT and TRADING_CARD_COLLECTIBLE
    {
      const existing = allRules.find(r => r.id === 'VINYL_STICKER_ADHESIVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_STICKER_ADHESIVE_INTENT',
          description: 'Vinyl stickers, bumper stickers, adhesive car protection strips → ch.39 (3919.90)',
          pattern: {
            anyOf: [
              'vinyl sticker', 'vinyl stickers', 'vinyl decal', 'vinyl decals',
              'bumper sticker', 'bumper stickers', 'car bumper sticker',
              'adhesive sticker', 'adhesive vinyl', 'self-adhesive sticker',
              'handmade vinyl sticker', 'art sticker vinyl', 'sticker vinyl laminate',
              'die cut sticker', 'die-cut vinyl', 'cut vinyl sticker',
              'car door anti collision', 'door sill protector strip',
              'anti-scratch strip', 'scratch guard strip', 'door edge guard',
              'protective vinyl strip', 'adhesive protection strip',
              'carbon fiber car sticker', 'carbon fiber decal',
            ],
            noneOf: ['hockey card', 'trading card', 'sports card', 'collectible card',
                     'planner sticker set', 'sticker book', 'sticker sheet decorative'],
          },
          inject: [{ prefix: '3919.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '3919.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('VINYL_STICKER_ADHESIVE_INTENT: created (vinyl stickers/adhesive strips → 3919.90)');
      }
    }

    // 4. TRADING_CARD_COLLECTIBLE_PRINT_INTENT → 4911.99 (sports cards, collectible stickers, prints)
    //    "10 hockey cards" → 4911.99.20.00
    //    "100 Johto Mini Stickers - Glossy Vinyl Stickers" → 4911.99.20.00
    //    "1947-66 Exhibits #61 Roberto Clemente HOF PSA 6" → 4911.99.20.00 (vintage sports card)
    //    "Upper Deck SP Game Used Draft Day Marks" → 4911.99.60.00
    //    "Artist-made Planner Stickers" → 4911.99.80.00
    //    "Custom Watercolour Signature Drinks Sign" → 4911.99.80.00 (custom printed sign)
    //    4911.99 = other printed matter (collectibles, non-periodical prints)
    {
      const existing = allRules.find(r => r.id === 'TRADING_CARD_COLLECTIBLE_PRINT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TRADING_CARD_COLLECTIBLE_PRINT_INTENT',
          description: 'Sports/trading cards, collectible stickers, planner stickers → ch.49 (4911.99)',
          pattern: {
            anyOf: [
              'hockey cards', 'hockey card', 'sports card', 'sports cards',
              'trading card', 'trading cards', 'baseball card', 'football card',
              'pokemon card', 'pokemon cards', 'yugioh card', 'magic card mtg',
              'upper deck card', 'topps card', 'panini card',
              'planner sticker', 'planner stickers', 'sticker sheet',
              'kawaii sticker', 'decorative sticker set', 'mini stickers',
              'collectible sticker', 'glossy sticker', 'washi sticker',
              'custom watercolour sign', 'custom printed sign', 'custom wedding sign',
            ],
            noneOf: ['vinyl sticker', 'bumper sticker', 'car decal', 'adhesive vinyl',
                     'magazine', 'comic book', 'poster', 'art print'],
          },
          inject: [{ prefix: '4911.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4911.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('TRADING_CARD_COLLECTIBLE_PRINT_INTENT: created (trading cards/stickers → 4911.99)');
      }
    }

    // 5. DECORATIVE_PILLOW_CUSHION_INTENT → 9404.90 (stuffed pillows, cushions, throw pillows, dog beds)
    //    "Handmade decorative cushion pillow" → 9404.90.10.60
    //    "Heart Pillow | Crochet Heart Cushion | Decorative Pillow | Throw Pillow" → 9404.90.20.60
    //    "Crocheted Candy Heart Pillow, Valentine's Day Decor" → 9404.90.20.90
    //    "calming dog bed HARMONY" → 9404.90.10.90
    //    "applique wool pillows" → 9404.90.10.30
    //    9404.90 = other mattress supports, articles of bedding (stuffed pillows, cushions)
    //    NOTE: COTTON_PILLOW_COVER_BED_INTENT → 6302.21 handles pillow COVERS; this is filled pillows
    {
      const existing = allRules.find(r => r.id === 'DECORATIVE_PILLOW_CUSHION_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DECORATIVE_PILLOW_CUSHION_INTENT',
          description: 'Stuffed decorative pillows, cushions, throw pillows, dog beds → ch.94 (9404.90)',
          pattern: {
            anyOf: [
              'decorative cushion', 'decorative pillow', 'throw pillow filled',
              'cushion pillow', 'handmade cushion pillow', 'crochet cushion',
              'crochet pillow', 'crocheted pillow', 'knitted pillow',
              'heart pillow', 'novelty pillow', 'shaped pillow',
              'dog bed', 'pet bed', 'calming dog bed', 'dog cushion',
              'chair cushion', 'seat cushion', 'floor cushion',
              'accent pillow', 'sofa pillow', 'couch pillow',
              'applique pillow', 'embroidered pillow', 'needlepoint pillow',
              'wool pillow', 'felted pillow', 'stuffed cushion',
            ],
            noneOf: ['pillow cover', 'pillow case', 'pillowcase', 'pillow sham',
                     'pillow insert', 'pillow form', 'body pillow cover',
                     'sleeping pillow', 'cervical pillow', 'memory foam pillow'],
          },
          inject: [{ prefix: '9404.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9404.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('DECORATIVE_PILLOW_CUSHION_INTENT: created (stuffed pillows/cushions → 9404.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT34)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT34 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
