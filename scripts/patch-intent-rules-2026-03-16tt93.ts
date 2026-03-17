#!/usr/bin/env ts-node
/**
 * Patch TT93 — 2026-03-16: Decorative glass vessels, luminaire cross-chapter fixes,
 *                            baby blankets, wood place card stands.
 *
 * Fixes:
 *  1. NEW DECORATIVE_GLASS_VESSEL_INTENT → 7013/7010 (glassware/glass containers)
 *     "Vinegar bottle" → 2209.00 WRONG (expected 7010.90.30 - glass container)
 *     "Coca-Cola Canada Aqua Blue Coke Bottle Antique" → 2202.99 WRONG (expected 7010.90.50)
 *     "antique glass perfume bottle" → 3303.00 WRONG (expected 7013.99.35 - glassware)
 *     "Potion Bottles" → ch.73 WRONG (expected 7013.99.90 - decorative glassware)
 *     BUG: Decorative/antique/vintage glass bottles classified as their content (vinegar=22,
 *          perfume=33, beverages=22) instead of the glass vessel (ch.70).
 *     FIX: New intent → 7013.99/7010.90, denyChapters:['22','33','21','03']
 *
 *  2. UPDATE LAMP_SHADE_LIGHT_FIXTURE_INTENT — add lightbox, bottle lamp, denyChapters:['39','22']
 *     "Grateful Dead Dancing Bear 3D Printed LED Lightbox" → 3926.90 WRONG (expected 9405.21)
 *     "Clase Azul Tequila Bottle Lamp" → 2208.90 WRONG (expected 9405.29)
 *     "LED Base sample" → 8539.31 WRONG (expected 9405.21) — should be fixed by denyChapters:['85']
 *     FIX: Add 'lightbox', 'led lightbox', 'bottle lamp' to anyOf; add denyChapters:['39','22']
 *
 *  3. NEW COTTON_BABY_BLANKET_INTENT → 6301.30 (cotton blankets)
 *     "Muslin Cross Stitch Baby Blanket - 14 Count AIDA" → 6304.11 WRONG (expected 6301.30.00)
 *     BUG: Baby blanket with AIDA fabric context → CROSS_STITCH intent blocked, then
 *          semantic routing puts it in 6304 (bedspreads). Should be 6301 (blankets).
 *     6301.30 = cotton blankets and travelling rugs
 *     FIX: New intent → 6301.30, anyOf: baby blanket phrases
 *
 *  4. NEW WOOD_DISPLAY_STAND_INTENT → 4404.20/4421.99 (wood stands/display items)
 *     "Large Wood Stand / Place Card, Business Card, Retail Signage" → 9209.92 WRONG (expected 4404.20)
 *     "Medium Wood Stand / Place Card, Business Card, Retail Signage" → 9209.92 WRONG (expected 4404.20)
 *     BUG: Wooden display/place card stands classified as musical instrument parts (9209.92!)
 *          probably because semantic matching on "Stand" matches music stands.
 *     4404.20 = wood hoopwood; split poles; stakes of wood (includes simple wooden display sticks)
 *     FIX: New intent → 4404.20/4421.99, denyChapters:['92','95']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt93.ts
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

    // 1. NEW DECORATIVE_GLASS_VESSEL_INTENT → 7013.99/7010.90 (decorative glassware/bottles)
    //    The dataset classifies decorative/antique glass vessels as ch.70 (glass):
    //    7010.90 = carboys, bottles, flasks, jars, pots (glass containers)
    //    7013.99 = other glassware for table/kitchen/toilet (decorative)
    //    Engine misclassifies these based on content keywords (vinegar → 2209, perfume → 3303, etc.)
    {
      const existing = allRules.find(r => r.id === 'DECORATIVE_GLASS_VESSEL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DECORATIVE_GLASS_VESSEL_INTENT',
          description: 'Decorative/antique/vintage glass bottles/jars/vessels → 7013/7010 (glassware, ch.70)',
          pattern: {
            anyOf: [
              // Antique/vintage glass bottles
              'antique glass bottle', 'vintage glass bottle', 'antique bottle',
              'antique coke bottle', 'vintage coca cola bottle', 'vintage coke bottle',
              'antique reproduction bottle', 'vintage reproduction bottle',
              'antique medicine bottle', 'vintage medicine bottle',
              // Perfume/decorative bottles
              'antique glass perfume bottle', 'vintage perfume bottle', 'glass perfume bottle',
              'perfume bottle glass', 'antique perfume bottle',
              // Potion/fantasy bottles
              'potion bottle', 'potion bottles', 'potion glass bottle',
              'witch bottle', 'apothecary bottle',
              // Decorative/craft glass vessels
              'glass vessel', 'glass vessels', 'decorative glass bottle',
              'hand blown glass bottle', 'blown glass bottle',
              'glass bottle vase', 'antique glass jar',
              // Vinegar/sauce bottles (container, not content)
              'vinegar bottle', 'sauce bottle glass', 'glass condiment bottle',
            ],
            noneOf: [
              // Exclude the actual product (liquid) rather than the container
              'vinegar recipe', 'vinegar dressing', 'perfume spray',
              // Exclude plastic bottles
              'plastic bottle', 'plastic container',
              // Exclude metal/brass items
              'brass bottle', 'metal bottle',
            ],
          },
          inject: [
            { prefix: '7013.99', syntheticRank: 2 },  // other glassware (decorative)
            { prefix: '7010.90', syntheticRank: 4 },  // glass containers (bottles/jars)
            { prefix: '7013.49', syntheticRank: 6 },  // other glassware for kitchen/table
            { prefix: '7013.10', syntheticRank: 8 },  // glass tableware of glass-ceramics
          ],
          whitelist: {
            allowChapters: ['70'],                     // glass and glassware chapter
            denyChapters: ['22', '33', '21', '03'],   // deny beverages, cosmetics, food prep, fish products
          },
          boosts: [
            { delta: 0.85, prefixMatch: '7013.' },    // boost glassware
            { delta: 0.75, prefixMatch: '7010.' },    // boost glass containers
            { delta: 0.50, chapterMatch: '70' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '22' },       // strong penalty for beverages
            { delta: 0.70, chapterMatch: '33' },       // strong penalty for cosmetics/perfumes
            { delta: 0.70, chapterMatch: '21' },       // penalty for food preparations
          ],
        } as IntentRule;
        patches.push({ priority: 538, rule: newRule });
        console.log('DECORATIVE_GLASS_VESSEL_INTENT: created (glass bottles → 7013/7010, deny ch.22/33)');
      } else {
        console.log('DECORATIVE_GLASS_VESSEL_INTENT: already exists, skipping');
      }
    }

    // 2. UPDATE LAMP_SHADE_LIGHT_FIXTURE_INTENT — add lightbox phrases, expand denyChapters
    //    "Grateful Dead Dancing Bear 3D Printed LED Lightbox" → expected 9405.21.40.1 (floor/table lamp)
    //    "Clase Azul Tequila Bottle Lamp" → expected 9405.29.80.1 (floor lamp)
    //    denyChapters:['39'] should prevent 3D printed → plastic routing
    //    denyChapters:['22'] should prevent tequila/beverage routing
    {
      const existing = allRules.find(r => r.id === 'LAMP_SHADE_LIGHT_FIXTURE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const currentWhitelist = (existing as any).whitelist || {};
        const currentDeny = currentWhitelist.denyChapters || [];

        const newPhrases = [
          // LED lightbox (decorative 3D-printed lamp types)
          'lightbox', 'led lightbox', 'led light box', '3d lightbox',
          'neon lightbox', 'neon sign lamp',
          // Bottle lamps (converted bottle luminaires)
          'bottle lamp', 'tequila bottle lamp', 'wine bottle lamp',
          'glass bottle lamp', 'liquor bottle lamp',
          // Other lamp types not in original intent
          'arc lamp', 'arc light', 'led lamp',
          'plant grow light', 'grow lamp',
        ];

        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
          whitelist: {
            ...currentWhitelist,
            denyChapters: [...new Set([...currentDeny, '39', '22'])],  // deny plastic + beverages
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 539, rule: updated });
        console.log('LAMP_SHADE_LIGHT_FIXTURE_INTENT: added lightbox/bottle lamp phrases, denyChapters:[39,22]');
      } else {
        console.log('LAMP_SHADE_LIGHT_FIXTURE_INTENT: not found');
      }
    }

    // 3. NEW COTTON_BABY_BLANKET_INTENT → 6301.30 (cotton blankets/rugs)
    //    "Muslin Cross Stitch Baby Blanket - 14 Count AIDA, Crochet Edge" → 6304.11 WRONG
    //    The CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT blocks for 'baby blanket' (noneOf),
    //    but the item still routes to 6304 (bedspreads) instead of 6301 (blankets).
    //    6301.30 = blankets and travelling rugs, of cotton
    //    FIX: Specific intent to route baby blankets to 6301.30
    {
      const existing = allRules.find(r => r.id === 'COTTON_BABY_BLANKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_BABY_BLANKET_INTENT',
          description: 'Baby blankets, muslin blankets, infant blankets → 6301.30 (cotton blankets)',
          pattern: {
            anyOf: [
              // Baby/infant blankets
              'baby blanket', 'baby blankets', 'infant blanket',
              'newborn blanket', 'newborn blankets',
              'cotton baby blanket', 'muslin baby blanket',
              // Muslin blankets specifically
              'muslin blanket', 'muslin swaddle', 'muslin swaddle blanket',
              'muslin receiving blanket',
              // Swaddle blankets
              'swaddle blanket', 'swaddle blankets',
              'swaddling blanket', 'receiving blanket',
              // Other blanket types
              'crib blanket', 'stroller blanket', 'baby quilt blanket',
              'cross stitch baby blanket', 'crochet edge blanket',
            ],
            noneOf: [
              // Exclude blanket kits/patterns (these are craft supplies)
              'pattern', 'kit',
              // Exclude electric blankets (ch.85)
              'electric blanket', 'heating blanket',
            ],
          },
          inject: [
            { prefix: '6301.30', syntheticRank: 2 },  // cotton blankets/travelling rugs
            { prefix: '6301.20', syntheticRank: 4 },  // wool/fine animal hair blankets
            { prefix: '6301.90', syntheticRank: 6 },  // other blankets
          ],
          whitelist: {
            allowChapters: ['63'],                     // made-up textile articles
            denyChapters: ['95'],                      // deny toys
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6301.' },
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.50, prefixMatch: '6304.' },     // penalize bedspreads
            { delta: 0.50, prefixMatch: '6302.' },     // penalize bed linen
          ],
        } as IntentRule;
        patches.push({ priority: 537, rule: newRule });
        console.log('COTTON_BABY_BLANKET_INTENT: created (baby/muslin blankets → 6301.30)');
      } else {
        console.log('COTTON_BABY_BLANKET_INTENT: already exists, skipping');
      }
    }

    // 4. NEW WOOD_DISPLAY_STAND_INTENT → 4404.20/4421.99 (wood stands/display items)
    //    "Large Wood Stand / Place Card, Business Card, Retail Signage" → 9209.92 WRONG
    //    (musical instrument parts!) — engine confuses "stand" with music stand
    //    4404.20 = wood hoopwood; split poles; stakes (simple wooden sticks/stands)
    //    4421.99 = other articles of wood (catch-all for wood articles)
    {
      const existing = allRules.find(r => r.id === 'WOOD_DISPLAY_STAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_DISPLAY_STAND_INTENT',
          description: 'Wood display stands, place card holders, menu holders → 4404/4421 (wood articles, ch.44)',
          pattern: {
            anyOf: [
              // Place card stands
              'wood stand place card', 'wooden place card', 'place card holder wood',
              'wooden place card holder', 'wood place card stand',
              'place card stand', 'table place card holder',
              // Business card holders
              'business card stand wood', 'wood business card holder',
              'wooden business card stand',
              // Menu/sign holders (wood)
              'wood sign holder', 'wood menu holder', 'wood menu stand',
              'wooden menu stand', 'wood sign stand',
              // Retail/display stands (wood)
              'retail wood stand', 'wood display stand',
              'laser cut wood stand', 'wood card stand',
              // Recipe card holders
              'recipe card holder wood', 'wooden recipe holder',
              // Number stands / table number holders
              'table number stand wood', 'wood number stand',
            ],
            noneOf: [
              // Exclude non-wood stands
              'metal stand', 'acrylic stand', 'plastic stand',
              // Exclude music stands (separate intent)
              'music stand', 'music stand accessory',
              // Exclude large furniture stands
              'speaker stand', 'tv stand',
            ],
          },
          inject: [
            { prefix: '4404.20', syntheticRank: 2 },  // wood hoopwood/stakes (simple wood display sticks)
            { prefix: '4421.99', syntheticRank: 4 },  // other articles of wood NES
            { prefix: '4420.19', syntheticRank: 6 },  // decorative articles of wood
          ],
          whitelist: {
            allowChapters: ['44'],                     // wood and articles of wood
            denyChapters: ['92', '95'],                // deny musical instruments, toys
          },
          boosts: [
            { delta: 0.85, prefixMatch: '4404.' },
            { delta: 0.75, prefixMatch: '4421.' },
            { delta: 0.40, chapterMatch: '44' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '92' },       // strong penalty for musical instruments
            { delta: 0.60, chapterMatch: '95' },       // penalize toys
          ],
        } as IntentRule;
        patches.push({ priority: 536, rule: newRule });
        console.log('WOOD_DISPLAY_STAND_INTENT: created (wood stands → 4404/4421, deny ch.92)');
      } else {
        console.log('WOOD_DISPLAY_STAND_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT93)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT93 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
