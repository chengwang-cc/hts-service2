#!/usr/bin/env ts-node
/**
 * Patch TT119 — 2026-03-16: Metal trays, patches, laundry, rubber mats, gemstone jewelry, wood boxes, bamboo combs.
 *
 * Fix 1: NEW METAL_HOUSEHOLD_CANDLE_TRAY_INTENT → 7323.99
 *   "candle snuffer" → 3406 (candles!) WRONG (expected 7323.99.30.00)
 *   "Vintage metal Candelabra" → 9405.50 (lamps!) WRONG (expected 7323.99.30.00)
 *   "Secondhand Metal Tray" → 8304 (desk organizers!) WRONG (expected 7323.99.90.80)
 *   "metal ash tray decorative design" → 2620.11 (slag/ashes!) WRONG (expected 7323.99.50.30)
 *   "Vintage Metal Butter Dish" → 6912 (ceramic) WRONG (expected 7323.99.50.30)
 *   Root cause: "candle" → ch.34; "candelabra" → ch.94 lamps; "metal tray" → ch.83 desk.
 *   7323.99 = "Other household articles" of iron/steel (trays, snuffers, candelabra, butter dishes).
 *
 * Fix 2: NEW EMBROIDERY_IRON_ON_PATCH_INTENT → 5810.92
 *   "Actual Size Patch" → 6211.33 (garment!) WRONG (expected 5810.92.00.10)
 *   "Bearded Axe Patch" → 3301.29 (essential oils!) WRONG (expected 5810.92.00.10)
 *   "Morale patch military" → 9301.10 (military weapons!) WRONG (expected 5810.92)
 *   Root cause: "patch" alone matches garments/textiles; "military" → weapons. No patch intent.
 *   5810.92 = "Embroidery of other textile materials" (includes iron-on/sew-on decorative patches).
 *
 * Fix 3: NEW LAUNDRY_CLEANING_PREPARATION_INTENT → 3402.90
 *   "Laundry Care" → 8450.20 (washing machines!) WRONG (expected 3402.90.50.10)
 *   "Laundy Care" (typo) → 3304.10 (cosmetics!) WRONG
 *   "Dishwasher Sheets 120 Loads Enzyme Eco" → 6302.22 (linen!) WRONG (expected 3402.90.10.00)
 *   "RezzRockz Cleaner Duo" → 8508.11 (vacuum cleaners!) WRONG (expected 3402.90.50.50)
 *   Root cause: "laundry care" → washing machine; "sheets" → linen; "duo" → vacuum cleaner.
 *   3402.90 = "Other" washing preparations / organic surface-active agents.
 *
 * Fix 4: NEW RUBBER_NEOPRENE_MAT_COASTER_INTENT → 4016.99
 *   "Gaming Mat" → 5911.90 (industrial textile!) WRONG (expected 4016.99.05.00)
 *   "neoprene coasters" → 9508.21 (fairground rides!) WRONG (expected 4016.99.30.00)
 *   Root cause: "mat" → industrial textile; "neoprene" has no intent; "coaster" → unmatched.
 *   4016.99 = "Other articles of vulcanized rubber" (gaming mats, neoprene products).
 *
 * Fix 5: NEW GEMSTONE_BEAD_JEWELRY_FINISHED_INTENT → 7116.20
 *   "Aquamarine Gemstone Necklace, Antique Bronze Copper" → 7103.99 (raw stones) WRONG (7116.20.15)
 *   "Burma Jade Beaded Bracelet - 6.75 inch / 8mm" → 7103.99 WRONG (7116.20.15)
 *   "Rose Quartz Bangle" → 7103.91 (rough stones) WRONG (7116.20.40)
 *   "Handmade African Turquoise Wrap bracelet" → 7103.99 WRONG (7116.20.50)
 *   Root cause: gemstone material names trigger 7103 (uncut stones) not 7116 (finished jewelry).
 *   7116.20 = "Articles of precious or semi-precious stones (finished jewelry/articles)".
 *
 * Fix 6: NEW WOOD_JEWELRY_WATCH_BOX_KEEPSAKE_INTENT → 4420.90
 *   "Heart shape wood ring box - Walnut" → 4202.12 (travel bags!) WRONG (expected 4420.90.20.00)
 *   "Large Watch Box" → 4202.12 (travel bags!) WRONG (expected 4420.90.65.00)
 *   "Wooden wall tiles decor" → 6907.23 (ceramic tiles!) WRONG (expected 4420.90.65.00)
 *   Root cause: "box" triggers luggage/cases (4202); "wall tiles" → ceramics. No wood box intent.
 *   4420.90 = "Statuettes and other ornaments of wood" / wooden jewelry/watch boxes.
 *
 * Fix 7: NEW BAMBOO_WOODEN_COMB_INTENT → 4421.91
 *   "Birth Comb for Labor Pain - Doula Recommended Natural Pain Relief" → 9615.90 (combs) WRONG (4421.91.30.00)
 *   "Personalized Birth Comb - Custom Quote Engraving" → 9615.90 WRONG
 *   Root cause: "comb" triggers 9615 (combs of general material); bamboo combs = 4421.91 (bamboo).
 *   4421.91.30.00 = Other articles of bamboo (includes bamboo combs/acupressure tools).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt119.ts
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

    // 1. NEW METAL_HOUSEHOLD_CANDLE_TRAY_INTENT → 7323.99
    //    Candle snuffers, metal trays, candelabra, butter dishes → iron/steel household articles.
    //    "candle snuffer" → ch.34 (candles); "candelabra" → ch.94 (lamps); "metal tray" → ch.83.
    //    denyChapters:['34','94','83','39'] blocks the wrong chapters.
    {
      const existing = allRules.find(r => r.id === 'METAL_HOUSEHOLD_CANDLE_TRAY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'METAL_HOUSEHOLD_CANDLE_TRAY_INTENT',
          description: 'Metal household articles: candle snuffers, trays, candelabra → 7323.99',
          pattern: {
            anyOf: [
              'candle snuffer', 'candle snuffers',
              'candelabra', 'metal candelabra', 'silver candelabra', 'brass candelabra',
              'metal tv tray', 'tv tray table', 'dinner tray table',
              'metal ash tray', 'metal ashtray', 'decorative ashtray',
              'metal butter dish', 'butter dish metal',
              'stainless wire frame', 'metal wire frame',
              'decorative metal tray',
            ],
            noneOf: [
              // Exclude food/catering trays
              'sushi tray', 'food tray', 'cafeteria tray',
              // Exclude actual candles (these get 3406)
              'scented candle', 'candle jar',
              // Exclude medical ash trays (if any)
              'surgical tray', 'medical tray',
            ],
          },
          inject: [
            { prefix: '7323.99', syntheticRank: 1 },  // other metal household articles
            { prefix: '7323.93', syntheticRank: 5 },  // stainless steel household
          ],
          whitelist: {
            denyChapters: ['34', '39', '83', '94'],  // block candles, plastics, desk accessories, lamps
          },
          boosts: [
            { delta: 0.95, prefixMatch: '7323.99' },  // very strong boost
            { delta: 0.70, prefixMatch: '7323.' },     // moderate boost for all household metal
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '3406.' },  // candles
            { delta: 0.90, prefixMatch: '9405.' },  // lamps
            { delta: 0.90, prefixMatch: '8304.' },  // desk organizers
            { delta: 0.90, prefixMatch: '2620.' },  // ashes/slag
          ],
        } as IntentRule;
        patches.push({ priority: 584, rule: newRule });
        console.log('METAL_HOUSEHOLD_CANDLE_TRAY_INTENT: created (snuffer/tray/candelabra → 7323.99)');
      } else {
        console.log('METAL_HOUSEHOLD_CANDLE_TRAY_INTENT: already exists, skipping');
      }
    }

    // 2. NEW EMBROIDERY_IRON_ON_PATCH_INTENT → 5810.92
    //    Embroidered patches (iron-on, sew-on, morale patches, back patches) = 5810.92.
    //    "morale patch" → 9301.10 (weapons!); "Actual Size Patch" → 6211.33 (garments).
    //    Priority > clothing intents to prevent garment mis-routing.
    {
      const existing = allRules.find(r => r.id === 'EMBROIDERY_IRON_ON_PATCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'EMBROIDERY_IRON_ON_PATCH_INTENT',
          description: 'Embroidered/iron-on patches → 5810.92 (embroidery, not garments)',
          pattern: {
            anyOf: [
              'embroidered patch', 'iron on patch', 'iron-on patch',
              'sew on patch', 'sew-on patch', 'morale patch',
              'back patch', 'jacket patch', 'military patch',
              'embroidery patch', 'patch badge', 'woven patch',
              'tactical patch', 'velcro patch', 'hook and loop patch',
            ],
            noneOf: [
              // Medical/first aid patches
              'nicotine patch', 'birth control patch', 'pain relief patch', 'medical patch',
              // Hardware/repair
              'patch cord', 'patch cable', 'tire patch', 'patch kit', 'software patch',
              // Eyepatch (different product)
              'eye patch', 'eyepatch',
            ],
          },
          inject: [
            { prefix: '5810.92', syntheticRank: 1 },  // embroidery of other textile materials
            { prefix: '5810.10', syntheticRank: 5 },  // embroidery without visible ground
          ],
          whitelist: {
            allowChapters: ['58'],   // embroidery chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '5810.92' },  // very strong boost
            { delta: 0.70, prefixMatch: '5810.' },     // moderate boost for all embroidery
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9301.' },  // military weapons
            { delta: 0.90, prefixMatch: '6211.' },  // garments
          ],
        } as IntentRule;
        patches.push({ priority: 585, rule: newRule });
        console.log('EMBROIDERY_IRON_ON_PATCH_INTENT: created (morale/back patch → 5810.92, allowChapters:[58])');
      } else {
        console.log('EMBROIDERY_IRON_ON_PATCH_INTENT: already exists, skipping');
      }
    }

    // 3. NEW LAUNDRY_CLEANING_PREPARATION_INTENT → 3402.90
    //    "Laundry Care" → 8450 (washing machines!); "Dishwasher Sheets" → 6302 (linen!).
    //    "laundry" + "care" → washing machine codes; "sheets" → textile linen codes.
    //    3402.90 = washing preparations / organic surface-active cleaning agents.
    {
      const existing = allRules.find(r => r.id === 'LAUNDRY_CLEANING_PREPARATION_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LAUNDRY_CLEANING_PREPARATION_INTENT',
          description: 'Laundry detergents, cleaning sheets, dishwasher pods → 3402.90 (cleaning preparations)',
          pattern: {
            anyOf: [
              'laundry care', 'laundry detergent', 'laundry sheets',
              'laundry pods', 'laundry strips', 'laundry tabs',
              'dishwasher sheets', 'dishwasher pods', 'dishwasher tabs',
              'cleaning sheets', 'eco laundry', 'washing sheets',
              'cleaning preparation', 'detergent sheets',
              'enzyme cleaner', 'eco cleaner duo',
            ],
            noneOf: [
              // Hardware/machines
              'laundry machine', 'laundry washer', 'laundry bag', 'laundry hamper',
              'dishwasher machine', 'dishwasher appliance',
              // Clothing
              'laundry cloth', 'laundry basket',
            ],
          },
          inject: [
            { prefix: '3402.90', syntheticRank: 1 },  // other washing preparations
            { prefix: '3402.20', syntheticRank: 4 },  // cleaning preparations
          ],
          whitelist: {
            allowChapters: ['34'],   // cleaning agents chapter; block ch.84/85 (machines), ch.63 (linen)
          },
          boosts: [
            { delta: 0.95, prefixMatch: '3402.90' },  // very strong boost
            { delta: 0.70, prefixMatch: '3402.' },     // moderate boost for cleaning agents
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8450.' },  // washing machines
            { delta: 0.90, prefixMatch: '6302.' },  // household linen
          ],
        } as IntentRule;
        patches.push({ priority: 586, rule: newRule });
        console.log('LAUNDRY_CLEANING_PREPARATION_INTENT: created (laundry care → 3402.90, allowChapters:[34])');
      } else {
        console.log('LAUNDRY_CLEANING_PREPARATION_INTENT: already exists, skipping');
      }
    }

    // 4. NEW RUBBER_NEOPRENE_MAT_COASTER_INTENT → 4016.99
    //    "Gaming Mat" → 5911.90 (industrial textile!); "neoprene coasters" → 9508.21 (fairground rides!).
    //    No rubber mat intent; "neoprene" has no dedicated intent.
    //    4016.99 = "Other articles of vulcanized rubber" (gaming mats, neoprene accessories).
    {
      const existing = allRules.find(r => r.id === 'RUBBER_NEOPRENE_MAT_COASTER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RUBBER_NEOPRENE_MAT_COASTER_INTENT',
          description: 'Rubber/neoprene gaming mats, coasters → 4016.99 (vulcanized rubber articles)',
          pattern: {
            anyOf: [
              'gaming mat', 'gaming desk mat',
              'neoprene coaster', 'neoprene coasters', 'rubber coaster',
              'neoprene mat', 'rubber desk mat', 'rubber bar mat',
              'neoprene gaming', 'rubber gaming',
              'neoprene trivet', 'neoprene pad',
            ],
            noneOf: [
              // Other mat types handled elsewhere
              'yoga mat', 'workout mat', 'exercise mat', 'bath mat',
              'car floor mat', 'welcome mat', 'door mat',
              // Balloon-type rubber (handled by balloon intent)
              'rubber balloon', 'latex balloon',
            ],
          },
          inject: [
            { prefix: '4016.99', syntheticRank: 1 },  // other rubber articles
            { prefix: '4016.91', syntheticRank: 5 },  // floor coverings of rubber
          ],
          whitelist: {
            allowChapters: ['40'],   // rubber chapter; block industrial textiles (ch.59), amusements (ch.95)
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4016.99' },  // very strong boost
            { delta: 0.70, prefixMatch: '4016.' },     // moderate boost for rubber articles
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '5911.' },  // industrial textiles
            { delta: 0.90, prefixMatch: '9508.' },  // fairground amusement rides
          ],
        } as IntentRule;
        patches.push({ priority: 587, rule: newRule });
        console.log('RUBBER_NEOPRENE_MAT_COASTER_INTENT: created (gaming mat/neoprene coaster → 4016.99, allowChapters:[40])');
      } else {
        console.log('RUBBER_NEOPRENE_MAT_COASTER_INTENT: already exists, skipping');
      }
    }

    // 5. NEW GEMSTONE_BEAD_JEWELRY_FINISHED_INTENT → 7116.20
    //    Finished gemstone bead jewelry (bracelets, necklaces) → 7116.20, not 7103 (uncut stones).
    //    "Aquamarine necklace" → 7103.99 (raw stones); "Jade bracelet" → 7103.99.
    //    "turquoise chips beads" (strung strand) → 7103 despite being a finished jewelry item.
    //    7116.20 = "Articles of precious or semi-precious stones" (finished jewelry/articles).
    {
      const existing = allRules.find(r => r.id === 'GEMSTONE_BEAD_JEWELRY_FINISHED_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GEMSTONE_BEAD_JEWELRY_FINISHED_INTENT',
          description: 'Finished gemstone jewelry (bracelets, necklaces) → 7116.20, not 7103 raw stones',
          pattern: {
            anyOf: [
              'gemstone necklace', 'gemstone bracelet',
              'jade bracelet', 'jade beaded bracelet', 'jade bangle',
              'quartz bracelet', 'quartz bangle', 'rose quartz bangle',
              'turquoise bracelet', 'turquoise wrap bracelet', 'turquoise chips beads',
              'aquamarine necklace', 'aquamarine bracelet',
              'lapis lazuli beads', 'lapis bracelet',
              'crystal bracelet', 'crystal beaded bracelet',
              'gemstone bead bracelet', 'gemstone chips beads',
              'semi precious bracelet', 'semi-precious bracelet',
              'african turquoise bracelet', 'tiger eye bracelet',
              'malachite bracelet', 'amethyst bracelet', 'amazonite bracelet',
            ],
            noneOf: [
              // Raw/unworked stones
              'rough crystal', 'raw crystal', 'rough gemstone', 'raw gemstone',
              'crystal point', 'unpolished stone', 'raw stone',
              // Loose beads (not finished jewelry)
              'bead lot', 'bead supply', 'bead making',
            ],
          },
          inject: [
            { prefix: '7116.20', syntheticRank: 1 },  // articles of precious/semi-precious stones
            { prefix: '7116.10', syntheticRank: 5 },  // natural or cultured pearls
          ],
          whitelist: {
            denyPrefixes: ['7103.'],  // hard-block uncut/rough stone codes
          },
          boosts: [
            { delta: 0.95, prefixMatch: '7116.20' },  // very strong boost for finished gem jewelry
            { delta: 0.70, prefixMatch: '7116.' },     // moderate boost for precious stone articles
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7103.' },  // raw precious stones
          ],
        } as IntentRule;
        patches.push({ priority: 588, rule: newRule });
        console.log('GEMSTONE_BEAD_JEWELRY_FINISHED_INTENT: created (gemstone bracelet/necklace → 7116.20, denyPrefixes:[7103.])');
      } else {
        console.log('GEMSTONE_BEAD_JEWELRY_FINISHED_INTENT: already exists, skipping');
      }
    }

    // 6. NEW WOOD_JEWELRY_WATCH_BOX_KEEPSAKE_INTENT → 4420.90
    //    "Heart shape wood ring box - Walnut" → 4202.12 (travel bags!) WRONG (expected 4420.90.20.00)
    //    "Large Watch Box" → 4202.12 (travel bags!) WRONG (expected 4420.90.65.00)
    //    "Wooden wall tiles decor" → 6907.23 (ceramic tiles!) WRONG (expected 4420.90.65.00)
    //    "box" triggers luggage/cases (4202); ceramic keywords → ch.69.
    //    4420.90 = "Statuettes and other ornaments of wood" / wooden boxes (jewelry, watch, keepsake boxes).
    {
      const existing = allRules.find(r => r.id === 'WOOD_JEWELRY_WATCH_BOX_KEEPSAKE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_JEWELRY_WATCH_BOX_KEEPSAKE_INTENT',
          description: 'Wooden jewelry boxes, watch boxes, keepsake boxes → 4420.90 (wood ornaments/boxes)',
          pattern: {
            anyOf: [
              'wood ring box', 'wooden ring box', 'wood ring holder',
              'wood watch box', 'wooden watch box', 'wood watch case',
              'wood jewelry box', 'wooden jewelry box', 'wood keepsake box',
              'wood memory box', 'wooden memory box', 'wood treasure box',
              'walnut ring box', 'maple ring box', 'cherry wood box',
              'wooden wall tiles', 'wood wall tiles decor',
              'wood decorative box',
            ],
            noneOf: [
              // Fabric-lined or travel cases (4202)
              'travel case', 'carrying case', 'portable case',
              // Musical instrument cases
              'guitar case', 'violin case',
            ],
          },
          inject: [
            { prefix: '4420.90', syntheticRank: 1 },  // wood ornaments / wood boxes
            { prefix: '4421.99', syntheticRank: 5 },  // other wood articles
          ],
          whitelist: {
            allowChapters: ['44'],   // wood articles chapter; block ch.42 (bags/cases), ch.69 (ceramics)
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4420.90' },  // very strong boost
            { delta: 0.70, prefixMatch: '4420.' },     // moderate boost for all wood ornaments
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4202.' },  // luggage/cases
            { delta: 0.90, prefixMatch: '6907.' },  // ceramic tiles
          ],
        } as IntentRule;
        patches.push({ priority: 589, rule: newRule });
        console.log('WOOD_JEWELRY_WATCH_BOX_KEEPSAKE_INTENT: created (wood ring/watch box → 4420.90, allowChapters:[44])');
      } else {
        console.log('WOOD_JEWELRY_WATCH_BOX_KEEPSAKE_INTENT: already exists, skipping');
      }
    }

    // 7. NEW BAMBOO_WOODEN_COMB_ACUPRESSURE_INTENT → 4421.91
    //    "Birth Comb for Labor Pain - Doula Recommended" → 9615.90 (general combs) WRONG (4421.91.30.00)
    //    "Personalized Birth Comb - Custom Quote Engraving" → 9615.90 WRONG
    //    Root cause: "comb" → 9615 (combs of any material). These are bamboo combs.
    //    4421.91.30.00 = "Other articles of bamboo" (bamboo combs, acupressure tools).
    {
      const existing = allRules.find(r => r.id === 'BAMBOO_WOODEN_COMB_ACUPRESSURE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BAMBOO_WOODEN_COMB_ACUPRESSURE_INTENT',
          description: 'Bamboo/wooden combs (including birth/doula combs) → 4421.91 (other bamboo articles)',
          pattern: {
            anyOf: [
              'birth comb', 'labor comb', 'doula comb',
              'bamboo comb', 'wooden comb',
              'acupressure comb', 'natural comb',
              'wood hair comb', 'bamboo hair comb',
              'wooden wide tooth comb',
            ],
            noneOf: [
              // Plastic/nylon combs (9615)
              'plastic comb', 'nylon comb',
              // Grooming sets that are mostly other materials
              'comb and brush set',
            ],
          },
          inject: [
            { prefix: '4421.91', syntheticRank: 1 },  // other bamboo articles (bamboo combs)
            { prefix: '4421.99', syntheticRank: 5 },  // other wood articles (wooden combs)
          ],
          whitelist: {
            allowChapters: ['44'],   // wood/bamboo chapter; block combs chapter (96)
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4421.91' },  // very strong boost for bamboo combs
            { delta: 0.70, prefixMatch: '4421.' },     // moderate boost for wood articles
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9615.' },  // general combs
          ],
        } as IntentRule;
        patches.push({ priority: 590, rule: newRule });
        console.log('BAMBOO_WOODEN_COMB_ACUPRESSURE_INTENT: created (birth comb/bamboo comb → 4421.91, allowChapters:[44])');
      } else {
        console.log('BAMBOO_WOODEN_COMB_ACUPRESSURE_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT119)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT119 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
