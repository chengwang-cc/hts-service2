#!/usr/bin/env ts-node
/**
 * Patch TT125 — 2026-03-16: Wooden kitchenware, copper/brass articles, incense holders,
 *   snow goggles, artist brushes, ratchets, camera filters, multitools, glass containers.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt125.ts
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

    // 1. WOODEN_KITCHEN_UTENSIL_INTENT → 4419.20.10/90 (wooden/bamboo cooking utensils)
    //    "Cookie Molds Wooden" → 3926.10 WRONG (expected 4419.20.10.00)
    //    "Wooden Kitchen Spoon" → 8215.99 WRONG (expected 4419.20.90.00)
    //    "100% Teak Snack Bowl" → 6912 WRONG (expected 4419.20.90.00)
    {
      const existing = allRules.find(r => r.id === 'WOODEN_KITCHEN_UTENSIL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_KITCHEN_UTENSIL_INTENT',
          description: 'Wooden/bamboo kitchen utensils/tableware → 4419.20 (cooking/kitchen ware)',
          pattern: {
            anyOf: [
              'wooden cookie mold', 'cookie molds wooden', 'wood cookie mold',
              'wooden kitchen spoon', 'wood kitchen spoon', 'wooden spoon',
              'wooden ladle', 'wood ladle', 'wooden spatula', 'wood spatula',
              'wooden cooking utensil', 'wood cooking utensil',
              'teak snack bowl', 'teak bowl', 'teak salad bowl',
              'wooden salad bowl', 'wood salad bowl', 'wooden serving bowl',
              'bamboo spoon', 'bamboo ladle', 'bamboo spatula',
              'bamboo kitchen utensil', 'bamboo cooking utensil',
              'wooden mortar pestle', 'wood mortar pestle',
              'bamboo cutting board', 'bamboo chopping board',
              'wooden rolling pin', 'wood rolling pin',
            ],
            noneOf: [
              'plastic', 'stainless', 'silicone spoon', 'rubber spatula',
            ],
          },
          inject: [
            { prefix: '4419.20.10', syntheticRank: 1 },  // cooking/kitchen ware of bamboo/wood
            { prefix: '4419.20.90', syntheticRank: 2 },  // other tableware/kitchenware
            { prefix: '4419.19', syntheticRank: 5 },     // other wood tableware
          ],
          whitelist: {
            allowChapters: ['44'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4419.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '8215.' },  // penalize kitchen implements (non-wood)
            { delta: 0.80, prefixMatch: '6912.' },  // penalize ceramic
            { delta: 0.80, prefixMatch: '3926.' },  // penalize plastic articles
          ],
        } as IntentRule;
        patches.push({ priority: 661, rule: newRule });
        console.log('WOODEN_KITCHEN_UTENSIL_INTENT: created (→4419.20)');
      } else {
        console.log('WOODEN_KITCHEN_UTENSIL_INTENT: already exists, skipping');
      }
    }

    // 2. WOODEN_KITCHEN_ORGANIZER_INTENT → 4419.90.91 (wood racks/organizers/trivets)
    //    "magnetic rack wood" → 4420.11 WRONG (expected 4419.90.91.00)
    //    "drawer organizers wood" → 4420.90 WRONG (expected 4419.90.91.00)
    //    "Large Patchwork Flowers Trivet" → 0603 (fresh flowers!) WRONG (expected 4419.90.91.00)
    {
      const existing = allRules.find(r => r.id === 'WOODEN_KITCHEN_ORGANIZER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_KITCHEN_ORGANIZER_INTENT',
          description: 'Wooden kitchen organizers/trivets/racks → 4419.90.91 (other wood articles)',
          pattern: {
            anyOf: [
              'magnetic rack wood', 'wood magnetic rack', 'wooden magnetic rack',
              'drawer organizer wood', 'wooden drawer organizer', 'wood drawer organizer',
              'wood trivet', 'wooden trivet', 'bamboo trivet',
              'wood kitchen rack', 'wooden kitchen rack', 'wood plate rack',
              'wooden soap dish', 'wood soap dish', 'bamboo soap dish',
              'wood spice rack', 'wooden spice rack', 'wood paper towel holder',
              'wooden toilet paper holder', 'wood toilet paper holder',
            ],
            noneOf: [
              'metal rack', 'stainless rack', 'plastic rack',
            ],
          },
          inject: [
            { prefix: '4419.90.91', syntheticRank: 1 },  // other wood articles for kitchen
            { prefix: '4419.19', syntheticRank: 4 },     // other wood tableware
          ],
          whitelist: {
            allowChapters: ['44'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '4419.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '4420.' },  // penalize wooden decorative articles
            { delta: 0.80, prefixMatch: '0603.' },  // penalize fresh cut flowers
            { delta: 0.75, prefixMatch: '4818.' },  // penalize paper products
          ],
        } as IntentRule;
        patches.push({ priority: 662, rule: newRule });
        console.log('WOODEN_KITCHEN_ORGANIZER_INTENT: created (→4419.90.91)');
      } else {
        console.log('WOODEN_KITCHEN_ORGANIZER_INTENT: already exists, skipping');
      }
    }

    // 3. COPPER_BRASS_TABLE_ARTICLE_INTENT → 7418.10 (copper articles for table/kitchen use)
    //    "Vintage Metal Serving Tray" → 7323.91 WRONG (expected 7418.10.00.23)
    //    "Antique Brass Oval Tray" → 7419.80 WRONG (expected 7418.10.00.25)
    //    "Antique Brass Rectangular Dish" → 6911 WRONG (expected 7418.10.00.25)
    //    "Antique Design Brass Cookie Box" → 1905 (biscuits!) WRONG (expected 7418.10.00.25)
    {
      const existing = allRules.find(r => r.id === 'COPPER_BRASS_TABLE_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COPPER_BRASS_TABLE_ARTICLE_INTENT',
          description: 'Copper/brass trays, dishes, decorative table articles → 7418.10',
          pattern: {
            anyOf: [
              'brass tray', 'copper tray', 'brass serving tray', 'copper serving tray',
              'vintage brass tray', 'antique brass tray', 'vintage metal serving tray',
              'antique metal tray', 'brass dish', 'copper dish', 'brass oval tray',
              'brass rectangular dish', 'brass cookie box', 'brass box',
              'copper bowl decorative', 'brass bowl decorative', 'brass platter',
              'copper platter', 'antique brass dish', 'brass decorative tray',
              'brass trinket tray', 'copper trinket tray', 'brass catchall tray',
            ],
            noneOf: [
              'stainless', 'tin tray', 'aluminum tray', 'silver tray',
              'wooden tray', 'plastic tray', 'enamel tray',
            ],
          },
          inject: [
            { prefix: '7418.10', syntheticRank: 1 },  // copper table/kitchen articles
          ],
          whitelist: {
            allowChapters: ['74'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7418.10' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '7323.' },   // penalize iron/steel kitchen articles
            { delta: 0.85, prefixMatch: '6911.' },   // penalize porcelain
            { delta: 0.85, prefixMatch: '7419.' },   // penalize other copper articles
            { delta: 0.90, prefixMatch: '1905.' },   // penalize food products (biscuits)
          ],
        } as IntentRule;
        patches.push({ priority: 663, rule: newRule });
        console.log('COPPER_BRASS_TABLE_ARTICLE_INTENT: created (→7418.10)');
      } else {
        console.log('COPPER_BRASS_TABLE_ARTICLE_INTENT: already exists, skipping');
      }
    }

    // 4. INCENSE_HOLDER_BURNER_INTENT → 7418.20 (block 3307.41 incense sticks)
    //    "incense holder" → 3307.41 WRONG (expected 7418.20.10.00)
    //    "stone incense holder" → 3307.41 WRONG (expected 2516.11.00.00)
    //    "concrete incense holder" → 3307.41 WRONG (expected 6810.99.00.80)
    //    Root cause: "incense" keyword triggers incense stick classification.
    //    Holders should use material-based classification (stone→2516, concrete→6810, copper→7418).
    {
      const existing = allRules.find(r => r.id === 'INCENSE_HOLDER_BURNER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'INCENSE_HOLDER_BURNER_INTENT',
          description: 'Incense holders/burners → 7418.20 (copper household articles), block incense stick codes',
          pattern: {
            anyOf: [
              'incense holder', 'incense burner', 'incense ash catcher',
              'incense cone holder', 'incense stick holder', 'incense tray',
              'incense dish', 'incense boat', 'incense box holder',
            ],
            noneOf: [
              // Exclude actual incense products
              'incense stick', 'incense sticks', 'incense cone', 'incense cones',
              'incense bundle', 'incense joss', 'palo santo stick',
            ],
          },
          inject: [
            { prefix: '7418.20', syntheticRank: 5 },  // copper household articles (generic holder)
          ],
          whitelist: {
            denyPrefixes: ['3307.41'],  // hard-block incense sticks classification
          },
          boosts: [],
          penalties: [
            { delta: 0.95, prefixMatch: '3307.41' },  // very strong penalty for incense sticks
            { delta: 0.80, prefixMatch: '3307.' },     // penalize other perfumery/incense
          ],
        } as IntentRule;
        patches.push({ priority: 664, rule: newRule });
        console.log('INCENSE_HOLDER_BURNER_INTENT: created (→7418.20, denyPrefixes:3307.41)');
      } else {
        console.log('INCENSE_HOLDER_BURNER_INTENT: already exists, skipping');
      }
    }

    // 5. SNOW_GOGGLE_SAFETY_GOGGLE_INTENT → 9004.90 (protective spectacles/goggles)
    //    "Anti-Fog Snow Goggle" → 2933.59 WRONG (heterocyclic nitrogen compounds, "Anti-Fog" = chemical)
    //    Root cause: "Anti-Fog" triggers chemical compound codes.
    {
      const existing = allRules.find(r => r.id === 'SNOW_GOGGLE_SAFETY_GOGGLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SNOW_GOGGLE_SAFETY_GOGGLE_INTENT',
          description: 'Snow/ski/safety goggles → 9004.90 (other goggles/protective spectacles)',
          pattern: {
            anyOf: [
              'snow goggle', 'snow goggles', 'ski goggle', 'ski goggles',
              'snowboard goggle', 'snowboard goggles', 'anti-fog ski',
              'anti-fog goggle', 'anti fog goggle', 'safety goggle', 'safety goggles',
              'lab goggle', 'lab goggles', 'protective goggle', 'protective goggles',
              'shooting goggle', 'motorcycle goggle', 'sport goggle',
              'sport goggles', 'foam goggle', 'over glasses goggle',
            ],
          },
          inject: [
            { prefix: '9004.90', syntheticRank: 1 },  // other spectacles/goggles/protective
          ],
          whitelist: {
            allowChapters: ['90'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9004.90' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '2933.' },  // strong penalty for chemical compounds
            { delta: 0.85, prefixMatch: '3926.' },  // penalize plastic articles
            { delta: 0.80, prefixMatch: '9004.10' }, // penalize sunglasses (different subheading)
          ],
        } as IntentRule;
        patches.push({ priority: 665, rule: newRule });
        console.log('SNOW_GOGGLE_SAFETY_GOGGLE_INTENT: created (→9004.90, allowChapters:[90])');
      } else {
        console.log('SNOW_GOGGLE_SAFETY_GOGGLE_INTENT: already exists, skipping');
      }
    }

    // 6. ARTIST_FINE_ART_BRUSH_INTENT → 9603.30 (artists' brushes)
    //    "Artist paint brushes" → 9603.40.20.00 WRONG (expected 9603.30.60.00)
    //    "Paint brush, synthetic" → 9603.40.40.40 WRONG (expected 9603.30.20.00)
    //    Root cause: 9603.40 (paintbrushes for buildings/general) wins over 9603.30 (artists' brushes).
    {
      const existing = allRules.find(r => r.id === 'ARTIST_FINE_ART_BRUSH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ARTIST_FINE_ART_BRUSH_INTENT',
          description: 'Artists\' fine art brushes → 9603.30 (artist/writing brushes)',
          pattern: {
            anyOf: [
              'artist brush', 'artist brushes', 'artist paint brush', 'artist paint brushes',
              'artists brush', 'artists brushes', 'artists paint brush',
              'watercolor brush', 'watercolour brush', 'watercolor brushes',
              'acrylic paint brush', 'acrylic paint brushes', 'acrylic brush set',
              'oil paint brush', 'oil paint brushes', 'oil painting brush',
              'watercolor painting brush', 'fine art brush', 'fine art brushes',
              'calligraphy brush', 'ink brush', 'sumi brush',
              'painting brush set artist', 'paint brush set artist',
              'round brush artist', 'flat brush artist', 'fan brush artist',
              'filbert brush artist', 'liner brush artist',
            ],
            noneOf: [
              'paint roller', 'house paint brush', 'wall paint brush',
              'masonry brush', 'fence paint', 'exterior paint brush',
            ],
          },
          inject: [
            { prefix: '9603.30', syntheticRank: 1 },  // artists'/writing brushes
          ],
          whitelist: {
            allowChapters: ['96'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9603.30' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '9603.40' },  // penalize general paint brushes
          ],
        } as IntentRule;
        patches.push({ priority: 666, rule: newRule });
        console.log('ARTIST_FINE_ART_BRUSH_INTENT: created (→9603.30, allowChapters:[96])');
      } else {
        console.log('ARTIST_FINE_ART_BRUSH_INTENT: already exists, skipping');
      }
    }

    // 7. RATCHET_WRENCH_SOCKET_INTENT → 8204 (hand-operated spanners/wrenches/ratchets)
    //    "Milwaukee 3/8 in Drive Ratchet - Silver" → 3204.13 WRONG (color "Silver" → dye)
    //    "SOCKET KEYCHAIN - 10MM SOCKET TOOL" → 7326.20 WRONG (expected 8204.20.00.00)
    //    "Antique Telephone Linesman Wrench Cast Iron" → 8207.30 WRONG (expected 8204.12.00.00)
    {
      const existing = allRules.find(r => r.id === 'RATCHET_WRENCH_SOCKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RATCHET_WRENCH_SOCKET_INTENT',
          description: 'Ratchets, wrenches, socket tools → 8204 (hand-operated spanners/wrenches)',
          pattern: {
            anyOf: [
              'drive ratchet', 'ratchet wrench', '3/8 drive ratchet', '1/4 drive ratchet',
              '1/2 drive ratchet', 'socket wrench', 'socket set wrench',
              '10mm socket', '12mm socket', '14mm socket', 'socket tool',
              'box wrench', 'open end wrench', 'combination wrench', 'combination spanner',
              'adjustable wrench', 'crescent wrench', 'torque wrench',
              'linesman wrench', 'lineman wrench', 'utility wrench cast iron',
              'pipe wrench', 'monkey wrench', 'hex wrench set',
              'spanner wrench', 'spanner set', 'wrench set',
            ],
            noneOf: [
              'ratchet strap', 'tie down ratchet', 'cargo ratchet',
              'ratchet buckle', 'ratchet tightener',
            ],
          },
          inject: [
            { prefix: '8204.11', syntheticRank: 1 },  // ratchets (interchangeable wrenches)
            { prefix: '8204.12', syntheticRank: 3 },  // other spanners/wrenches
            { prefix: '8204.20', syntheticRank: 5 },  // socket sets
          ],
          whitelist: {
            allowChapters: ['82'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8204.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '3204.' },  // strong penalty for dyes (silver color!)
            { delta: 0.80, prefixMatch: '7326.' },  // penalize metal articles
            { delta: 0.80, prefixMatch: '8207.' },  // penalize tools for drilling/boring
          ],
        } as IntentRule;
        patches.push({ priority: 667, rule: newRule });
        console.log('RATCHET_WRENCH_SOCKET_INTENT: created (→8204, allowChapters:[82])');
      } else {
        console.log('RATCHET_WRENCH_SOCKET_INTENT: already exists, skipping');
      }
    }

    // 8. CAMERA_OPTICAL_FILTER_INTENT → 9002.20 (optical filters for cameras)
    //    "kenko filter set" → 4823.20 WRONG (filter paper, expected 9002.20.40.00)
    //    "Mamiya M645 Medium Format SLR Film Camera" → 3702.53 WRONG (expected 9002.20.40.00)
    //    Root cause: "filter" triggers filter paper; film camera triggers photographic film.
    {
      const existing = allRules.find(r => r.id === 'CAMERA_OPTICAL_FILTER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CAMERA_OPTICAL_FILTER_INTENT',
          description: 'Camera/optical filters and film camera lenses → 9002.20 (objective lenses)',
          pattern: {
            anyOf: [
              'camera filter', 'camera filters', 'lens filter', 'lens filters',
              'uv filter', 'nd filter', 'cpl filter', 'circular polarizing filter',
              'polarizing filter', 'kenko filter', 'photography filter',
              'filter set camera', 'nd filter set', 'uv lens filter',
              'step-up ring filter', 'close-up filter', 'macro filter',
              'slr film camera', 'film camera lens', 'medium format lens',
              'medium format camera', 'mamiya lens', 'hasselblad lens',
              'rolleiflex lens', 'film slr lens',
            ],
            noneOf: [
              'filter paper', 'air filter', 'oil filter', 'water filter',
              'coffee filter', 'fuel filter', 'hvac filter',
            ],
          },
          inject: [
            { prefix: '9002.20', syntheticRank: 1 },  // objective lenses for cameras
          ],
          whitelist: {
            allowChapters: ['90'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9002.20' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4823.' },  // filter paper
            { delta: 0.85, prefixMatch: '3702.' },  // photographic film
            { delta: 0.80, prefixMatch: '8443.' },  // printing machinery
          ],
        } as IntentRule;
        patches.push({ priority: 668, rule: newRule });
        console.log('CAMERA_OPTICAL_FILTER_INTENT: created (→9002.20, allowChapters:[90])');
      } else {
        console.log('CAMERA_OPTICAL_FILTER_INTENT: already exists, skipping');
      }
    }

    // 9. MULTITOOL_PLIER_HANDTOOL_INTENT → 8205.20 (pliers/multitools)
    //    "Kelvin 8 multitool" → 7002.32 WRONG (glass rods, expected 8205.20.30.00)
    //    "Dr Doolin Wrench SU Carburetor Jet Adjustment Tool" → 8207.50 WRONG (expected 8205.59.30.10)
    {
      const existing = allRules.find(r => r.id === 'MULTITOOL_PLIER_HANDTOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MULTITOOL_PLIER_HANDTOOL_INTENT',
          description: 'Multitools, pliers → 8205.20/8205.59 (pliers/other handtools)',
          pattern: {
            anyOf: [
              'multitool', 'multi-tool', 'multi tool', 'multitools',
              'leatherman', 'gerber multitool', 'victorinox multitool',
              'needle nose plier', 'needle nose pliers', 'needlenose pliers',
              'linesman plier', 'linesman pliers', 'channel lock plier',
              'locking plier', 'vise grip plier', 'snap ring plier',
              'carburetor jet tool', 'jet adjustment tool', 'carburetor tool',
              'adjustment tool carburetor',
            ],
          },
          inject: [
            { prefix: '8205.20', syntheticRank: 1 },  // pliers including cutting pliers
            { prefix: '8205.59', syntheticRank: 4 },  // other handtools for household/other use
            { prefix: '8205.90', syntheticRank: 7 },  // sets of handtools
          ],
          whitelist: {
            allowChapters: ['82'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8205.20' },
            { delta: 0.60, prefixMatch: '8205.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7002.' },  // penalize glass rods
            { delta: 0.80, prefixMatch: '8207.' },  // penalize boring/drilling tools
          ],
        } as IntentRule;
        patches.push({ priority: 669, rule: newRule });
        console.log('MULTITOOL_PLIER_HANDTOOL_INTENT: created (→8205.20, allowChapters:[82])');
      } else {
        console.log('MULTITOOL_PLIER_HANDTOOL_INTENT: already exists, skipping');
      }
    }

    // 10. GLASS_WATER_BOTTLE_CONTAINER_INTENT → 7010.90 (glass containers for beverages)
    //    "glass water bottle" → 7013.99 WRONG (table glassware, expected 7010.90.50.15)
    //    "Vinegar bottle" → 7013.99 WRONG (expected 7010.90.30.40)
    //    Root cause: glass bottles for beverages/storage go to 7010 not table glassware (7013).
    {
      const existing = allRules.find(r => r.id === 'GLASS_WATER_BOTTLE_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_WATER_BOTTLE_CONTAINER_INTENT',
          description: 'Glass bottles/containers for beverages/storage → 7010.90 (not table glassware)',
          pattern: {
            anyOf: [
              'glass water bottle', 'glass spirit bottle', 'glass spirits bottle',
              'vinegar bottle', 'glass vinegar bottle', 'glass olive oil bottle',
              'glass oil bottle', 'glass sauce bottle', 'glass condiment bottle',
              'glass dispenser bottle', 'glass flip top bottle', 'glass milk bottle',
              'glass beer bottle', 'glass wine bottle', 'glass bottle for spirits',
            ],
            noneOf: [
              'plastic water bottle', 'stainless water bottle', 'metal water bottle',
              'decorative bottle', 'decorative glass bottle', 'decorative use only',
            ],
          },
          inject: [
            { prefix: '7010.90', syntheticRank: 1 },  // glass containers for beverages
          ],
          whitelist: {
            allowChapters: ['70'],
            denyPrefixes: ['7013.'],  // hard-block table glassware
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7010.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7013.' },  // strong penalty for table glassware
          ],
        } as IntentRule;
        patches.push({ priority: 670, rule: newRule });
        console.log('GLASS_WATER_BOTTLE_CONTAINER_INTENT: created (→7010.90, denyPrefixes:[7013.])');
      } else {
        console.log('GLASS_WATER_BOTTLE_CONTAINER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT125)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT125 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
