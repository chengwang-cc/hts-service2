#!/usr/bin/env ts-node
/**
 * Patch TT40 — 2026-03-15: Hair ties + Christmas ornaments + silicone wristbands + wallets + insulated bags.
 * Current: ~33.69% (after TT39)
 *
 * Targets:
 *  1. SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT → 6117.80 (scrunchies, hair ties, boho headbands)
 *     "4 pack of hair ties" → 6117.80; "Personalized Dusty Pink Satin Scrunchie" → 6117.80; 5 miss entries
 *  2. CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT → 9505.10 (glass/wood/plastic Christmas ornaments)
 *     "Glass Christmas ornament" → 9505.10; "handmade fabric santa figure" → 9505.10; 8 miss entries
 *  3. SILICONE_WRISTBAND_BRACELET_INTENT → 3926.20 (silicone wristbands, plastic wristbands)
 *     "10 Pack of Wristbands - Anishnaabe" → 3926.20; "3 Pack Wristbands Canada" → 3926.20; 10 miss entries
 *  4. WALLET_COIN_POUCH_POCKET_INTENT → 4202.32 (wallets, coin pouches, pencil cases, small fabric bags)
 *     "PU leather coin pouch" → 4202.32; "used women's wallet" → 4202.32; 7 miss entries
 *  5. INSULATED_BAG_COOLER_DOG_TREAT_INTENT → 4202.92 (insulated lunch bags, dog treat bags, cooler bags)
 *     "Insulated Lunch Bags - Leak-Proof Cooler Lunch Box" → 4202.92; "Silicone Pouch Dog Treat Pouch" → 4202.92
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt40.ts
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

    // 1. SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT → 6117.80 (clothing accessories of textiles)
    //    "4 pack of hair ties" → 6117.80.95.50
    //    "Personalized Dusty Pink Satin Scrunchie: Bridesmaid Proposal Gift" → 6117.80.95.50
    //    "Blue & White Cotton Scrunchie: Mediterranean Island-Inspired Hair Tie" → 6117.80.95.50
    //    "Boho headband, Workout headband, Wide twist headband" → 6117.80.95.50
    //    "Ecuadorian Cotton Blend Headband, Boho Twist Head Wrap" → 6117.80.95.50
    //    6117.80 = other accessories of other textile materials (hair ties, scrunchies, headbands)
    //    NOTE: SILK_NECKTIE_BOWTIE_INTENT → 6215.10 handles silk neckties
    {
      const existing = allRules.find(r => r.id === 'SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT',
          description: 'Scrunchies, hair ties, fabric headbands, textile hair accessories → ch.61 (6117.80)',
          pattern: {
            anyOf: [
              'scrunchie', 'scrunchies', 'satin scrunchie', 'velvet scrunchie',
              'cotton scrunchie', 'silk scrunchie', 'hair scrunchie',
              'hair tie', 'hair ties', 'pack hair ties', 'set hair ties',
              'elastic hair tie', 'fabric hair tie', 'hair band fabric',
              'headband', 'head band', 'boho headband', 'workout headband',
              'fabric headband', 'twist headband', 'yoga headband',
              'wide headband', 'knotted headband', 'turban headband',
              'head wrap fabric', 'head wrap boho', 'head scarf tie',
              'hair wrap fabric', 'hair ribbon',
              'dreadlocks headband', 'festival headband',
            ],
            noneOf: [
              'metal headband', 'plastic headband', 'elastic only', 'rubber band',
              'hair clip', 'hair pin', 'barrette', 'bobby pin',
            ],
          },
          inject: [{ prefix: '6117.80', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6117.8' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('SCRUNCHIE_HAIR_TIE_HEADBAND_INTENT: created (scrunchies/hair ties/headbands → 6117.80)');
      }
    }

    // 2. CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT → 9505.10 (Christmas ornaments, holiday figurines)
    //    "Glass Christmas ornament" → 9505.10.10.00 (glass ornament)
    //    "Christopher Radko AFLAC SANTA DUCK Blown Glass Christmas Duck" → 9505.10.10.00
    //    "handmade christmas ornament made of wood and acrylic" → 9505.10.15.00
    //    "3 inches wood flat Christmas ornament painted" → 9505.10.15.00
    //    "Custom wood novelty arrow" → 9505.10.15.00 (novelty arrow for holiday)
    //    "fabric Advent calendar" → 9505.10.25.00 (fabric holiday decoration)
    //    "handmade fabric santa figure" → 9505.10.25.00
    //    "Nativity Set" → 9505.10.30.00
    //    "Plastic Christmas Tree Ornament" → 9505.10.40.00
    //    "christmas stockings" → 9505.10.50.00
    //    9505.10 = Christmas, Easter, Hanukkah and similar festive articles for trees/decorations
    {
      const existing = allRules.find(r => r.id === 'CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT',
          description: 'Christmas ornaments, holiday figurines, nativity sets, advent calendars → ch.95 (9505.10)',
          pattern: {
            anyOf: [
              'christmas ornament', 'christmas ornaments', 'holiday ornament',
              'glass ornament', 'glass christmas ornament', 'blown glass ornament',
              'glass christmas ball', 'glitter ornament', 'glitter christmas ornament',
              'wood christmas ornament', 'wooden christmas ornament', 'wood ornament painted',
              'fabric advent calendar', 'advent calendar fabric', 'fabric christmas',
              'fabric santa', 'handmade santa figure', 'santa figurine', 'santa claus figurine',
              'christmas stocking', 'christmas stockings', 'holiday stocking',
              'nativity set', 'nativity figurine', 'nativity scene', 'christmas nativity',
              'christmas decoration', 'christmas decor', 'holiday decoration',
              'christmas tree ornament', 'tree ornament', 'ornament personalized christmas',
              'hallmark ornament', 'radko ornament', 'swarovski ornament',
              'novelty christmas', 'christmas figurine',
            ],
            noneOf: [
              'wall ornament', 'ornamental plant', 'ornament non-christmas',
              'easter egg', 'halloween decoration',
            ],
          },
          inject: [
            { prefix: '9505.10', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '9505.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('CHRISTMAS_ORNAMENT_HOLIDAY_DECOR_INTENT: created (Christmas ornaments/decorations → 9505.10)');
      }
    }

    // 3. SILICONE_WRISTBAND_BRACELET_INTENT → 3926.20 (plastic/silicone wristbands, jelly bracelets)
    //    "10 Pack of Wristbands - Anishnaabe" → 3926.20.40.50 (plastic wristbands)
    //    "25 Pack of Wristband (MMIWG Design)" → 3926.20.40.50
    //    "3 Pack Writstbands -Canada with Maple Leaf" → 3926.20.40.50
    //    "Sitch Band" → 3926.20.40.50 (silicone wristband/tracker band)
    //    "Jelly color Wristlet, Phone Strap, Phone Charm" → 3926.20.90.50 (jelly plastic accessories)
    //    3926.20 = articles of apparel and clothing accessories of plastics
    //    NOTE: This targets silicone/plastic wristbands, not metal bracelets
    {
      const existing = allRules.find(r => r.id === 'SILICONE_WRISTBAND_BRACELET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILICONE_WRISTBAND_BRACELET_INTENT',
          description: 'Silicone/plastic wristbands, rubber wristbands, jelly bracelets → ch.39 (3926.20)',
          pattern: {
            anyOf: [
              'wristband', 'wristbands', 'silicone wristband', 'rubber wristband',
              'plastic wristband', 'medical wristband', 'charity wristband',
              'pack of wristbands', 'set of wristbands', 'wristband pack',
              'wristband bracelet', 'awareness wristband', 'custom wristband',
              'jelly bracelet', 'jelly wristlet', 'jelly color wristlet',
              'silicone bracelet', 'rubber bracelet',
              'phone strap plastic', 'phone charm plastic', 'phone wristlet',
              'tracker band', 'fitness band', 'sport wristband',
            ],
            noneOf: [
              'gold bracelet', 'silver bracelet', 'metal bracelet', 'beaded bracelet',
              'leather wristband', 'fabric wristband', 'cloth wristband',
              'copper bracelet',
            ],
          },
          inject: [{ prefix: '3926.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '3926.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SILICONE_WRISTBAND_BRACELET_INTENT: created (silicone/plastic wristbands → 3926.20)');
      }
    }

    // 4. WALLET_COIN_POUCH_POCKET_INTENT → 4202.32 (wallets, coin pouches, pencil cases, small bags)
    //    "PU leather coin pouch" → 4202.32.40.00
    //    "Nightmare Before Christmas Wallet" → 4202.32.40.00
    //    "used women's wallet" → 4202.32.40.00
    //    "polyester pencil case" → 4202.32.40.00 (pencil case = pocket/handbag article)
    //    "large vinyl pouch" → 4202.32.40.00
    //    "ditty bag in linen - s m a l l" → 4202.32.80.00
    //    4202.32 = articles of a kind normally carried in the pocket or handbag, of textile materials
    //    Includes: wallets, coin purses, small pouches, pencil cases
    {
      const existing = allRules.find(r => r.id === 'WALLET_COIN_POUCH_POCKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WALLET_COIN_POUCH_POCKET_INTENT',
          description: 'Wallets, coin pouches, pencil cases, small fabric bags → ch.42 (4202.32)',
          pattern: {
            anyOf: [
              'coin pouch', 'coin purse', 'change purse',
              'wallet', 'womens wallet', 'mens wallet', 'card wallet',
              'fabric wallet', 'vinyl wallet', 'pu leather wallet', 'bifold wallet',
              'pencil case', 'pencil pouch', 'polyester pencil case',
              'vinyl pouch', 'large vinyl pouch', 'envelope vinyl pouch',
              'ditty bag', 'linen ditty bag', 'small linen bag',
              'small fabric bag', 'small cotton bag', 'small pouch fabric',
              'knit coin bag', 'crochet coin pouch', 'knitted mini bag',
              'id card holder fabric', 'card holder textile',
            ],
            noneOf: [
              'leather wallet', 'genuine leather wallet', 'real leather wallet',
              'metal wallet', 'titanium wallet', 'stainless steel wallet',
              'tote bag', 'shoulder bag', 'handbag', 'backpack', 'purse',
            ],
          },
          inject: [{ prefix: '4202.32', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4202.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WALLET_COIN_POUCH_POCKET_INTENT: created (wallets/coin pouches → 4202.32)');
      }
    }

    // 5. INSULATED_BAG_COOLER_DOG_TREAT_INTENT → 4202.92 (insulated bags, dog treat bags, bicycle bags)
    //    "Insulated Lunch Bags - Leak-Proof Cooler Lunch Box 26x24x17 cm" → 4202.92.04.00
    //    "Silicone Pouch Dog Treat Pouch" → 4202.92.04.00
    //    "Silicone Pouch for Dog Treats" → 4202.92.04.00
    //    "Rocket Pocket Saddle Bag" → 4202.92.08.09 (bicycle saddle bag)
    //    "Compression Wash Bag" → 4202.92.08.09 (travel compression bag)
    //    4202.92 = other containers/bags not in 4202.11-4202.39 (cases, trunks, travel bags)
    //    NOTE: Very diverse category; targeting the clearest sub-patterns
    {
      const existing = allRules.find(r => r.id === 'INSULATED_BAG_COOLER_DOG_TREAT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'INSULATED_BAG_COOLER_DOG_TREAT_INTENT',
          description: 'Insulated lunch bags, dog treat pouches, cooler bags, bicycle bags → ch.42 (4202.92)',
          pattern: {
            anyOf: [
              'insulated lunch bag', 'insulated bag', 'cooler lunch bag', 'cooler bag',
              'leak proof lunch bag', 'thermal lunch bag', 'lunch box bag',
              'dog treat pouch', 'dog treat bag', 'dog snack pouch', 'dog training pouch',
              'treat pouch dog', 'silicone dog pouch', 'silicone treat pouch',
              'saddle bag bicycle', 'bicycle saddle bag', 'bike saddle bag', 'cycling bag',
              'compression bag', 'compression wash bag', 'packing cube',
              'hydration bag', 'hydration pack',
              'tool roll bag', 'roll bag canvas', 'canvas bag roll',
              'airpod case fabric', 'earbud case fabric', 'cotton airpod case',
            ],
            noneOf: [
              'leather', 'metal', 'stainless steel',
              'handbag', 'purse', 'tote bag',
            ],
          },
          inject: [{ prefix: '4202.92', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '4202.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('INSULATED_BAG_COOLER_DOG_TREAT_INTENT: created (insulated bags/dog treat bags → 4202.92)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT40)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT40 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
