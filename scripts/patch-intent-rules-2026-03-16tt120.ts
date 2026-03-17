#!/usr/bin/env ts-node
/**
 * Patch TT120 — 2026-03-16: Fix antiques, food preparations, dish cloths,
 *   cup sleeves, textile keychains, and gold-decorated ceramic mugs.
 *
 * Fix 1: NEW ANTIQUE_9706_INTENT → 9706.10 / 9706.90
 *   "Antique Alarm Clock" → 9105 WRONG (expected 9706.10)
 *   "antique brass candlesticks" → 9405 WRONG (expected 9706.90)
 *   "antique brass card dish" → 6911 WRONG (expected 9706.90)
 *   "antique american stereoview photo card" → 9504 WRONG (expected 9706.10)
 *   "Antique Brass Drawer Handles" → 8302 WRONG (expected 9706.90)
 *   Root cause: no intent; "antique brass" items go to material chapter;
 *   clocks go to ch.91; stereoview photos go to playing cards.
 *   Fix: inject 9706.10 + 9706.90 with allowChapters:['97'].
 *
 * Fix 2: NEW FOOD_MISC_PREPARATION_INTENT → 2106.90
 *   "Wine Gummies by Vinoos - Merlot/Chardonnay/Rosé" → 1806 WRONG (expected 2106.90)
 *   "Mild Vanilla (10 meals)" → 0905 WRONG (expected 2106.90)
 *   "Rich Chocolate (10 meals)" → 1806 WRONG (expected 2106.90)
 *   "Deluxe Butt Cream" → 0405 WRONG (expected 2106.90) [buttercream/food prep]
 *   "Bum Candies" → 1806 WRONG (expected 2106.90)
 *   Root cause: "wine" triggers alcohol codes, "chocolate" → ch.18, "vanilla" → 0905.
 *   2106.90 = food preparations not elsewhere specified (food supplements, meal preps).
 *   Fix: dedicated intent with allowChapters:['21'].
 *
 * Fix 3: NEW TEXTILE_DISH_CLOTH_INTENT → 6307.90
 *   "crochet dish cloth hand made with cotton yarn" → 5208 WRONG (expected 6307.90)
 *   "Cotton Dish Cloth/patterned fabric" → 6911 WRONG (expected 6307.90)
 *   "Swedish dish cloth" → 6911 WRONG (expected 6307.90)
 *   "homemade dish cloths - polyester blend" → 6911 WRONG (expected 6307.90)
 *   Root cause: "dish" + "cloth" triggers ceramic (6911) or raw fabric (5208).
 *   6307.90 = made-up textile articles (includes dish cloths, cleaning cloths).
 *   Fix: specific intent denying ceramic chapter.
 *
 * Fix 4: NEW TEXTILE_CUP_SLEEVE_INTENT → 6307.90
 *   "Wishing Star - Cup Sleeve set" → 6911 WRONG (expected 6307.90)
 *   "NEOPRENE BEVERAGE HOLDER SLEEVES" → 4202.92 WRONG (expected 6307.90)
 *   Root cause: "cup" → ceramic (6911); "sleeve" alone insufficient signal.
 *   6307.90 = made-up textile articles (includes fabric cup sleeves/cozies).
 *   Fix: inject 6307.90, deny ch.69 (ceramic) and ch.42 (leather goods).
 *
 * Fix 5: NEW TEXTILE_KEYCHAIN_FABRIC_INTENT → 6307.90
 *   "Handmade Crochet Textile Keychain" → 7326.20 WRONG (expected 6307.90)
 *   "Handmade keychain using cotton" → 7326.20 WRONG (expected 6307.90)
 *   Root cause: "keychain" → metal chain (7326); fabric context ignored.
 *   6307.90 = made-up textile articles (includes fabric/macramé keychains).
 *   Fix: inject 6307.90, deny metal chapters when textile material present.
 *
 * Fix 6: NEW GOLD_DECORATED_CERAMIC_MUG_INTENT → 6912.00
 *   "ABC mug: pink 22kt gold" → 7113.19 WRONG (expected 6912.00)
 *   "ABC mug: Purple 22kt gold" → 7113.19 WRONG (expected 6912.00)
 *   Root cause: "22kt gold" triggers precious metal jewelry (7113).
 *   A mug decorated with gold paint/luster stays 6912 (ceramic tableware).
 *   Fix: inject 6912.00, denyPrefixes:['7113.','7114.'] for mugs.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt120.ts
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

    // 1. NEW ANTIQUE_9706_INTENT → 9706.10 / 9706.90
    //    Specific antique phrases that signal genuine antiques (>100 years).
    //    "antique brass", "stereoview", "antique alarm clock" etc.
    //    allowChapters:['97'] forces all results through chapter 97 only.
    {
      const existing = allRules.find(r => r.id === 'ANTIQUE_9706_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ANTIQUE_9706_INTENT',
          description: 'Genuine antiques (>100 yrs) → 9706.10/9706.90 (antiques)',
          pattern: {
            anyOf: [
              // Photo/collectible antiques
              'stereoview', 'stereoview card', 'stereoview photo', 'stereoscope card',
              'antique stereoscope', 'antique stereoview',
              // Antique brass items
              'antique brass', 'antique bronze',
              // Antique clocks
              'antique alarm clock', 'antique clock', 'antique mantel clock',
              'antique wall clock', 'antique pocket watch',
              // Antique silver items
              'antique silver candlestick', 'antique silver tray',
              // Antique household
              'antique candlestick', 'antique candelabra',
              'antique drawer handle', 'antique drawer pull',
              'antique card dish', 'antique calling card',
              'antique ink well', 'antique inkwell',
              'antique figurine', 'antique porcelain',
              'antique ceramic piece', 'antique decanter',
              'antique snuff box', 'antique coin purse',
            ],
            noneOf: [
              // Modern items with "antique" style/finish
              'antique style', 'antique look', 'antique white', 'antique finish',
              'faux antique', 'antique effect', 'antique patina finish',
              'antique color', 'antique appearance',
              // Jewelry stays in ch.71
              'antique ring', 'antique necklace', 'antique earring', 'antique bracelet',
              'antique pendant',
            ],
          },
          inject: [
            { prefix: '9706.10', syntheticRank: 1 },  // antiques of textile/carpet type
            { prefix: '9706.90', syntheticRank: 2 },  // other antiques > 100 years
          ],
          whitelist: {
            allowChapters: ['97'],   // only chapter 97 codes allowed
          },
          boosts: [
            { delta: 0.95, prefixMatch: '9706.' },  // very strong boost for antiques
          ],
        } as IntentRule;
        patches.push({ priority: 591, rule: newRule });
        console.log('ANTIQUE_9706_INTENT: created (→9706.10/9706.90, allowChapters:[97])');
      } else {
        console.log('ANTIQUE_9706_INTENT: already exists, skipping');
      }
    }

    // 2. NEW FOOD_MISC_PREPARATION_INTENT → 2106.90
    //    Wine gummies, meal supplement packs, and miscellaneous food preparations.
    //    "wine gummies" → chocolate chapter (1806); "vanilla meals" → vanilla beans (0905).
    //    2106.90 = food preparations not elsewhere specified.
    {
      const existing = allRules.find(r => r.id === 'FOOD_MISC_PREPARATION_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FOOD_MISC_PREPARATION_INTENT',
          description: 'Food preparations nec → 2106.90 (wine gummies, meal supplements)',
          pattern: {
            anyOf: [
              // Wine/alcohol gummies
              'wine gummies', 'wine gummy', 'wine candy', 'wine-infused gummies',
              'merlot gummies', 'chardonnay gummies', 'rosé gummies',
              // Meal supplement packs
              'vanilla meals', 'chocolate meals', 'vanilla meal pack',
              '(10 meals)', '(29 meals)', '(14 meals)', '(21 meals)', '(28 meals)',
              'meal supplement pack', 'meal shake supplement',
              // Niche food prep items
              'bum candies', 'butt cream food', 'butt butter',
              // Apple cider vinegar gummies (food supplement)
              'acv gummies', 'apple cider vinegar gummies',
              // Adaptogen shots/supplements (food classification)
              'adaptogen shot', 'adaptogen shots', 'adaptogen supplement',
              'wellness shot concentrate', 'elderberry gummies', 'elderberry supplement',
              // Collagen/biotin gummies (food supplement)
              'collagen gummies', 'biotin gummies', 'immunity gummies',
              'probiotic gummies', 'vitamin gummy',
            ],
            noneOf: [
              // Actual wine/spirits
              'wine bottle', 'wine glass', 'bottle of wine', 'red wine', 'white wine',
              'sparkling wine', 'wine rack', 'wine opener',
              // Regular candy/chocolate
              'chocolate bar', 'chocolate cake', 'chocolate box', 'chocolate chip',
              // Supplements in pill/capsule form (ch.30 pharmaceutical)
              'supplement capsule', 'supplement pill', 'supplement tablet',
              'vitamin capsule', 'vitamin pill',
            ],
          },
          inject: [
            { prefix: '2106.90', syntheticRank: 1 },  // food preparations nec
            { prefix: '2106.10', syntheticRank: 6 },  // protein concentrates
          ],
          whitelist: {
            allowChapters: ['21'],   // only chapter 21 (miscellaneous food preparations)
          },
          boosts: [
            { delta: 0.90, prefixMatch: '2106.90' },  // strong boost for misc food prep
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '1806.' },  // penalize chocolate codes
            { delta: 0.85, prefixMatch: '0905.' },  // penalize vanilla beans
            { delta: 0.85, prefixMatch: '2209.' },  // penalize vinegar
          ],
        } as IntentRule;
        patches.push({ priority: 592, rule: newRule });
        console.log('FOOD_MISC_PREPARATION_INTENT: created (→2106.90, allowChapters:[21])');
      } else {
        console.log('FOOD_MISC_PREPARATION_INTENT: already exists, skipping');
      }
    }

    // 3. NEW TEXTILE_DISH_CLOTH_INTENT → 6307.90
    //    Dish cloths are made-up textile articles, not ceramic (ch.69).
    //    "dish cloth" triggers 6911 (ceramic) because "dish" = ceramic ware.
    //    6307.90 = made-up textile articles (cleaning cloths, dish towels).
    {
      const existing = allRules.find(r => r.id === 'TEXTILE_DISH_CLOTH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEXTILE_DISH_CLOTH_INTENT',
          description: 'Dish cloths/cleaning cloths → 6307.90 (made-up textile)',
          pattern: {
            anyOf: [
              'dish cloth', 'dish cloths', 'dishcloth', 'dishcloths',
              'swedish dish cloth', 'swedish dishcloth', 'swedish dish towel',
              'crochet dish cloth', 'knit dish cloth', 'woven dish cloth',
              'cotton dish cloth', 'polyester dish cloth',
              'cleaning cloth set', 'reusable cleaning cloth',
              'eco dish cloth', 'cellulose dish cloth',
            ],
            noneOf: [
              // Ceramic dish items
              'dish plate', 'ceramic dish', 'pottery dish', 'porcelain dish',
              'serving dish', 'baking dish', 'casserole dish', 'soap dish',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 1 },  // made-up textile articles
            { prefix: '6302.60', syntheticRank: 5 },  // toilet/kitchen linen (towels)
          ],
          whitelist: {
            allowChapters: ['63'],   // only textile chapter
            denyChapters: ['69', '52', '55'],  // block ceramic, woven cotton/synth fabric chapters
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6307.90' },  // strong boost for made-up textiles
            { delta: 0.50, prefixMatch: '6302.' },     // moderate for kitchen linen
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6911.' },  // penalize ceramic
            { delta: 0.80, prefixMatch: '5208.' },  // penalize raw woven fabric
          ],
        } as IntentRule;
        patches.push({ priority: 593, rule: newRule });
        console.log('TEXTILE_DISH_CLOTH_INTENT: created (→6307.90, allowChapters:[63])');
      } else {
        console.log('TEXTILE_DISH_CLOTH_INTENT: already exists, skipping');
      }
    }

    // 4. NEW TEXTILE_CUP_SLEEVE_INTENT → 6307.90
    //    Fabric/neoprene cup sleeves are made-up textile articles.
    //    "cup sleeve" → 6911 (ceramic) because "cup" = ceramic ware.
    //    "neoprene beverage holder" → 4202.92 (cases/bags) WRONG.
    {
      const existing = allRules.find(r => r.id === 'TEXTILE_CUP_SLEEVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEXTILE_CUP_SLEEVE_INTENT',
          description: 'Fabric cup sleeves/cozies → 6307.90 (made-up textile)',
          pattern: {
            anyOf: [
              'cup sleeve', 'cup sleeves', 'coffee sleeve', 'coffee sleeves',
              'cup cozy', 'cup cozies', 'mug cozy', 'mug cozies',
              'mug sleeve', 'mug sleeves',
              'beverage sleeve', 'beverage sleeves', 'drink sleeve',
              'beverage holder sleeve', 'beverage holder sleeves',
              'cup holder sleeve', 'cup holder cozy',
              'knit cup cozy', 'crochet cup cozy', 'knit mug cozy',
              'neoprene cup sleeve', 'neoprene beverage holder',
              'can cozy', 'can cozy knit', 'beer can cozy',
            ],
            noneOf: [
              // Actual cups/mugs
              'ceramic cup', 'porcelain cup', 'glass cup', 'cup set',
              'coffee mug set', 'travel mug',
              // Insulated bottles
              'insulated tumbler', 'hydro flask', 'stanley cup',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 1 },  // made-up textile articles
          ],
          whitelist: {
            allowChapters: ['63'],   // only textile chapter
            denyChapters: ['69', '42', '40', '73'],  // block ceramic, bags, rubber, metal
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6307.90' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6911.' },  // penalize ceramic
            { delta: 0.80, prefixMatch: '4202.' },  // penalize bags/cases
          ],
        } as IntentRule;
        patches.push({ priority: 594, rule: newRule });
        console.log('TEXTILE_CUP_SLEEVE_INTENT: created (→6307.90, allowChapters:[63])');
      } else {
        console.log('TEXTILE_CUP_SLEEVE_INTENT: already exists, skipping');
      }
    }

    // 5. NEW TEXTILE_KEYCHAIN_FABRIC_INTENT → 6307.90
    //    Fabric/crochet/macramé keychains are made-up textile articles.
    //    "keychain using cotton" → 7326.20 (iron/steel chain articles) WRONG.
    //    Existing KEYCHAIN intents target metal/acrylic — not textile.
    {
      const existing = allRules.find(r => r.id === 'TEXTILE_KEYCHAIN_FABRIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEXTILE_KEYCHAIN_FABRIC_INTENT',
          description: 'Fabric/macramé keychains → 6307.90 (made-up textile)',
          pattern: {
            anyOf: [
              'keychain using cotton', 'keychain using fabric',
              'cotton keychain', 'fabric keychain', 'textile keychain',
              'crochet keychain', 'macrame keychain', 'knit keychain',
              'crochet textile keychain', 'handmade crochet keychain',
              'woven keychain', 'yarn keychain',
              'cotton lanyard', 'macrame lanyard',
              'handmade keychain cotton', 'handmade keychain fabric',
              'keychain with cotton', 'keychain made of cotton',
            ],
            noneOf: [
              // Metal/acrylic keychains (handled by other intents)
              'metal keychain', 'acrylic keychain', 'leather keychain',
              'epoxy keychain', 'resin keychain', 'silicone keychain',
              'enamel keychain', 'wooden keychain',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 1 },  // made-up textile articles
          ],
          whitelist: {
            allowChapters: ['63'],   // only textile chapter
            denyChapters: ['73', '83'],  // block iron/steel and base metal articles
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6307.90' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7326.' },  // penalize iron/steel chain articles
          ],
        } as IntentRule;
        patches.push({ priority: 595, rule: newRule });
        console.log('TEXTILE_KEYCHAIN_FABRIC_INTENT: created (→6307.90, allowChapters:[63])');
      } else {
        console.log('TEXTILE_KEYCHAIN_FABRIC_INTENT: already exists, skipping');
      }
    }

    // 6. NEW GOLD_DECORATED_CERAMIC_MUG_INTENT → 6912.00
    //    Ceramic mugs with gold decoration go to 6912 (tableware), not 7113 (jewelry).
    //    "ABC mug: pink 22kt gold" → 7113.19 WRONG (expected 6912.00).
    //    "22kt gold" in description triggers precious metal jewelry codes.
    //    Fix: deny 7113/7114, inject 6912.00 for mugs/tableware with gold decoration.
    {
      const existing = allRules.find(r => r.id === 'GOLD_DECORATED_CERAMIC_MUG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GOLD_DECORATED_CERAMIC_MUG_INTENT',
          description: 'Ceramic mugs with gold decoration → 6912.00 (tableware not jewelry)',
          pattern: {
            anyOf: [
              'mug 22kt gold', 'mug 22k gold', 'mug 24kt gold', 'mug 24k gold',
              'mug gold luster', 'mug gold lustre', 'mug gold rim',
              'mug gold trim', 'mug gold accent', 'mug gold decoration',
              'mug with gold', 'gold accent mug', 'gold rim mug',
              'gold luster mug', 'gold lustre mug', 'gold trim mug',
              'ceramic mug 22kt', 'porcelain mug 22kt', 'ceramic mug gold',
              'porcelain mug gold', '22kt gold mug', '22k gold mug',
              '24kt gold mug', 'gold luster cup', 'gold rim cup',
            ],
            noneOf: [
              // Actual gold jewelry
              'gold ring', 'gold necklace', 'gold bracelet', 'gold earring',
              'gold pendant', 'gold chain', 'gold bangle',
              // Gold plated items
              'gold plated ring', 'gold plated necklace',
            ],
          },
          inject: [
            { prefix: '6912.00', syntheticRank: 1 },  // ceramic tableware
            { prefix: '6911.10', syntheticRank: 5 },  // porcelain tableware
          ],
          whitelist: {
            denyPrefixes: ['7113.', '7114.'],  // hard-block jewelry codes
            allowChapters: ['69'],  // only ceramic chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6912.' },
            { delta: 0.70, prefixMatch: '6911.' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '7113.' },  // very strong penalty for gold jewelry
            { delta: 0.95, prefixMatch: '7114.' },  // very strong penalty for goldsmiths' articles
          ],
        } as IntentRule;
        patches.push({ priority: 596, rule: newRule });
        console.log('GOLD_DECORATED_CERAMIC_MUG_INTENT: created (→6912.00, denyPrefixes:[7113,7114])');
      } else {
        console.log('GOLD_DECORATED_CERAMIC_MUG_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT120)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT120 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
