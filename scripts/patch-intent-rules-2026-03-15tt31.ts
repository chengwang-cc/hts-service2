#!/usr/bin/env ts-node
/**
 * Patch TT31 — 2026-03-15: Glass mugs + imitation jewelry + audio media + suede shoes + men's cotton trousers.
 * Current: ~32.48% (after TT28; TT29/TT30 pending eval)
 *
 * Targets:
 *  1. GLASS_DRINKING_MUG_TUMBLER_INTENT → 7013.37 (glass beer mugs, tumblers, drinking glasses)
 *     "16oz glass beer mug" → 7013.37; "18 oz glass tumbler" → 7013.37; 20 entries
 *  2. IMITATION_JEWELRY_OTHER_INTENT → 7117.90 (sarbloh steel kada, costume jewelry non-metal base)
 *     "Plain Sarbloh Kada Design 2" → 7117.90; "Used Costume Jewellery" → 7117.90; 21 entries
 *  3. AUDIO_MEDIA_CASSETTE_CD_INTENT → 8523.49 (CDs, audio cassettes, video tapes, recorded media)
 *     "POP Music CD Collection Late 90s Early 00s" → 8523.49; "Agfa Stereochrom cassette" → 8523.29; 34 entries (8523.29+8523.49)
 *  4. SUEDE_LEATHER_SHOE_INTENT → 6404.11 (suede shoes, leather upper/rubber sole footwear)
 *     "suede shoes" → 6404.11; "Converse Chuck Taylor All Star Leather High Top" → 6404.11; 17 entries
 *  5. MEN_COTTON_TROUSER_PANT_INTENT → 6203.42 (men's cotton trousers, pants, jeans)
 *     "Vintage 100% cotton tee and jeans" → 6203.42; "Peugeot Sweatshirt" → 6203.42; 14 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt31.ts
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

    // 1. GLASS_DRINKING_MUG_TUMBLER_INTENT → 7013.37 (glass mugs, glass tumblers, pint glasses)
    //    "16oz glass beer mug" → 7013.37.xx
    //    "18 oz glass tumbler" → 7013.37.xx
    //    7013.37 = other drinking glasses (not glass ceramics, not lead crystal)
    //    NOTE: GLASSWARE_DRINKING_INTENT already handles some; this adds glass-specific terms
    {
      const existing = allRules.find(r => r.id === 'GLASS_DRINKING_MUG_TUMBLER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_DRINKING_MUG_TUMBLER_INTENT',
          description: 'Glass beer mugs, glass tumblers, pint glasses, drinking glasses → ch.70 (7013.37)',
          pattern: {
            anyOf: [
              'glass beer mug', 'glass mug', 'glass coffee mug', 'glass tea mug',
              'glass tumbler', 'glass tumblers', 'drinking glass', 'drinking glasses',
              'pint glass', 'pint glasses', 'pilsner glass', 'pub glass',
              'highball glass', 'rocks glass', 'old fashioned glass',
              'glass cup', 'glass cups', 'water glass', 'juice glass',
              'mason jar glass', 'mason jar drinking', 'glass mason jar',
              'glass set', 'set of glasses', 'glasses set',
              'crystal glass', 'crystal glasses', 'crystal tumbler',
              'stemless wine glass', 'stemless glass',
            ],
            noneOf: ['ceramic mug', 'stainless mug', 'travel mug', 'insulated mug',
                     'plastic cup', 'paper cup', 'wine glass', 'champagne flute',
                     'glass ornament', 'glass vase', 'glass candle holder'],
          },
          inject: [{ prefix: '7013.37', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7013.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('GLASS_DRINKING_MUG_TUMBLER_INTENT: created (glass mugs/tumblers → 7013.37)');
      }
    }

    // 2. IMITATION_JEWELRY_OTHER_INTENT → 7117.90 (sarbloh/steel kada, costume jewelry non-base-metal)
    //    "Plain Sarbloh Kada Design 2 -2.82" → 7117.90.xx
    //    "Used Costume Jewellery - Bracelet" → 7117.90.xx
    //    7117.90 = other imitation jewelry (not of base metal, e.g. plastic, acrylic, sarbloh steel)
    //    NOTE: PVD_TITANIUM_STEEL_JEWELRY_INTENT → 7117.19 handles base metal/titanium
    {
      const existing = allRules.find(r => r.id === 'IMITATION_JEWELRY_OTHER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'IMITATION_JEWELRY_OTHER_INTENT',
          description: 'Costume jewelry, sarbloh kada, fashion jewelry (non-base-metal) → ch.71 (7117.90)',
          pattern: {
            anyOf: [
              'costume jewelry', 'costume jewellery', 'fashion jewelry', 'fashion jewellery',
              'costume bracelet', 'costume necklace', 'costume earrings', 'costume ring',
              'sarbloh', 'sarbloh kada', 'sarbloh kara', 'steel kada', 'sikh kara',
              'acrylic jewelry', 'acrylic jewellery', 'resin jewelry', 'resin jewellery',
              'plastic jewelry', 'plastic bangle', 'plastic bracelet', 'plastic ring jewelry',
              'enamel jewelry', 'enamel jewellery', 'enamel bracelet', 'enamel bangle',
              'wooden jewelry', 'wooden bangle', 'wood bracelet', 'wood jewelry',
              'shell jewelry', 'shell bracelet', 'shell necklace',
              'fabric jewelry', 'cloth bracelet', 'macrame bracelet',
            ],
            noneOf: ['sterling silver', 'gold filled', '10k gold', '14k gold', '18k gold',
                     'titanium', 'stainless steel jewelry', 'pvd', 'base metal chain',
                     'diamond', 'gemstone jewelry', 'precious stone'],
          },
          inject: [{ prefix: '7117.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7117.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('IMITATION_JEWELRY_OTHER_INTENT: created (costume jewelry/sarbloh kada → 7117.90)');
      }
    }

    // 3. AUDIO_MEDIA_CD_CASSETTE_INTENT → 8523.49 (CDs, DVDs) + 8523.29 (audio cassettes, tapes)
    //    "POP Music CD Collection Late 90s Early 00s" → 8523.49
    //    "Agfa Stereochrom - 1978 - EU - 90+6 Minutes" (audio cassette) → 8523.29
    //    "video tape movie" → 8523.29 (or 8523.49 for DVD)
    //    8523.49 = optical media (CDs, DVDs, Blu-ray)
    //    8523.29 = magnetic media (cassettes, video tapes, 8-track)
    {
      const existing = allRules.find(r => r.id === 'AUDIO_MEDIA_CD_CASSETTE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUDIO_MEDIA_CD_CASSETTE_INTENT',
          description: 'Music CDs, audio cassettes, video tapes, DVDs, recorded media → ch.85 (8523.49 / 8523.29)',
          pattern: {
            anyOf: [
              'music cd', 'cd collection', 'audio cd', 'compact disc',
              'vinyl record', 'vinyl lp', 'vinyl album', 'record album', 'lp record',
              'dvd movie', 'dvd disc', 'blu-ray', 'bluray',
              'audio cassette', 'cassette tape', 'cassette album', 'music cassette',
              'video tape', 'vhs tape', 'vhs movie', 'betamax',
              '8-track', '8 track tape', 'reel to reel',
              'recorded music', 'music album cd', 'band cd', 'concert dvd',
            ],
            noneOf: ['usb drive', 'sd card', 'memory card', 'hard drive', 'blank cd',
                     'blank dvd', 'blank cassette', 'cd case empty', 'cd holder'],
          },
          inject: [
            { prefix: '8523.49', syntheticRank: 5 },
            { prefix: '8523.29', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '8523' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('AUDIO_MEDIA_CD_CASSETTE_INTENT: created (CDs/cassettes/DVDs → 8523.49/8523.29)');
      }
    }

    // 4. SUEDE_LEATHER_SHOE_INTENT → 6404.11 (suede/leather upper shoes with rubber/synthetic sole)
    //    "suede shoes" → 6404.11.xx
    //    "Converse Chuck Taylor All Star Leather High Top in Black" → 6404.11.xx
    //    6404.11 = sports footwear, tennis shoes, basketball shoes, with textile/leather upper
    //    NOTE: ATHLETIC_SNEAKER_SHOE_INTENT → 6404.11 already exists — check if overlap
    {
      const existing = allRules.find(r => r.id === 'SUEDE_LEATHER_SHOE_INTENT');
      const athleticExisting = allRules.find(r => r.id === 'ATHLETIC_SNEAKER_SHOE_INTENT');
      if (!existing) {
        // Check if ATHLETIC_SNEAKER_SHOE_INTENT already covers suede shoes
        const athleticAnyOf = athleticExisting ? ((athleticExisting.pattern as any)?.anyOf || []) : [];
        const hasSuede = athleticAnyOf.some((t: string) => t.includes('suede'));
        if (!hasSuede) {
          const newRule: IntentRule = {
            id: 'SUEDE_LEATHER_SHOE_INTENT',
            description: 'Suede shoes, leather hi-tops, canvas sneakers, Converse-style → ch.64 (6404.11)',
            pattern: {
              anyOf: [
                'suede shoes', 'suede sneakers', 'suede trainers', 'suede boots',
                'suede loafers', 'suede oxford', 'suede lace up',
                'leather high top', 'leather hi top', 'leather high-top sneaker',
                'leather low top', 'leather sneaker', 'leather trainer',
                'canvas sneaker', 'canvas shoes', 'canvas high top',
                'converse', 'chuck taylor', 'all star shoe', 'vans shoe',
                'plimsoll', 'plimsoll shoe', 'tennis shoe', 'court shoe sneaker',
                'leather court shoe', 'leather sport shoe',
              ],
              noneOf: ['running shoe', 'running sneaker', 'trail shoe', 'athletic sneaker',
                       'boot', 'ankle boot', 'dress shoe', 'oxford shoe', 'loafer shoe',
                       'sandal', 'slipper', 'heel', 'pump'],
            },
            inject: [{ prefix: '6404.11', syntheticRank: 5 }],
            boosts: [{ delta: 0.55, prefixMatch: '6404.1' }],
          } as IntentRule;
          patches.push({ priority: 565, rule: newRule });
          console.log('SUEDE_LEATHER_SHOE_INTENT: created (suede/leather shoes → 6404.11)');
        } else {
          console.log('SUEDE_LEATHER_SHOE_INTENT: skipped (ATHLETIC_SNEAKER_SHOE_INTENT already covers suede)');
        }
      }
    }

    // 5. MEN_COTTON_TROUSER_PANT_INTENT → 6203.42 (men's cotton trousers, jeans, pants, coveralls)
    //    "Vintage 100% cotton tee and jeans" → 6203.42.xx
    //    "Handmade Patchwork African Mudcloth Pants: Men's Cotton Trousers" → 6203.42.xx
    //    6203.42 = men's/boys' trousers of cotton (woven)
    //    NOTE: MEN_COTTON_JACKET_ANORAK_INTENT → 6201.30 handles jackets
    {
      const existing = allRules.find(r => r.id === 'MEN_COTTON_TROUSER_PANT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MEN_COTTON_TROUSER_PANT_INTENT',
          description: 'Men\'s cotton trousers, jeans, pants, mudcloth pants → ch.62 (6203.42)',
          pattern: {
            anyOf: [
              'men cotton trousers', 'mens cotton trousers', 'cotton trousers men',
              'men cotton pants', 'mens cotton pants', 'cotton pants men',
              'denim jeans', 'jeans denim', 'men jeans', 'mens jeans', 'vintage jeans',
              'cotton jeans', 'denim trousers', 'woven cotton pants',
              'mudcloth pants', 'mudcloth trousers', 'african pants men',
              'men chinos', 'cotton chinos', 'chino trousers',
              'khaki pants', 'khaki trousers', 'cargo pants cotton', 'cotton cargo pants',
              'men shorts cotton', 'cotton shorts men', 'cotton board shorts',
            ],
            noneOf: ['polyester pants', 'synthetic pants', 'nylon pants', 'fleece pants',
                     'women trousers', 'womens pants', 'girls jeans', 'baby pants',
                     'yoga pants', 'leggings', 'sweatpants', 'jogger pants'],
          },
          inject: [{ prefix: '6203.42', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6203.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('MEN_COTTON_TROUSER_PANT_INTENT: created (men\'s cotton trousers → 6203.42)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT31)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT31 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
