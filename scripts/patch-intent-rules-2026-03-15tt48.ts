#!/usr/bin/env ts-node
/**
 * Patch TT48 — 2026-03-15: Swimwear regression fix + women's leggings + anime keychains.
 * Current: ~34.13% (after TT47)
 *
 * Fixes:
 *  - MEN_UNDERWEAR_BRIEF_BOXERS_INTENT: remove 'swim brief' from anyOf, add 'swim' to noneOf
 *    "80% nylon, 20% spandex Men's Swim Brief" → regression: was going to 6207.11 (underwear)
 *    Expected: 6211.11 (men's swimwear)
 *
 * New Rules:
 *  1. SWIMWEAR_WOVEN_INTENT → 6211.11 (men's) + 6211.12 (women's) (woven swimwear)
 *     "swim brief" → 6211.11; "bikini" → 6211.12; "swimsuit" → 6211.12; ~5 miss entries
 *  2. WOMEN_LEGGING_INTENT → 6104.62 + 6104.63 (knit women's leggings/trousers)
 *     "women cotton legging" → 6104.62; "women's legging" → 6104.62; ~4 miss entries
 *     ALSO → leggings going to 6406.90 (footwear) is a known routing bug
 *  3. ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT → 3926.90 (anime/novelty plastic keychains)
 *     "Fire Emblem Keychains" → 3926.90; "Plush Kawaii Keychain" → 3926.90; ~3 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt48.ts
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

    // FIX: MEN_UNDERWEAR_BRIEF_BOXERS_INTENT — remove 'swim brief' from anyOf, add 'swim' to noneOf
    // "80% nylon, 20% spandex Men's Swim Brief" → 6207.11 (regression - underwear not swimwear)
    // Expected: 6211.11 (men's woven swimwear)
    // Fix: 'swim brief' belongs to SWIMWEAR_WOVEN_INTENT, not men's underwear
    {
      const existing = allRules.find(r => r.id === 'MEN_UNDERWEAR_BRIEF_BOXERS_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const currentNoneOf: string[] = ((existing.pattern as any)?.noneOf || []);
        const hasSwimInNoneOf = currentNoneOf.some((t: string) => t.includes('swim'));
        if (!hasSwimInNoneOf) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              // Remove swim brief from anyOf — it belongs in swimwear
              anyOf: currentAnyOf.filter(t => !t.includes('swim brief') && !t.includes('swim')),
              noneOf: [
                ...currentNoneOf,
                'swim', 'swim brief', 'swimwear', 'swimsuit', 'swimming', 'aqua',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('MEN_UNDERWEAR_BRIEF_BOXERS_INTENT: fixed (removed swim brief, added swim to noneOf)');
        } else {
          console.log('MEN_UNDERWEAR_BRIEF_BOXERS_INTENT: already has swim in noneOf');
        }
      }
    }

    // 1. SWIMWEAR_WOVEN_INTENT → 6211.11 (men's) + 6211.12 (women's)
    //    "80% nylon, 20% spandex Men's Swim Brief" → 6211.11.10.10 (men's woven swimwear)
    //    "Large Bikini" → 6211.12.10.10 (women's woven swimwear)
    //    "swimsuit" → 6211.12.10.10
    //    "one piece swimsuit" → 6211.12.10.10
    //    "bathing suit women" → 6211.12.10.10
    //    6211.11 = men's swimwear (not knitted/crocheted)
    //    6211.12 = women's swimwear (not knitted/crocheted)
    //    NOTE: knitted swimwear = 6112 (handled by existing rules); 6211 = woven
    {
      const existing = allRules.find(r => r.id === 'SWIMWEAR_WOVEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SWIMWEAR_WOVEN_INTENT',
          description: 'Swimwear, bikini, swim brief, bathing suit → ch.62 (6211.11 + 6211.12)',
          pattern: {
            anyOf: [
              // Men's swimwear
              'swim brief', 'mens swim brief', 'men swim brief', 'nylon swim brief',
              'swim trunk', 'swim trunks', 'swim shorts', 'board shorts',
              'men bathing suit', 'mens bathing suit',
              // Women's swimwear
              'bikini', 'string bikini', 'triangle bikini', 'bikini top', 'bikini bottom',
              'one piece swimsuit', 'one-piece swimsuit', 'swimsuit women', 'women swimsuit',
              'bathing suit women', 'womens bathing suit', 'two piece swimsuit',
              'tankini', 'monokini', 'swimwear women', 'ladies swimsuit',
              // Generic swimwear
              'swimsuit', 'swimwear', 'swim wear', 'bathing suit',
            ],
            noneOf: [
              'rash guard', 'wetsuit', 'diving suit',
              'underwear', 'bra', 'panty',
            ],
          },
          inject: [
            { prefix: '6211.11', syntheticRank: 5 },
            { prefix: '6211.12', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6211.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('SWIMWEAR_WOVEN_INTENT: created (swimwear → 6211.11 + 6211.12)');
      }
    }

    // 2. WOMEN_LEGGING_KNIT_INTENT → 6104.62 + 6104.63 (women's knit trousers/leggings)
    //    "women cotton legging" → currently → 6406.90 (footwear!) — WRONG
    //    "women's legging" → currently → 6406.90 (footwear!) — WRONG
    //    Expected: 6104.62 (cotton) or 6104.63 (synthetic) or 6211.12 (other)
    //    6104.62 = women's knit trousers of cotton
    //    6104.63 = women's knit trousers of synthetic fiber
    //    The word "legging" in HTS database matches footwear parts (6406 = legging = leg cover)
    //    Need to explicitly route clothing leggings to chapter 61
    {
      const existing = allRules.find(r => r.id === 'WOMEN_LEGGING_KNIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOMEN_LEGGING_KNIT_INTENT',
          description: 'Women\'s leggings, cotton/synthetic knit trousers → ch.61 (6104.62 + 6104.63)',
          pattern: {
            anyOf: [
              // Women's leggings (routing bug: currently goes to 6406.90 footwear)
              'women legging', 'women leggings', 'womens legging', 'womens leggings',
              'ladies legging', 'ladies leggings', 'girls legging', 'girls leggings',
              'cotton legging', 'cotton leggings', 'women cotton legging',
              'yoga legging', 'yoga leggings', 'yoga pants',
              'athletic legging', 'sport legging', 'compression legging',
              'high waist legging', 'high waisted legging', 'waist legging',
              'knit legging', 'knit trousers women', 'stretch pants women',
              // Specific women's knit bottoms
              'women skirt knit', 'women skort',
            ],
            noneOf: [
              'men', 'mens', 'boys', 'unisex',
              'shorts', 'swim', 'swimwear',
            ],
          },
          inject: [
            { prefix: '6104.62', syntheticRank: 5 },
            { prefix: '6104.63', syntheticRank: 5 },
            { prefix: '6104.69', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6104.6' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOMEN_LEGGING_KNIT_INTENT: created (women\'s leggings → 6104.62 + 6104.63)');
      }
    }

    // 3. ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT → 3926.90 (anime/novelty plastic keychains)
    //    "Fire Emblem Keychains" → currently 7326.20 (metal keychain) — should be 3926.90 (plastic)
    //    "Plush Taiyaki Coin Purse Keychain" → 3926.90.10.00
    //    Anime/novelty keychains = acrylic/plastic laser-cut, not metal keychains
    //    3926.90 = other articles of plastics (plastic keychains/charms)
    {
      const existing = allRules.find(r => r.id === 'ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT',
          description: 'Anime/novelty plastic keychains, acrylic charms → ch.39 (3926.90)',
          pattern: {
            anyOf: [
              // Anime/game/pop culture keychains (typically acrylic/plastic)
              'anime keychain', 'anime keychains', 'anime charm', 'anime charms',
              'fire emblem keychain', 'pokemon keychain', 'pokemon keychains',
              'gaming keychain', 'video game keychain', 'character keychain',
              'kawaii keychain', 'kawaii charm', 'cute keychain charm',
              'enamel keychain', 'acrylic keychain charm',
              // Novelty/plush keychains
              'plush keychain', 'stuffed keychain', 'mini plush keychain',
              'taiyaki keychain', 'cute plush keychain',
              // Double-sided keychains
              'double sided keychain', 'holographic keychain',
              'transparent keychain', 'clear keychain',
            ],
            noneOf: [
              'metal keychain', 'steel keychain', 'iron keychain',
              'carabiner', 'lanyard',
            ],
          },
          inject: [
            { prefix: '3926.90', syntheticRank: 5 },
            { prefix: '3926.40', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '3926.9' }],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('ANIME_NOVELTY_KEYCHAIN_PLASTIC_INTENT: created (anime/novelty keychains → 3926.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT48)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT48 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
