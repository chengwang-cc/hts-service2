#!/usr/bin/env ts-node
/**
 * Patch TT72 — 2026-03-15: Fix game/anime keychains, photocard holders, auto trim molding.
 *
 * Fixes:
 *  1. UPDATE KEYCHAIN_METAL_INTENT — require explicit metal keyword (anyOfGroups)
 *     "Omori SMASH Keychains" → 7326.20 (metal wire!) WRONG (expected 3926.90.35)
 *     "Fire Emblem 3 Hopes Keychains" → 7326.20 WRONG (expected 3926.90.40)
 *     BUG: KEYCHAIN_METAL_INTENT fires for ALL 'keychains' queries without plastic keywords
 *     including anime/game character keychains which are almost always acrylic plastic.
 *     FIX: Add anyOfGroups:[['metal','steel','iron','alloy','brass','zinc','stainless',...]]
 *          so metal intent only fires for queries with explicit metal material keywords.
 *
 *  2. NEW CHARACTER_KEYCHAIN_PLASTIC_INTENT → 3926.90 (plastic key rings/holders)
 *     Game/anime character keychains → 3926.90.35 / 3926.90.40 / 3926.90.85
 *     BUG: Without KEYCHAIN_METAL_INTENT fix, these go to 7326. After fix, organic
 *          search still needs boosting for 3926.90 codes.
 *     FIX: New intent matches "keychains" with game/character context → 3926.90.35
 *
 *  3. NEW PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT → 3926.90
 *     "Photocard Holder | ID Badge Holder | Bus Pass Cover" → 5807 (labels!) WRONG (expected 3926.90.10)
 *     "Keychain Plastic Photocard Holder" → expected 3926.90.59
 *     "Custom name badge holder" → expected 3926.90.65.10
 *     BUG: "badge" triggers textile/label chapter (5807); "photocard" → ch.48 (paper)
 *     FIX: New intent for plastic card holders, badge holders, photocard sleeves → 3926.90
 *
 *  4. NEW PLASTIC_AUTO_TRIM_MOLDING_INTENT → 3925.20
 *     "Trunk Chrome Molding" → 2610.00 (chromium ore!) WRONG (expected 3925.20.00.91)
 *     "Trunk Chrome Molding (Used)" → 2610.00 WRONG
 *     BUG: "chrome" triggers chromium ore chapter (2610); "molding" → mold boxes (8480)
 *     3925.20.00.91 = builders' ware of plastics (includes plastic auto body trim/molding)
 *     FIX: New intent for plastic car body trim/chrome molding strips → 3925.20
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt72.ts
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

    // 1. UPDATE KEYCHAIN_METAL_INTENT — require explicit metal keyword via anyOfGroups
    //    "Omori SMASH Keychains" → 7326.20 WRONG because KEYCHAIN_METAL_INTENT fires for
    //    any 'keychains' query without plastic keywords (game/anime = almost always plastic acrylic)
    //    FIX: Add anyOfGroups requiring at least one explicit metal material keyword
    {
      const existing = allRules.find(r => r.id === 'KEYCHAIN_METAL_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            // Now requires explicit metal keyword — prevents anime/game keychains from matching
            anyOfGroups: [
              ['metal', 'steel', 'iron', 'stainless', 'alloy', 'brass', 'zinc',
               'copper', 'pewter', 'aluminum', 'aluminium', 'chrome metal',
               'die cast', 'cast zinc', 'nickel'],
            ],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('KEYCHAIN_METAL_INTENT: added anyOfGroups (require explicit metal keyword)');
      } else {
        console.log('KEYCHAIN_METAL_INTENT: not found');
      }
    }

    // 2. NEW CHARACTER_KEYCHAIN_PLASTIC_INTENT → 3926.90 (plastic key rings/holders)
    //    Game/anime character keychains: "Omori SMASH Keychains" → 3926.90.35
    //                                   "Fire Emblem 3 Hopes Keychains" → 3926.90.40
    //    These don't have "acrylic" or "plastic" keywords — KEYCHAIN_ACRYLIC_INTENT won't match
    //    FIX: Match 'keychains' with game/anime context → inject 3926.90.35/40/85
    {
      const existing = allRules.find(r => r.id === 'CHARACTER_KEYCHAIN_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CHARACTER_KEYCHAIN_PLASTIC_INTENT',
          description: 'Game/anime/character keychains without explicit plastic keyword → 3926.90 plastic key rings',
          pattern: {
            anyOf: ['keychains', 'keychain'],
            // These are typically plastic/acrylic character art keychains
            // noneOf excludes explicit metal, textile, wood materials
            noneOf: [
              'metal', 'steel', 'iron', 'stainless', 'alloy', 'brass', 'zinc', 'copper',
              'leather', 'wood', 'wooden', 'mdf', 'crochet', 'knit', 'macrame',
              'cotton', 'denim', 'fabric', 'textile', 'fur', 'plush',
              'epoxy',
            ],
          },
          inject: [
            { prefix: '3926.90.35', syntheticRank: 5 },  // Key rings, key cases, key holders
            { prefix: '3926.90.40', syntheticRank: 8 },  // Other plastic articles
            { prefix: '3926.90.85', syntheticRank: 12 }, // Other plastic articles (misc)
            { prefix: '3926.40', syntheticRank: 15 },    // Decorative/statuette plastic articles
          ],
          whitelist: {
            allowChapters: ['39', '71', '95'],            // plastic, jewelry/charm, festive/hobby
          },
          boosts: [
            { delta: 0.65, prefixMatch: '3926.90.35' },
            { delta: 0.50, prefixMatch: '3926.90' },
            { delta: 0.40, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.70, prefixMatch: '7326.' },
            { delta: 0.70, prefixMatch: '7314.' },
          ],
        } as IntentRule;
        patches.push({ priority: 475, rule: newRule });
        console.log('CHARACTER_KEYCHAIN_PLASTIC_INTENT: created (game/anime keychains → 3926.90.35, allow ch.39/71/95)');
      }
    }

    // 3. NEW PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT → 3926.90
    //    "Photocard Holder | ID Badge Holder | Bus Pass Cover" → 5807 (fabric labels!) WRONG
    //    Expected: 3926.90.10 (plastic articles, general)
    //    "Keychain Plastic Photocard Holder" → expected 3926.90.59
    //    "Custom name badge holder" → expected 3926.90.65.10
    //    BUG: "badge" pulls into textile/label chapter (5807 = woven fabric labels)
    //         "photocard" → ch.48 (paper/photographic paper)
    //    3926.90 = other articles of plastics (card holders, badge holders, sleeves)
    {
      const existing = allRules.find(r => r.id === 'PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT',
          description: 'Photocard holders, ID badge holders, card sleeves → ch.39 (3926.90 plastic articles)',
          pattern: {
            anyOf: [
              // Photocard holders (K-pop card sleeves)
              'photocard holder', 'photocard sleeve', 'photo card holder', 'photo card sleeve',
              'kpop photocard', 'kpop card holder', 'kpop card sleeve', 'idol card holder',
              'trading card holder', 'trading card sleeve',
              // ID/badge holders
              'id badge holder', 'name badge holder', 'badge holder plastic', 'badge holder clear',
              'id card holder', 'id card sleeve', 'id card cover',
              'lanyard badge holder', 'conference badge holder',
              // Bus pass / transit card holders
              'bus pass cover', 'bus pass holder', 'transit card holder', 'oyster card holder',
              // General plastic card sleeves/cases
              'card holder plastic', 'plastic card holder', 'clear card sleeve',
              'sliding card holder', 'card case plastic',
            ],
            noneOf: [
              // Exclude textile/fabric badge holders
              'fabric badge', 'cloth badge', 'woven badge',
              // Exclude paper stationery
              'paper folder', 'card stock',
              // Exclude actual ID documents
              'government id', 'driver license',
            ],
          },
          inject: [
            { prefix: '3926.90.10', syntheticRank: 3 },  // Plastic articles
            { prefix: '3926.90.59', syntheticRank: 5 },  // Other plastic articles
            { prefix: '3926.90.65', syntheticRank: 7 },  // Other plastic articles
            { prefix: '3926.90.99', syntheticRank: 10 }, // Other plastic articles NEC
          ],
          whitelist: {
            allowChapters: ['39'],
          },
          boosts: [
            { delta: 0.70, prefixMatch: '3926.90' },
          ],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT: created (photocard/badge holders → 3926.90, deny non-plastic)');
      }
    }

    // 4. NEW PLASTIC_AUTO_TRIM_MOLDING_INTENT → 3925.20
    //    "Trunk Chrome Molding" → 2610.00 (chromium ore!) WRONG (expected 3925.20.00.91)
    //    BUG: "chrome" → chromium ore (2610); "molding" → mold equipment (8480)
    //    3925.20 = builders' ware of plastics (doors/windows/thresholds/trim)
    //    3925.20.00.91 = other builders' ware (includes plastic automotive body trim/molding strips)
    //    FIX: New intent targeting plastic auto body trim/molding → 3925.20, deny ch.26/84
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_AUTO_TRIM_MOLDING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_AUTO_TRIM_MOLDING_INTENT',
          description: 'Plastic/chrome auto body trim, trunk molding strips → ch.39 (3925.20 builders ware)',
          pattern: {
            anyOf: [
              // Chrome/body trim molding strips
              'trunk chrome molding', 'chrome molding', 'chrome trim molding', 'chrome trim strip',
              'body side molding', 'body molding strip', 'car body trim',
              'door chrome trim', 'door molding strip', 'auto body molding',
              'trunk molding', 'trunk trim strip', 'trunk trim molding',
              'vehicle chrome trim', 'car chrome strip', 'car chrome molding',
              // Plastic trim/molding (automotive)
              'plastic trim strip', 'plastic molding strip', 'auto trim plastic',
              'window trim molding', 'hood molding', 'fender molding',
            ],
            noneOf: [
              // Exclude metal molding tools
              'injection mold', 'molding machine', 'mold base', 'foundry mold',
              // Exclude chromium ore/chemical
              'chromium ore', 'chromite',
              // Exclude actual window molding (construction)
              'wood molding', 'crown molding', 'baseboard molding',
            ],
          },
          inject: [
            { prefix: '3925.20', syntheticRank: 2 },  // Builders ware of plastics (doors/trim)
            { prefix: '3926.30', syntheticRank: 5 },  // Fittings for furniture/carriages/similar
            { prefix: '8708.29', syntheticRank: 10 }, // Other auto body parts
          ],
          whitelist: {
            denyChapters: ['26', '84', '85'], // deny chromium ores, machinery, electric
          },
          boosts: [
            { delta: 0.75, prefixMatch: '3925.' },
            { delta: 0.40, chapterMatch: '39' },
          ],
        } as IntentRule;
        patches.push({ priority: 574, rule: newRule });
        console.log('PLASTIC_AUTO_TRIM_MOLDING_INTENT: created (trunk chrome molding → 3925.20, deny ch.26/84)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT72)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT72 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
