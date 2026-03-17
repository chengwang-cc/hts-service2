#!/usr/bin/env ts-node
/**
 * Patch TT106 — 2026-03-16: Glass tableware + furniture stand fixes.
 *
 * Fix 1: UPDATE DRINKING_GLASS_TABLEWARE_INTENT — add singular forms + raise inject ranks
 *   "Whiskey Glass" → 7010.90 WRONG (expected 7013.28) — "whiskey glass" singular not in pattern
 *   "Drinking Long Stem Glass" → 7010.90 WRONG — "long stem glass" not in pattern
 *   Fix: Add singular forms of all plural anyOf phrases; raise inject ranks (9→2, etc.)
 *
 * Fix 2: UPDATE GLASS_DRINKING_VESSEL_INTENT — raise inject ranks + add glass goblet/whiskey
 *   Many within-7013 misses because inject ranks too low (all at 4-5)
 *   Fix: Raise 7013.28 to rank 2, 7013.42 to rank 3, add "whiskey glass", "glass goblet"
 *
 * Fix 3: NEW GLASS_AWARD_TROPHY_INTENT → 7013.10 (glass tableware for awards)
 *   "All Glass Award" → 7016.10 WRONG (expected 7013.10)
 *   "Glass Award, All glass" → 7016.10 WRONG
 *   Fix: New intent injecting 7013.10 at rank 2 with allowChapters:['70']
 *
 * Fix 4: UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — add glass ornament + vase + raise 7013.10
 *   "glass ornament" → 9505 WRONG (expected 7013.37)
 *   "Vintage Emerald Green Glass Pineapple Vase" → 6913 WRONG (expected 7013.99)
 *   Fix: Add "glass ornament", "glass vase", raise 7013.28 inject rank
 *
 * Fix 5: UPDATE MONITOR_STAND_FURNITURE_INTENT — add inject + tighten allowChapters
 *   "monitor stand" → 7326.90 WRONG (expected 9403.30) — no inject, allowChapters ['94','73','84']
 *   Fix: Add inject [9403.30 rank2], restrict allowChapters to ['94'] only
 *
 * Fix 6: UPDATE WOODEN_FURNITURE_HOUSEHOLD_INTENT — add "wooden magazine" to anyOf
 *   "Wooden Magazine" → 4902.90 WRONG (expected 9403.30) — "magazine" = publication
 *   Fix: Add "wooden magazine", "wood magazine" to anyOf so intent fires
 *
 * Fix 7: UPDATE FURNITURE_WOOD_TABLE_INTENT — add telephone table, plant stand
 *   "26\" Vintage Mahogany Telephone Table" → exp:9403.50 but bizarre mis-route
 *   Fix: Add "telephone table", "plant stand" etc. to anyOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt106.ts
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

    // 1. UPDATE DRINKING_GLASS_TABLEWARE_INTENT — add singular forms + raise inject ranks
    //    "Whiskey Glass" (singular) → not in anyOf (only "whiskey glasses" plural)
    //    "Drinking Long Stem Glass" → not in anyOf
    {
      const existing = allRules.find(r => r.id === 'DRINKING_GLASS_TABLEWARE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addPhrases = [
          // Singular forms (pattern has plurals but not singulars)
          'whiskey glass', 'whisky glass', 'bourbon glass', 'brandy glass', 'cognac glass',
          'beer glass', 'pint glass', 'pilsner glass', 'snifter glass',
          'shot glass', 'cocktail glass', 'martini glass', 'margarita glass',
          'highball glass', 'rocks glass', 'old fashioned glass',
          'wine glass', 'red wine glass', 'white wine glass',
          'champagne flute', 'champagne glass', 'prosecco glass',
          'drinking glass', 'glass tumbler',
          // Long stem / goblet types
          'long stem glass', 'stem glass', 'long stem wine glass', 'stemmed glass',
          'glass goblet', 'goblet glass', 'crystal goblet',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addPhrases])],
          },
          inject: [
            { prefix: '7013.28', syntheticRank: 2 },  // non-lead crystal drinkware (raised from 9)
            { prefix: '7013.37', syntheticRank: 3 },  // other drinkware (raised from 8)
            { prefix: '7013.22', syntheticRank: 4 },  // lead crystal stemware (raised from 7)
            { prefix: '7013.33', syntheticRank: 5 },  // lead crystal other (raised from 6)
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 574, rule: updated });
        console.log('DRINKING_GLASS_TABLEWARE_INTENT: added singular forms + raised inject ranks (7013.28→rank2)');
      } else {
        console.log('DRINKING_GLASS_TABLEWARE_INTENT: not found');
      }
    }

    // 2. UPDATE GLASS_DRINKING_VESSEL_INTENT — raise inject ranks + add whiskey glass
    //    Currently all inject at rank 4-5; raising 7013.28 to rank 2 for better 8-digit match
    {
      const existing = allRules.find(r => r.id === 'GLASS_DRINKING_VESSEL_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addPhrases = [
          'whiskey glass', 'whisky glass', 'bourbon glass',
          'glass goblet', 'goblet glass', 'crystal goblet',
          'long stem glass', 'stem glass', 'stemmed glass',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addPhrases])],
          },
          inject: [
            { prefix: '7013.28', syntheticRank: 2 },  // non-lead crystal drinkware (raised from 5)
            { prefix: '7013.42', syntheticRank: 3 },  // glass mugs (raised from 5)
            { prefix: '7013.37', syntheticRank: 4 },  // other drinkware (raised from 5)
            { prefix: '7013.99', syntheticRank: 6 },
            { prefix: '7013.49', syntheticRank: 8 },
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 572, rule: updated });
        console.log('GLASS_DRINKING_VESSEL_INTENT: raised inject ranks, added whiskey glass / goblet phrases');
      } else {
        console.log('GLASS_DRINKING_VESSEL_INTENT: not found');
      }
    }

    // 3. NEW GLASS_AWARD_TROPHY_INTENT → 7013.10 (glass-ceramic tableware / awards)
    //    "All Glass Award" → 7016.10 WRONG, "Glass Award, All glass" → 7016.10 WRONG
    //    No existing intent covers glass awards specifically
    {
      const existing = allRules.find(r => r.id === 'GLASS_AWARD_TROPHY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_AWARD_TROPHY_INTENT',
          description: 'Glass/crystal awards and trophies → 7013.10 (glass tableware, ch.70)',
          pattern: {
            anyOf: [
              'glass award', 'crystal award', 'all glass award',
              'glass trophy', 'crystal trophy',
              'glass plaque', 'crystal plaque',
              'glass recognition', 'crystal recognition',
              'glass engraved award', 'engraved glass award',
              'glass sports award', 'crystal sports award',
              'glass corporate award', 'glass achievement',
            ],
            noneOf: [
              'plastic award', 'metal award', 'acrylic award',
              'award ribbon', 'certificate',
            ],
          },
          inject: [
            { prefix: '7013.10', syntheticRank: 2 },  // glass-ceramics / award glass
            { prefix: '7013.99', syntheticRank: 4 },  // other glassware (decorative)
            { prefix: '7013.28', syntheticRank: 6 },  // non-lead crystal
          ],
          whitelist: {
            allowChapters: ['70'],                     // restrict to glass chapter
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7013.' },    // strong boost for glassware
            { delta: 0.50, chapterMatch: '70' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '7016.' },    // penalize glass tiles/mosaics
            { delta: 0.70, prefixMatch: '7015.' },    // penalize optical glass
          ],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('GLASS_AWARD_TROPHY_INTENT: created (glass awards → 7013.10, deny 7016)');
      } else {
        console.log('GLASS_AWARD_TROPHY_INTENT: already exists, skipping');
      }
    }

    // 4. UPDATE GLASS_HOUSEHOLD_DRINKWARE_INTENT — add glass ornament/vase + raise 7013.28
    //    "glass ornament" → 9505 WRONG (expected 7013.37)
    //    "Vintage Emerald Green Glass Pineapple Vase" → 6913 WRONG (expected 7013.99)
    {
      const existing = allRules.find(r => r.id === 'GLASS_HOUSEHOLD_DRINKWARE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addPhrases = [
          // Glass ornaments (currently going to 9505 festive articles)
          'glass ornament', 'glass ornaments', 'glass art ornament', 'crystal ornament',
          'glass holiday ornament', 'glass christmas ornament',
          // Glass vases (currently going to 6913 ceramic vases)
          'glass vase', 'glass vases', 'glass flower vase', 'glass bud vase',
          'glass decorative vase', 'crystal flower vase',
          // Additional glassware
          'glass award', 'crystal award', 'glass trophy',
          'glass planter', 'glass bowl set', 'crystal bowl set',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addPhrases])],
          },
          inject: [
            { prefix: '7013.28', syntheticRank: 2 },  // non-lead crystal (general best match; raised from n/a)
            { prefix: '7013.49', syntheticRank: 3 },  // other glass (was rank 2)
            { prefix: '7013.37', syntheticRank: 4 },  // other drinkware (was rank 4)
            { prefix: '7013.10', syntheticRank: 6 },  // glass-ceramics (was rank 8)
            { prefix: '7013.99', syntheticRank: 8 },  // other
            { prefix: '7013.33', syntheticRank: 10 }, // lead crystal other (was rank 6)
            { prefix: '7013.22', syntheticRank: 12 }, // lead crystal stemware (was rank 10)
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 572, rule: updated });
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: added glass ornament/vase phrases, raised 7013.28 inject rank');
      } else {
        console.log('GLASS_HOUSEHOLD_DRINKWARE_INTENT: not found');
      }
    }

    // 5. UPDATE MONITOR_STAND_FURNITURE_INTENT — add inject + tighten allowChapters
    //    "monitor stand" → 7326.90 WRONG (expected 9403.30) — no inject, ch.73 allowed
    //    Fix: inject 9403.30 at rank 2; allowChapters only ['94'] (eval expects ch.94)
    {
      const existing = allRules.find(r => r.id === 'MONITOR_STAND_FURNITURE_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '9403.30', syntheticRank: 2 },  // wooden furniture for offices
            { prefix: '9403.20', syntheticRank: 4 },  // metal furniture for offices
            { prefix: '9403.10', syntheticRank: 6 },  // metal furniture for offices (other)
          ],
          whitelist: {
            allowChapters: ['94'],                     // only furniture — remove ch.73/84 allowance
          },
          boosts: [
            { delta: 0.80, prefixMatch: '9403.' },    // strong boost for furniture
            { delta: 0.50, chapterMatch: '94' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '73' },       // penalize steel articles
            { delta: 0.60, chapterMatch: '84' },       // penalize machines
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('MONITOR_STAND_FURNITURE_INTENT: added inject 9403.30 rank2, tightened allowChapters to [94]');
      } else {
        console.log('MONITOR_STAND_FURNITURE_INTENT: not found');
      }
    }

    // 6. UPDATE WOODEN_FURNITURE_HOUSEHOLD_INTENT — add "wooden magazine" (not "rack")
    //    "Wooden Magazine" → 4902.90 WRONG (expected 9403.30) — "magazine" treated as publication
    //    Fix: add "wooden magazine" and "wood magazine" to anyOf so intent fires for this query
    {
      const existing = allRules.find(r => r.id === 'WOODEN_FURNITURE_HOUSEHOLD_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addPhrases = [
          'wooden magazine',   // "Wooden Magazine" (magazine rack without "rack")
          'wood magazine',
          'wooden display board',
          'wooden charging station',
          'wooden cable organizer',
          'wooden file holder',
          'wooden letter tray',
          'wooden desk tray',
          'wooden key holder',
          'wooden mail holder',
          'wooden planter stand',
          'wooden jewelry stand',
          'wooden ring stand',
          'wooden bracelet stand',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 565, rule: updated });
        console.log('WOODEN_FURNITURE_HOUSEHOLD_INTENT: added "wooden magazine" and related phrases');
      } else {
        console.log('WOODEN_FURNITURE_HOUSEHOLD_INTENT: not found');
      }
    }

    // 7. UPDATE FURNITURE_WOOD_TABLE_INTENT — add telephone table + plant stand
    //    "26\" Vintage Mahogany Telephone Table" → bizarre mis-route (expected 9403.50)
    //    Fix: add "telephone table" and similar to anyOf
    {
      const existing = allRules.find(r => r.id === 'FURNITURE_WOOD_TABLE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addPhrases = [
          'telephone table', 'phone table', 'plant table', 'plant stand table',
          'accent cabinet', 'display cabinet', 'curio cabinet',
          'bar cabinet', 'wine cabinet', 'liquor cabinet',
          'corner table', 'nesting table', 'nesting tables',
          'trestle table', 'trestle desk',
          'secretary desk', 'vanity desk', 'vanity table',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('FURNITURE_WOOD_TABLE_INTENT: added telephone table, cabinet types, nesting tables');
      } else {
        console.log('FURNITURE_WOOD_TABLE_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT106)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT106 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
