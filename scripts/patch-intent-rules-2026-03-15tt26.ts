#!/usr/bin/env ts-node
/**
 * Patch TT26 — 2026-03-15: Metal trays + neoprene rubber + ad print + cotton women's dress + hair combs.
 * Current: ~32.06% (after TT24; TT25 pending eval)
 *
 * Targets:
 *  1. METAL_TRAY_HOUSEHOLD_INTENT → 7323.99 (iron/steel trays, candelabras, metal kitchen articles)
 *     "Silver Plate Tray" → 7323.99; "Vintage Partylite metal Candelabra" → 7323.99; 13 entries
 *  2. NEOPRENE_RUBBER_ARTICLE_INTENT → 4016.99 (neoprene insulators, koozies, mouse pads, rubber articles)
 *     "neoprene beverage insulator" → 4016.99; "Large Desk Mousepad" → 4016.99; 11 entries
 *  3. COMMERCIAL_ADVERTISING_PRINT_INTENT → 4911.10 (printed catalogs, promotional flyers, brochures)
 *     "2026 Printed Color Catalog" → 4911.10; "Full-Color Paper Promotional Flyers" → 4911.10; 12 entries
 *  4. COTTON_WOMEN_DRESS_KURTA_INTENT → 6204.42 (women's cotton woven dresses, kurtas, African print tops)
 *     "Black Georgette Mirror Kurta" → 6204.42.10; "ZAIRE African Print Women's Top" → 6204.42.20; 13 entries
 *  5. HAIR_COMB_PICK_INTENT → 9615.90 (hair combs, picks, fine tooth combs)
 *     "The Grip Comb 2.0" → 9615.90; "The Grip Comb PRO" → 9615.90; 12 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt26.ts
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

    // 1. METAL_TRAY_HOUSEHOLD_INTENT → 7323.99 (iron/steel household articles, trays, candelabras)
    //    "Silver Plate Tray" → 7323.99.00.50 (metal serving tray, not precious metal)
    //    "Vintage Partylite metal Candelabra, Retro Wedding Decor" → 7323.99.00.10
    //    7323.99 = other kitchen/household articles of iron or steel (not stainless, not cast iron)
    //    NOTE: STAINLESS_STEEL_KITCHEN_INTENT handles 7323.93; this is for non-stainless iron/steel
    {
      const existing = allRules.find(r => r.id === 'METAL_TRAY_HOUSEHOLD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'METAL_TRAY_HOUSEHOLD_INTENT',
          description: 'Metal trays, candelabras, iron/steel household articles → ch.73 (7323.99)',
          pattern: {
            anyOf: [
              'metal tray', 'serving tray metal', 'silver plate tray', 'plated serving tray',
              'metal serving tray', 'iron tray', 'tin tray', 'pewter tray',
              'metal candelabra', 'candelabra metal', 'metal candlestick holder',
              'iron candelabra', 'wrought iron candelabra', 'metal candle holder set',
              'metal bowl', 'metal serving bowl', 'metal mixing bowl',
              'metal colander', 'metal strainer', 'metal ladle', 'metal spoon set',
              'metal utensil set', 'metal kitchen set', 'metal tool set kitchen',
            ],
            noneOf: ['stainless steel', 'sterling silver', 'silver plated silver', 'gold plated',
                     'ceramic', 'glass', 'wooden tray', 'bamboo tray', 'plastic tray'],
          },
          inject: [{ prefix: '7323.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '7323.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('METAL_TRAY_HOUSEHOLD_INTENT: created (metal trays/candelabras → 7323.99)');
      }
    }

    // 2. NEOPRENE_RUBBER_ARTICLE_INTENT → 4016.99 (neoprene/rubber articles, koozies, mouse pads)
    //    "neoprene beverage insulator" → 4016.99.45.00 (rubber insulator/koozie)
    //    "Large Desk Mousepad" → 4016.99.55.00 (rubber mouse pad)
    //    4016.99 = other articles of vulcanized rubber (not cellular, not foam)
    {
      const existing = allRules.find(r => r.id === 'NEOPRENE_RUBBER_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'NEOPRENE_RUBBER_ARTICLE_INTENT',
          description: 'Neoprene insulators, koozies, mouse pads, rubber articles → ch.40 (4016.99)',
          pattern: {
            anyOf: [
              'neoprene insulator', 'beverage insulator', 'can insulator', 'bottle insulator',
              'neoprene sleeve', 'neoprene can sleeve', 'neoprene bottle sleeve',
              'koozie', 'koozies', 'can koozie', 'bottle koozie', 'beer koozie',
              'neoprene mat', 'rubber mat', 'desk mat rubber', 'anti-fatigue mat',
              'mouse pad', 'mousepad', 'gaming mouse pad', 'desk mousepad', 'rubber mousepad',
              'neoprene pouch laptop', 'neoprene laptop sleeve',
              'rubber gasket', 'rubber seal', 'rubber grommet',
            ],
            noneOf: ['foam mat', 'yoga mat', 'exercise mat', 'fabric mat', 'vinyl mat'],
          },
          inject: [{ prefix: '4016.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4016.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('NEOPRENE_RUBBER_ARTICLE_INTENT: created (neoprene/rubber articles → 4016.99)');
      }
    }

    // 3. COMMERCIAL_ADVERTISING_PRINT_INTENT → 4911.10 (printed catalogs, flyers, promotional material)
    //    "2026 Printed Color Catalog" → 4911.10.xx
    //    "Full-Color Paper Promotional Flyers" → 4911.10.xx
    //    4911.10 = printed commercial advertising, price lists, commercial catalogs
    {
      const existing = allRules.find(r => r.id === 'COMMERCIAL_ADVERTISING_PRINT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COMMERCIAL_ADVERTISING_PRINT_INTENT',
          description: 'Printed catalogs, promotional flyers, advertising brochures → ch.49 (4911.10)',
          pattern: {
            anyOf: [
              'printed catalog', 'product catalog', 'color catalog', 'printed catalogue',
              'promotional flyer', 'advertising flyer', 'commercial flyer', 'sales flyer',
              'advertising brochure', 'promotional brochure', 'product brochure',
              'promotional material print', 'print flyer', 'flyer print',
              'promotional postcard', 'advertising postcard', 'business flyer',
            ],
            noneOf: ['comic book', 'manga', 'novel', 'textbook', 'art print', 'poster'],
          },
          inject: [{ prefix: '4911.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '4911.1' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('COMMERCIAL_ADVERTISING_PRINT_INTENT: created (printed catalogs/flyers → 4911.10)');
      }
    }

    // 4. COTTON_WOMEN_DRESS_KURTA_INTENT → 6204.42 (women's cotton woven dresses, kurtas, tops)
    //    "Black - Georgette Mirror Kurta - 40" → 6204.42.10.00 (cotton printed dress)
    //    "ZAIRE African Print Women's Top - S" → 6204.42.20.00 (african print)
    //    "AMINA African Print Women's Dress (Hi-Low)" → 6204.42.20.00
    //    "AYAJE African Print Kimono Women's Jacket" → 6204.42.20.00
    //    6204.42 = women's/girls' dresses of cotton (woven)
    //    NOTE: SYNTHETIC_WOMEN_DRESS_INTENT → 6204.43 handles synthetic (polyester/rayon)
    {
      const existing = allRules.find(r => r.id === 'COTTON_WOMEN_DRESS_KURTA_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_WOMEN_DRESS_KURTA_INTENT',
          description: 'Women\'s cotton woven dresses, kurtas, African print tops → ch.62 (6204.42)',
          pattern: {
            anyOf: [
              'kurta', 'kurti', 'salwar kameez', 'anarkali', 'churidar kurta',
              'african print dress', 'african print top', 'african print women top',
              'african print women dress', 'ankara dress', 'ankara top', 'kente dress',
              'cotton women dress', 'cotton womens dress', 'women cotton dress',
              'cotton maxi dress', 'cotton boho dress', 'cotton sundress',
              'kaftan cotton', 'cotton kaftan', 'cotton tunic dress', 'tunic cotton',
              'cotton summer dress', 'cotton wrap dress', 'cotton shirt dress',
              'cotton midi dress', 'cotton mini dress',
            ],
            noneOf: ['polyester dress', 'rayon dress', 'synthetic dress', 'nylon dress',
                     'knit dress', 'jersey dress', 'sweater dress', 'crochet dress'],
          },
          inject: [{ prefix: '6204.42', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6204.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_WOMEN_DRESS_KURTA_INTENT: created (cotton dresses/kurtas → 6204.42)');
      }
    }

    // 5. HAIR_COMB_PICK_INTENT → 9615.90 (combs, hair picks, detangling combs)
    //    "The Grip Comb 2.0" → 9615.90.xx; "The Grip Comb PRO" → 9615.90.xx; 12 entries
    //    9615.90 = other combs, hair slides, and the like
    //    NOTE: HAIR_ACCESSORY_INTENT may already have 9615 whitelist but may not cover combs specifically
    {
      const existing = allRules.find(r => r.id === 'HAIR_COMB_PICK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HAIR_COMB_PICK_INTENT',
          description: 'Hair combs, picks, detangling combs, rat tail combs → ch.96 (9615.90)',
          pattern: {
            anyOf: [
              'hair comb', 'hair combs', 'comb', 'combs',
              'fine tooth comb', 'wide tooth comb', 'wide-tooth comb',
              'detangling comb', 'detangle comb', 'afro pick', 'hair pick',
              'tail comb', 'rat tail comb', 'rattail comb', 'pintail comb',
              'barber comb', 'styling comb', 'pocket comb', 'travel comb',
              'carbon comb', 'cellulose acetate comb', 'horn comb', 'wood comb',
              'beard comb', 'mustache comb',
            ],
            noneOf: ['hair brush', 'hair dryer', 'flat iron', 'curling iron', 'hair straightener',
                     'electric comb', 'honey comb', 'honeycomb'],
          },
          inject: [{ prefix: '9615.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9615.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('HAIR_COMB_PICK_INTENT: created (hair combs/picks → 9615.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT26)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT26 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
