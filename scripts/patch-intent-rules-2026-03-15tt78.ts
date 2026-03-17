#!/usr/bin/env ts-node
/**
 * Patch TT78 — 2026-03-15: EDC card holders → ch.42, glass brand terms, copper/metal clasps.
 *
 * Fixes:
 *  1. NEW SLIM_WALLET_EDC_HOLDER_INTENT → 4202 (leather/travel goods)
 *     "Carbon Fiber ID and Card EDC Holder" → 9504 WRONG (expected 4202.39.90)
 *     BUG: 'edc card holder' phrase doesn't match because word order is "card edc holder"
 *          PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT has allowChapters:['39'] → blocks ch.42
 *     FIX: New intent with 'card edc', 'edc holder', 'edc card case' → 4202, allow ch.42
 *
 *  2. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — add Corelle brand, glass trinket/candy
 *     "Corelle Brushed Green Large Pasta Salad Bowls" → 6912 WRONG (expected 7013.49.60)
 *     "Retro Clear Glass Trinket Dish" → 6911 WRONG (expected 7013.41.50)
 *     "handmade glass leather candy dish" → 6912 WRONG (expected 7013.49.20)
 *     FIX: Add 'corelle', 'glass trinket', 'glass candy dish', 'glass trinket dish',
 *          'glass coaster', 'glass tray', 'glass dessert dish'
 *
 *  3. NEW COPPER_CLASP_BROOCH_INTENT → 7419.99 (copper misc articles) for copper jewelry findings
 *     "Handmade Copper Cardigan Clasp with Aventurine Gemstone" → 8301 (padlocks) WRONG
 *     BUG: "clasp" pulls to locks/padlocks (8301); "copper" alone → copper pipes/wire
 *     7419.99 = other articles of copper; 7319.40 = pins of steel
 *     FIX: Match copper clasps, brooches, closures → 7419 or 7317 (copper nails/pins)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt78.ts
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

    // 1. NEW SLIM_WALLET_EDC_HOLDER_INTENT → 4202 (travel goods/wallets)
    //    "Carbon Fiber ID and Card EDC Holder" → 9504 WRONG (expected 4202.39.90)
    //    BUG: PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT has allowChapters:['39'] → blocks ch.42
    //         'edc card holder' phrase doesn't match "card edc holder" (wrong word order)
    //    4202.31 = wallets, change purses, cardholder cases; 4202.39 = other wallets/cases
    //    FIX: New intent for minimalist wallets, EDC card holders → 4202, allow ch.42
    {
      const existing = allRules.find(r => r.id === 'SLIM_WALLET_EDC_HOLDER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SLIM_WALLET_EDC_HOLDER_INTENT',
          description: 'Slim wallets, EDC card holders, minimalist wallets → ch.42 (4202 wallets)',
          pattern: {
            anyOf: [
              // EDC variants (different word orders)
              'edc holder', 'edc wallet', 'edc card case',
              'card edc', 'everyday carry wallet', 'everyday carry card',
              // Carbon fiber specific
              'carbon fiber card holder', 'carbon fiber card case', 'carbon fiber wallet',
              'carbon fibre card holder', 'carbon fibre wallet',
              // RFID wallets
              'rfid blocking wallet', 'rfid wallet', 'rfid card holder',
              'rfid blocking card', 'rfid slim wallet',
              // Slim/minimalist wallets
              'slim wallet', 'thin wallet', 'minimalist wallet',
              'money clip wallet', 'front pocket wallet',
              'bifold wallet', 'trifold wallet',
              // Card-specific holders that go to ch.42
              'card holder wallet', 'card case wallet',
            ],
            noneOf: [
              // Exclude tech wallets (phone cases with card slots)
              'phone wallet', 'phone card holder', 'iphone wallet',
              // Exclude plastic card holders (handled by PHOTOCARD_BADGE_HOLDER)
              'photocard holder', 'badge holder', 'id badge',
            ],
          },
          inject: [
            { prefix: '4202.31', syntheticRank: 2 },  // wallets, change purses, cardholders
            { prefix: '4202.32', syntheticRank: 4 },  // wallets with outer surface of other material
            { prefix: '4202.39', syntheticRank: 6 },  // other wallets/cases
          ],
          whitelist: {
            allowChapters: ['42', '39'],              // leather goods OR plastic
            denyChapters: ['95', '85', '84'],         // deny games, electrical, machinery
          },
          boosts: [
            { delta: 0.80, prefixMatch: '4202.' },
            { delta: 0.40, chapterMatch: '42' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '95' }, // penalize games/toys
          ],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SLIM_WALLET_EDC_HOLDER_INTENT: created (EDC/slim/RFID wallets → 4202, deny ch.95)');
      } else {
        console.log('SLIM_WALLET_EDC_HOLDER_INTENT: already exists, skipping');
      }
    }

    // 2. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — add Corelle, glass trinket/candy phrases
    //    "Corelle Brushed Green Large Pasta Salad Bowls" → 6912 WRONG (expected 7013.49.60)
    //    "Retro Clear Glass Trinket Dish" → 6911 WRONG (expected 7013.41.50)
    //    "handmade glass leather candy dish" → 6912 WRONG (expected 7013.49.20)
    {
      const existing = allRules.find(r => r.id === 'GLASS_HOUSEHOLD_DRINKWARE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Corelle brand (Vitrelle glass material)
          'corelle', 'corelle bowl', 'corelle plate', 'corelle dish',
          // Glass trinket and candy dishes
          'glass trinket', 'glass trinket dish', 'glass trinket bowl',
          'glass candy dish', 'glass candy bowl', 'glass candy jar',
          // Glass tray/coaster
          'glass tray', 'glass serving tray', 'glass coaster',
          // Glass dessert dishes
          'glass dessert dish', 'glass sundae', 'glass parfait',
          // Vintage/antique glass
          'vintage glass dish', 'vintage glass bowl', 'antique glass dish',
          'retro glass dish', 'retro glass bowl', 'vintage glass trinket',
          // More glass vessel terms
          'glass compote', 'glass comport', 'glass bonbon', 'glass relish dish',
          'glass fruit dish', 'glass butter dish',
          // Additional brand names
          'waterford crystal', 'waterford glass',
          'lenox crystal', 'wedgwood glass',
          'fostoria glass', 'cambridge glass', 'heisey glass',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 572, rule: updated });
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: added Corelle, glass trinket/candy, vintage glass brands');
      } else {
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: not found');
      }
    }

    // 3. UPDATE ENAMEL_DECORATIVE_PIN_INTENT — add copper clasp/brooch terms
    //    "Handmade Copper Cardigan Clasp with Aventurine Gemstone" → 8301 (padlocks) WRONG (expected 7319.40)
    //    BUG: "clasp" → padlocks/locks (8301); copper clasp should be 7319 (pins/clasps) or 7417/7419
    //    7319.40 includes various pins/clasps of iron/steel; copper ones might be 7417 or 7419
    //    FIX: Add copper clasp/brooch terms to existing ENAMEL_DECORATIVE_PIN_INTENT
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_DECORATIVE_PIN_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Copper/brass clasps and closures (for textile/jewelry)
          'copper clasp', 'copper brooch', 'copper cardigan clasp',
          'brass clasp', 'brass brooch', 'metal cardigan clasp',
          'cardigan clasp', 'shawl clasp', 'cape clasp',
          'sweater clasp', 'cloak clasp',
          // Closures for jewelry/garments
          'toggle clasp', 'hook and eye clasp', 'lobster clasp',
          'metal clasp fastener', 'decorative clasp',
        ];
        // Also update whitelist to include ch.74 (copper) alongside ch.73
        const currentWhitelist = (existing as any).whitelist || {};
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
          whitelist: {
            ...currentWhitelist,
            allowChapters: ['73', '74'],  // iron/steel OR copper articles
            denyChapters: ['71', '83', '96'],
          },
        } as IntentRule;
        patches.push({ priority: 568, rule: updated });
        console.log('ENAMEL_DECORATIVE_PIN_INTENT: added copper clasp/brooch terms, allow ch.74 (copper)');
      } else {
        console.log('ENAMEL_DECORATIVE_PIN_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT78)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT78 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
