#!/usr/bin/env ts-node
/**
 * Patch TT58 — 2026-03-15: Fix cross-chapter failures from sampling analysis.
 * Current: ~35.00% (1759/5025)
 *
 * Fixes:
 *  1. ACRYLIC_KNIT_HAT_HEADWEAR_INTENT → 6505.00 (headgear)
 *     "80% acrylic 20% wool hand knitted hat" → 9701.21 (paintings!) BUG — "acrylic" triggers art chapter
 *     "acrylic wool beanie" → ? likely wrong
 *     BUG: "acrylic" in "acrylic hat" triggers 9701 (paintings/drawings with acrylic paint)
 *  2. CRYSTAL_GEMSTONE_JEWELRY_INTENT → 7117.90 (imitation jewelry)
 *     "handmade woman jewelry crystal" → 7018.10 (glass beads!) BUG — "crystal" triggers glass
 *     "crystal necklace" → 7018 BUG
 *     BUG: "crystal" triggers glass/crystal beads (7018.10) instead of jewelry
 *  3. VELVET_FABRIC_COSTUME_HAT_INTENT → 6505.00 (headgear)
 *     "velvet crown" → 0507 (ivory/horn!) BUG — "crown" triggers antler/bone HTS
 *     "fabric crown" → wrong chapter
 *     BUG: "crown" triggers 0507 (horns/antlers/hooves) or "velvet" triggers fabric
 *  4. TITANIUM_BODY_JEWELRY_INTENT → 7117.19 (jewelry of base metal)
 *     "16 Gauge Plain Titanium Clicker Hoop" → 8108.20 (titanium metal) BUG
 *     BUG: "titanium" material triggers metal (ch.81) not jewelry (ch.71)
 *  5. CANDLE_ACCESSORY_SNUFFER_INTENT → 7323.99 / 7326.90 (household articles of metal)
 *     "Silver plated metal candle snuffer" → 3406.00 (candles!) BUG — "candle" triggers candle chapter
 *     BUG: "candle" in "candle snuffer" triggers candle product (3406) instead of metal accessory
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt58.ts
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

    // 1. ACRYLIC_KNIT_HAT_HEADWEAR_INTENT → 6505.00 (hats, headgear of any material)
    //    "80% acrylic 20% wool hand knitted hat" → 9701.21 (paintings!) WRONG
    //    "hand knitted beanie acrylic" → 9701.21 WRONG
    //    "knit merino headband" → wrong chapter likely
    //    BUG: "acrylic" in product name triggers 9701.21 (acrylic paintings/drawings)
    //    6505.00 = hats and headgear, knitted or crocheted, of any material
    {
      const existing = allRules.find(r => r.id === 'ACRYLIC_KNIT_HAT_HEADWEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ACRYLIC_KNIT_HAT_HEADWEAR_INTENT',
          description: 'Knitted/crocheted hats, beanies, headbands of acrylic/wool → ch.65 (6505.00)',
          pattern: {
            anyOf: [
              // Knitted/crocheted hats
              'hand knitted hat', 'hand knit hat', 'hand crocheted hat',
              'knitted hat', 'knit hat', 'crocheted hat', 'crochet hat',
              'acrylic wool hat', 'acrylic knit hat', 'acrylic beanie',
              'wool knitted hat', 'merino knit hat', 'alpaca knit hat',
              // Beanies
              'knitted beanie', 'knit beanie', 'crochet beanie', 'crocheted beanie',
              'acrylic beanie', 'wool beanie', 'winter beanie knit',
              // Headbands (knitted)
              'knit headband', 'knitted headband', 'crochet headband',
              'merino headband', 'wool headband knit', 'acrylic headband',
              // General headwear material combos that trigger wrong chapter
              'acrylic wool beanie', 'acrylic merino hat', '100% acrylic hat',
              '80% acrylic hat', 'acrylic winter hat',
            ],
            noneOf: [
              'baseball cap', 'sun hat', 'brim hat', 'straw hat',
              'bucket hat', 'fedora', 'trucker hat', 'snapback',
              'painting', 'artwork', 'canvas',
            ],
          },
          inject: [
            { prefix: '6505.00', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['97', '55', '58'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '6505.' }],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('ACRYLIC_KNIT_HAT_HEADWEAR_INTENT: created (knit hats → 6505.00, deny ch.97 paintings)');
      }
    }

    // 2. CRYSTAL_GEMSTONE_JEWELRY_INTENT → 7117.90 (imitation jewelry, not precious metal)
    //    "handmade woman jewelry crystal" → 7018.10 (glass beads!) WRONG
    //    "crystal necklace" → 7018.10 WRONG
    //    "crystal bracelet" → 7018.10 WRONG
    //    BUG: "crystal" triggers glass/crystal beads (7018.10) instead of jewelry (7117)
    //    7117.19 = imitation jewelry of base metal
    //    7117.90 = other imitation jewelry (crystal, plastic, acrylic jewelry)
    {
      const existing = allRules.find(r => r.id === 'CRYSTAL_GEMSTONE_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CRYSTAL_GEMSTONE_JEWELRY_INTENT',
          description: 'Crystal jewelry, gemstone jewelry, rhinestone jewelry → ch.71 (7117.90)',
          pattern: {
            anyOf: [
              // Crystal jewelry
              'crystal jewelry', 'crystal jewellery', 'crystal necklace', 'crystal bracelet',
              'crystal earrings', 'crystal ring', 'crystal pendant',
              'crystal bead necklace', 'crystal bead bracelet',
              'handmade crystal jewelry', 'handmade crystal necklace',
              'swarovski crystal jewelry', 'swarovski necklace',
              // Rhinestone jewelry
              'rhinestone jewelry', 'rhinestone necklace', 'rhinestone earrings',
              'rhinestone bracelet', 'rhinestone brooch',
              // Gemstone jewelry (costume/imitation)
              'gemstone jewelry', 'gemstone necklace', 'gemstone bracelet',
              'gemstone earrings', 'semi precious jewelry',
              // Stone/crystal pendants
              'crystal pendant necklace', 'gemstone pendant', 'healing crystal jewelry',
              'amethyst jewelry', 'rose quartz jewelry', 'quartz crystal jewelry',
            ],
            noneOf: [
              // Exclude loose beads (not jewelry)
              'loose beads', 'bead lot', 'glass beads bulk',
              // Exclude precious metal jewelry (different HTS)
              'gold jewelry', 'silver jewelry', 'platinum jewelry',
              'sterling silver', '14k gold', '18k gold',
              // Exclude crystal glassware
              'crystal glass', 'crystal vase', 'crystal bowl', 'crystal decanter',
            ],
          },
          inject: [
            { prefix: '7117.90', syntheticRank: 5 },
            { prefix: '7117.19', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['70'],
            denyPrefixes: ['7018'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '7117.' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('CRYSTAL_GEMSTONE_JEWELRY_INTENT: created (crystal jewelry → 7117.90, deny ch.70 glass)');
      }
    }

    // 3. VELVET_FABRIC_COSTUME_HAT_INTENT → 6505.00 (hats and headgear of any material)
    //    "velvet crown" → 0507 (ivory/horns/hooves!) WRONG — "crown" triggers antler/horn HTS
    //    "fabric crown" → wrong chapter
    //    "faux fur hat" → wrong chapter
    //    BUG: "crown" triggers 0507 (natural animal materials) in HTS descriptions
    //    6505.00 = hats and other headgear, knitted/crocheted or of any material
    {
      const existing = allRules.find(r => r.id === 'VELVET_FABRIC_COSTUME_HAT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VELVET_FABRIC_COSTUME_HAT_INTENT',
          description: 'Velvet crowns, fabric hats, costume headwear, faux fur hats → ch.65 (6505.00)',
          pattern: {
            anyOf: [
              // Velvet hats/crowns
              'velvet crown', 'velvet hat', 'velvet headband',
              'velvet top hat', 'velvet beret',
              // Fabric crowns (costume)
              'fabric crown', 'felt crown', 'princess crown hat',
              'costume crown', 'party crown hat',
              // Faux fur hats
              'faux fur hat', 'fake fur hat', 'fur trim hat',
              'faux fur trapper hat', 'sherpa hat',
              // Fleece/fabric winter hats
              'fleece hat', 'fleece beanie', 'polar fleece hat',
              // Costume/novelty hats
              'costume hat', 'novelty hat', 'witch hat', 'elf hat',
              'santa hat', 'pirate hat costume',
            ],
            noneOf: [
              'straw', 'baseball cap', 'sun visor', 'hard hat', 'helmet',
              'crown jewel', 'dental crown',
            ],
          },
          inject: [
            { prefix: '6505.00', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['05', '58', '61', '62'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '6505.' }],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('VELVET_FABRIC_COSTUME_HAT_INTENT: created (velvet crowns/fabric hats → 6505.00)');
      }
    }

    // 4. TITANIUM_BODY_JEWELRY_INTENT → 7117.19 (imitation/fashion jewelry)
    //    "16 Gauge Plain Titanium Clicker Hoop" → 8108.20 (unwrought titanium metal) WRONG
    //    "titanium nose ring" → 8108 WRONG
    //    BUG: "titanium" triggers ch.81 (other base metals) not ch.71 (jewelry)
    //    7117.19 = imitation jewelry of base metal (includes titanium body jewelry)
    {
      const existing = allRules.find(r => r.id === 'TITANIUM_BODY_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TITANIUM_BODY_JEWELRY_INTENT',
          description: 'Titanium body jewelry, rings, hoops, clicker rings → ch.71 (7117.19)',
          pattern: {
            anyOf: [
              // Titanium body jewelry
              'titanium clicker', 'titanium hoop', 'titanium ring',
              'titanium nose ring', 'titanium earring', 'titanium stud',
              'titanium body jewelry', 'titanium piercing',
              'titanium belly ring', 'titanium septum ring',
              'titanium gauge', 'titanium barbell',
              // Grade titanium body jewelry
              'implant grade titanium', 'g23 titanium', 'titanium body jewellery',
              // Other body jewelry that goes wrong
              'surgical steel ring body', 'surgical steel nose ring',
              'niobium ring body', 'niobium clicker',
            ],
            noneOf: [
              'titanium screw', 'titanium bolt', 'titanium bar stock',
              'titanium wire', 'titanium sheet', 'titanium rod',
            ],
          },
          inject: [
            { prefix: '7117.19', syntheticRank: 5 },
            { prefix: '7117.90', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['81', '73'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '7117.' }],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('TITANIUM_BODY_JEWELRY_INTENT: created (titanium body jewelry → 7117.19, deny ch.81)');
      }
    }

    // 5. CANDLE_ACCESSORY_SNUFFER_INTENT → 7323.99 / 7326.90 (household articles of metal)
    //    "Silver plated metal candle snuffer" → 3406.00 (candles!) WRONG — "candle" triggers candle product
    //    "candle snuffer brass" → 3406 WRONG
    //    "candle holder metal" → might go to 3406 as well
    //    BUG: "candle" in "candle snuffer" triggers 3406 (prepared candles)
    //    7323.99 = other household articles of iron/steel (includes candle accessories)
    //    7326.90 = other articles of iron/steel (includes candle snuffers, wick trimmers)
    {
      const existing = allRules.find(r => r.id === 'CANDLE_ACCESSORY_SNUFFER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CANDLE_ACCESSORY_SNUFFER_INTENT',
          description: 'Candle snuffers, wick trimmers, metal candle accessories → ch.73 (7323.99/7326.90)',
          pattern: {
            anyOf: [
              // Candle snuffers
              'candle snuffer', 'candle snuffers', 'metal candle snuffer',
              'brass candle snuffer', 'silver candle snuffer', 'gold candle snuffer',
              // Wick trimmers
              'wick trimmer', 'wick trimmers', 'candle wick trimmer',
              'wick dipper', 'wick cutter',
              // Candle holders (metal)
              'metal candle holder', 'iron candle holder', 'brass candle holder',
              'silver candle holder', 'taper candle holder metal',
              // Candle accessories (metal)
              'candle accessory metal', 'candle tool set metal',
            ],
            noneOf: [
              // Exclude the candles themselves
              'scented candle', 'soy candle', 'beeswax candle', 'pillar candle',
              'taper candle', 'tea light', 'votive candle',
            ],
          },
          inject: [
            { prefix: '7323.99', syntheticRank: 5 },
            { prefix: '7326.90', syntheticRank: 5 },
          ],
          whitelist: {
            denyChapters: ['34'],
          },
          boosts: [{ delta: 0.55, prefixMatch: '7323.' }],
        } as IntentRule;
        patches.push({ priority: 574, rule: newRule });
        console.log('CANDLE_ACCESSORY_SNUFFER_INTENT: created (candle snuffers → 7323.99, deny ch.34)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT58)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT58 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
