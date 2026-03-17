#!/usr/bin/env ts-node
/**
 * Patch TT17 — 2026-03-15: Hats + wooden articles + gold jewelry + decorative glass.
 * Current: 30.89% (1552/5025)
 *
 * Targets:
 *  1. BEANIE_HAT_INTENT: inject rank 22→5, add trucker/snapback/camo/corduroy/nylon/golf hats
 *     "Tiger Trucker Hat" → missing; "Black snapback hat" → missing; 66 entries in 6505.00
 *  2. SCRUB_CAP_HAIR_BONNET_INTENT → 6505.00 (scrub caps, hair bonnets, baby bonnets)
 *     "Cotton Surgical Scrub Hat" → missing; "Hair Bonnet" → missing
 *  3. WOODEN_MISC_ARTICLE_INTENT → 4421.99 (embroidery hoops, wooden letters, shelves, etc.)
 *     26 entries in 4421.99; embroidery hoops, wooden countdown blocks, coat racks
 *  4. GOLD_CHAIN_INTENT: rank 22→4, add 14kt, 9k, signet ring etc.
 *     "14kt Yellow Gold Vintage Bar/Brick Charm" → missing due to '14k' vs '14kt'
 *  5. DECORATIVE_GLASS_ARTICLE_INTENT → 7013.99 (sake sets, mosaic coasters, murano glass)
 *     "Glass sake set", "Glass mosaic coaster set", "vintage murano glass ashtray" → 7013.99
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt17.ts
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

    // 1. BEANIE_HAT_INTENT: boost inject rank 22→5, add trucker/snapback/camo/golf hat terms
    //    "Tiger Trucker Hat", "Black snapback hat", "camo hat cotton", "corduroy hat", "nylon hat"
    //    "NFL Baseball Cap", "golf hat" — none of these match current anyOf
    {
      const e = allRules.find(r => r.id === 'BEANIE_HAT_INTENT');
      if (e) {
        const newPat = addAnyOf(e,
          'trucker hat', 'trucker cap', 'foam trucker', 'mesh trucker hat',
          'snapback', 'snapback hat', 'snapback cap', 'snapback fitted',
          'strapback hat', 'strapback cap', 'strap-back cap',
          'camo hat', 'camouflage hat', 'corduroy hat', 'corduroy cap',
          'nylon hat', 'polyester hat', 'cotton hat',
          'golf hat', 'golf cap', 'sport cap',
          'dad hat', 'low profile cap', 'low profile hat',
          'embroidered hat', 'embroidered cap', 'nfl cap', 'nfl hat',
          'baseball hat', 'vintage hat cap', 'vintage snapback',
        );
        const newInject = [
          { prefix: '6505.00', syntheticRank: 5 },
          { prefix: '6504.00', syntheticRank: 26 },
        ];
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, pattern: newPat, inject: newInject } });
        console.log('BEANIE_HAT_INTENT: boosted inject rank 22→5, added trucker/snapback/golf hats');
      }
    }

    // 2. SCRUB_CAP_HAIR_BONNET_INTENT → 6505.00 (scrub caps, hair bonnets, baby bonnets)
    //    6505.00.20.3/6 = scrub caps; 6505.00.25.9 = baby bonnets; 6505.00.90.3 = silk bonnets
    {
      const existing = allRules.find(r => r.id === 'SCRUB_CAP_HAIR_BONNET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SCRUB_CAP_HAIR_BONNET_INTENT',
          description: 'Scrub caps, surgical caps, hair bonnets, baby bonnets → ch.65 (6505.00)',
          pattern: {
            anyOf: [
              'scrub cap', 'scrubcap', 'scrub hat', 'surgical scrub cap', 'surgical scrub hat',
              'medical scrub cap', 'operating room cap', 'ponytail scrub cap', 'surgical cap',
              'hair bonnet', 'silk bonnet', 'satin bonnet', 'sleep bonnet', 'sleeping bonnet',
              'baby bonnet', 'infant bonnet', 'newborn bonnet', 'sun bonnet', 'baby sun hat',
              'bonnet hat', 'bouffant cap', 'disposable cap',
            ],
            noneOf: ['shower cap', 'swim cap', 'swimming cap', 'bath cap'],
          },
          inject: [{ prefix: '6505.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.60, prefixMatch: '6505' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SCRUB_CAP_HAIR_BONNET_INTENT: created (scrub caps/hair bonnets → 6505.00)');
      }
    }

    // 3. WOODEN_MISC_ARTICLE_INTENT → 4421.99 (embroidery hoops, wooden letters, shelves, etc.)
    //    26 entries in 4421.99: "Decorative wooden letter", "Bamboo Embroidery Hoop",
    //    "Wooden Countdown Blocks", "Wood Wall Coat Rack", "Wooden Wedding Signs"
    {
      const existing = allRules.find(r => r.id === 'WOODEN_MISC_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_MISC_ARTICLE_INTENT',
          description: 'Wooden decorative articles, embroidery hoops, wooden letters, shelves → ch.44 (4421.99)',
          pattern: {
            anyOf: [
              'embroidery hoop', 'embroidery hoops', 'wooden hoop', 'wood hoop', 'bamboo hoop',
              'bamboo embroidery hoop', 'wooden embroidery hoop', 'cross stitch frame',
              'wooden letter', 'wooden letters', 'decorative wooden letter', 'wood letter',
              'wooden countdown', 'countdown blocks', 'wooden blocks countdown', 'pregnancy countdown',
              'wooden wedding sign', 'wooden placecard', 'wooden sign', 'engraved wooden sign',
              'wood wall shelf', 'wooden wall shelf', 'wood shelf', 'wooden shelf',
              'wood coat rack', 'wooden coat rack', 'wall coat rack', 'wood hook rack',
              'wooden candy dispenser', 'wooden dispenser',
              'wood toothpick', 'wooden toothpick', 'bamboo toothpick',
              'cupcake topper', 'cupcake toppers',
              'gesso board', 'icon board', 'gesso panel', 'icon panel', 'linden wood panel',
              'wooden purse frame', 'wood purse frame', 'kiss lock frame',
              'hoop holder', 'hoop block', 'wood hoop holder',
            ],
            noneOf: ['plastic', 'metal shelf', 'acrylic', 'glass shelf'],
          },
          inject: [{ prefix: '4421.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '4421.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('WOODEN_MISC_ARTICLE_INTENT: created (embroidery hoops/wooden letters/shelves → 4421.99)');
      }
    }

    // 4. GOLD_CHAIN_INTENT: boost rank 22→4, add 14kt, 9k, signet, charm terms
    //    "14kt Yellow Gold Vintage Bar/Brick Charm" — '14kt' not matched by '14k' token
    {
      const e = allRules.find(r => r.id === 'GOLD_CHAIN_INTENT');
      if (e) {
        const newInject = [{ prefix: '7113.19', syntheticRank: 4 }];
        const newPat = addAnyOf(e,
          '14kt', '14kt gold', '9k gold', '9ct gold', '10kt gold', '18kt gold',
          'kt gold', 'gold charm', 'gold cross pendant', 'gold signet ring',
          'gold signet', 'signet ring gold', 'gold mens ring', 'gold ring mens',
        );
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, inject: newInject, pattern: newPat } });
        console.log('GOLD_CHAIN_INTENT: boosted rank 22→4, added 14kt/9k/signet terms');
      }
    }

    // 5. DECORATIVE_GLASS_ARTICLE_INTENT → 7013.99 (decorative glass, sake sets, murano glass)
    //    "Glass sake set", "Glass mosaic coaster set", "vintage murano glass ashtray",
    //    "decorative glass bowl set", "Picardie Colors Mixed Tumblers", "glass bottle decorative"
    {
      const existing = allRules.find(r => r.id === 'DECORATIVE_GLASS_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DECORATIVE_GLASS_ARTICLE_INTENT',
          description: 'Decorative glass articles, sake sets, murano glass, glass coasters → ch.70 (7013.99)',
          pattern: {
            anyOf: [
              'sake set', 'glass sake', 'sake glass set', 'sake cup set', 'tokkuri',
              'murano glass', 'murano vase', 'murano bowl', 'murano ashtray', 'murano art glass',
              'glass mosaic coaster', 'glass coaster set', 'stained glass coaster',
              'decorative glass bowl', 'glass bowl set', 'glass display bowl',
              'glass vase', 'bud vase glass', 'glass bud vase', 'glass flower vase',
              'glass figurine', 'glass paperweight', 'glass candle holder',
              'glass ashtray', 'vintage glass ashtray',
              'glass decanter', 'crystal decanter', 'wine decanter glass',
              'glass terrarium', 'glass cloche', 'glass dome',
            ],
            noneOf: ['drinking glass', 'beer glass', 'wine glass', 'whiskey glass', 'cocktail glass', 'coffee mug'],
          },
          inject: [{ prefix: '7013.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '7013.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('DECORATIVE_GLASS_ARTICLE_INTENT: created (sake sets/murano/decorative glass → 7013.99)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT17)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT17 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
