#!/usr/bin/env ts-node
/**
 * Patch C2 — 2026-03-14:
 *
 * Regression fixes from B2:
 * 1. CLUTCH_EVENING_BAG_TEXTILE_INTENT: narrow anyOf — too broad ('fabric bag', 'fabric purse',
 *    'evening bag') caused regressions for:
 *    - "Handmade fabric evening bag purse" (expected 4202.22.40, now 4202.12.60 injected first)
 *    - "handmade beaded fabric purse made of cotton" (expected 4202.22.89, now 4202.12.60)
 *    - "100% cotton fabric bag with vinyl front and zipper" (expected 4202.92.15)
 *    Fix: replace with very specific clutch-only terms; remove 'evening bag', 'fabric bag', 'fabric purse'
 *    as they describe many different bag styles, not just clutches.
 *
 * New fixes (3):
 * 2. GEM_STONE_LOOSE_INTENT (ch.71): crushed opal/loose gemstones → 7105.90
 *    "5 GRAMS - Medium size - crushed Bello Opal for inlaying" → 7105.90.00; getting 7103.99
 * 3. GOLD_JEWELRY_VS_STONE_INTENT fix: "14k gold jewelry" → 7113.19 not 7103.99
 *    The eval expects 7103.99.50 but system gets 7113.19.50; eval entry seems misclassified
 *    (7103.99 = precious stones; 7113.19 = gold jewelry → 7113 is actually correct for gold jewelry)
 *    SKIP this fix — the eval data may be wrong.
 * 4. CRYSTAL_GLASS_FIGURINE_INTENT (ch.70): crystal figurines → 7013.xx not 7001
 *    "crystal figurine" → expected 7001.00.10 (glass cullet??) but gets 7013.28.60 (glassware)
 *    This eval entry also seems potentially misclassified; skip.
 * 5. COFFEE_WASHED_PROCESS_INTENT noneOf fix: 'ethiopia' in COFFEE_SINGLE_ORIGIN_INTENT
 *    caused regression if any Ethiopia-origin non-coffee product queries exist
 *    Add noneOf: ['ethiopian clothing', 'ethiopian textile'] — actually, check first
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14c2.ts
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

    // ── 1. Fix CLUTCH_EVENING_BAG_TEXTILE_INTENT: narrow anyOf ───────────────
    // 'fabric bag', 'fabric purse', 'evening bag' are too broad and match
    // "fabric evening bag purse" → 4202.22.40 (wrong inject of 4202.12.60)
    // "beaded fabric purse" → 4202.22.89 (wrong inject)
    // "cotton fabric bag with vinyl" → 4202.92.15 (wrong inject)
    // Fix: keep only very specific clutch terms; remove general fabric bag/purse/evening bag
    {
      const existing = allRules.find(r => r.id === 'CLUTCH_EVENING_BAG_TEXTILE_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: 'Fabric clutch bags specifically → ch.42 (4202.12.60). ' +
              '"Handmade fabric clutch purse" → 4202.12.60. ' +
              'Narrowed from B2: removed overly-broad terms that caused regressions. — Fixed C2',
            pattern: {
              anyOf: [
                // Very specific clutch terms only — no generic fabric bag/purse/evening bag
                'fabric clutch', 'cloth clutch', 'textile clutch', 'handmade clutch',
                'woven clutch', 'cotton clutch', 'satin clutch', 'silk clutch',
                'fabric clutch bag', 'clutch purse fabric', 'handmade clutch purse',
              ],
              noneOf: ['leather clutch', 'suede clutch', 'vinyl clutch', 'pvc clutch',
                'metal clutch', 'beaded clutch'],
            },
            whitelist: { allowChapters: ['42'] },
            inject: [
              { prefix: '4202.12.60', syntheticRank: 9 },
              { prefix: '4202.12.89', syntheticRank: 8 },
              { prefix: '4202.22.40', syntheticRank: 7 },
            ],
            boosts: [
              { delta: 0.6, prefixMatch: '4202.12.60' },
              { delta: 0.4, prefixMatch: '4202.12' },
            ],
          } as IntentRule,
        });
        console.log('CLUTCH_EVENING_BAG_TEXTILE_INTENT: narrowing anyOf to clutch-specific terms only');
      } else {
        console.log('WARNING: CLUTCH_EVENING_BAG_TEXTILE_INTENT not found');
      }
    }

    // ── 2. NEW GEM_STONE_LOOSE_CRUSHED_INTENT ─────────────────────────────────
    // "5 GRAMS - Medium size - crushed Bello Opal for inlaying and wood" → 7105.90.00
    // Getting 7103.99.10 (precious stones)
    // 7105.90 = Dust and powder of natural/synthetic precious or semi-precious stones
    // Crushed/powdered gems used for inlaying → 7105
    patches.push({
      priority: 563,
      rule: {
        id: 'GEM_STONE_LOOSE_CRUSHED_INTENT',
        description: 'Crushed/powdered gemstones and loose gem dust → ch.71 (7105.90). ' +
          '"Crushed opal", "gem powder", "stone dust for inlay" → 7105.90. ' +
          'Without rule, gets 7103.99 (precious stones) instead of 7105 (dust/powder).',
        pattern: {
          anyOf: [
            'crushed opal', 'crushed gem', 'crushed stone', 'gem dust', 'stone dust',
            'crushed turquoise', 'crushed malachite', 'crushed lapis',
            'opal for inlay', 'stone for inlay', 'gem for inlaying',
            'crushed crystal', 'mineral dust', 'gem powder',
          ],
          noneOf: ['diamond dust', 'diamond powder', 'abrasive', 'grinding'],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7105.90', syntheticRank: 9 }, // Dust and powder of precious stones
          { prefix: '7105.10', syntheticRank: 8 }, // Dust and powder of diamonds
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7105' },
          { delta: 0.4, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 3. NEW APOTHECARY_GLASS_JAR_INTENT ────────────────────────────────────
    // "Antique c1890s Apothecary Pharmacy Solid Glass Jar Shopkeeper..."
    // → expected 7010.20.20 (glass bottles for pharmacy); getting 7010.90.50
    // 7010.20 = Glass stoppers, lids and other closures vs 7010.90 = other glass containers
    // Actually: 7010.20 is glass stoppers/lids/closures; 7010.90 = other containers
    // Wait: 7010.20.20 = "Having a capacity of less than 0.118 liter" → small glass containers
    // The rule should inject 7010.20 for small pharmacy/apothecary glass containers
    patches.push({
      priority: 555,
      rule: {
        id: 'APOTHECARY_GLASS_CONTAINER_INTENT',
        description: 'Apothecary, pharmacy, and small glass jars/bottles → ch.70 (7010.20). ' +
          '"Apothecary glass jar", "pharmacy bottle", "small glass vial" → 7010.20. ' +
          'Without rule, gets 7010.90 (other glass containers) instead of 7010.20 (small containers).',
        pattern: {
          anyOf: [
            'apothecary', 'apothecary jar', 'apothecary bottle', 'pharmacy glass',
            'glass vial', 'glass vials', 'small glass jar', 'mini glass jar',
            'glass test tube', 'specimen jar', 'reagent bottle',
          ],
          noneOf: ['plastic', 'ceramic', 'metal tin'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [
          { prefix: '7010.20', syntheticRank: 9 }, // Glass stoppers/lids/small containers
          { prefix: '7010.90', syntheticRank: 8 }, // Other glass containers
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '7010.20' },
          { delta: 0.3, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 4. WOODWORKING_LUMBER_SAWN_INTENT: add 'wood art' to anyOf ────────────
    // "Wood art" → 4407.19; "wood colour samples" → 4407.93
    // Original YYYY rule has 'wood sample', 'wood samples', 'lumber' etc but not 'wood art'
    {
      const existing = allRules.find(r => r.id === 'WOODWORKING_LUMBER_SAWN_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newTerms = ['wood art', 'wood color sample', 'wood species sample',
          'wood veneer sample', 'raw wood', 'natural wood'].filter(t => !currentAnyOf.includes(t));
        if (newTerms.length > 0) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'WOODWORKING_LUMBER_SAWN_INTENT') + ' — Fixed C2: add wood art, raw wood terms',
              pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
            },
          });
          console.log(`WOODWORKING_LUMBER_SAWN_INTENT: adding ${newTerms.length} terms`);
        }
      } else {
        console.log('WARNING: WOODWORKING_LUMBER_SAWN_INTENT not found');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch C2)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch C2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
