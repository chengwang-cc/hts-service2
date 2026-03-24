#!/usr/bin/env ts-node
/**
 * Patch TT132 — 2026-03-18:
 *
 * Fix 1: NEW CRUSHED_GEMSTONE_DUST_CRAFT_INTENT → 7105.90
 *   "Crushed stone for inlaying and crafting" → 2516.20 WRONG (expected 7105.90.00.00)
 *   "Fine size - Crushed Bello Opal for inlaying and crafting" → 7105.10 WRONG (expected 7105.90)
 *   Root cause: "crushed stone" → quartzite/sandstone codes (2516). But crushed gemstone/opal
 *   for crafting = dust/powder/chips of precious/semi-precious stones (7105.90).
 *
 * Fix 2: NEW VIDEO_GAME_CONSOLE_ACCESSORY_CABLE_INTENT → 9504.50
 *   "1 - MAD CATZ Gamecube Platform Link Cable" → 8544.42 WRONG (expected 9504.50.00.00)
 *   Root cause: "link cable" → electrical conductors (8544). Video game console cables/accessories → 9504.50.
 *
 * Fix 3: NEW PINBALL_BILLIARD_ARCADE_MACHINE_INTENT → 9504.20
 *   "Pinball Playfield for 1988 Gottlieb Bad Girls" → 6108.22 WRONG (expected 9504.20.80.00)
 *   Root cause: "Girls" in product name → women's underwear. Pinball/billiard parts → 9504.20.
 *
 * Fix 4: UPDATE WOODEN_KITCHEN_ORGANIZER_INTENT — add spice rack patterns
 *   "Handmade wooden spice rack for kitchen, made in Canada" → 4419.11 WRONG (expected 9403.60.40.00)
 *   Root cause: "spice rack" not in anyOf; getting kitchen utensils (4419).
 *
 * Fix 5: NEW METAL_WALL_ART_SIGN_DECOR_INTENT → 9403.20
 *   "wall art metal tin small 12x5 x0.25 inches." → 8001.20 WRONG (expected 9403.20.00.50)
 *   Root cause: "metal tin" → tin/metal alloy codes. Wall art = other metal furniture (9403.20).
 *
 * Fix 6: NEW TISSUE_CREPE_CRAFT_PAPER_INTENT → 4803
 *   "Cotton Tissue Set" → 4818.20 WRONG (expected 4803.00.40.00)
 *   Root cause: "tissue" → toilet/facial paper (4818). Cotton tissue paper for crafts → 4803.
 *
 * Fix 7: NEW TOY_GAME_PLASTIC_DEVICE_INTENT → 9504.90.40
 *   "Custom Plastic Umpire 4-dial Indicator" → 3926.20 WRONG (expected 9504.90.40.00)
 *   "Toy pinball game, plastic" → 9504.30 WRONG (expected 9504.90.40.00)
 *   Root cause: Plastic sports/toy indicators → plastic articles (3926) or video game (9504.30).
 *   9504.90.40 = "game equipment" for ball/other games (non-video).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-18tt132.ts
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

    // 1. NEW CRUSHED_GEMSTONE_DUST_CRAFT_INTENT → 7105.90
    {
      const existing = allRules.find(r => r.id === 'CRUSHED_GEMSTONE_DUST_CRAFT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CRUSHED_GEMSTONE_DUST_CRAFT_INTENT',
          description: 'Crushed gemstones/opal/turquoise for crafting → 7105.90 (dust/powder of precious stones)',
          pattern: {
            anyOf: [
              // Crushed gemstones
              'crushed stone for inlaying', 'crushed stone inlaying', 'crushed stone inlay',
              'crushed gemstone', 'crushed gem stone', 'crushed precious stone',
              'crushed semi precious', 'crushed semi-precious',
              // Specific crushed materials for craft
              'crushed opal', 'crushed turquoise', 'crushed malachite',
              'crushed lapis', 'crushed obsidian', 'crushed jasper',
              'crushed crystal', 'crushed quartz', 'crushed garnet',
              'crushed amethyst', 'crushed howlite',
              // Dust/powder forms
              'gemstone dust', 'gemstone powder', 'gemstone chips',
              'gem chips craft', 'stone dust inlay', 'stone powder craft',
              'stone chips inlaying', 'mineral inlay craft',
            ],
            noneOf: [
              // Diamond dust (7105.10)
              'diamond dust', 'diamond powder', 'diamond grit',
              // Construction aggregate (not craft)
              'construction aggregate', 'road aggregate', 'concrete aggregate',
              // Gravel
              'gravel driveway', 'pea gravel',
            ],
          },
          inject: [
            { prefix: '7105.90', syntheticRank: 1 },  // dust/powder/chips of precious/semi-precious (other)
            { prefix: '7103.99', syntheticRank: 5 },  // worked semi-precious stones
          ],
          whitelist: {
            allowChapters: ['71'],   // precious metals and stones chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7105.90' },
            { delta: 0.60, prefixMatch: '7105.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '2516.' },  // strong penalty for quartzite/stone (building)
            { delta: 0.85, prefixMatch: '2517.' },  // pebbles/gravel
          ],
        } as IntentRule;
        patches.push({ priority: 641, rule: newRule });
        console.log('CRUSHED_GEMSTONE_DUST_CRAFT_INTENT: created (→7105.90, allowChapters:[71])');
      } else {
        console.log('CRUSHED_GEMSTONE_DUST_CRAFT_INTENT: already exists, skipping');
      }
    }

    // 2. NEW VIDEO_GAME_CONSOLE_ACCESSORY_CABLE_INTENT → 9504.50
    {
      const existing = allRules.find(r => r.id === 'VIDEO_GAME_CONSOLE_ACCESSORY_CABLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VIDEO_GAME_CONSOLE_ACCESSORY_CABLE_INTENT',
          description: 'Video game console accessories (cables, controllers, adapters) → 9504.50',
          pattern: {
            anyOfGroups: [
              // Must mention a game console
              ['gamecube', 'game cube', 'nintendo 64', 'n64', 'playstation', 'ps2', 'ps3', 'ps4',
               'xbox', 'sega genesis', 'dreamcast', 'atari 2600', 'super nintendo', 'nes',
               'game boy', 'gameboy', 'nintendo switch', 'wii'],
              // AND must mention a cable/accessory
              ['link cable', 'av cable', 'video cable', 'composite cable', 'component cable',
               'hdmi cable', 's-video cable', 'rf cable', 'power supply adapter', 'ac adapter',
               'controller cable', 'extension cable', 'game cable', 'console cable',
               'platform cable', 'connection cable'],
            ],
          },
          inject: [
            { prefix: '9504.50', syntheticRank: 1 },  // video game consoles/accessories
            { prefix: '9504.30', syntheticRank: 5 },  // video games (fallback)
          ],
          whitelist: {
            allowChapters: ['95'],  // only amusement/games chapter
            denyChapters: ['85'],   // block electrical conductors chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9504.50' },
            { delta: 0.50, prefixMatch: '9504.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '8544.' },  // penalize insulated wire/cable
          ],
        } as IntentRule;
        patches.push({ priority: 642, rule: newRule });
        console.log('VIDEO_GAME_CONSOLE_ACCESSORY_CABLE_INTENT: created (→9504.50, denyChapters:[85])');
      } else {
        console.log('VIDEO_GAME_CONSOLE_ACCESSORY_CABLE_INTENT: already exists, skipping');
      }
    }

    // 3. NEW PINBALL_BILLIARD_ARCADE_MACHINE_INTENT → 9504.20
    {
      const existing = allRules.find(r => r.id === 'PINBALL_BILLIARD_ARCADE_MACHINE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PINBALL_BILLIARD_ARCADE_MACHINE_INTENT',
          description: 'Pinball machines, billiards/pool tables and parts → 9504.20',
          pattern: {
            anyOf: [
              // Pinball
              'pinball playfield', 'pinball machine', 'pinball cabinet',
              'pinball board', 'pinball part', 'pinball assembly',
              'pinball playfield board', 'pinball flipper', 'pinball bumper',
              'pinball rom', 'pinball game machine',
              // Billiards/pool
              'billiard pocket', 'billiards pocket', 'pool pocket',
              'billiard table part', 'pool table part', 'billiard ball',
              'pool ball set', 'billiard cue', 'pool cue', 'cue ball',
              '8 ball pool', 'billiard chalk', 'pool table slate',
            ],
            noneOf: [
              // Pool as in swimming
              'swimming pool', 'pool cleaner', 'pool pump',
              // Non-billiards games
              'foosball', 'air hockey',
            ],
          },
          inject: [
            { prefix: '9504.20', syntheticRank: 1 },  // billiards, bagatelle, table games (incl. pinball)
            { prefix: '9504.90', syntheticRank: 6 },  // other game articles
          ],
          whitelist: {
            allowChapters: ['95'],  // only games chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9504.20' },
            { delta: 0.60, prefixMatch: '9504.' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '6108.' },  // penalize women's garments
            { delta: 0.80, prefixMatch: '3926.' },  // penalize plastic articles
          ],
        } as IntentRule;
        patches.push({ priority: 643, rule: newRule });
        console.log('PINBALL_BILLIARD_ARCADE_MACHINE_INTENT: created (→9504.20, allowChapters:[95])');
      } else {
        console.log('PINBALL_BILLIARD_ARCADE_MACHINE_INTENT: already exists, skipping');
      }
    }

    // 4. UPDATE WOODEN_KITCHEN_ORGANIZER_INTENT — add spice rack
    {
      const existing = allRules.find(r => r.id === 'WOODEN_KITCHEN_ORGANIZER_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addAnyOf = [
          'spice rack', 'spice rack wood', 'wooden spice rack', 'wood spice rack',
          'spice shelf', 'spice organizer', 'herb rack wood', 'wooden herb rack',
          'wall spice rack', 'countertop spice rack', 'spice rack shelf',
          'bamboo spice rack', 'kitchen spice rack wood',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('WOODEN_KITCHEN_ORGANIZER_INTENT: added spice rack phrases');
      } else {
        console.log('WOODEN_KITCHEN_ORGANIZER_INTENT: not found');
      }
    }

    // 5. NEW METAL_WALL_ART_SIGN_DECOR_INTENT → 9403.20
    //    Metal wall art / tin signs / metal plaques = other metal furniture (9403.20).
    //    Getting: tin alloy codes (8001/8007) due to "tin" token.
    {
      const existing = allRules.find(r => r.id === 'METAL_WALL_ART_SIGN_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'METAL_WALL_ART_SIGN_DECOR_INTENT',
          description: 'Metal wall art, tin signs, metal plaques, wall shelves → 9403.20 (other metal furniture)',
          pattern: {
            anyOf: [
              // Metal wall art
              'wall art metal', 'metal wall art', 'metal wall sign', 'tin wall sign',
              'metal tin sign', 'wall art tin', 'decorative metal sign',
              'vintage metal sign', 'retro metal sign', 'antique metal sign',
              'metal plaque', 'metal wall plaque', 'metal wall decor',
              'metal wall hanging', 'hanging metal sign', 'metal art wall',
              // Wall-mounted shelves
              'wall shelf wood metal', 'metal wall shelf', 'floating shelf metal',
            ],
            noneOf: [
              // Functional signs (not decorative art)
              'road sign', 'street sign', 'traffic sign', 'safety sign',
              'outdoor signage', 'business sign', 'neon sign',
            ],
          },
          inject: [
            { prefix: '9403.20', syntheticRank: 1 },  // other metal furniture (wall art/shelves)
            { prefix: '8306.29', syntheticRank: 5 },  // statuettes/decorative articles of metal
          ],
          whitelist: {
            allowChapters: ['94', '83'],  // furniture or metal articles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '9403.20' },
            { delta: 0.60, prefixMatch: '8306.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8001.' },  // strong penalty for tin/tin alloy
            { delta: 0.90, prefixMatch: '8007.' },  // tin alloy articles
            { delta: 0.85, prefixMatch: '7310.' },  // steel containers
          ],
        } as IntentRule;
        patches.push({ priority: 644, rule: newRule });
        console.log('METAL_WALL_ART_SIGN_DECOR_INTENT: created (→9403.20, denyTinAlloy)');
      } else {
        console.log('METAL_WALL_ART_SIGN_DECOR_INTENT: already exists, skipping');
      }
    }

    // 6. NEW TISSUE_CREPE_CRAFT_PAPER_INTENT → 4803
    //    Cotton tissue paper, crepe paper for crafts = 4803 (not 4818 toilet paper).
    {
      const existing = allRules.find(r => r.id === 'TISSUE_CREPE_CRAFT_PAPER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TISSUE_CREPE_CRAFT_PAPER_INTENT',
          description: 'Tissue paper/crepe paper for crafts, wrapping, etc. → 4803 (not toilet paper)',
          pattern: {
            anyOf: [
              // Craft tissue paper
              'tissue paper', 'tissue papers', 'gift tissue paper', 'wrapping tissue paper',
              'colored tissue paper', 'coloured tissue paper', 'craft tissue paper',
              'pom pom tissue paper', 'flower tissue paper', 'bulk tissue paper',
              'cotton tissue', 'cotton tissue paper', 'cotton tissue set',
              // Crepe paper
              'crepe paper', 'crepe papers', 'craft crepe paper', 'crepe paper ribbon',
              'crepe paper roll', 'crepe streamers', 'crepe paper streamer',
            ],
            noneOf: [
              // Facial tissue / toilet paper (4818)
              'facial tissue', 'facial tissues', 'kleenex', 'nose tissue',
              'toilet paper', 'bathroom tissue', 'hygiene tissue',
              // Paper towels
              'paper towel', 'paper towels', 'kitchen towel paper',
            ],
          },
          inject: [
            { prefix: '4803.00', syntheticRank: 1 },  // toilet/facial tissue and similar paper (4803)
            { prefix: '4823.90', syntheticRank: 6 },  // other paper/paperboard articles
          ],
          whitelist: {
            allowChapters: ['48'],  // paper chapter
          },
          boosts: [
            { delta: 0.85, prefixMatch: '4803.' },
            { delta: 0.60, prefixMatch: '4803.00' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '4818.' },  // penalize household toilet paper
            { delta: 0.75, prefixMatch: '4802.' },  // penalize uncoated paper
          ],
        } as IntentRule;
        patches.push({ priority: 645, rule: newRule });
        console.log('TISSUE_CREPE_CRAFT_PAPER_INTENT: created (→4803, allowChapters:[48])');
      } else {
        console.log('TISSUE_CREPE_CRAFT_PAPER_INTENT: already exists, skipping');
      }
    }

    // 7. UPDATE WOODEN_KITCHEN_ORGANIZER_INTENT — route spice rack to 9403.60
    //    (spice racks are kitchen furniture, not utensils)
    //    (Already handled above by adding to anyOf - the rule already injects 9403.60)

    console.log(`\nApplying ${patches.length} rule patches (batch TT132)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT132 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
