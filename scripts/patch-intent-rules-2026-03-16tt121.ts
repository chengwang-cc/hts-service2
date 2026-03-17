#!/usr/bin/env ts-node
/**
 * Patch TT121 — 2026-03-16: Fix gold-decorated ceramics, wooden purse frames,
 *   collectible trading cards, cooktop mats, and embroidered patches.
 *
 * Fix 1: UPDATE GOLD_DECORATED_CERAMIC_MUG_INTENT — use anyOfGroups
 *   "ABC mug: pink 22kt gold" → 7113.19 WRONG (expected 6912.00)
 *   Root cause: anyOf requires "mug 22kt gold" as a continuous phrase but
 *   the query has ": pink" between "mug" and "22kt gold". Switch to anyOfGroups
 *   requiring BOTH a tableware word AND a gold descriptor to fire.
 *
 * Fix 2: NEW WOODEN_PURSE_FRAME_KISS_LOCK_INTENT → 4421.99
 *   "Wooden Purse Frame Kiss Lock 20cm" → 8301 WRONG (expected 4421.99)
 *   "wood monitor frame" → 9305 WRONG (expected 4421.99)
 *   Root cause: "kiss lock" and "purse frame" trigger lock/hardware codes.
 *   4421.99 = other articles of wood.
 *
 * Fix 3: NEW COLLECTIBLE_GRADED_TRADING_CARD_INTENT → 4911.99
 *   "1947-66 Exhibits #61 Roberto Clemente HOF PSA 6" → EMPTY / 3204 WRONG
 *   "2023 Upper Deck SP Game Used Draft Day Marks /35 Simon Nemec #DDM-SN" → 9504
 *   "custom one piece don!! cards" → 9504 WRONG (expected 4911.99)
 *   Root cause: PSA-graded cards, sports card brands not classified; "PSA 6"
 *   gets no useful tokens; game used/numbered cards go to playing cards.
 *   4911.99.60 = printed on paper by lithographic process (incl. collectible cards).
 *
 * Fix 4: NEW COOKTOP_MAT_SILICONE_PROTECT_INTENT → 4202.99
 *   "LoMi the cooktop mat ver.2.0/3.0/5.0" → 4601 WRONG (expected 4202.99)
 *   Root cause: "mat" → wicker floor mats (4601); no signal for cooktop context.
 *   4202.99 = other containers/articles (includes protective mats/covers).
 *
 * Fix 5: NEW EMBROIDERED_PATCH_BADGE_BROAD_INTENT → 5810.92
 *   "Actual Size Patch" → 0306 (shrimp!) WRONG (expected 5810.92)
 *   "Bearded Axe Patch" → 3301 (essential oils!) WRONG (expected 5810.92)
 *   Root cause: EMBROIDERY_IRON_ON_PATCH_INTENT requires specific phrases like
 *   "embroidered patch", "morale patch", etc. Generic "[noun] patch" not covered.
 *   5810.92 = embroidery and ornamental trimming (patches/badges).
 *   Fix: broader intent allowing "[word] Patch" + "[word] Badge" combos.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt121.ts
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

    // 1. UPDATE GOLD_DECORATED_CERAMIC_MUG_INTENT — switch to anyOfGroups
    //    "ABC mug: pink 22kt gold" fails because "mug 22kt gold" is NOT a
    //    continuous substring (": pink" is between "mug" and "22kt gold").
    //    Use anyOfGroups requiring BOTH a vessel word AND a gold descriptor.
    {
      const existing = allRules.find(r => r.id === 'GOLD_DECORATED_CERAMIC_MUG_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            anyOfGroups: [
              // Group A: vessel/tableware type
              ['mug', 'cup', 'stein', 'teacup', 'saucer', 'bowl', 'plate', 'platter',
               'dinnerware', 'tableware', 'serveware', 'pitcher', 'creamer', 'teapot',
               'coffee mug', 'cappuccino mug', 'latte mug', 'espresso cup'],
              // Group B: gold decoration indicator
              ['22kt', '22k gold', '24kt', '24k gold', '18kt', '18k gold',
               'gold luster', 'gold lustre', 'gold rim', 'gold trim', 'gold accent',
               'gold decoration', 'gold painted', 'gold leaf', 'gold edge',
               'gold band', 'gilt', 'gilded'],
            ],
            noneOf: [
              // Block actual jewelry
              'gold ring', 'gold necklace', 'gold bracelet', 'gold earring',
              'gold pendant', 'gold chain', 'gold bangle', 'gold anklet',
              'gold plated ring', 'gold plated necklace', 'gold plated bracelet',
              'gold jewelry', 'gold jewellery',
              // Block candles
              'scented candle', 'candle mug', 'candle cup',
            ],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 596, rule: updated });
        console.log('GOLD_DECORATED_CERAMIC_MUG_INTENT: updated to use anyOfGroups');
      } else {
        console.log('GOLD_DECORATED_CERAMIC_MUG_INTENT: not found');
      }
    }

    // 2. NEW WOODEN_PURSE_FRAME_KISS_LOCK_INTENT → 4421.99
    //    Wooden purse frames are articles of wood, not hardware/locks (8301).
    //    "kiss lock" in product names triggers 8301 (padlocks).
    {
      const existing = allRules.find(r => r.id === 'WOODEN_PURSE_FRAME_KISS_LOCK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_PURSE_FRAME_KISS_LOCK_INTENT',
          description: 'Wooden purse frames / kiss-lock frames → 4421.99 (articles of wood)',
          pattern: {
            anyOf: [
              'wooden purse frame', 'wood purse frame', 'purse frame wood',
              'wooden purse frames', 'wood purse frames',
              'kiss lock purse frame', 'kiss lock wood', 'kiss lock wooden',
              'purse frame kiss lock', 'purse frame kiss-lock',
              'wood bag frame', 'wooden bag frame',
              'wood clutch frame', 'wooden clutch frame',
              'wallet wood frame', 'purse clasp wood',
              'wood monitor frame', 'wooden monitor frame',
              'wood display frame', 'wooden display frame',
            ],
            noneOf: [
              // Metal/plastic frames
              'metal purse frame', 'brass purse frame', 'silver purse frame',
              'acrylic frame', 'plastic frame', 'resin frame',
              // Window/door frames
              'window frame', 'door frame', 'picture frame', 'photo frame',
            ],
          },
          inject: [
            { prefix: '4421.99', syntheticRank: 1 },  // other articles of wood
            { prefix: '4421.91', syntheticRank: 5 },  // bamboo articles
          ],
          whitelist: {
            allowChapters: ['44'],   // only wood chapter
            denyChapters: ['83', '73'],  // block hardware, iron/steel
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4421.' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '8301.' },  // strong penalty for locks
            { delta: 0.85, prefixMatch: '8302.' },  // penalty for fittings
          ],
        } as IntentRule;
        patches.push({ priority: 597, rule: newRule });
        console.log('WOODEN_PURSE_FRAME_KISS_LOCK_INTENT: created (→4421.99, allowChapters:[44])');
      } else {
        console.log('WOODEN_PURSE_FRAME_KISS_LOCK_INTENT: already exists, skipping');
      }
    }

    // 3. NEW COLLECTIBLE_GRADED_TRADING_CARD_INTENT → 4911.99
    //    PSA-graded and numbered sports cards, trading card brands.
    //    "PSA 6" / "BGS 9.5" → empty or dye codes (3204); "Upper Deck" → 9504.
    //    4911.99.60 = lithographic prints (includes collectible trading cards).
    {
      const existing = allRules.find(r => r.id === 'COLLECTIBLE_GRADED_TRADING_CARD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COLLECTIBLE_GRADED_TRADING_CARD_INTENT',
          description: 'Graded/collectible sports/trading cards → 4911.99.60 (lithographic prints)',
          pattern: {
            anyOf: [
              // PSA/BGS/SGC graded cards
              'psa graded', 'psa grade', 'bgs graded', 'sgc graded',
              'graded card', 'graded baseball card', 'graded hockey card',
              'graded basketball card', 'graded football card',
              // Grading abbreviations in context
              'psa 10', 'psa 9', 'psa 8', 'psa 7', 'psa 6', 'psa 5',
              'bgs 10', 'bgs 9.5', 'bgs 9', 'sgc 10', 'sgc 9',
              // Major card brands
              'upper deck card', 'upper deck sp', 'upper deck rookie',
              'topps rookie', 'topps card', 'topps chrome',
              'panini rookie', 'panini card', 'panini prizm',
              'donruss card', 'fleer card', 'bowman card',
              'score hockey card', 'o-pee-chee card', 'opc card',
              // Card types
              'rookie card', 'baseball rookie card', 'hockey rookie card',
              'numbered card', 'serial numbered card', 'refractor card',
              'game used card', 'game used relic', 'autographed card',
              'patch card', 'jersey card', 'relic card',
              // Card product lines
              'sport card lot', 'sports card lot', 'card lot pack',
              'wax pack card', 'blaster box cards',
              // Exhibit/vintage cards
              'exhibits card', 'exhibit card', 'hof card',
            ],
            noneOf: [
              // Playing card games (ch.95)
              'playing card game', 'poker card', 'tarot card', 'oracle card',
              'flash card', 'flashcard', 'greeting card',
              // Birthday/gift
              'gift card', 'credit card', 'id card', 'business card',
              // Fabric/other
              'cardigan', 'cardstock',
            ],
          },
          inject: [
            { prefix: '4911.99', syntheticRank: 1 },  // lithographic prints (collectible cards)
            { prefix: '4911.91', syntheticRank: 5 },  // other printed matter
          ],
          whitelist: {
            allowChapters: ['49'],   // only paper/printed matter chapter
            denyChapters: ['95', '32'],  // block games/playing cards and dyes
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4911.99' },
            { delta: 0.50, prefixMatch: '4911.' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '9504.' },  // strong penalty for playing card games
            { delta: 0.95, prefixMatch: '3204.' },  // strong penalty for dyes
          ],
        } as IntentRule;
        patches.push({ priority: 598, rule: newRule });
        console.log('COLLECTIBLE_GRADED_TRADING_CARD_INTENT: created (→4911.99, allowChapters:[49])');
      } else {
        console.log('COLLECTIBLE_GRADED_TRADING_CARD_INTENT: already exists, skipping');
      }
    }

    // 4. NEW COOKTOP_MAT_SILICONE_PROTECT_INTENT → 4202.99
    //    "LoMi the cooktop mat" → 4601 (wicker floor mats!) WRONG.
    //    "cooktop mat" → silicone/rubber protective mat for stove tops.
    //    4202.99 = other articles used as containers/protectors.
    {
      const existing = allRules.find(r => r.id === 'COOKTOP_MAT_SILICONE_PROTECT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COOKTOP_MAT_SILICONE_PROTECT_INTENT',
          description: 'Cooktop protective mats → 4202.99 (other containers/protectors)',
          pattern: {
            anyOf: [
              'cooktop mat', 'cooktop mats', 'cooktop protective mat',
              'stove top mat', 'stovetop mat', 'cooktop cover mat',
              'cooktop protector mat', 'induction mat', 'induction cooktop mat',
              'lomi cooktop', 'lomi mat', 'silicone cooktop',
              'glass cooktop mat', 'gas stove mat', 'cooktop pad',
              'stove mat', 'range mat',
            ],
            noneOf: [
              'floor mat', 'door mat', 'bath mat', 'car mat',
              'yoga mat', 'exercise mat', 'welcome mat',
            ],
          },
          inject: [
            { prefix: '4202.99', syntheticRank: 1 },
            { prefix: '3924.10', syntheticRank: 5 },  // plastic kitchen articles
          ],
          whitelist: {
            denyChapters: ['46', '57', '63'],  // block wicker/floor coverings/textiles
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4202.99' },
            { delta: 0.60, prefixMatch: '3924.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4601.' },  // strong penalty for wicker/plaited mats
            { delta: 0.80, prefixMatch: '5705.' },  // penalty for textile floor mats
          ],
        } as IntentRule;
        patches.push({ priority: 599, rule: newRule });
        console.log('COOKTOP_MAT_SILICONE_PROTECT_INTENT: created (→4202.99, denyChapters:[46,57,63])');
      } else {
        console.log('COOKTOP_MAT_SILICONE_PROTECT_INTENT: already exists, skipping');
      }
    }

    // 5. NEW FABRIC_PATCH_BADGE_GENERIC_INTENT → 5810.92
    //    Supplement the existing EMBROIDERY_IRON_ON_PATCH_INTENT for generic "[word] patch"
    //    patterns that don't contain "iron on", "morale", "embroidered" etc.
    //    "Actual Size Patch" → 0306 (shrimp); "Bearded Axe Patch" → 3301 (oils).
    //    5810.92 = embroidery and ornamental trimming (includes fabric patches/badges).
    {
      const existing = allRules.find(r => r.id === 'FABRIC_PATCH_BADGE_GENERIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FABRIC_PATCH_BADGE_GENERIC_INTENT',
          description: 'Generic fabric patches and embroidered badges → 5810.92',
          pattern: {
            anyOfGroups: [
              // Group A: it must be a patch or badge (sew/embroidered context)
              ['patch', 'patches', 'badge', 'badges', 'insignia'],
              // Group B: context signal showing it's decorative/wearable not medical/tech
              [
                'embroidered', 'embroidery', 'woven', 'iron on', 'iron-on',
                'sew on', 'sew-on', 'sewn', 'velcro', 'hook loop', 'hook-and-loop',
                'morale', 'jacket', 'backpack', 'vest', 'military', 'tactical',
                'decorative patch', 'souvenir', 'fan patch', 'logo patch',
                'name patch', 'custom patch', 'applique', 'appliqué',
                'actual size', 'bearded axe', 'design patch',
              ],
            ],
            noneOf: [
              // Medical patches
              'nicotine patch', 'birth control patch', 'pain relief patch',
              'medical patch', 'hormone patch', 'drug patch', 'transdermal',
              // Tech / software
              'patch cord', 'patch cable', 'patch panel', 'patch bay',
              'software patch', 'firmware patch', 'security patch',
              // Physical repair
              'tire patch', 'repair patch', 'inner tube patch',
              'patch kit', 'patch and repair',
              // Body
              'eye patch', 'eyepatch', 'pirate patch',
            ],
          },
          inject: [
            { prefix: '5810.92', syntheticRank: 1 },  // embroidery (synthetic fabrics)
            { prefix: '5810.10', syntheticRank: 4 },  // embroidery without visible ground
            { prefix: '5810.91', syntheticRank: 6 },  // embroidery of cotton
          ],
          whitelist: {
            allowChapters: ['58'],   // embroidery chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '5810.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '3301.' },  // penalize essential oils
            { delta: 0.90, prefixMatch: '3005.' },  // penalize medical dressings
          ],
        } as IntentRule;
        patches.push({ priority: 600, rule: newRule });
        console.log('FABRIC_PATCH_BADGE_GENERIC_INTENT: created (→5810.92, anyOfGroups)');
      } else {
        console.log('FABRIC_PATCH_BADGE_GENERIC_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT121)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT121 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
