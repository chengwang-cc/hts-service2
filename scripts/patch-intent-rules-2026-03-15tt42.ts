#!/usr/bin/env ts-node
/**
 * Patch TT42 — 2026-03-15: Update glass/hat/wood/jersey rules + plastic card holders.
 * Current: ~33.93% (after TT41)
 *
 * Updates:
 *  - HAT_CAP_BEANIE_HEADGEAR_INTENT: add bonnet, hair bonnet, novelty hat patterns
 *  - GLASS_DECORATIVE_HOME_INTENT: add glass vase, sake set, glass coaster, glass paperweight
 *  - ICON_PANEL_GESSO_BOARD_INTENT: add decorative wooden letters
 *  - JERSEY_SPORTS_APPAREL_INTENT: add soccer shirt, kids jersey patterns
 *
 * New Rules:
 *  1. PLASTIC_CARD_BADGE_HOLDER_INTENT → 3926.90 (photocard holders, badge holders, phone holders)
 *     "Photocard Holder | ID Badge Holder | Bus Pass Cover" → 3926.90; 15+ miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt42.ts
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

    // UPDATE HAT_CAP_BEANIE_HEADGEAR_INTENT — add bonnet, novelty hats
    // "100% silk bonnet" → 6505.00.90.30 (silk bonnet is headwear → 6505.00)
    // "Silk Hair Bonnet" → 6505.00.90.30
    // "Hair Bonnet" → 6505.00.90.30
    // "Boiled Wool Pixie Bonnet" → 6505.00 (baby bonnet)
    // "Reversible Baby Bonnet Hat" → 6505.00
    // "knit hard hat liner" → 6505.00 (hard hat liner)
    {
      const existing = allRules.find(r => r.id === 'HAT_CAP_BEANIE_HEADGEAR_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasBonnet = currentAnyOf.some((t: string) => t.includes('bonnet'));
        if (!hasBonnet) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                'bonnet', 'hair bonnet', 'silk bonnet', 'satin bonnet', 'cotton bonnet',
                'baby bonnet', 'infant bonnet', 'pixie bonnet', 'baby hat bonnet',
                'hard hat liner', 'hat liner', 'helmet liner',
                'novelty hat', 'top hat', 'shamrock hat', 'party hat',
                'scrub cap', 'surgical scrub hat', 'surgical scrub cap',
                'skullcap', 'skull cap',
                'velvet hat', 'embroidered hat velvet', 'central asian hat',
                'Kazakh hat', 'Kyrgyz hat',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 570, rule: updated });
          console.log('HAT_CAP_BEANIE_HEADGEAR_INTENT: updated with bonnet/scrub cap/novelty hat patterns');
        } else {
          console.log('HAT_CAP_BEANIE_HEADGEAR_INTENT: already has bonnet pattern');
        }
      }
    }

    // UPDATE GLASS_DECORATIVE_HOME_INTENT — add glass vase, sake set, coaster, paperweight
    // "Vintage Emerald Green Glass Pineapple Vase" → 7013.99.50.00
    // "Vintage Milk Glass Bud Vases, Pair, Mid Century Modern" → 7013.99.50.00
    // "Glass sake set" → 7013.99.10.00
    // "Glass mosaic coaster set" → 7013.99.50.00
    // "Clear glass paperweight" → 7013.99.50.00
    // "crystal glass candle holder set" → 7013.99.35.00
    // "art glass bowl" → 7013.99.50.00
    {
      const existing = allRules.find(r => r.id === 'GLASS_DECORATIVE_HOME_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasVase = currentAnyOf.some((t: string) => t.includes('vase'));
        if (!hasVase) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                'glass vase', 'glass vases', 'milk glass vase', 'art glass vase',
                'crystal vase', 'crystal bowl', 'crystal glass bowl',
                'glass bud vase', 'bud vase glass',
                'sake set', 'sake glass set', 'glass sake set',
                'glass coaster', 'glass coasters', 'glass coaster set', 'mosaic coaster glass',
                'glass paperweight', 'crystal paperweight', 'glass paper weight',
                'crystal candle holder', 'crystal glass candle holder',
                'pineapple vase', 'glass pineapple',
                'art glass bowl', 'glass art bowl', 'decorative glass bowl',
                'murano glass', 'murano art glass',
                'fused glass', 'fused glass plate', 'fused glass decor',
                'glass alphabet tray', 'decoupage glass', 'glass tray decor',
                'potion bottle', 'decorative potion bottle',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 570, rule: updated });
          console.log('GLASS_DECORATIVE_HOME_INTENT: updated with glass vase/sake/coaster/paperweight patterns');
        } else {
          console.log('GLASS_DECORATIVE_HOME_INTENT: already has vase pattern');
        }
      }
    }

    // UPDATE ICON_PANEL_GESSO_BOARD_INTENT — add decorative wooden letters
    // "Decorative wooden letter" → 4421.99.15.00 (wooden letter, decorative wood article)
    // "Decorative wooden letters" → 4421.99.15.00
    {
      const existing = allRules.find(r => r.id === 'ICON_PANEL_GESSO_BOARD_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasWoodenLetter = currentAnyOf.some((t: string) => t.includes('wooden letter') || t.includes('wood letter'));
        if (!hasWoodenLetter) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                'decorative wooden letter', 'decorative wooden letters', 'wood letter decor',
                'wooden letter', 'wooden letters', 'wood alphabet letter',
                'wood craft letter', 'wooden craft letter',
                'wood block letter', 'wood monogram',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('ICON_PANEL_GESSO_BOARD_INTENT: updated with wooden letters pattern');
        } else {
          console.log('ICON_PANEL_GESSO_BOARD_INTENT: already has wooden letter pattern');
        }
      }
    }

    // UPDATE JERSEY_SPORTS_APPAREL_INTENT — add soccer shirt, kids jersey, team jersey patterns
    // "Kids soccer shirt" → 6110.30.10.10 (child's polyester sports shirt)
    // "Used Men's Sweater" → 6110.30.10.10 (synthetic knit sweater)
    // "Used Men's Tshirt" → 6110.30.10.10
    // The existing rule likely has 'sports jersey' but needs 'soccer shirt', 'polyester sweater'
    {
      const existing = allRules.find(r => r.id === 'JERSEY_SPORTS_APPAREL_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasSoccerShirt = currentAnyOf.some((t: string) => t.includes('soccer shirt'));
        if (!hasSoccerShirt) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                'soccer shirt', 'kids soccer shirt', 'soccer jersey',
                'polyester sweater', 'synthetic sweater', 'acrylic sweater',
                'polyester tshirt', 'polyester t-shirt', 'poly tshirt',
                'FR hoodie', 'FR sweatshirt', 'flame resistant hoodie',
                'basketball jersey', 'football jersey', 'hockey jersey',
                'men sweater polyester', 'men tshirt polyester',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('JERSEY_SPORTS_APPAREL_INTENT: updated with soccer shirt/polyester sweater patterns');
        } else {
          console.log('JERSEY_SPORTS_APPAREL_INTENT: already has soccer shirt pattern');
        }
      }
    }

    // 1. PLASTIC_CARD_BADGE_HOLDER_INTENT → 3926.90 (plastic card holders, badge holders)
    //    "Photocard Holder | ID Badge Holder | Bus Pass Cover | Sliding Card Holder" → 3926.90.93.00
    //    "Plush Taiyaki Coin Purse Keychain" → 3926.90 (plush novelty keychain)
    //    "Anniversary Edition Floating BMW Wheel Center Caps" → 3926.90? (plastic car caps)
    //    3926.90 = other articles of plastics (miscellaneous plastic articles)
    //    This is the general catch-all for plastic items not elsewhere specified
    //    NOTE: 3926.20 = plastic clothing accessories; this is other plastic articles
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_CARD_BADGE_HOLDER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_CARD_BADGE_HOLDER_INTENT',
          description: 'Plastic photocard holders, ID badge holders, sliding card holders → ch.39 (3926.90)',
          pattern: {
            anyOf: [
              'photocard holder', 'photo card holder', 'id badge holder', 'badge holder plastic',
              'bus pass cover', 'sliding card holder', 'card holder plastic', 'plastic card holder',
              'id card holder plastic', 'name badge holder', 'lanyard badge holder',
              'phone card holder', 'transit card holder', 'card sleeve plastic',
              'plastic name badge', 'badge protector plastic', 'badge cover plastic',
              'kpop photocard holder', 'photocard sleeve', 'trading card holder plastic',
              'acrylic card holder', 'clear card holder', 'transparent card holder',
              'acrylic badge holder', 'clear badge holder',
              'plastic photo frame', 'acrylic photo holder',
            ],
            noneOf: [
              'leather card holder', 'fabric card holder', 'metal card holder',
              'wallet', 'passport holder',
            ],
          },
          inject: [{ prefix: '3926.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '3926.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('PLASTIC_CARD_BADGE_HOLDER_INTENT: created (plastic card/badge holders → 3926.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT42)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT42 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
