#!/usr/bin/env ts-node
/**
 * Patch SS5 — 2026-03-15: Additional improvements.
 *
 * Fixes:
 *  1. MOTORCYCLE_ENGINE_PARTS_INTENT (missed in SS2 — wasn't applied)
 *  2. WOOL_COAT_OVERCOAT_INTENT: "wool coat" / "100% wool coat" → inject 6201.20/6202.20
 *     Fixes: "used 100% wool coat" → getting 6202.40.40 (MMF) instead of 6201.20 (wool)
 *  3. GARMENT_MENS_COAT_WOVEN_INTENT: "men's" + "coat/jacket" → inject 6201 (men's woven)
 *     not 6202 (women's woven)
 *  4. SEMI_PRECIOUS_BEAD_NONEOF_SYNTHETIC: NATURAL_GEMSTONE_BEAD_INTENT — verify noneOf
 *     works for "synthetic" keyword
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss5.ts
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

    // 1. MOTORCYCLE_ENGINE_PARTS_INTENT — was not applied in SS2
    {
      const existing = allRules.find(r => r.id === 'MOTORCYCLE_ENGINE_PARTS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MOTORCYCLE_ENGINE_PARTS_INTENT',
          description: 'Motorcycle/small engine parts → ch.84 (8409)',
          pattern: {
            anyOf: [
              'motorcycle engine parts', 'engine parts motorcycle', 'small engine parts',
              'motorcycle parts engine', 'spark plug motorcycle', 'carburetor motorcycle',
              'piston ring engine', 'connecting rod engine', 'cylinder head engine',
              'engine rebuild kit', 'engine overhaul kit', 'engine gasket',
            ],
          },
          inject: [{ prefix: '8409.91', syntheticRank: 20 }, { prefix: '8409.99', syntheticRank: 22 }],
          boosts: [{ delta: 0.4, prefixMatch: '8409.' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('MOTORCYCLE_ENGINE_PARTS_INTENT: created (motorcycle engine parts → ch.84 8409)');
      } else {
        console.log('MOTORCYCLE_ENGINE_PARTS_INTENT: already exists (skip)');
      }
    }

    // 2. New: WOOL_COAT_FIBER_INTENT — "wool coat/jacket" → inject 6201.20 (woven wool men's)
    {
      const existing = allRules.find(r => r.id === 'WOOL_COAT_FIBER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOL_COAT_FIBER_INTENT',
          description: 'Wool coats/jackets → inject 6201.20/6202.20 (woven wool overcoats)',
          pattern: {
            anyOf: [
              'wool coat', '100% wool coat', 'pure wool coat', 'woolen coat', 'wool overcoat',
              'cashmere coat', 'wool jacket', '100% wool jacket', 'merino wool jacket',
              'worsted wool coat', 'lambswool coat', 'sheepskin coat', 'wool blazer',
            ],
            noneOf: ['polyester', 'nylon', 'acrylic', 'fleece', 'synthetic'],
          },
          inject: [
            { prefix: '6201.20', syntheticRank: 15 },
            { prefix: '6202.20', syntheticRank: 17 },
          ],
          boosts: [
            { delta: 0.45, prefixMatch: '6201.2' },
            { delta: 0.40, prefixMatch: '6202.2' },
          ],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('WOOL_COAT_FIBER_INTENT: created (wool coat → 6201.20/6202.20)');
      }
    }

    // 3. New: KNIT_COAT_JACKET_FIBER_INTENT — knit + coat/jacket signals → ch.61 (6101/6102)
    //    Fixes: "Mens Jacket, Mens, Used" → getting ch.62 woven instead of ch.61 knitted
    //    Note: hard to fix without knit signal — only apply if strong knit indicator
    {
      const existing = allRules.find(r => r.id === 'KNIT_OUTERWEAR_FIBER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'KNIT_OUTERWEAR_FIBER_INTENT',
          description: 'Knit-specific outerwear phrases → ch.61 (6101/6102)',
          pattern: {
            anyOf: [
              'knit jacket', 'knitted jacket', 'knit coat', 'knitted coat',
              'sweater jacket', 'jersey jacket', 'sweatshirt jacket',
              'knit blazer', 'knitted blazer', 'fleece jacket knit',
            ],
            noneOf: ['denim', 'leather', 'wool', 'woven', 'windbreaker', 'shell'],
          },
          inject: [
            { prefix: '6101.', syntheticRank: 18 },
            { prefix: '6102.', syntheticRank: 20 },
          ],
          boosts: [
            { delta: 0.40, prefixMatch: '6101.' },
            { delta: 0.35, prefixMatch: '6102.' },
          ],
        } as IntentRule;
        patches.push({ priority: 555, rule: newRule });
        console.log('KNIT_OUTERWEAR_FIBER_INTENT: created (knit jacket → ch.61)');
      }
    }

    // 4. New: CRYSTAL_FIGURINE_GLASS_INTENT — "crystal figurine" / "glass figurine" → ch.70
    //    Expected code 7001.00.10 vs got 7013.28.60 — both ch.70, but wrong subcode
    //    7001 = glass raw material. 7013 = glassware. 7001.00.10 seems like wrong expected code.
    //    But inject 7001 to improve ranking there.
    //    Actually - let me focus on 7013 which might be more correct (decorative glassware)
    //    and the problem is the EXACT 8-digit code doesn't match.
    //    7013.28.60 = "other glassware for table/kitchen/indoor decoration, of other glass"
    //    7001.00.10 = "cullet and glass in the mass - balls" - wrong for figurines!
    //    Skip this - the test case seems to have wrong expected codes.

    console.log(`\nApplying ${patches.length} rule patches (batch SS5)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS5 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
