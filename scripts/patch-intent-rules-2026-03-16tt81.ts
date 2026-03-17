#!/usr/bin/env ts-node
/**
 * Patch TT81 — 2026-03-16: Fridge magnets, wooden display stands, natural stones, board game overlays.
 *
 * Fixes:
 *  1. UPDATE FRIDGE_MAGNET_SOUVENIR_INTENT — add 'fridge plastic magnet', 'vintage fridge magnet'
 *     "Arizona vintage fridge plastic magn" → 3926 (ch.39!) WRONG (expected 8505.11)
 *     BUG: 'fridge magn' doesn't match "fridge plastic magn" (non-contiguous - "plastic" between)
 *     FIX: Add 'fridge plastic magnet', 'vintage fridge magnet' etc.
 *
 *  2. NEW WOODEN_PLACE_CARD_HOLDER_INTENT → 4421/4415 (wooden articles)
 *     "Extra Large Double Groove Wood Stand / Place Card" → 9504 WRONG (expected 4404.20)
 *     BUG: "place card" or "card" triggers game-related intent → ch.95
 *     4421 = other articles of wood; 4415 = packing cases/pallets of wood
 *     FIX: New intent for wooden place card holders, menu holders, name card stands → 4421
 *
 *  3. NEW NATURAL_GEM_STONE_RAW_INTENT → 2516/2506 (mineral/stone chapter)
 *     "natural agate slice" → 7103.91 WRONG (expected 2506.20)
 *     "TERMINATED WHITE QUARTZ POINT" → 7103.99 WRONG (expected 2516.11)
 *     "Genuine Crushed Stone" → 7103/7105 WRONG (expected 2516.20)
 *     BUG: "agate", "quartz", "stone" → precious stones (ch.71); raw/natural = ch.25
 *     2506 = quartz (natural); 2516 = granite/sandstone/other stone (worked)
 *     FIX: New intent for raw/uncut/crushed natural stones → ch.25, deny ch.71
 *
 *  4. NEW BOARD_GAME_PLASTIC_INSERT_INTENT → 3920.59/3926.90 (plastic sheets/articles)
 *     "4 Overlays WITHOUT BACKBOARDS for the Clans of Caledonia player board" → 4202 WRONG
 *     "5pcs Terraforming Mars player board acrylic overlays" → 4202 WRONG (expected 3920.59)
 *     BUG: "overlays" + "player board" → travel goods/bags (ch.42)?
 *     3920.59 = other plastic sheets (not cellular); 3926.90 = other plastic articles
 *     FIX: New intent for board game acrylic/plastic overlays and inserts → 3920, deny ch.42
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt81.ts
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

    // 1. UPDATE FRIDGE_MAGNET_SOUVENIR_INTENT — add non-contiguous fridge magnet phrases
    //    "Arizona vintage fridge plastic magn" → 3926 WRONG
    //    BUG: "fridge plastic magn" doesn't contain "fridge magn" (non-contiguous)
    {
      const existing = allRules.find(r => r.id === 'FRIDGE_MAGNET_SOUVENIR_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Fridge magnet with material qualifiers between words
          'fridge plastic magnet', 'fridge metal magnet', 'fridge magnet plastic',
          // Vintage/antique fridge magnets
          'vintage fridge magnet', 'vintage refrigerator magnet', 'retro fridge magnet',
          // Souvenir magnets by material
          'souvenir plastic magnet', 'souvenir metal magnet',
          // Promotional/custom magnets
          'promotional magnet', 'business card magnet', 'logo magnet',
          // Collectible magnets
          'collectible magnet', 'tourist magnet', 'city souvenir magnet',
          // Photo/picture magnets with material
          'photo magnet plastic', 'picture magnet resin',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 569, rule: updated });
        console.log('FRIDGE_MAGNET_SOUVENIR_INTENT: added vintage/plastic fridge magnet phrases');
      } else {
        console.log('FRIDGE_MAGNET_SOUVENIR_INTENT: not found');
      }
    }

    // 2. NEW WOODEN_PLACE_CARD_HOLDER_INTENT → 4421 (wooden articles)
    //    "Extra Large Double Groove Wood Stand / Place Card, Business Card" → 9504 WRONG
    //    BUG: "card" triggers card/game intent → ch.95 (games)
    //    4421 = other articles of wood; includes display items, place card holders
    //    FIX: New intent for wooden card holders, menu holders, display stands → 4421
    {
      const existing = allRules.find(r => r.id === 'WOODEN_PLACE_CARD_HOLDER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_PLACE_CARD_HOLDER_INTENT',
          description: 'Wooden place card holders, menu stands, business card holders → 4421 (wooden articles)',
          pattern: {
            anyOf: [
              // Place card holders/stands
              'place card holder', 'place card holders', 'place card stand',
              'wood place card', 'wooden place card',
              // Business card stands/holders (table display)
              'business card holder wood', 'business card stand wood',
              'wood business card stand', 'wooden business card holder',
              'wooden card display', 'wood card display',
              // Menu holders/stands
              'wooden menu holder', 'wood menu holder', 'wooden menu stand',
              'wood menu stand', 'table number holder wood', 'table number stand wood',
              // Table number/display stands
              'double groove wood stand', 'groove wood stand',
              // Sign holders
              'wood sign holder', 'wooden sign holder', 'wood sign stand',
              // Wedding display items (wood)
              'wood escort card', 'wooden escort card', 'wedding wood stand',
            ],
            noneOf: [
              // Exclude card games
              'card game', 'playing card', 'tarot card',
              // Exclude plastic holders
              'plastic card holder', 'acrylic card holder',
            ],
          },
          inject: [
            { prefix: '4421.91', syntheticRank: 2 },  // other articles of wood
            { prefix: '4421.99', syntheticRank: 5 },  // other articles of wood (other)
            { prefix: '4415.10', syntheticRank: 8 },  // boxes, cases, crates of wood
          ],
          whitelist: {
            allowChapters: ['44', '39'],              // wood articles OR plastic
            denyChapters: ['95', '85', '84'],         // deny games/toys, electrical, machinery
          },
          boosts: [
            { delta: 0.80, prefixMatch: '4421.' },
            { delta: 0.40, chapterMatch: '44' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '95' },      // penalize games/toys
          ],
        } as IntentRule;
        patches.push({ priority: 559, rule: newRule });
        console.log('WOODEN_PLACE_CARD_HOLDER_INTENT: created (place card stands → 4421, deny ch.95)');
      } else {
        console.log('WOODEN_PLACE_CARD_HOLDER_INTENT: already exists, skipping');
      }
    }

    // 3. NEW NATURAL_GEM_STONE_RAW_INTENT → ch.25 (mineral products)
    //    "natural agate slice" → 7103.91 WRONG (expected 2506.20)
    //    "TERMINATED WHITE QUARTZ POINT" → 7103.99 WRONG (expected 2516.11)
    //    "Genuine Crushed Stone" → 7105 WRONG (expected 2516.20)
    //    "Genuine Crushed Stone inlays" → 7103 WRONG (expected 2516.20)
    //    BUG: "agate", "quartz", "stone" → ch.71 (precious/semi-precious stones)
    //    Raw minerals without gemstone processing = ch.25 (mineral products)
    //    2506.10/20 = quartz; 2516.11/12/20/90 = granite/sandstone/etc
    //    Key distinction: if raw/natural/crushed/unworked → ch.25; cut/faceted/polished → ch.71
    {
      const existing = allRules.find(r => r.id === 'NATURAL_STONE_RAW_MINERAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'NATURAL_STONE_RAW_MINERAL_INTENT',
          description: 'Raw/natural/crushed mineral stones (agate, quartz, granite) → ch.25 (mineral products)',
          pattern: {
            anyOf: [
              // Raw agate
              'natural agate', 'agate slice', 'agate slices', 'agate slab',
              'raw agate', 'rough agate', 'agate geode', 'agate nodule',
              // Raw quartz
              'quartz point', 'quartz crystal point', 'terminated quartz',
              'raw quartz', 'rough quartz', 'quartz cluster', 'quartz specimen',
              'natural quartz', 'quartz points', 'amethyst cluster',
              'amethyst geode', 'amethyst points', 'amethyst raw',
              // Crushed stone / stone inlays
              'crushed stone', 'crushed stones', 'stone inlay', 'stone inlays',
              'crushed rock', 'powdered stone', 'stone dust',
              // Raw minerals/rocks
              'mineral specimen', 'rock specimen', 'raw mineral', 'rough mineral',
              'raw crystal', 'rough crystal', 'natural crystal specimen',
              // Stone chips/gravel
              'stone chips', 'stone chip inlay', 'turquoise inlay',
              'malachite inlay', 'lapis inlay', 'shell inlay',
            ],
            noneOf: [
              // Exclude cut/faceted gemstones (ch.71)
              'gemstone', 'faceted', 'precious stone', 'semi-precious',
              'cut stone', 'polished gemstone',
              // Exclude finished jewelry
              'necklace', 'bracelet', 'ring', 'earring', 'pendant',
              // Exclude stone countertops/tiles (construction)
              'granite countertop', 'marble tile', 'stone tile',
            ],
          },
          inject: [
            { prefix: '2506.10', syntheticRank: 2 },  // quartz (natural sands)
            { prefix: '2516.11', syntheticRank: 4 },  // granite crude/roughly trimmed
            { prefix: '2516.20', syntheticRank: 6 },  // sandstone/other stone
            { prefix: '2516.90', syntheticRank: 8 },  // other stone
          ],
          whitelist: {
            allowChapters: ['25', '26'],              // mineral products
            denyChapters: ['71'],                     // deny precious stones
          },
          boosts: [
            { delta: 0.80, prefixMatch: '2516.' },
            { delta: 0.75, prefixMatch: '2506.' },
            { delta: 0.40, chapterMatch: '25' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '71' },      // penalize precious stones
          ],
        } as IntentRule;
        patches.push({ priority: 558, rule: newRule });
        console.log('NATURAL_STONE_RAW_MINERAL_INTENT: created (raw agate/quartz/stone → ch.25, deny ch.71)');
      } else {
        console.log('NATURAL_STONE_RAW_MINERAL_INTENT: already exists, skipping');
      }
    }

    // 4. NEW BOARD_GAME_PLASTIC_INSERT_INTENT → 3920.59/3926.90 (plastic sheets/articles)
    //    "4 Overlays WITHOUT BACKBOARDS for the Clans of Caledonia" → 4202 WRONG
    //    "5pcs Terraforming Mars player board acrylic overlays" → 4202 WRONG (expected 3920.59)
    //    BUG: "overlays" + "player board" context pulls to travel goods (ch.42)
    //    3920.59 = other plastic sheets (not expanded/reinforced); 3926.90 = other plastic articles
    {
      const existing = allRules.find(r => r.id === 'BOARD_GAME_PLASTIC_INSERT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BOARD_GAME_PLASTIC_INSERT_INTENT',
          description: 'Board game plastic overlays, inserts, player board accessories → 3920/3926',
          pattern: {
            anyOf: [
              // Board game overlays
              'player board overlay', 'player board overlays',
              'game board overlay', 'game overlay', 'board game overlay',
              'board overlay', 'board overlays', 'game board insert',
              // Acrylic overlays/inserts
              'acrylic overlay', 'acrylic overlays', 'acrylic insert',
              'acrylic inserts', 'acrylic player board',
              'plastic overlay', 'plastic overlays',
              // Board game specific
              'board game insert', 'board game inserts', 'game box insert',
              'meeple token', 'resource token acrylic',
              // Player accessories
              'player board acrylic', 'dashboard overlay', 'dashboard insert',
              'game dashboard', 'player dashboard acrylic',
            ],
            noneOf: [
              // Exclude actual board games
              'complete game', 'board game complete',
              // Exclude overlays in other contexts (road/construction)
              'road overlay', 'asphalt overlay',
            ],
          },
          inject: [
            { prefix: '3920.59', syntheticRank: 2 },  // other plastic sheets
            { prefix: '3926.90', syntheticRank: 5 },  // other plastic articles
            { prefix: '3920.10', syntheticRank: 8 },  // sheets of polymers of ethylene
          ],
          whitelist: {
            allowChapters: ['39', '95', '44'],        // plastic OR games OR wood
            denyChapters: ['42', '48', '49'],         // deny bags/cases, paper, printed matter
          },
          boosts: [
            { delta: 0.80, prefixMatch: '3920.' },
            { delta: 0.65, prefixMatch: '3926.' },
            { delta: 0.40, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '42' },      // penalize bags
          ],
        } as IntentRule;
        patches.push({ priority: 557, rule: newRule });
        console.log('BOARD_GAME_PLASTIC_INSERT_INTENT: created (game overlays → 3920, deny ch.42)');
      } else {
        console.log('BOARD_GAME_PLASTIC_INSERT_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT81)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT81 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
