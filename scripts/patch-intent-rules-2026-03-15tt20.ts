#!/usr/bin/env ts-node
/**
 * Patch TT20 — 2026-03-15: Scrunchies + sports jerseys + glass tumblers + more.
 * Current: ~31.5% (after TT19)
 *
 * Targets:
 *  1. SCRUNCHIE_TEXTILE_HEADBAND_INTENT → 6117.80 (scrunchies, hair ties, soft headbands, neckties)
 *     "Personalized Satin Scrunchie" → 6117.80.30; "Boho headband, Workout headband" → 6117.80.85
 *     "4 pack of hair ties" → 6117.80.20; "vintage necktie" → 6117.80.87
 *     14 entries in 6117.80 cluster
 *  2. JERSEY_SPORTS_GARMENT_INTENT → 6110.30 (polyester hockey/football/soccer jerseys)
 *     "Polyester Hockey jersey" → 6110.30.10.3; "Football jersey" → 6110.30.10.3
 *     "BASEBALL JERSEY" → 6110.30.10.3; "mens polyester hoodie" → 6110.30.10.5
 *  3. GLASSWARE_DRINKING_INTENT: boost inject rank 22→5 for 7013.28 (crystal/whiskey tumblers)
 *     "Crystal Drinking Tumblers" → 7013.28.40; "whiskey glass" → 7013.28.60
 *  4. BABY_TODDLER_GARMENT_COTTON_INTENT → 6209.20 (onesies, bibs, toddler shirts)
 *     "Baby Onesie" → 6209.20.20; "Toddler Shirt" → 6209.20.20; "DMC Toddler Bib" → 6209.20.50
 *  5. BOOK_COMIC_MANGA_MEDIA_INTENT improvement: add 'comic book', 'manga', 'magazine',
 *     'trading card' to BOOK_NOVEL_PAPERBACK_INTENT (or create supplement rule)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt20.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };

    // 1. SCRUNCHIE_TEXTILE_HEADBAND_INTENT → 6117.80 (scrunchies, hair ties, soft headbands)
    //    "Personalized Dusty Pink Satin Scrunchie" → 6117.80.30.1
    //    "Blue & White Cotton Scrunchie" → 6117.80.30.1
    //    "4 pack of hair ties" → 6117.80.20.0
    //    "Boho headband, Workout headband, Wide twist headband" → 6117.80.85.0
    //    "vintage necktie rayon knit" → 6117.80.87
    //    "Silk Cravat Woven" → 6117.80.20.0
    //    "Rose Croix Scottish Rite 32nd Degree Necktie Red" → 6117.80.20.0
    //    NOTE: Do NOT use generic 'headband' (conflicts with HAIR_ACCESSORY_INTENT → 9615)
    {
      const existing = allRules.find(r => r.id === 'SCRUNCHIE_TEXTILE_HEADBAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SCRUNCHIE_TEXTILE_HEADBAND_INTENT',
          description: 'Scrunchies, hair ties, soft textile headbands, neckties → ch.61 (6117.80)',
          pattern: {
            anyOf: [
              'scrunchie', 'scrunchies', 'satin scrunchie', 'velvet scrunchie', 'silk scrunchie',
              'cotton scrunchie', 'fabric scrunchie', 'hair scrunchie', 'hair tie', 'hair ties',
              'elastic hair tie', 'cloth hair tie', 'pack of hair ties',
              'boho headband', 'workout headband', 'yoga headband', 'twist headband',
              'wide headband', 'wide twist headband', 'fabric headband', 'textile headband',
              'stretch headband', 'knit headband', 'crochet headband', 'woven headband',
              'head wrap', 'headwrap', 'turban headband', 'boho wrap',
              'necktie', 'neckties', 'neck tie', 'vintage necktie', 'silk necktie',
              'knit tie', 'knitted tie', 'cravat', 'silk cravat', 'woven cravat',
              'hearing aid headband',
            ],
            noneOf: ['headband alice', 'alice band', 'hair band rigid', 'plastic headband'],
          },
          inject: [{ prefix: '6117.80', syntheticRank: 5 }],
          boosts: [{ delta: 0.60, prefixMatch: '6117.8' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SCRUNCHIE_TEXTILE_HEADBAND_INTENT: created (scrunchies/hair ties/headbands/neckties → 6117.80)');
      }
    }

    // 2. JERSEY_SPORTS_APPAREL_INTENT → 6110.30 (polyester jerseys and hoodies)
    //    "Polyester Hockey jersey" → 6110.30.10.3; "Football jersey" → 6110.30.10.3
    //    "BASEBALL JERSEY" → 6110.30.10.3; "mens polyester hoodie" → 6110.30.10.5
    //    "Kids soccer shirt" → 6110.30.10.1
    {
      const existing = allRules.find(r => r.id === 'JERSEY_SPORTS_APPAREL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'JERSEY_SPORTS_APPAREL_INTENT',
          description: 'Sports jerseys, polyester hoodies, football/hockey/soccer jerseys → ch.61 (6110.30)',
          pattern: {
            anyOf: [
              'hockey jersey', 'football jersey', 'soccer jersey', 'baseball jersey',
              'sports jersey', 'team jersey', 'basketball jersey', 'lacrosse jersey',
              'jersey shirt', 'polyester jersey', 'nylon jersey',
              'polyester hoodie', 'polyester sweatshirt', 'polyester pullover',
              'fleece hoodie', 'fleece sweatshirt', 'fleece pullover',
              'polyester fleece', 'synthetic fleece', 'tech fleece hoodie',
              'soccer shirt', 'kids soccer shirt',
            ],
            noneOf: ['cotton hoodie', 'cotton sweatshirt', 'leather jacket', 'denim jacket',
                     'woven shirt', 'dress shirt', 'polo shirt'],
          },
          inject: [{ prefix: '6110.30', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6110.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('JERSEY_SPORTS_APPAREL_INTENT: created (sports jerseys/polyester hoodies → 6110.30)');
      }
    }

    // 3. GLASSWARE_DRINKING_INTENT: boost inject rank 22→5
    //    "Crystal Drinking Tumblers" → 7013.28.40; "whiskey glass" → 7013.28.60
    //    "Duralex Picardie Highball Glasses" → 7013.28.05; "tumblers set" → 7013.28.05
    //    Current inject ranks 22-28 are too low (score ~0.012, barely competitive)
    {
      const e = allRules.find(r => r.id === 'GLASSWARE_DRINKING_INTENT');
      if (e) {
        const newInject = [
          { prefix: '7013.22', syntheticRank: 5 },
          { prefix: '7013.28', syntheticRank: 6 },
          { prefix: '7013.37', syntheticRank: 7 },
        ];
        const newPat = addAnyOf(e,
          'tumbler set', 'tumblers set', 'glass tumbler set', 'drinking glasses set',
          'whiskey glass', 'whiskey glasses', 'crystal tumbler', 'crystal tumblers',
          'crystal drinking', 'duralex', 'picardie glass', 'cafe glass',
          'shot glass set', 'bar glass set', 'rocks glass', 'old fashioned glass',
        );
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, inject: newInject, pattern: newPat } });
        console.log('GLASSWARE_DRINKING_INTENT: boosted inject rank 22→5, added crystal/whiskey/tumbler terms');
      }
    }

    // 4. BABY_TODDLER_GARMENT_COTTON_INTENT → 6209.20 (baby/children's cotton garments)
    //    "Baby Onesie" → 6209.20.20.0; "Toddler Shirt" → 6209.20.20.0
    //    "DMC Toddler Bib" → 6209.20.50.3; "toddler jean overalls" → 6209.20.50.3
    //    "Bunny or Bear Ear Cotton Baby Bonnet" (see 6505 cluster) — different
    {
      const existing = allRules.find(r => r.id === 'BABY_TODDLER_GARMENT_COTTON_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BABY_TODDLER_GARMENT_COTTON_INTENT',
          description: 'Baby/toddler garments: onesies, bibs, rompers, infant shirts → ch.62 (6209.20)',
          pattern: {
            anyOf: [
              'baby onesie', 'onesie', 'onesies', 'infant onesie', 'newborn onesie',
              'baby romper', 'infant romper', 'toddler romper', 'baby bodysuit',
              'toddler bib', 'baby bib', 'infant bib', 'drool bib', 'bandana bib',
              'toddler overalls', 'baby overalls', 'infant overalls', 'jean overalls toddler',
              'toddler shirt', 'baby shirt', 'infant shirt', 'toddler tee',
              'baby clothes set', 'newborn clothes', 'baby dress', 'toddler dress',
              'baby set', 'infant set', 'layette',
            ],
            noneOf: ['dog onesie', 'cat onesie', 'adult onesie', 'dog bib', 'pet bib'],
          },
          inject: [{ prefix: '6209.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6209.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('BABY_TODDLER_GARMENT_COTTON_INTENT: created (onesies/bibs/toddler clothes → 6209.20)');
      }
    }

    // 5. Update BOOK_NOVEL_PAPERBACK_INTENT: add comic/manga/magazine terms
    //    "comic book" already returns 4901.99 organically, but let's add to rule for robustness
    //    "BGS graded manga", "Entertainment Weekly magazine" → 4901.99
    //    Avoid adding 'trading card' (conflicts with ch.95 Pokemon/game cards)
    {
      const e = allRules.find(r => r.id === 'BOOK_NOVEL_PAPERBACK_INTENT');
      if (e) {
        const newPat = addAnyOf(e,
          'comic book', 'comic books', 'manga', 'graphic novel', 'graphic novels',
          'vintage magazine', 'magazine issue', 'graded manga', 'graded comic',
          'first edition book', 'limited edition book', 'first print', 'first printing',
          'insert card comic', 'promo card set', 'chromium card', 'magnachrome card',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: newPat } });
        console.log('BOOK_NOVEL_PAPERBACK_INTENT: added comic/manga/magazine/first edition terms');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT20)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT20 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
