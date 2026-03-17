#!/usr/bin/env ts-node
/**
 * Patch TT30 — 2026-03-15: Hats + glass decor + gold jewelry + wooden articles + art prints.
 * Current: ~32.48% (after TT28; TT29 pending eval)
 *
 * Targets:
 *  1. HAT_CAP_BEANIE_HEADGEAR_INTENT → 6505.00 (baseball caps, beanies, bucket hats, fedoras)
 *     "FUCK YOUR DIET HAT" → 6505.00; "Vintage 1994 St.Patricks Day Top Hat" → 6505.00; 66 entries
 *  2. GLASS_DECORATIVE_HOME_INTENT → 7013.99 (glass ornaments, charms, coasters, decorative glass)
 *     "Handmade decorative charm" → 7013.99; "Glass mosaic coaster set" → 7013.99; 27 entries
 *  3. GOLD_PRECIOUS_JEWELRY_INTENT → 7113.19 (10k/14k/18k gold rings, pendants, necklaces)
 *     "Handmade 10k Gold Cross Pendant with Chain" → 7113.19; "10k Gold Mens Signet Ring" → 7113.19; 27 entries
 *  4. WOODEN_MISC_ARTICLE_INTENT → 4421.99 (wooden decorative letters, wooden articles nec)
 *     "Decorative wooden letter" → 4421.99; "Decorative wooden letters" → 4421.99; 26 entries
 *  5. ART_PRINT_POSTER_PHOTO_INTENT → 4911.91 (art prints, movie posters, photographs)
 *     "Arrival Inspired Art Print" → 4911.91; "Challengers Inspired Art Print" → 4911.91; 21 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt30.ts
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

    // 1. HAT_CAP_BEANIE_HEADGEAR_INTENT → 6505.00 (hats and headgear of any material)
    //    "FUCK YOUR DIET HAT" → 6505.00
    //    "Vintage 1994 Saint Patricks Day St.Patty-s Shamrock Top Hat" → 6505.00
    //    6505.00 = hats and other headgear, knitted or crocheted or made from textile
    //    NOTE: includes baseball caps, beanies, fedoras, bucket hats, top hats
    {
      const existing = allRules.find(r => r.id === 'HAT_CAP_BEANIE_HEADGEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HAT_CAP_BEANIE_HEADGEAR_INTENT',
          description: 'Baseball caps, beanies, bucket hats, fedoras, top hats → ch.65 (6505.00)',
          pattern: {
            anyOf: [
              'baseball cap', 'baseball hat', 'snapback cap', 'snapback hat',
              'fitted cap', 'fitted hat', 'trucker hat', 'trucker cap',
              'beanie', 'knit beanie', 'wool beanie', 'winter beanie',
              'bucket hat', 'bucket cap', 'sun hat', 'gardening hat',
              'fedora', 'fedora hat', 'straw hat', 'panama hat',
              'top hat', 'derby hat', 'cowboy hat', 'stetson hat',
              'beret', 'newsboy cap', 'flat cap', 'ivy cap',
              'dad hat', 'dad cap', 'five panel hat', 'six panel hat',
              'embroidered hat', 'embroidered cap', 'custom hat', 'custom cap',
              'slouchy beanie', 'pom pom beanie', 'toque', 'winter hat',
            ],
            noneOf: ['helmet', 'hard hat', 'safety hat', 'swimming cap', 'shower cap',
                     'hair net', 'wig', 'headband', 'bandana'],
          },
          inject: [{ prefix: '6505.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6505' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('HAT_CAP_BEANIE_HEADGEAR_INTENT: created (caps/hats/beanies → 6505.00)');
      }
    }

    // 2. GLASS_DECORATIVE_HOME_INTENT → 7013.99 (glass ornaments, charms, coasters, vases, decor)
    //    "Handmade decorative charm" → 7013.99.xx
    //    "Glass mosaic coaster set" → 7013.99.xx
    //    7013.99 = other glassware for table, kitchen, toilet, indoor decoration
    //    NOTE: GLASSWARE_DRINKING_INTENT → 7013.37 handles drinking glasses
    {
      const existing = allRules.find(r => r.id === 'GLASS_DECORATIVE_HOME_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_DECORATIVE_HOME_INTENT',
          description: 'Glass decorative items, glass charms, glass coasters, glass ornaments → ch.70 (7013.99)',
          pattern: {
            anyOf: [
              'glass charm', 'glass charms', 'decorative glass charm',
              'glass coaster', 'glass coasters', 'glass coaster set',
              'glass mosaic', 'glass mosaic coaster', 'fused glass',
              'glass figurine', 'glass sculpture', 'glass art',
              'glass decor', 'decorative glass', 'glass home decor',
              'glass vase', 'glass flower vase', 'hand blown glass vase',
              'glass bowl decorative', 'decorative glass bowl', 'glass centerpiece',
              'glass planter', 'glass terrarium', 'glass candle holder',
              'glass pendant', 'glass bead necklace', 'lampwork glass',
              'glass knick knack', 'glass trinket', 'glass paperweight',
            ],
            noneOf: ['drinking glass', 'wine glass', 'beer glass', 'shot glass',
                     'glass mug', 'tumbler glass', 'cocktail glass', 'champagne glass',
                     'christmas ornament', 'holiday ornament'],
          },
          inject: [{ prefix: '7013.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7013.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('GLASS_DECORATIVE_HOME_INTENT: created (glass decor/charms/coasters → 7013.99)');
      }
    }

    // 3. GOLD_PRECIOUS_JEWELRY_INTENT → 7113.19 (10k/14k/18k gold jewelry, pendants, rings)
    //    "Handmade 10k Gold Cross Pendant with Chain" → 7113.19.xx
    //    "Handmade 10k Gold Mens Signet Ring R-M-10K-19" → 7113.19.xx
    //    7113.19 = articles of jewelry of other precious metal (gold, platinum)
    //    NOTE: 7113.11 = sterling silver; 7117.19 = base metal (PVD/titanium)
    {
      const existing = allRules.find(r => r.id === 'GOLD_PRECIOUS_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GOLD_PRECIOUS_JEWELRY_INTENT',
          description: '10k/14k/18k gold rings, pendants, necklaces, bracelets → ch.71 (7113.19)',
          pattern: {
            anyOf: [
              '10k gold', '14k gold', '18k gold', '24k gold',
              '10 karat gold', '14 karat gold', '18 karat gold',
              'gold ring', 'gold pendant', 'gold necklace', 'gold bracelet', 'gold earring',
              'solid gold', 'solid gold ring', 'solid gold necklace',
              'gold cross pendant', 'gold signet ring', 'gold chain necklace',
              'yellow gold ring', 'white gold ring', 'rose gold ring',
              'gold filled ring', 'gold filled necklace', 'gold filled bracelet',
              'real gold jewelry', 'fine gold jewelry',
            ],
            noneOf: ['gold plated', 'gold tone', 'gold color', 'pvd gold', 'titanium gold',
                     'stainless gold', 'costume gold', 'fashion gold', 'alloy gold',
                     'sterling silver', 'silver ring', 'gemstone', 'diamond'],
          },
          inject: [{ prefix: '7113.19', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7113.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GOLD_PRECIOUS_JEWELRY_INTENT: created (10k/14k gold jewelry → 7113.19)');
      }
    }

    // 4. WOODEN_MISC_ARTICLE_INTENT → 4421.99 (decorative wooden letters, misc wooden articles)
    //    "Decorative wooden letter" → 4421.99.xx
    //    "Decorative wooden letters" → 4421.99.xx
    //    4421.99 = other articles of wood (not boxes/frames → 4420.90)
    //    NOTE: WOODEN_BOX_CASKET_INTENT → 4420.90 handles wooden boxes/frames
    {
      const existing = allRules.find(r => r.id === 'WOODEN_MISC_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_MISC_ARTICLE_INTENT',
          description: 'Wooden decorative letters, wooden signs, wooden pegs, misc wooden articles → ch.44 (4421.99)',
          pattern: {
            anyOf: [
              'wooden letter', 'wood letter', 'wooden letters', 'wood letters',
              'decorative wooden letter', 'wooden alphabet', 'wood alphabet',
              'wooden sign', 'wood sign', 'wooden wall sign', 'wooden word sign',
              'wooden peg', 'wood peg', 'wooden clothes peg', 'wooden clothespeg',
              'wooden spool', 'wood spool', 'wooden bobbin',
              'wooden skewer', 'wood skewer', 'wooden cocktail pick',
              'wooden block', 'wood block', 'wooden toy block',
              'wooden dowel', 'wood dowel', 'wooden rod',
              'wooden name', 'wood name', 'wooden monogram',
              'wood slice', 'wooden slice', 'birch slice',
            ],
            noneOf: ['wooden box', 'wooden frame', 'wooden tray', 'wooden chest',
                     'wood box', 'wood frame', 'wood cutting board', 'wood plaque'],
          },
          inject: [{ prefix: '4421.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4421.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOODEN_MISC_ARTICLE_INTENT: created (wooden letters/signs/pegs → 4421.99)');
      }
    }

    // 5. ART_PRINT_POSTER_PHOTO_INTENT → 4911.91 (art prints, movie posters, printed photos)
    //    "Arrival Inspired Art Print" → 4911.91.xx
    //    "Challengers Inspired Art Print - Luca Guadagnino Poster" → 4911.91.xx
    //    4911.91 = printed pictures, designs, photographs
    //    NOTE: COMMERCIAL_ADVERTISING_PRINT_INTENT → 4911.10 handles catalogs/flyers
    {
      const existing = allRules.find(r => r.id === 'ART_PRINT_POSTER_PHOTO_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ART_PRINT_POSTER_PHOTO_INTENT',
          description: 'Art prints, movie posters, illustrated prints, photographs → ch.49 (4911.91)',
          pattern: {
            anyOf: [
              'art print', 'art prints', 'inspired art print', 'movie art print',
              'film poster', 'movie poster', 'cinema poster', 'retro poster',
              'illustrated print', 'illustration print', 'giclee print',
              'digital art print', 'limited edition print', 'numbered print',
              'photo print', 'photograph print', 'fine art print',
              'wall art print', 'gallery print', 'framed art print',
              'anime poster', 'band poster', 'music poster', 'concert poster',
              'vintage poster', 'minimalist poster', 'decorative poster',
              'canvas print', 'canvas art print',
            ],
            noneOf: ['catalog', 'flyer', 'brochure', 'advertisement', 'promotional',
                     'sticker', 'label', 'wrapping paper', 'greeting card'],
          },
          inject: [{ prefix: '4911.91', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4911.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('ART_PRINT_POSTER_PHOTO_INTENT: created (art prints/posters → 4911.91)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT30)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT30 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
