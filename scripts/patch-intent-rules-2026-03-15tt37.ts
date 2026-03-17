#!/usr/bin/env ts-node
/**
 * Patch TT37 — 2026-03-15: Ceramic tableware + cotton hoodies + women synthetic dresses + glass jars + base metal jewelry.
 * Current: ~33.09% (after TT36)
 *
 * Targets:
 *  1. CERAMIC_PORCELAIN_TABLEWARE_INTENT → 6911.10 + 6912.00 (ceramic/porcelain mugs, plates, tea cups, china)
 *     "Ceramic Mug and Wood Coaster" → 6911.10; "Bone China Tea Cups" → 6911.10; 38+ entries
 *     "handmade blue ceramic mug" → 6912.00; "Ceramic dinnerware set 8pc" → 6912.00; 27 entries
 *  2. COTTON_KNIT_HOODIE_SWEATSHIRT_INTENT → 6110.20 (cotton hoodies, sweatshirts, pullovers)
 *     "100% cotton hoodie" → 6110.20; "65% cotton 35% poly Hoodie" → 6110.20; 14 miss entries
 *  3. WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT → 6204.43 (women's/girls' synthetic dresses, satin gowns)
 *     "Black sleeveless dress, polyester and lyocell blend" → 6204.43; "girls tulle dress" → 6204.43; 15 miss entries
 *  4. GLASS_JAR_BOTTLE_DECANTER_INTENT → 7010.90 (glass decanters, jars, bottles, carafes)
 *     "clear glass decanter bottle for spirits" → 7010.90; "4oz glass mason jar with lid" → 7010.90; 14 miss entries
 *  5. BASE_METAL_IMITATION_JEWELRY_INTENT → 7117.19 (PVD rings, titanium earrings, pewter, cufflinks)
 *     "18K Gold PVD Sun Signet Ring" → 7117.19; "100% English Pewter Womens Necklace" → 7117.19; 14 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt37.ts
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

    // 1. CERAMIC_PORCELAIN_TABLEWARE_INTENT → 6911.10 + 6912.00 (ceramic/porcelain tableware)
    //    "Ceramic Mug and Wood Coaster" → 6911.10.10.00 (porcelain/china)
    //    "Vintage Vitrified China Plates" → 6911.10.10.00
    //    "Bone China Tea Cups and Plates" → 6911.10.10.00
    //    "Vintage Royal Copenhagen Porcelain Trinket Dishes" → 6911.10.15.00
    //    "handmade blue ceramic mug" → 6912.00.10.00 (other ceramic)
    //    "Ceramic dinnerware set 8pc" → 6912.00.20.00
    //    "Ceramic butter dish" → 6912.00.35.00
    //    6911.10 = porcelain or china tableware/kitchenware
    //    6912.00 = other ceramic tableware/kitchenware (earthenware, stoneware)
    {
      const existing = allRules.find(r => r.id === 'CERAMIC_PORCELAIN_TABLEWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CERAMIC_PORCELAIN_TABLEWARE_INTENT',
          description: 'Ceramic/porcelain mugs, plates, tea cups, china dishes → ch.69 (6911.10 + 6912.00)',
          pattern: {
            anyOf: [
              'ceramic mug', 'ceramic mugs', 'ceramic cup', 'ceramic cups', 'ceramic coffee cup',
              'ceramic plate', 'ceramic plates', 'ceramic bowl', 'ceramic bowls', 'ceramic dish',
              'ceramic dinnerware', 'ceramic tableware', 'ceramic set', 'ceramic pasta bowl',
              'ceramic butter dish', 'ceramic jar', 'ceramic cookie jar', 'ceramic canister',
              'ceramic pet bowl', 'ceramic cat bowl', 'ceramic dog bowl',
              'ceramic sponge holder', 'ceramic figurine',
              'porcelain mug', 'porcelain cup', 'porcelain plate', 'porcelain dish',
              'porcelain tea cup', 'porcelain teacup', 'porcelain trinket',
              'bone china', 'bone china cup', 'bone china mug', 'bone china plate',
              'vitrified china', 'china plates', 'china cups', 'china tea cup',
              'china mug', 'china dinnerware', 'china teacup',
              'teacup and saucer', 'tea cup and saucer', 'teacup saucer',
              'royal albert', 'royal copenhagen', 'belleek', 'wedgwood', 'spode',
              'ironstone platter', 'ironstone china',
              'earthenware vase', 'earthenware mug',
              'handmade ceramic', 'stoneware mug', 'stoneware plate',
              'tiki mug', 'cappuccino mug',
              'salt cellar porcelain', 'salt cellar ceramic',
              'egg cup ceramic', 'egg cup porcelain',
            ],
            noneOf: [
              'glass mug', 'glass cup', 'glass bowl', 'glass plate',
              'stainless steel mug', 'stainless mug', 'travel mug',
              'plastic mug', 'paper cup', 'silicone bowl',
              'metal camp mug', 'enamel mug', 'tin mug', 'camp mug',
            ],
          },
          inject: [
            { prefix: '6911.10', syntheticRank: 5 },
            { prefix: '6912.00', syntheticRank: 5 },
          ],
          boosts: [
            { delta: 0.50, prefixMatch: '6911' },
            { delta: 0.50, prefixMatch: '6912' },
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('CERAMIC_PORCELAIN_TABLEWARE_INTENT: created (ceramic/porcelain tableware → 6911.10 + 6912.00)');
      }
    }

    // 2. COTTON_KNIT_HOODIE_SWEATSHIRT_INTENT → 6110.20 (cotton/blended knit hoodies, sweatshirts, pullovers)
    //    "100% cotton hoodie" → 6110.20.20.10
    //    "65% cotton 35% poly Hoodie" → 6110.20.20.10
    //    "Embroidered Airbending-inspired Swoosh Sweatshirt" → 6110.20.10.10
    //    "Thrasher zip up - L" → 6110.20.20.20
    //    "Black Cropped Hoodie" → 6110.20.20.10
    //    "women's pullover" → 6110.20.10.20
    //    "Men's cotton sweatshirt" → 6110.20.10.10
    //    6110.20 = jerseys/pullovers/sweatshirts of cotton (knitted/crocheted)
    //    NOTE: 6110.30 = same but man-made fibres; this is COTTON/blended-majority-cotton
    //    NOTE: JERSEY_SPORTS_APPAREL_INTENT → 6110.30 handles synthetic jerseys
    {
      const existing = allRules.find(r => r.id === 'COTTON_KNIT_HOODIE_SWEATSHIRT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_KNIT_HOODIE_SWEATSHIRT_INTENT',
          description: 'Cotton hoodies, sweatshirts, pullovers, zip-ups → ch.61 (6110.20)',
          pattern: {
            anyOf: [
              'hoodie', 'hoodies', 'sweatshirt', 'sweatshirts',
              'zip up hoodie', 'zip-up hoodie', 'zip up sweatshirt',
              'cropped hoodie', 'pullover hoodie', 'embroidered hoodie',
              'crewneck sweatshirt', 'crew neck sweatshirt', 'crewneck pullover',
              'pullover sweatshirt', 'graphic sweatshirt', 'embroidered sweatshirt',
              'cotton hoodie', 'cotton sweatshirt', 'cotton pullover', 'cotton zip up',
              'cotton knit sweater', 'knitted sweater cotton', 'handknit sweater',
              '100% cotton sweater', '100% cotton hoodie', '100% cotton sweatshirt',
              '1/4 zip pullover', 'quarter zip pullover',
              'boys sweatshirt', 'girls sweatshirt', 'kids hoodie', 'youth hoodie',
              'womens hoodie', 'women hoodie', "women's hoodie", 'mens hoodie', "men's hoodie",
              'cotton crop sweater', 'crop hoodie',
              'vest cotton knit', 'cotton vest knit',
            ],
            noneOf: [
              '100% polyester', 'all polyester', 'pure polyester',
              'fleece jacket', 'down jacket', 'windbreaker',
              'woven shirt', 'button shirt', 'dress shirt',
            ],
          },
          inject: [{ prefix: '6110.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6110.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_KNIT_HOODIE_SWEATSHIRT_INTENT: created (cotton hoodies/sweatshirts → 6110.20)');
      }
    }

    // 3. WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT → 6204.43 (women's/girls' synthetic woven dresses)
    //    "Black sleeveless dress, polyester and lyocell blend" → 6204.43.10.00
    //    "Tie-Dye Rayon Maxi Dress: Sleeveless Hippie Boho Style" → 6204.43.10.00
    //    "girls tulle dress" → 6204.43.20.00
    //    "Satin Gown" → 6204.43.30.10
    //    "Flower Girl Dress" → 6204.43.30.20
    //    "85% Polyester, 15% Spandex Womens Dress" → 6204.43.40.10
    //    "74% Viscose 24.4%Polyamide Womens Black Dress" → 6204.43.10.00
    //    "Maternity Robe + Nursing Gown" → 6204.43
    //    6204.43 = women's/girls' dresses of man-made fibres (woven)
    //    NOTE: COTTON_WOMEN_SKIRT_WOVEN_INTENT → 6204.52 handles cotton skirts; this is synthetic DRESSES
    //    NOTE: SYNTHETIC_KNIT_SKIRT_INTENT → 6204.53 handles synthetic skirts (knit)
    {
      const existing = allRules.find(r => r.id === 'WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT',
          description: 'Women\'s/girls\' synthetic dresses, satin gowns, tulle dresses → ch.62 (6204.43)',
          pattern: {
            anyOf: [
              'polyester dress', 'polyester women dress', 'women polyester dress',
              'rayon dress', 'rayon maxi dress', 'viscose dress', 'lyocell dress',
              'satin dress', 'satin gown', 'satin formal dress',
              'tulle dress', 'girls tulle dress', 'flower girl dress', 'flower girl gown',
              'women synthetic dress', 'synthetic women dress',
              'sleeveless dress polyester', 'maxi dress polyester', 'midi dress polyester',
              'bodycon dress', 'bodycon polyester',
              'spandex dress women', 'polyamide dress',
              'maternity gown', 'nursing gown', 'delivery gown', 'labor gown',
              'lace dress women', 'lace gown women',
              'formal gown', 'evening gown', 'cocktail dress',
            ],
            noneOf: [
              'cotton dress', '100% cotton dress', 'linen dress', 'wool dress', 'silk dress',
              'men dress shirt', 'shirt dress men',
              'baby dress', 'toddler dress only', 'doll dress',
            ],
          },
          inject: [{ prefix: '6204.43', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6204.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOMEN_SYNTHETIC_DRESS_WOVEN_INTENT: created (women\'s synthetic dresses → 6204.43)');
      }
    }

    // 4. GLASS_JAR_BOTTLE_DECANTER_INTENT → 7010.90 (glass containers, decanters, jars, carafes)
    //    "Decanter Set - Multi Flowers Whisky" → 7010.90.20.20
    //    "clear glass decanter bottle for spirits" → 7010.90.30.20
    //    "4oz glass mason jar with lid" → 7010.90.30.30
    //    "Custom Laser Engraved Glass Treat Jar" → 7010.90.30.30
    //    "Retro Pyrex 1.2L Jug: Corning Microwave Safe Glass Pitcher" → 7010.90.30.20
    //    "Glass bottle dispenser" → 7010.90.20.20
    //    "Vintage Avon White Ballerina Perfume Bottle" → 7010.90.10.00
    //    7010.90 = glass carboys, bottles, jars, pots, phials and other containers of glass
    //    NOTE: GLASS_DRINKING_MUG_TUMBLER_INTENT → 7013.37 handles drinking tumblers/mugs
    //    NOTE: 7013.49 = other glassware for table (bowls, vases, trays)
    {
      const existing = allRules.find(r => r.id === 'GLASS_JAR_BOTTLE_DECANTER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_JAR_BOTTLE_DECANTER_INTENT',
          description: 'Glass decanters, jars, mason jars, glass bottles, glass carafes → ch.70 (7010.90)',
          pattern: {
            anyOf: [
              'glass decanter', 'glass decanters', 'decanter set', 'whisky decanter',
              'spirit decanter', 'decanter bottle', 'decanter glass spirits',
              'glass pitcher', 'glass carafe', 'glass jug', 'glass dispenser',
              'glass jar', 'glass jars', 'mason jar', 'mason jars', 'glass mason jar',
              'apothecary jar', 'apothecary glass jar', 'spell jar', 'ritual jar',
              'glass treat jar', 'glass canister', 'glass storage jar',
              'glass bottle', 'glass bottles', 'glass bottle dispenser',
              'glass vial', 'glass phial', 'glass ampoule',
              'glass perfume bottle', 'vintage perfume bottle', 'avon perfume bottle',
              'glass carboys', 'laboratory glassware bottle',
              'glass pill bottle', 'medicine glass jar',
              'vinegar bottle glass', 'olive oil bottle glass',
              'engraved glass jar', 'personalized glass jar',
            ],
            noneOf: [
              'glass mug', 'glass tumbler', 'drinking glass', 'beer glass', 'wine glass',
              'glass bowl', 'glass vase', 'glass tray',
              'plastic bottle', 'stainless steel bottle', 'metal bottle', 'silicone bottle',
              'water bottle', 'sports bottle',
            ],
          },
          inject: [{ prefix: '7010.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7010.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('GLASS_JAR_BOTTLE_DECANTER_INTENT: created (glass containers/decanters → 7010.90)');
      }
    }

    // 5. BASE_METAL_IMITATION_JEWELRY_INTENT → 7117.19 (PVD, titanium, stainless steel jewelry, pewter)
    //    "18K Gold PVD Sun Signet Ring: Waterproof Vintage Style" → 7117.19.05.00
    //    "20G Titanium Steel Cross Huggie Earring" → 7117.19.05.00
    //    "Handmade Stainless Steel, Paper, and Glass Cuff Links" → 7117.19.15.00
    //    "100% English Pewter Womens Necklace" → 7117.19.30.00
    //    "button vtg pinback" → 7117.19.60.00
    //    "316 Stainless steel customizable ring core" → 7117.19
    //    "Religious pendant/charm non precious metal" → 7117.19.90.00
    //    "Base metal charm" → 7117.19.90.00
    //    7117.19 = imitation jewelry of base metal (stainless steel, titanium, PVD, pewter)
    //    NOTE: STERLING_SILVER_JEWELRY_INTENT → 7113.11 handles silver; GOLD_PRECIOUS_JEWELRY_INTENT → 7113.19
    //    NOTE: IMITATION_JEWELRY_OTHER_INTENT → 7117.90 handles non-metal imitation jewelry (acrylic, resin)
    {
      const existing = allRules.find(r => r.id === 'BASE_METAL_IMITATION_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BASE_METAL_IMITATION_JEWELRY_INTENT',
          description: 'PVD rings, titanium earrings, pewter necklace, stainless steel cufflinks → ch.71 (7117.19)',
          pattern: {
            anyOf: [
              'pvd ring', 'pvd jewelry', 'pvd earring', 'pvd necklace', 'pvd coated jewelry',
              '18k gold pvd', 'gold pvd ring', 'gold pvd necklace',
              'titanium earring', 'titanium ring', 'titanium bracelet', 'titanium jewelry',
              'titanium steel earring', 'titanium steel ring',
              'pewter necklace', 'pewter jewelry', 'pewter pendant', 'english pewter',
              'cufflinks', 'cuff links', 'stainless steel cufflinks', 'glass cufflinks',
              'pinback button', 'pin back button', 'vtg pinback', 'vintage pinback',
              'lapel pin metal', 'enamel pin metal',
              'base metal charm', 'base metal pendant', 'non precious metal charm',
              'non precious metal pendant', 'non precious metal jewelry',
              'stainless steel ring core', 'ring core stainless', 'customizable ring core',
              'religious pendant metal', 'crucifixes metal', 'rosary centerpiece metal',
              'antique crosses metal', 'stamped metal cross',
            ],
            noneOf: [
              'gold', 'silver', 'sterling', 'gold filled', '14k', '18k solid',
              'precious metal', 'fine jewelry',
              'plastic', 'acrylic', 'resin', 'wood', 'fabric',
            ],
          },
          inject: [{ prefix: '7117.19', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7117.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('BASE_METAL_IMITATION_JEWELRY_INTENT: created (PVD/titanium/pewter jewelry → 7117.19)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT37)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT37 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
