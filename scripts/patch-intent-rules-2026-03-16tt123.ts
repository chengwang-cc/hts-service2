#!/usr/bin/env ts-node
/**
 * Patch TT123 — 2026-03-16: Fix pennant flags, imitation jewelry (gold-filled),
 *   sports wristbands, wooden cremation urns, and handmade textile bags.
 *
 * Fix 1: NEW PENNANT_FLAG_TEXTILE_INTENT → 6307.90.85.00
 *   "Personalized Pennant Flag" → 6307.90.30.10 WRONG (expected 6307.90.85.00)
 *   "Custom Pennant Flag" → 6307.90.30.10 WRONG (expected 6307.90.85.00)
 *   Root cause: TEXTILE_DISH_CLOTH_INTENT injects 6307.90 rank 1, organic score
 *   selects 6307.90.30 (shop/wiping cloths) over 6307.90.85 (flags/pennants).
 *
 * Fix 2: NEW GOLD_FILLED_IMITATION_JEWELRY_INTENT → 7117.19.20.00
 *   "14k Gold Filled Ring #7" → 7113.19.50.25 WRONG (expected 7117.19.20.00)
 *   "14K Gold Filled Ring #6" → 7113.20.10.00 WRONG (expected 7117.19.20.00)
 *   "gold filled bracelet" → 7113 WRONG (expected 7117)
 *   Root cause: "gold" + "ring/bracelet" → precious jewelry (7113). But
 *   gold-filled/gold-plated items ARE imitation jewelry (7117), not precious metal.
 *   7117.19.20 = imitation jewelry of base metal with gold.
 *
 * Fix 3: NEW NON_PRECIOUS_METAL_JEWELRY_INTENT → 7117.19.30.00
 *   "Religious pendant/charm non precious metal" → 7113 WRONG (expected 7117.19.30.00)
 *   "button vtg pinback" → 9606 WRONG (expected 7117.19.60.00)
 *   "Brand New Charm" → 7113 WRONG (expected 7117.19.60.00)
 *   Root cause: non-precious metal pendants/charms classified as precious jewelry.
 *   7117.19.30 = rosaries and religious items of imitation jewelry.
 *   7117.19.60 = other imitation jewelry.
 *
 * Fix 4: NEW SPORTS_WRISTBAND_PLASTIC_INTENT → 3926.20.10.50
 *   "3 Pack Wristbands -Canada with Maple Leaf" → 1702 (sugar!) WRONG (expected 3926.20.10.50)
 *   "Sitch Band" → 3005.90.50 (medical bandages!) WRONG (expected 3926.20.40.50)
 *   Root cause: "wristband" without context → medical/food codes.
 *   3926.20 = articles of apparel of plastics (sports/identification wristbands).
 *
 * Fix 5: NEW WOODEN_CREMATION_URN_INTENT → 4421.20.20.00
 *   "Wooden Cremation urn manufactured in Canada" → 4420.90 (wooden caskets/boxes) WRONG
 *   Root cause: no dedicated intent; "cremation urn" → decorative wooden articles.
 *   4421.20.20.00 = wooden coffins and urns.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt123.ts
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

    // 1. NEW PENNANT_FLAG_TEXTILE_INTENT → 6307.90.85.00
    //    Pennant flags are "other made up textile articles" (6307.90.85), not
    //    shop/wiping cloths (6307.90.30). Organic search picks wrong 6307.90 subheading.
    {
      const existing = allRules.find(r => r.id === 'PENNANT_FLAG_TEXTILE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PENNANT_FLAG_TEXTILE_INTENT',
          description: 'Pennant flags/banners → 6307.90.85 (other made-up textile articles)',
          pattern: {
            anyOf: [
              'pennant flag', 'pennant flags', 'pennant banner',
              'custom pennant', 'personalized pennant',
              'felt pennant', 'sports pennant', 'team pennant',
              'wall pennant', 'decorative pennant',
              'pennant', 'pennants',
            ],
            noneOf: [
              // Actual flags (different subheading)
              'national flag', 'country flag', 'american flag', 'canadian flag',
              // Signal pennants
              'nautical pennant', 'boat pennant',
            ],
          },
          inject: [
            { prefix: '6307.90.85', syntheticRank: 1 },  // flags, pennants, other made-up
            { prefix: '6307.90', syntheticRank: 8 },       // general made-up textile fallback
          ],
          whitelist: {
            allowChapters: ['63'],   // textile made-up articles
          },
          boosts: [
            { delta: 0.95, prefixMatch: '6307.90.85' },
            { delta: 0.50, prefixMatch: '6307.90' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6307.90.30' },  // penalize shop/wiping cloths
            { delta: 0.85, prefixMatch: '6307.10' },      // penalize dish cloths
          ],
        } as IntentRule;
        patches.push({ priority: 605, rule: newRule });
        console.log('PENNANT_FLAG_TEXTILE_INTENT: created (→6307.90.85)');
      } else {
        console.log('PENNANT_FLAG_TEXTILE_INTENT: already exists, skipping');
      }
    }

    // 2. NEW GOLD_FILLED_IMITATION_JEWELRY_INTENT → 7117.19.20.00
    //    Gold-filled/gold-plated/gold-tone jewelry is IMITATION jewelry (7117),
    //    not precious metal jewelry (7113). Key phrases: "gold filled", "gold plated",
    //    "gold tone", "gold overlay", "rolled gold".
    {
      const existing = allRules.find(r => r.id === 'GOLD_FILLED_IMITATION_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GOLD_FILLED_IMITATION_JEWELRY_INTENT',
          description: 'Gold-filled/plated imitation jewelry → 7117.19.20 (base metal w/ gold)',
          pattern: {
            anyOf: [
              'gold filled ring', 'gold filled bracelet', 'gold filled necklace',
              'gold filled earring', 'gold filled pendant', 'gold filled jewelry',
              'gold filled chain', 'gold filled bangle',
              'gold plated ring', 'gold plated bracelet', 'gold plated necklace',
              'gold plated earring', 'gold plated pendant', 'gold plated jewelry',
              'gold plated chain', 'gold plated bangle',
              'gold tone ring', 'gold tone bracelet', 'gold tone necklace',
              'gold overlay ring', 'rolled gold ring',
              '14k gold filled', '14kt gold filled', '18k gold filled',
              'gold fill ring', 'gold fill bracelet', 'gold fill necklace',
              'pvd gold ring', 'pvd gold necklace', 'pvd gold bracelet',
              'gold vermeil ring', 'vermeil ring', 'vermeil necklace',
              'gold dipped ring', 'gold dipped necklace',
            ],
            noneOf: [
              // Actual solid gold (precious metal → 7113)
              'solid 14k', 'solid 18k', 'solid 24k', 'solid gold',
              'pure gold', '14k solid', '18k solid',
              // Platinum
              'platinum ring', 'platinum necklace',
              // Sterling silver
              'sterling silver', '925 silver', '.925',
            ],
          },
          inject: [
            { prefix: '7117.19.20', syntheticRank: 1 },  // imitation jewelry of base metal w/ gold
            { prefix: '7117.19', syntheticRank: 4 },       // other imitation jewelry of base metal
            { prefix: '7117.90', syntheticRank: 8 },       // other imitation jewelry
          ],
          whitelist: {
            allowChapters: ['71'],   // only jewelry/precious metal chapter
            denyPrefixes: ['7113.', '7114.'],  // hard-block precious metal jewelry
          },
          boosts: [
            { delta: 0.95, prefixMatch: '7117.19.20' },
            { delta: 0.70, prefixMatch: '7117.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '7113.' },   // strong penalty for precious jewelry
            { delta: 0.85, prefixMatch: '7114.' },   // precious metal articles
          ],
        } as IntentRule;
        patches.push({ priority: 606, rule: newRule });
        console.log('GOLD_FILLED_IMITATION_JEWELRY_INTENT: created (→7117.19.20, denyPrefixes:[7113,7114])');
      } else {
        console.log('GOLD_FILLED_IMITATION_JEWELRY_INTENT: already exists, skipping');
      }
    }

    // 3. NEW NON_PRECIOUS_CHARM_PENDANT_INTENT → 7117.19.30 / 7117.19.60
    //    Non-precious metal pendants, charms, and pinback buttons are imitation jewelry.
    //    Getting classified as precious jewelry (7113) or buttons (9606).
    {
      const existing = allRules.find(r => r.id === 'NON_PRECIOUS_CHARM_PENDANT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'NON_PRECIOUS_CHARM_PENDANT_INTENT',
          description: 'Non-precious metal charms/pendants → 7117.19.30/.60 (imitation jewelry)',
          pattern: {
            anyOf: [
              // Non-precious charms/pendants
              'non precious metal pendant', 'non precious metal charm',
              'base metal pendant', 'base metal charm',
              'non precious charm', 'non precious pendant',
              // Religious imitation jewelry
              'religious pendant', 'religious charm', 'saint medal', 'religious medal',
              'cross pendant non precious', 'crucifix pendant non precious',
              // Pinback buttons (7117.19.60 in US HTS)
              'pinback button', 'pin back button', 'vintage pinback',
              'button pinback', 'pinback badge', 'button badge vintage',
              'vtg pinback', 'vtg button pinback',
              // General imitation charms
              'alloy charm', 'zinc alloy charm', 'alloy pendant',
              'zinc alloy pendant', 'base metal jewelry',
              'fashion pendant', 'fashion charm',
            ],
            noneOf: [
              // Precious metals
              'sterling silver', '925 silver', '14k gold', '18k gold',
              'solid gold', 'platinum',
              // Medical
              'medical alert charm', 'medical pendant',
            ],
          },
          inject: [
            { prefix: '7117.19.30', syntheticRank: 1 },  // religious imitation jewelry
            { prefix: '7117.19.60', syntheticRank: 3 },  // other imitation jewelry
            { prefix: '7117.90', syntheticRank: 7 },       // other imitation jewelry
          ],
          whitelist: {
            allowChapters: ['71'],
            denyPrefixes: ['7113.', '7114.'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7117.19' },
            { delta: 0.70, prefixMatch: '7117.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '7113.' },
            { delta: 0.85, prefixMatch: '9606.' },  // penalize buttons
          ],
        } as IntentRule;
        patches.push({ priority: 607, rule: newRule });
        console.log('NON_PRECIOUS_CHARM_PENDANT_INTENT: created (→7117.19.30/60)');
      } else {
        console.log('NON_PRECIOUS_CHARM_PENDANT_INTENT: already exists, skipping');
      }
    }

    // 4. NEW SPORTS_WRISTBAND_PLASTIC_INTENT → 3926.20.10.50
    //    Sports/ID wristbands of silicone/rubber/plastic are 3926.20 (articles of apparel
    //    of plastics). Getting: 1702 (sugar), 3005 (medical bandages), 6217 (accessories).
    {
      const existing = allRules.find(r => r.id === 'SPORTS_WRISTBAND_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SPORTS_WRISTBAND_PLASTIC_INTENT',
          description: 'Sports/ID wristbands → 3926.20.10.50 (plastic apparel articles)',
          pattern: {
            anyOf: [
              'wristband', 'wristbands', 'wrist band', 'wrist bands',
              'silicone wristband', 'silicone bracelet', 'rubber wristband',
              'rubber bracelet', 'sport wristband', 'sports wristband',
              'awareness wristband', 'charity wristband',
              'festival wristband', 'event wristband', 'tyvek wristband',
              'id wristband', 'identification wristband',
              'sweatband wristband', 'athletic wristband',
              'pack wristbands', 'pack wrist bands',
            ],
            noneOf: [
              // Medical (different chapter)
              'medical wristband', 'hospital wristband', 'patient wristband',
              // Watch bands (different classification)
              'watch wristband', 'watch band replacement', 'apple watch band',
              // Actual bracelets (jewelry)
              'bracelet set', 'charm bracelet', 'tennis bracelet', 'bangle bracelet',
            ],
          },
          inject: [
            { prefix: '3926.20', syntheticRank: 1 },  // plastic apparel articles
            { prefix: '4016.99', syntheticRank: 6 },  // other rubber articles
          ],
          whitelist: {
            allowChapters: ['39', '40'],  // plastics or rubber
          },
          boosts: [
            { delta: 0.90, prefixMatch: '3926.20' },
            { delta: 0.50, prefixMatch: '4016.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '1702.' },   // penalize sugars
            { delta: 0.90, prefixMatch: '3005.' },   // penalize medical bandages
            { delta: 0.85, prefixMatch: '6217.' },   // penalize textile accessories
          ],
        } as IntentRule;
        patches.push({ priority: 608, rule: newRule });
        console.log('SPORTS_WRISTBAND_PLASTIC_INTENT: created (→3926.20)');
      } else {
        console.log('SPORTS_WRISTBAND_PLASTIC_INTENT: already exists, skipping');
      }
    }

    // 5. NEW WOODEN_CREMATION_URN_INTENT → 4421.20.20.00
    //    Wooden cremation urns are specifically 4421.20.20 (wooden coffins/urns).
    //    Getting classified as 4420.90 (decorative wooden articles/boxes).
    {
      const existing = allRules.find(r => r.id === 'WOODEN_CREMATION_URN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_CREMATION_URN_INTENT',
          description: 'Wooden cremation urns → 4421.20.20 (wooden coffins and urns)',
          pattern: {
            anyOf: [
              'cremation urn', 'cremation urns', 'wooden cremation urn',
              'wood cremation urn', 'bamboo cremation urn',
              'urn for ashes', 'urn for cremation', 'funeral urn',
              'memorial urn', 'wooden urn', 'wood urn',
              'pet cremation urn', 'pet memorial urn',
              'keepsake cremation urn', 'biodegradable urn',
            ],
            noneOf: [
              // Ceramic/porcelain urns (different chapter)
              'ceramic urn', 'porcelain urn', 'clay urn',
              // Metal urns
              'brass urn', 'copper urn', 'metal urn', 'aluminum urn',
              // Decorative (not cremation)
              'flower urn', 'garden urn', 'decorative urn',
            ],
          },
          inject: [
            { prefix: '4421.20', syntheticRank: 1 },  // wooden coffins and urns
            { prefix: '4421.99', syntheticRank: 5 },  // other wooden articles
          ],
          whitelist: {
            allowChapters: ['44'],   // wood articles only
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4421.20' },
            { delta: 0.50, prefixMatch: '4421.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4420.' },   // penalize decorative boxes
          ],
        } as IntentRule;
        patches.push({ priority: 609, rule: newRule });
        console.log('WOODEN_CREMATION_URN_INTENT: created (→4421.20)');
      } else {
        console.log('WOODEN_CREMATION_URN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT123)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT123 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
