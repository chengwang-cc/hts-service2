#!/usr/bin/env ts-node
/**
 * Patch TT70 — 2026-03-15: Fix spiritual candles, reed/passive diffusers, oud incense sticks.
 *
 * Fixes:
 *  1. NEW SPIRITUAL_RITUAL_CANDLE_INTENT → 3307.30.50 (room deodorizers)
 *     "3 Pack Money Candles" → 3406 (plain wax candles) WRONG (expected 3307.30.50)
 *     "3 Pack Spiritual Conjured Candles" → 3406 WRONG (expected 3307.30.50)
 *     "Block Buster Candle" → 3406 WRONG (expected 3307.30.10 or 3307.30.50)
 *     BUG: CANDLE_INTENT/CANDLE_HOME_INTENT match "candle" → injects 3406 (plain candles)
 *     3307.30.50 = other room deodorizers (ritual/spiritual/blessing candles with fragrance)
 *     FIX: New intent for spiritual/money/conjured candles → 3307.30 with denyChapters:['34']
 *
 *  2. NEW PASSIVE_DIFFUSER_FRESHENER_INTENT → 3307.49 (non-electric room deodorizers)
 *     "car air diffuser" → 8479.89 (industrial machinery!) WRONG (expected 3307.49)
 *     "Diffuser Cedar Mood - 140ml-diffuser" → 8479.89 WRONG (expected 3307.49)
 *     "Glade Electric Wax Melt Warmer Air Freshener" → 0904 WRONG (expected 3307.49)
 *     BUG: DIFFUSER_INTENT injects 8479.89 at rank:22 (higher priority than 3307.49 at rank:26)
 *     3307.49 = room deodorizers (non-electric reed/passive/wax-melt diffusers, car fresheners)
 *     FIX: New intent with 3307.49 at syntheticRank:1, denyChapters:['84','85']
 *
 *  3. UPDATE DIFFUSER_INTENT — add noneOf for passive/car diffusers to prevent 8479 routing
 *     When DIFFUSER_INTENT matches "reed diffuser" / "car diffuser" / "air freshener",
 *     the 8479.89 injection outweighs the 3307.49 injection.
 *     FIX: Add 'reed diffuser', 'car air diffuser', 'car diffuser', 'air freshener',
 *           'wax melt', 'wax melt warmer', 'room diffuser oil' to noneOf
 *
 *  4. UPDATE INCENSE_INTENT — add oud sticks and bakhoor to anyOf
 *     "Ayam Al Tayyebeen Oud Sticks - 10PC" → 4412 (plywood!) WRONG (expected 3307.41)
 *     BUG: "oud" and "bakhoor" are Arabic/Middle Eastern incense but not in INCENSE_INTENT anyOf
 *     FIX: Add 'oud sticks', 'oud incense', 'bakhoor', 'agarbatti', 'dhoop', 'bukhoor' to anyOf
 *
 *  5. NEW RITUAL_BATH_SPIRITUAL_WASH_INTENT → 3307.30.10 (bath preparations)
 *     "Block Buster Wash - Buy 1 bath" → 3922 (bathtubs!) WRONG (expected 3307.30.10)
 *     "Block Buster Wash - Buy 3 baths" → 3922 WRONG
 *     BUG: "wash" and "bath" trigger bathroom fixture chapter (3922)
 *     3307.30.10 = perfumed bath salts and other bath preparations
 *     FIX: New intent for spiritual wash/bath preparations → 3307.30.10, deny ch.39
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt70.ts
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

    // 1. NEW SPIRITUAL_RITUAL_CANDLE_INTENT → 3307.30.50 (room deodorizers, ritual candles)
    //    "3 Pack Money Candles" → 3406 WRONG; "Spiritual Conjured Candles" → 3406 WRONG
    //    Spiritual/ritual candles with scent = room deodorizers (3307.30) not wax candles (3406)
    //    3307.30.10 = perfumed bath salts and other bath preparations
    //    3307.30.50 = other room deodorizers (incl. spiritual/prayer/blessing candles)
    {
      const existing = allRules.find(r => r.id === 'SPIRITUAL_RITUAL_CANDLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SPIRITUAL_RITUAL_CANDLE_INTENT',
          description: 'Spiritual/money/blessing/conjured candles → ch.33 (3307.30.50 room deodorizers)',
          pattern: {
            anyOf: [
              // Spiritual/ritual candles
              'money candle', 'money candles', 'spiritual candle', 'spiritual candles',
              'conjured candle', 'conjured candles', 'blessing candle', 'blessing candles',
              'ritual candle', 'ritual candles', 'spell candle', 'spell candles',
              'prayer candle', 'prayer candles', 'intention candle', 'chakra candle',
              'voodoo candle', 'hoodoo candle', 'witchcraft candle', 'wicca candle',
              // Block Buster brand (spiritual botanica)
              'block buster candle', 'block buster',
              // Seven day candles are typically spiritual (novena/religious)
              'seven day candle', '7 day candle', 'novena candle',
              // Other botanica/spiritual terms
              'reversible candle', 'protection candle', 'love candle spell',
              'come to me candle', 'prosperity candle',
            ],
            noneOf: [
              // Exclude plain decorative candles
              'candle holder', 'candlestick', 'candle stick', 'birthday candle',
              'taper candle', 'tea light', 'tealight', 'pillar candle',
              'soy candle', 'beeswax candle',
            ],
          },
          inject: [
            { prefix: '3307.30.50', syntheticRank: 1 }, // other room deodorizers (spiritual candles)
            { prefix: '3307.30.10', syntheticRank: 2 }, // bath preparations (scented ritual products)
            { prefix: '3307.41', syntheticRank: 3 },    // incense (related)
          ],
          whitelist: {
            denyChapters: ['34'],
          },
          boosts: [
            { delta: 0.70, prefixMatch: '3307.30' },
          ],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('SPIRITUAL_RITUAL_CANDLE_INTENT: created (money/spiritual candles → 3307.30.50, deny ch.34)');
      }
    }

    // 2. NEW PASSIVE_DIFFUSER_FRESHENER_INTENT → 3307.49 (non-electric room deodorizers)
    //    "car air diffuser" → 8479.89 WRONG; "Diffuser Cedar Mood" → 8479.89 WRONG
    //    "Glade Electric Wax Melt Warmer" → 0904 WRONG (all expect 3307.49)
    //    3307.49 = other room deodorizers (non-electric diffusers, car fresheners, wax melts)
    {
      const existing = allRules.find(r => r.id === 'PASSIVE_DIFFUSER_FRESHENER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PASSIVE_DIFFUSER_FRESHENER_INTENT',
          description: 'Car air fresheners, reed diffusers, wax melt warmers → ch.33 (3307.49)',
          pattern: {
            anyOf: [
              // Car fresheners/diffusers
              'car air diffuser', 'car diffuser', 'car air freshener', 'car freshener',
              'car scent', 'car scented', 'auto air freshener', 'vent clip freshener',
              'hanging freshener',
              // Reed/passive room diffusers
              'reed diffuser', 'reed oil diffuser', 'stick diffuser', 'room diffuser oil',
              'passive diffuser', 'oil reed diffuser', 'fragrance reed',
              // Wax melt products
              'wax melt warmer', 'wax melt', 'wax warmer', 'scented wax melt',
              'wax cube', 'scented wax cube', 'soy wax melt',
              // Room air fresheners (non-electric)
              'room air freshener', 'room freshener', 'room deodorizer',
              'air freshener spray', 'linen spray', 'room spray freshener',
              'closet freshener', 'bathroom freshener',
              // Gel/plug-in style (often 3307.49)
              'air freshener gel', 'gel freshener',
            ],
            noneOf: [
              // Exclude electric ultrasonic diffusers (ch.84/85)
              'ultrasonic diffuser', 'electric diffuser', 'essential oil diffuser machine',
              'humidifier diffuser', 'nebulizing diffuser',
              // Exclude printer-related
              'printer', 'toner',
              // Exclude actual incense
              'incense',
            ],
          },
          inject: [
            { prefix: '3307.49', syntheticRank: 1 }, // other room deodorizers (non-electric)
            { prefix: '3307.30.50', syntheticRank: 2 }, // other room deodorizers
          ],
          whitelist: {
            denyChapters: ['84', '85'],
          },
          boosts: [
            { delta: 0.70, prefixMatch: '3307.' },
          ],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('PASSIVE_DIFFUSER_FRESHENER_INTENT: created (car/reed/wax diffuser → 3307.49, deny ch.84/85)');
      }
    }

    // 3. UPDATE DIFFUSER_INTENT — add noneOf for passive diffusers to prevent 8479 over-routing
    //    DIFFUSER_INTENT matches "reed diffuser", "car diffuser", etc. and injects 8479.89
    //    even though those are passive (non-electric) products → should be 3307.49
    {
      const existing = allRules.find(r => r.id === 'DIFFUSER_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const passiveNoneOf = [
          'reed diffuser', 'car air diffuser', 'car diffuser', 'car air freshener',
          'car freshener', 'room diffuser oil', 'wax melt', 'wax melt warmer',
          'wax warmer', 'air freshener',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...passiveNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('DIFFUSER_INTENT: added passive diffuser noneOf (prevent 8479 routing for reed/car diffusers)');
      }
    }

    // 4. UPDATE INCENSE_INTENT — add oud sticks, bakhoor, agarbatti
    //    "Ayam Al Tayyebeen Oud Sticks - 10PC" → 4412 (plywood!) WRONG
    //    BUG: "oud sticks" not in INCENSE_INTENT anyOf
    {
      const existing = allRules.find(r => r.id === 'INCENSE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const oudTerms = [
          'oud sticks', 'oud incense', 'oud stick', 'bukhoor', 'bakhoor', 'bakhor',
          'agarbatti', 'dhoop sticks', 'dhoop', 'gugal', 'loban',
          'arabic incense', 'middle eastern incense', 'oud bakhoor',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...oudTerms])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('INCENSE_INTENT: added oud sticks, bakhoor, agarbatti to anyOf');
      }
    }

    // 5. NEW RITUAL_BATH_SPIRITUAL_WASH_INTENT → 3307.30.10 (bath preparations)
    //    "Block Buster Wash" → 3922 (bathtubs!) WRONG (expected 3307.30.10)
    //    "spiritual wash" / "ritual bath" products = perfumed bath preparations (3307.30.10)
    //    3307.30.10 = perfumed bath salts and other bath preparations
    {
      const existing = allRules.find(r => r.id === 'RITUAL_BATH_SPIRITUAL_WASH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RITUAL_BATH_SPIRITUAL_WASH_INTENT',
          description: 'Spiritual bath washes, ritual cleansing preparations → ch.33 (3307.30.10)',
          pattern: {
            anyOf: [
              // Spiritual wash/bath products
              'spiritual wash', 'ritual bath', 'cleansing bath', 'spiritual bath',
              'ritual cleanse', 'floor wash spiritual', 'uncrossing bath',
              'block buster wash', 'blockbuster wash', 'hoodoo wash', 'conjure bath',
              // Herbal/spiritual bath salts
              'spiritual bath salts', 'ritual bath salts', 'herbal bath soak spiritual',
              'moon bath soak', 'chakra bath soak', 'crystal bath soak',
            ],
            noneOf: [
              'bathtub', 'bath tub', 'shower', 'faucet', 'sink',
            ],
          },
          inject: [
            { prefix: '3307.30.10', syntheticRank: 1 }, // bath preparations/salts
            { prefix: '3307.30.50', syntheticRank: 2 }, // other room deodorizers
          ],
          whitelist: {
            denyChapters: ['39', '69'],
          },
          boosts: [
            { delta: 0.65, prefixMatch: '3307.30' },
          ],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('RITUAL_BATH_SPIRITUAL_WASH_INTENT: created (spiritual wash → 3307.30.10, deny ch.39 plastic)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT70)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT70 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
