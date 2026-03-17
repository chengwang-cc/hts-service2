#!/usr/bin/env ts-node
/**
 * Patch TT44 — 2026-03-15: Book manuals + encyclopedia + 6110.30 hoodie/fleece + more glass fixes.
 * Current: ~33.95% (after TT42, TT43 pending eval)
 *
 * Updates:
 *  - BOOK_NOVEL_PAPERBACK_INTENT: add owners manual, car manual, haynes, encyclopedia, dictionary
 *    "Car Owners Manual" → 4901.99; "Haynes Automotive Manual" → 4901.99; ~8 miss entries
 *  - JERSEY_SPORTS_APPAREL_INTENT: add mens hoodie, womens fleece sweater, polyester sweater
 *    "mens hoodie" → 6110.30.10.50; "Women's Fleece Sweater" → 6110.30.15.10; ~8 miss entries
 *  - GLASS_DECORATIVE_HOME_INTENT: add glass figurine, lead crystal, vintage crystal glasses
 *    "glass figurine horse" → 7013.91; "Vintage Austria Crystal Glasses" → 7013.91; ~8 miss entries
 *
 * New Rules:
 *  1. STAINLESS_STEEL_MOKA_POT_INTENT (if STAINLESS_STEEL_KITCHEN update missed moka)
 *     Handled in TT43; this patch focuses on other targets.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt44.ts
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

    // UPDATE BOOK_NOVEL_PAPERBACK_INTENT — add owners manual, car manual, haynes, encyclopedia
    // "Car Owners Manual" → 4901.99 (owners manual)
    // "Haynes Automotive Manual Used" → 4901.99 (Haynes is an auto manual publisher)
    // "Set Printed Lego Encyclopedia w/ figure" → 4901.99 (encyclopedia)
    // Guard: check for 'car manual' or 'owners manual' (different from hasManga guard)
    {
      const existing = allRules.find(r => r.id === 'BOOK_NOVEL_PAPERBACK_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasCarManual = currentAnyOf.some((t: string) =>
          t.includes('car manual') || t.includes('owners manual') || t.includes('haynes'));
        if (!hasCarManual) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Reference books
                'encyclopedia', 'encyclopaedia', 'almanac', 'dictionary',
                // Service/repair manuals (popular import items)
                'owners manual', "owner's manual", 'car manual', 'auto manual',
                'repair manual', 'service manual', 'workshop manual',
                'haynes', 'haynes manual', 'chilton manual', 'chilton',
                // Bare "magazine" (distinct from 'magazine issue' already there)
                'magazine',
                // "book" as a leading word - compound phrases
                'book used', 'used book', 'book lot', 'book set', 'book collection',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 554, rule: updated });
          console.log('BOOK_NOVEL_PAPERBACK_INTENT: updated with car manual/haynes/encyclopedia patterns');
        } else {
          console.log('BOOK_NOVEL_PAPERBACK_INTENT: already has car manual/haynes pattern');
        }
      }
    }

    // UPDATE JERSEY_SPORTS_APPAREL_INTENT — add hoodie, fleece sweater, leg warmers
    // "mens hoodie" → 6110.30.10.50 (polyester hoodie)
    // "mens polyester hoodie" → 6110.30.10.50
    // "mens polyester FR Hoodie, with Detachable Hood" → 6110.30.10.50
    // "Women's Fleece Sweater" → 6110.30.15.10 (women's fleece = polyester knit)
    // "100% Polyester Leg Warmers" → 6110.30.15.20
    // "100% acrylic" → 6110.30.15.60 (acrylic sweater/garment)
    // "50% cotton 50% polyester unisex sweatshirt" → 6110.30.20.20
    {
      const existing = allRules.find(r => r.id === 'JERSEY_SPORTS_APPAREL_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasFleece = currentAnyOf.some((t: string) => t.includes('fleece sweater') || t.includes('fleece vest'));
        if (!hasFleece) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Fleece sweaters (women's fleece = polyester knit → 6110.30)
                'fleece sweater', 'fleece vest', 'women fleece sweater', 'womens fleece',
                'ladies fleece sweater', 'girls fleece sweater',
                // Hoodies (polyester/synthetic hoodies → 6110.30.10.50)
                'hoodie', 'mens hoodie', 'mens polyester hoodie', 'polyester hoodie',
                'fr hoodie', 'fr sweatshirt', 'flame resistant hoodie',
                // Leg warmers (polyester leg warmers → 6110.30.15.20)
                'leg warmer', 'leg warmers', 'polyester leg warmers', 'knit leg warmers',
                // Sweaters (polyester/acrylic sweaters → 6110.30)
                'polyester sweater', 'acrylic sweater', 'synthetic sweater',
                'handknit sweater polyester', 'handknit ladies sweater polyester',
                // General poly-blends
                'polyester sweatshirt', 'poly sweatshirt', 'polyester blend sweatshirt',
                'cotton polyester sweatshirt', '50 cotton 50 polyester sweatshirt',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('JERSEY_SPORTS_APPAREL_INTENT: updated with fleece sweater/hoodie/leg warmer patterns');
        } else {
          console.log('JERSEY_SPORTS_APPAREL_INTENT: already has fleece sweater pattern');
        }
      }
    }

    // UPDATE GLASS_DECORATIVE_HOME_INTENT — add glass figurine, crystal glasses, lead crystal
    // "Hand Blown Crystal Figurine: M.Pyrcak Signed Glass Art" → 7013.91.30.00
    // "glass figurine horse" → 7013.91.30.00 (glass/crystal figurine)
    // "2 Vintage Austria Crystal Glasses" → 7013.91.50.00 (crystal drinking glasses)
    // "clear glass pyrex teapot" → 7013.91.50.00
    // "Viking glass candy dish" → 7013.91.50.00 (Viking glass is lead crystal brand)
    // "Vintage USA Anchor Hocking Glass Cup and Saucer" → 7013.91.10.00
    {
      const existing = allRules.find(r => r.id === 'GLASS_DECORATIVE_HOME_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasGlassFigurine = currentAnyOf.some((t: string) => t.includes('glass figurine') || t.includes('crystal figurine'));
        if (!hasGlassFigurine) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Glass/crystal figurines
                'glass figurine', 'crystal figurine', 'blown glass figurine',
                'glass animal figurine', 'crystal horse', 'glass horse',
                'glass bird figurine', 'art glass figurine',
                // Lead crystal drinkware (7013.91)
                'crystal glasses', 'lead crystal glasses', 'crystal drinking glasses',
                'vintage crystal glasses', 'austria crystal glasses',
                'crystal water glasses', 'crystal wine glasses',
                // Glass teapot
                'glass teapot', 'pyrex teapot', 'glass tea pot',
                // Brand names for crystal
                'viking glass', 'anchor hocking', 'waterford crystal',
                'swarovski crystal', 'bohemia crystal', 'schott zwiesel',
                // Glass cup and saucer
                'glass cup saucer', 'glass cup and saucer',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 570, rule: updated });
          console.log('GLASS_DECORATIVE_HOME_INTENT: updated with glass figurine/crystal glasses patterns');
        } else {
          console.log('GLASS_DECORATIVE_HOME_INTENT: already has glass figurine pattern');
        }
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT44)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT44 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
