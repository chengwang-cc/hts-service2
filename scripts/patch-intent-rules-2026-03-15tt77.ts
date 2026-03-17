#!/usr/bin/env ts-node
/**
 * Patch TT77 — 2026-03-15: Leather clothing/gauntlets, card holders EDC, night lights, metal feeders.
 *
 * Fixes:
 *  1. UPDATE LEATHER_GLOVES_INTENT — add gauntlets, medieval/cosplay leather handwear
 *     "Men's Medieval Renaissance Costume Leather Gauntlets" → 6116 WRONG (expected 4203.29)
 *     FIX: Add 'leather gauntlet', 'gauntlets leather', 'cosplay leather gauntlet'
 *
 *  2. UPDATE LEATHER_ARTICLES_INTENT — add leather clothing, earbud cases, cover cases
 *     "Vintage leather pant" → 4107 WRONG (expected 4203.10)
 *     "Leather cover case for earbuds" → 4107 WRONG (expected 4202.99)
 *     FIX: Add leather clothing terms and 'leather cover case', 'leather earphone'
 *
 *  3. UPDATE PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT — add EDC/minimalist card holders
 *     "Carbon Fiber ID and Card EDC Holder" → 9504 (games!) WRONG (expected 4202.39)
 *     "Carbon Fiber ID and Card EDC Holder. Razorflex" → 9504 WRONG
 *     BUG: "carbon fiber" + "card" + "EDC" doesn't match any card holder intent phrase
 *          "EDC" = everyday carry, "console" → gaming context → 9504
 *     FIX: Add 'edc card holder', 'carbon fiber card', 'minimalist card holder',
 *          'slim card holder', 'edc wallet', 'bifold card holder'
 *
 *  4. NEW HANDMADE_NIGHT_LIGHT_LAMP_INTENT → 9405.19 (lighting fittings)
 *     "handmade night light" → 8539.51 (electric bulbs!) WRONG (expected 9405.19)
 *     BUG: "light" → electric bulbs (8539); "night light" → ch.85
 *     9405.19 = other light fittings (non-portable lamps/lanterns)
 *     FIX: New intent for decorative lamps/night lights → 9405, deny ch.85
 *
 *  5. NEW METAL_GARDEN_BIRD_FEEDER_INTENT → 7323.94 (iron/steel household articles)
 *     "Metal Feeder - Metal Feeder" → 8302 (metal fittings!) WRONG (expected 7323.94)
 *     "Squirrel Proof Metal Baffle" → 8302 WRONG (expected 7323.94)
 *     BUG: "metal" + "feeder" or "baffle" → base metal mountings/brackets (8302)
 *          not household iron/steel articles (7323)
 *     FIX: New intent for metal bird feeders/baffles → 7323.94, deny ch.83
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt77.ts
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

    // 1. UPDATE LEATHER_GLOVES_INTENT — add gauntlets
    //    "Men's Medieval Renaissance Costume Leather Gauntlets Long" → 6116 WRONG
    {
      const existing = allRules.find(r => r.id === 'LEATHER_GLOVES_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          'leather gauntlet', 'leather gauntlets', 'gauntlets leather',
          'cosplay leather glove', 'cosplay leather gauntlet',
          'medieval leather glove', 'medieval leather gauntlet',
          'renaissance gauntlet', 'armored gauntlet',
          'falconry glove', 'falconry gauntlet',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 570, rule: updated });
        console.log('LEATHER_GLOVES_INTENT: added gauntlets and medieval/cosplay leather handwear');
      } else {
        console.log('LEATHER_GLOVES_INTENT: not found');
      }
    }

    // 2. UPDATE LEATHER_ARTICLES_INTENT — add leather clothing, earbud case fixes
    //    "Vintage leather pant" → 4107 WRONG; "Leather cover case for earbuds" → 4107 WRONG
    {
      const existing = allRules.find(r => r.id === 'LEATHER_ARTICLES_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Leather clothing/apparel (4203.10 = leather articles for apparel)
          'leather pant', 'leather pants', 'leather trousers', 'leather leggings',
          'leather skirt', 'leather vest', 'leather jacket lining',
          'leather neck warmer', 'leather face warmer', 'leather balaclava',
          // Earbud/headphone cases
          'leather case for earbuds', 'leather cover case', 'leather case earphone',
          'leather earbud pouch', 'leather case headphone',
          // Medieval/costume leather
          'leather pauldron', 'leather gorget', 'leather vambrace',
          // Other accessories
          'leather pen sleeve', 'leather journal cover', 'leather book cover',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 569, rule: updated });
        console.log('LEATHER_ARTICLES_INTENT: added leather clothing, earbud case terms');
      } else {
        console.log('LEATHER_ARTICLES_INTENT: not found');
      }
    }

    // 3. UPDATE PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT — add EDC/carbon fiber/minimalist holders
    //    "Carbon Fiber ID and Card EDC Holder" → 9504 WRONG (expected 4202.39)
    //    BUG: "carbon fiber" + "card" + "holder" doesn't match 'id card holder' (non-adjacent)
    {
      const existing = allRules.find(r => r.id === 'PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // EDC (everyday carry) card holders
          'edc card holder', 'edc wallet', 'edc card case',
          'everyday carry card', 'everyday carry wallet',
          // Carbon fiber card holders
          'carbon fiber card holder', 'carbon fiber wallet', 'carbon fiber card case',
          'carbon fibre card holder', 'carbon fibre wallet',
          // Minimalist/slim wallets
          'minimalist card holder', 'minimalist wallet', 'slim card holder',
          'slim card case', 'slim wallet', 'thin card holder',
          // Bifold/money clip card holders
          'bifold card holder', 'money clip card holder',
          // RFID card holders
          'rfid card holder', 'rfid wallet', 'rfid blocking wallet',
          'rfid blocking card holder', 'rfid card case',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 576, rule: updated });
        console.log('PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT: added EDC/carbon fiber/minimalist card holders');
      } else {
        console.log('PHOTOCARD_BADGE_HOLDER_PLASTIC_INTENT: not found');
      }
    }

    // 4. NEW HANDMADE_NIGHT_LIGHT_LAMP_INTENT → 9405.19 (lighting fittings)
    //    "handmade night light" → 8539 (bulbs!) WRONG (expected 9405.19.60)
    //    BUG: "light" triggers electric bulbs/lamps (8539 = electric filament lamps)
    //         "night light" should be 9405.19 (non-portable electric lamp/light fitting)
    //    FIX: New intent for decorative/night lights → 9405, deny ch.85
    {
      const existing = allRules.find(r => r.id === 'HANDMADE_NIGHT_LIGHT_LAMP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HANDMADE_NIGHT_LIGHT_LAMP_INTENT',
          description: 'Decorative/night lights, handmade lamps → ch.94 (9405 lighting fittings)',
          pattern: {
            anyOf: [
              // Night lights
              'night light', 'night lights', 'nightlight', 'nightlights',
              'handmade night light', 'handmade lamp', 'handmade lantern',
              // Decorative lamps/lights
              'decorative lamp', 'decorative light', 'decorative lantern',
              'table lamp', 'desk lamp', 'floor lamp', 'bedside lamp',
              'accent lamp', 'mood light', 'mood lamp',
              // LED decorative
              'led night light', 'led table lamp', 'led desk lamp',
              'fairy light lamp', 'neon light sign', 'neon sign',
              // Themed/gamer lights
              'gamer lamp', 'gaming light', 'rgb lamp', 'rgb light',
              'lava lamp', 'salt lamp', 'himalayan salt lamp',
              // Custom/novelty
              'custom lamp', 'custom light', 'novelty lamp',
              'resin lamp', 'wood lamp base', 'stained glass lamp',
            ],
            noneOf: [
              // Exclude actual bulbs/tubes
              'light bulb', 'led bulb', 'fluorescent bulb', 'incandescent bulb',
              'light tube', 'led tube', 'fluorescent tube',
              // Exclude flashlights/torches
              'flashlight', 'torch light', 'headlamp flashlight',
              // Exclude automotive lights
              'car light', 'headlight', 'tail light', 'brake light',
              // Exclude grow lights
              'grow light', 'grow lamp', 'plant light',
            ],
          },
          inject: [
            { prefix: '9405.19', syntheticRank: 2 },  // other non-portable lamps/light fittings
            { prefix: '9405.40', syntheticRank: 5 },  // other electric lamps and lighting
            { prefix: '9405.10', syntheticRank: 8 },  // chandeliers and ceiling fittings
          ],
          whitelist: {
            allowChapters: ['94'],                   // furniture/lighting
            denyChapters: ['85'],                    // deny electrical parts/components
          },
          boosts: [
            { delta: 0.80, prefixMatch: '9405.' },
            { delta: 0.40, chapterMatch: '94' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '85' },
          ],
        } as IntentRule;
        patches.push({ priority: 567, rule: newRule });
        console.log('HANDMADE_NIGHT_LIGHT_LAMP_INTENT: created (night lights/decorative lamps → 9405, deny ch.85)');
      } else {
        console.log('HANDMADE_NIGHT_LIGHT_LAMP_INTENT: already exists, skipping');
      }
    }

    // 5. NEW METAL_GARDEN_BIRD_FEEDER_INTENT → 7323.94 (iron/steel household articles)
    //    "Metal Feeder - Metal Feeder" → 8302 WRONG (expected 7323.94)
    //    "Squirrel Proof Metal Baffle" → 8302 WRONG (expected 7323.94)
    //    BUG: "metal feeder" → 8302 (base metal fittings/mountings for buildings)
    //         "feeder" alone → animal feed equipment (8436) or medical equipment
    //    7323 = table/kitchen/household articles of iron/steel; 7323.94 = other steel articles
    //    FIX: New intent for metal bird feeders, garden feeders, animal water bowls → 7323
    {
      const existing = allRules.find(r => r.id === 'METAL_GARDEN_BIRD_FEEDER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'METAL_GARDEN_BIRD_FEEDER_INTENT',
          description: 'Metal bird feeders, garden feeders, metal baffles → ch.73 (7323.94)',
          pattern: {
            anyOf: [
              // Bird feeders
              'metal bird feeder', 'metal feeder', 'steel bird feeder', 'iron bird feeder',
              'bird feeder metal', 'metal tube feeder', 'metal platform feeder',
              'copper bird feeder', 'galvanized bird feeder',
              // Baffles and guards
              'squirrel proof metal baffle', 'metal baffle', 'metal squirrel baffle',
              'pole baffle metal', 'bird feeder baffle',
              // Metal garden/outdoor animal items
              'metal pet bowl', 'metal dog bowl', 'metal cat bowl',
              'metal bird bath', 'metal water bowl',
              'metal hay rack', 'metal rabbit feeder',
            ],
            noneOf: [
              // Exclude industrial feeders
              'automatic feeder machine', 'parts feeder', 'bowl feeder machine',
              'conveyor feeder', 'screw feeder',
              // Exclude plastic feeders
              'plastic bird feeder', 'plastic feeder',
            ],
          },
          inject: [
            { prefix: '7323.94', syntheticRank: 2 },  // other iron/steel household articles
            { prefix: '7323.99', syntheticRank: 5 },  // other articles of copper/other metals
          ],
          whitelist: {
            denyChapters: ['83', '84', '85'],         // deny misc metal fittings, machinery
          },
          boosts: [
            { delta: 0.75, prefixMatch: '7323.' },
            { delta: 0.40, chapterMatch: '73' },
          ],
        } as IntentRule;
        patches.push({ priority: 566, rule: newRule });
        console.log('METAL_GARDEN_BIRD_FEEDER_INTENT: created (metal bird feeders → 7323.94, deny ch.83/84)');
      } else {
        console.log('METAL_GARDEN_BIRD_FEEDER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT77)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT77 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
