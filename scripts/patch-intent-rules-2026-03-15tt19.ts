#!/usr/bin/env ts-node
/**
 * Patch TT19 — 2026-03-15: Art prints + glass containers + glass kitchen + silverware.
 * Current: ~31.4% (after TT18)
 *
 * Targets:
 *  1. AI_CH49_POSTERS_PRINTS: boost inject rank 40→5 for 4911.91 (art prints/posters)
 *     "Arrival Inspired Art Print" → 4911.91.10; "Paper Printed Picture" → 4911.91.15
 *     21 entries in 4911.91 cluster; rank 40 currently not competitive
 *  2. GLASS_BOTTLE_CONTAINER_INTENT: add inject 7010.90 rank 5 + boost
 *     "Empty Beer Bottle" → 7010.90 (expected), got ch.22 (beer) — whitelist allows ch.22 but inject not pulling 7010.90
 *     "Vintage Avon White Ballerina Perfume Bottle" → 7010.90, got ch.33 (perfume)
 *  3. GLASS_KITCHEN_BAKING_INTENT → 7013.49 (Pyrex, glass mixing bowls, salt cellars)
 *     "PYREX BOWLS" → 7013.49, got 6912 (ceramic); "glass salt cellar" → 7013.49, got 2501 (salt)
 *  4. SILVER_ARTICLE_CUTLERY_INTENT → 7114.11 (silver plated forks, cutlery, compacts)
 *     "engraved silver plated fork" → 7114.11; "silver dessert forks" → 7114.11
 *  5. VINTAGE_PERFUME_BOTTLE_GLASS_INTENT → 7010.90 (perfume bottles, avon bottles, apothecary)
 *     "Vintage Avon Gas Pump Decanter" → 7010.90.30
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt19.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };
    const addNoneOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. AI_CH49_POSTERS_PRINTS: boost inject rank 40→5 (art prints/posters = 4911.91)
    //    "Arrival Inspired Art Print" → 4911.91.10; "Paper Printed Picture" → 4911.91.15
    //    "16x20 Fine Art Print" → 4911.91.20; "lithograph" → 4911.91.20
    {
      const e = allRules.find(r => r.id === 'AI_CH49_POSTERS_PRINTS');
      if (e) {
        const newInject = [
          { prefix: '4911.91', syntheticRank: 4 },  // inject all 4911.91 leaf codes
          { prefix: '4911.91.20', syntheticRank: 5 },
          { prefix: '4911.91.40', syntheticRank: 6 },
        ];
        const newPat = addAnyOf(e,
          'art print', 'art prints', 'fine art print', 'giclee print', 'giclee',
          'archival print', 'archival art print', 'signed print', 'limited edition print',
          'wall art print', 'movie poster', 'inspired poster', 'inspired art print',
          'printed picture', 'printed art', 'paper print',
        );
        const noPat = addNoneOf({ ...e, pattern: newPat } as IntentRule,
          'screen print', 'heat transfer', 'sublimation print', '3d print', '3d printed',
          'print on demand', 'fabric print', 'vinyl print', 'digital print on fabric',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, inject: newInject, pattern: noPat } });
        console.log('AI_CH49_POSTERS_PRINTS: boosted inject rank 40→4, added art print terms');
      }
    }

    // 2. GLASS_BOTTLE_CONTAINER_INTENT: add inject 7010.90 rank 5 + boost
    //    Rule exists with whitelist but NO inject → ch.22/33 organic results win for 'beer bottle'/'wine bottle'
    //    "Empty Beer Bottle" → 7010.90.20.2; "Vintage Avon Perfume Bottle" → 7010.90.20.4
    {
      const e = allRules.find(r => r.id === 'GLASS_BOTTLE_CONTAINER_INTENT');
      if (e) {
        const newInject = [{ prefix: '7010.90', syntheticRank: 4 }];
        const newBoosts = [{ delta: 0.65, prefixMatch: '7010.9' }];
        const newPat = addAnyOf(e,
          'empty glass bottle', 'glass beer bottle', 'glass wine bottle',
          'glass spirit bottle', 'glass spirits bottle',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, inject: newInject, boosts: newBoosts, pattern: newPat } });
        console.log('GLASS_BOTTLE_CONTAINER_INTENT: added inject 7010.90 rank 4 + boost');
      }
    }

    // 3. GLASS_KITCHEN_BAKING_INTENT → 7013.49 (Pyrex, glass mixing bowls, salt cellars, baking pans)
    //    "PYREX BOWLS" → 7013.49.10 (not ceramic!); "glass salt cellar" → 7013.49.20
    //    "Glass mixing bowl" → 7013.49.20; "Corning Ware glass baking" → 7013.49.10
    {
      const existing = allRules.find(r => r.id === 'GLASS_KITCHEN_BAKING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASS_KITCHEN_BAKING_INTENT',
          description: 'Glass kitchen/baking items: Pyrex, mixing bowls, salt cellars, baking pans → ch.70 (7013.49)',
          pattern: {
            anyOf: [
              'pyrex bowl', 'pyrex bowls', 'pyrex baking', 'pyrex dish', 'pyrex casserole',
              'corning ware glass', 'glass baking pan', 'glass casserole dish', 'glass casserole',
              'glass mixing bowl', 'glass mixing bowls', 'glass salad bowl', 'glass bowl set',
              'glass baking dish', 'glass oven dish', 'glass oven safe',
              'glass salt cellar', 'glass cellar', 'glass relish tray', 'glass candy dish',
              'glass candy tray', 'glass serving dish', 'glass snack tray',
              'friendship pyrex', 'cinderella pyrex', 'vintage pyrex',
            ],
            noneOf: ['ceramic', 'porcelain', 'stoneware', 'plastic bowl', 'metal bowl'],
          },
          inject: [{ prefix: '7013.49', syntheticRank: 4 }],
          boosts: [{ delta: 0.60, prefixMatch: '7013.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('GLASS_KITCHEN_BAKING_INTENT: created (Pyrex/glass bowls/salt cellars → 7013.49)');
      }
    }

    // 4. SILVER_ARTICLE_CUTLERY_INTENT → 7114.11 (silver-plated cutlery, compacts, candle accessories)
    //    "engraved silver plated fork" → 7114.11.10; "silver dessert forks" → 7114.11.30
    //    "silver plated metal candle snuffer" → 7114.11.40
    //    "women's powder compact of sterling silver" → 7114.11.30
    {
      const existing = allRules.find(r => r.id === 'SILVER_ARTICLE_CUTLERY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILVER_ARTICLE_CUTLERY_INTENT',
          description: 'Silver-plated cutlery, compacts, candle accessories → ch.71 (7114.11)',
          pattern: {
            anyOf: [
              'silver plated fork', 'silver plated spoon', 'silver plated knife', 'silver plated cutlery',
              'silver plated spreader', 'silver dessert fork', 'silver dessert forks',
              'sterling silver fork', 'sterling silver spoon', 'sterling silver cutlery',
              'silver fork', 'silver spoon', 'silver flatware', 'silver serving set',
              'silver powder compact', 'sterling silver compact', 'silver compact',
              'silver candle snuffer', 'silver plated candle snuffer', 'candle snuffer silver',
              'silver candlestick', 'silver plated candlestick',
              'silver plate bookmark', 'silver plated bookmark',
            ],
            noneOf: ['silver colored', 'silver tone', 'silver paint', 'stainless steel fork', 'aluminum fork'],
          },
          inject: [{ prefix: '7114.11', syntheticRank: 4 }],
          boosts: [{ delta: 0.55, prefixMatch: '7114.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SILVER_ARTICLE_CUTLERY_INTENT: created (silver cutlery/compacts → 7114.11)');
      }
    }

    // 5b. GEMSTONE_BEAD_JEWELRY_INTENT: Fix false positives on loose stone queries (TT18 regression)
    //    "semi precious gemstone bead" → expected 7103.99, got 7116.20 (wrong!)
    //    Remove overly broad terms that match loose stone queries
    {
      const e = allRules.find(r => r.id === 'GEMSTONE_BEAD_JEWELRY_INTENT');
      if (e) {
        const removeTerms = new Set([
          'gemstone bead', 'gemstone beads', 'stone beads', 'semi precious', 'semi-precious',
          'semi precious stone', 'gemstone chip',
        ]);
        const anyOf = ((e.pattern as any)?.anyOf || []).filter((t: string) => !removeTerms.has(t));
        const newPat = { ...(e.pattern as any), anyOf };
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: newPat } });
        console.log('GEMSTONE_BEAD_JEWELRY_INTENT: removed broad bead terms causing 7103.99 false positives');
      }
    }

    // 5. VINTAGE_GLASS_BOTTLE_PERFUME_INTENT → 7010.90 (vintage/collectible glass bottles)
    //    "Vintage Avon White Ballerina Perfume Bottle" → 7010.90.20.4
    //    "Vintage Avon Gas Pump Decanter" → 7010.90.30.2
    //    "antique glass perfume bottle" → 7013.99.35.0 (but close to 7010.90)
    {
      const existing = allRules.find(r => r.id === 'VINTAGE_GLASS_BOTTLE_PERFUME_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINTAGE_GLASS_BOTTLE_PERFUME_INTENT',
          description: 'Vintage/collectible glass bottles, perfume bottles, Avon decanters → ch.70 (7010.90)',
          pattern: {
            anyOf: [
              'perfume bottle', 'perfume bottles', 'glass perfume bottle', 'vintage perfume bottle',
              'antique perfume bottle', 'cologne bottle', 'fragrance bottle glass',
              'avon bottle', 'avon decanter', 'vintage avon', 'avon collectible bottle',
              'glass apothecary bottle', 'apothecary bottle', 'apothecary jar glass',
              'glass medicine bottle', 'vintage medicine bottle', 'vintage bottle collectible',
              'glass stopper bottle', 'ground glass stopper', 'glass bottle with stopper',
            ],
            noneOf: ['perfume spray', 'cologne spray', 'perfume atomizer full', 'plastic bottle'],
          },
          inject: [{ prefix: '7010.90', syntheticRank: 4 }],
          boosts: [{ delta: 0.60, prefixMatch: '7010.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('VINTAGE_GLASS_BOTTLE_PERFUME_INTENT: created (perfume bottles/Avon decanters → 7010.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT19)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT19 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
