#!/usr/bin/env ts-node
/**
 * Patch TT129 — 2026-03-16: Metal fasteners, automotive vents/fans, imitation gold-filled jewelry,
 *   printed cards, plastic mounting brackets.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt129.ts
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

    // 1. SCREW_NUT_BOLT_FASTENER_INTENT → 7318 (iron/steel threaded fasteners)
    //    "Metal Thumb Screws" → 7318.15.40 WRONG (expected 7318.15.20.61)
    //    "Metal Knurled Screws" → 7318.15.40 WRONG (expected 7318.15.20.61)
    //    "Wheel Nut" → 1207.10 WRONG (sesame seeds! expected 7318.16.00.30)
    //    "Wheel Nut Triumph Tr3" → 1207.10 WRONG (sesame seeds! "nut" = oilseed)
    //    "Bicycle chainring nuts" → 7315.11 WRONG (expected 7318.16.00.85)
    //    Root cause: "nut" → oilseeds (1207); "screw" → various; need strong fastener intent.
    {
      const existing = allRules.find(r => r.id === 'SCREW_NUT_BOLT_FASTENER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SCREW_NUT_BOLT_FASTENER_INTENT',
          description: 'Screws, nuts, bolts (metal fasteners) → 7318 (iron/steel threaded fasteners)',
          pattern: {
            anyOf: [
              // Screws
              'thumb screw', 'thumb screws', 'knurled screw', 'machine screw',
              'hex screw', 'socket head screw', 'set screw', 'grub screw',
              'sheet metal screw', 'wood screw steel', 'self-tapping screw',
              'stainless screw', 'm6 screw', 'm8 screw', 'm3 screw', 'm4 screw',
              // Nuts
              'wheel nut', 'wheel nuts', 'lug nut', 'hex nut', 'nylock nut',
              'nylon insert nut', 'lock nut', 'chainring nut', 'bicycle nut',
              'flange nut', 'wing nut', 'coupling nut', 'jam nut',
              'm6 nut', 'm8 nut', 'm10 nut', 'm12 nut',
              // Bolts
              'hex bolt', 'carriage bolt', 'flange bolt', 'shoulder bolt',
              'eye bolt', 'u-bolt', 'j-bolt', 'anchor bolt',
              // Studs
              'stud electrode', 'stud for electrode', 'threaded stud',
              // Heat breaks (3D printing = threaded metal)
              'heat break', 'all metal heat break', 'hotend heat break',
            ],
            noneOf: [
              // Food nuts (seeds)
              'almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut',
              'macadamia', 'pine nut', 'sesame', 'peanut', 'chestnut',
              // Furniture screws (different → plastic/rubber)
              'plastic screw cap', 'rubber screw',
            ],
          },
          inject: [
            { prefix: '7318.15', syntheticRank: 1 },  // screws/bolts
            { prefix: '7318.16', syntheticRank: 3 },  // nuts
            { prefix: '7318.14', syntheticRank: 5 },  // self-tapping screws
          ],
          whitelist: {
            allowChapters: ['73'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7318.' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '1207.' },  // very strong penalty for oilseeds
            { delta: 0.90, prefixMatch: '0801.' },  // penalty for nuts/coconuts
            { delta: 0.80, prefixMatch: '7315.' },  // penalize chains (chainring nuts → chains)
            { delta: 0.80, prefixMatch: '8302.' },  // penalize door fittings (mounting brackets)
          ],
        } as IntentRule;
        patches.push({ priority: 689, rule: newRule });
        console.log('SCREW_NUT_BOLT_FASTENER_INTENT: created (→7318, allowChapters:[73])');
      } else {
        console.log('SCREW_NUT_BOLT_FASTENER_INTENT: already exists, skipping');
      }
    }

    // 2. AUTOMOTIVE_VENT_FAN_BLOWER_INTENT → 8414 (fans/blowers for motor vehicles)
    //    "Dash Plastic Vent Trim" → 3926.20 WRONG (expected 8414.59.65.40)
    //    "Automotive Dash Vent" → 8708.95 WRONG (expected 8414.59.65.40)
    //    "Car Drying Leaf Blower Nozzle" → 8467.29 WRONG (expected 8414.90.10.80)
    //    "Nortel airmover" → 8414.59 WRONG (expected 8414.80.90.00)
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_VENT_FAN_BLOWER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_VENT_FAN_BLOWER_INTENT',
          description: 'Automotive dash vents, fans, blowers → 8414 (fans/blowers/air pumps)',
          pattern: {
            anyOf: [
              'dash vent', 'dashboard vent', 'automotive dash vent', 'car dash vent',
              'car air vent', 'vehicle vent', 'ac vent clip', 'vent trim',
              'dash plastic vent', 'vent register',
              'leaf blower nozzle', 'blower nozzle', 'blower attachment',
              'car drying nozzle', 'cordless blower nozzle',
              'airmover', 'air mover blower', 'nortel airmover',
              'cnc cooling fan', 'server fan', 'data center fan',
            ],
            noneOf: [
              'electric fan', 'ceiling fan', 'desk fan', 'standing fan',
              'table fan', 'window fan',
            ],
          },
          inject: [
            { prefix: '8414.59', syntheticRank: 1 },  // other fans (including automotive)
            { prefix: '8414.80', syntheticRank: 3 },  // other air pumps/blowers
            { prefix: '8414.90', syntheticRank: 5 },  // parts of fans/blowers
          ],
          whitelist: {
            allowChapters: ['84'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8414.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '3926.' },   // penalize plastic articles
            { delta: 0.85, prefixMatch: '8708.' },   // penalize vehicle parts (other)
            { delta: 0.80, prefixMatch: '8467.' },   // penalize tools (blower = power tool?)
          ],
        } as IntentRule;
        patches.push({ priority: 690, rule: newRule });
        console.log('AUTOMOTIVE_VENT_FAN_BLOWER_INTENT: created (→8414, allowChapters:[84])');
      } else {
        console.log('AUTOMOTIVE_VENT_FAN_BLOWER_INTENT: already exists, skipping');
      }
    }

    // 3. GOLD_FILLED_IMITATION_JEWELRY_INTENT → 7117.19 (gold-filled/plated imitation jewelry)
    //    "14K Gold Filled Ring #6" → 7113.19 WRONG (expected 7117.19.20.00)
    //    "14k Gold Filled Ring #7" → 7113.19 WRONG (expected 7117.19.20.00)
    //    "Baroque Pearl Earring Clip" → 7116.10 WRONG (expected 7117.19.20.00)
    //    Root cause: "14K Gold" → real gold jewelry (7113); gold-filled is imitation jewelry (7117).
    {
      const existing = allRules.find(r => r.id === 'GOLD_FILLED_IMITATION_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GOLD_FILLED_IMITATION_JEWELRY_INTENT',
          description: 'Gold-filled/plated imitation jewelry → 7117.19 (not real gold)',
          pattern: {
            anyOf: [
              'gold filled ring', 'gold filled earring', 'gold filled necklace',
              'gold filled bracelet', 'gold filled pendant', 'gold filled jewelry',
              'gold filled jewellery', '14k gold filled', '18k gold filled',
              'gold plated ring', 'gold plated earring', 'gold plated necklace',
              'gold plated jewelry', 'gold plated jewellery',
              'antique gold jewelry', 'vintage gold plated',
              'baroque pearl earring', 'clip earring', 'ear clip earring',
              'pearl clip earring', 'crystal clip earring',
            ],
            noneOf: [
              // Actual gold (solid gold, not filled/plated)
              'solid 14k', 'solid 18k', 'solid gold', 'solid yellow gold',
              '14k solid', '18k solid', 'white gold solid',
              // Fine silver
              '925 silver', 'sterling silver solid',
            ],
          },
          inject: [
            { prefix: '7117.19', syntheticRank: 1 },  // other imitation jewelry
          ],
          whitelist: {
            allowChapters: ['71'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7117.19' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7113.' },   // strong penalty for real gold jewelry
            { delta: 0.85, prefixMatch: '7116.' },   // penalize pearl/natural stone jewelry
          ],
        } as IntentRule;
        patches.push({ priority: 691, rule: newRule });
        console.log('GOLD_FILLED_IMITATION_JEWELRY_INTENT: created (→7117.19, allowChapters:[71])');
      } else {
        console.log('GOLD_FILLED_IMITATION_JEWELRY_INTENT: already exists, skipping');
      }
    }

    // 4. GREETING_CARD_POSTCARD_INTENT → 4909 (printed greeting cards/postcards)
    //    "Alchemy Look Book" → 4901.99 WRONG (expected 4909.00.20.00)
    //    "Bookcat - Mini Note Set" → 8472.90 WRONG (expected 4909.00.20.00)
    //    "40 Weeks Baby Bump Accordion Card" → 9504.40 WRONG (expected 4909.00.40.00)
    //    "Alice in Wonderland Birthday Card" → 9701.21 WRONG (expected 4909.00.40.00)
    {
      const existing = allRules.find(r => r.id === 'GREETING_CARD_POSTCARD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GREETING_CARD_POSTCARD_INTENT',
          description: 'Greeting cards, postcards, note sets → 4909 (printed cards)',
          pattern: {
            anyOf: [
              'greeting card', 'greeting cards', 'birthday card', 'birthday cards',
              'holiday card', 'holiday cards', 'christmas card', 'christmas cards',
              'thank you card', 'thank you cards', 'wedding card', 'anniversary card',
              'note card', 'note cards', 'note set', 'mini note set',
              'postcard', 'postcards', 'accordion card', 'illustrated card',
              'watercolor card', 'hand painted card', 'look book greeting',
              'stationery card', 'stationery set card',
            ],
            noneOf: [
              // Business cards
              'business card', 'visiting card',
              // Trading cards
              'trading card', 'game card', 'pokemon card', 'sports card',
              'collectible card', 'nba card', 'hockey card',
            ],
          },
          inject: [
            { prefix: '4909.00', syntheticRank: 1 },  // printed cards with personal messages
          ],
          whitelist: {
            allowChapters: ['49'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4909.00' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '4901.' },   // penalize books
            { delta: 0.85, prefixMatch: '9701.' },   // penalize paintings/fine art
            { delta: 0.85, prefixMatch: '9504.' },   // penalize games (accordion card → card game)
            { delta: 0.80, prefixMatch: '8472.' },   // penalize office machinery
          ],
        } as IntentRule;
        patches.push({ priority: 692, rule: newRule });
        console.log('GREETING_CARD_POSTCARD_INTENT: created (→4909, allowChapters:[49])');
      } else {
        console.log('GREETING_CARD_POSTCARD_INTENT: already exists, skipping');
      }
    }

    // 5. BEADED_KEYCHAIN_JEWELRY_CHARM_INTENT → 7117.90 (beaded keychains/charms as imitation jewelry)
    //    "Personalized Beaded Name Keychain: Handmade Backpack Charm" → 4202.92 WRONG (expected 7117.90.90.00)
    //    "Personalized Sports Keychain Gift" → 7326.20 WRONG (expected 7117.90.90.00)
    //    "beaded hair clip" → 9615.11 WRONG (expected 7117.90.90.00)
    //    Root cause: beaded keychains → bags (4202) or metal articles (7326); they're imitation jewelry.
    {
      const existing = allRules.find(r => r.id === 'BEADED_KEYCHAIN_JEWELRY_CHARM_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BEADED_KEYCHAIN_JEWELRY_CHARM_INTENT',
          description: 'Beaded keychains/charms/hair accessories as imitation jewelry → 7117.90',
          pattern: {
            anyOf: [
              'beaded keychain', 'beaded name keychain', 'personalized bead keychain',
              'beaded backpack charm', 'bead charm keychain', 'bead keychain charm',
              'personalized keychain gift', 'sports keychain charm',
              'beaded hair clip', 'bead hair clip', 'beaded hair accessory',
              'charm necklace handmade', 'handmade bead charm',
              'dust plug charm', 'phone dust plug', 'earphone charm',
            ],
            noneOf: [
              // Functional keychains (metal)
              'metal keychain bottle opener', 'keychain tool', 'keychain light',
              'keychain knife', 'keychain multi tool',
            ],
          },
          inject: [
            { prefix: '7117.90', syntheticRank: 1 },  // other imitation jewelry (beaded)
          ],
          whitelist: {
            allowChapters: ['71'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7117.90' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '4202.92' },  // penalize travel/sports bags
            { delta: 0.85, prefixMatch: '7326.20' },  // penalize metal keychains
            { delta: 0.80, prefixMatch: '9615.' },    // penalize hair combs/clips
          ],
        } as IntentRule;
        patches.push({ priority: 693, rule: newRule });
        console.log('BEADED_KEYCHAIN_JEWELRY_CHARM_INTENT: created (→7117.90, allowChapters:[71])');
      } else {
        console.log('BEADED_KEYCHAIN_JEWELRY_CHARM_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT129)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT129 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
