#!/usr/bin/env ts-node
/**
 * Patch IIII — 2026-03-13:
 *
 * Several targeted fixes for new consumer-language eval entries:
 *
 * 1. COFFEE_BEAN_INTENT — add 'table', 'furniture', 'coffee table' to noneOf
 *    "Walnut coffee table" → 'coffee' fires COFFEE_BEAN_INTENT → allowChapters=['09']
 *    But a "coffee table" is furniture (ch.94), not a coffee product.
 *
 * 2. AI_CH92_DRUM_STAND_ACCESSORY — add 'wood', 'wooden', 'step', 'kitchen', 'bar',
 *    'bathroom', 'stool' alone context to noneOf.
 *    "wood stool", "step stool", "bar stool" → fire drum stand rule → ch.92 (wrong).
 *    These are ch.94 furniture items.
 *
 * 3. NEW CHARCOAL_WOOD_INTENT
 *    "coconut charcoal", "wood charcoal", "charcoal briquettes" → 4402 (ch.44)
 *    Semantic search returns ch.08 (coconut) or ch.44 wrong sub-code.
 *    'charcoal' is a strong signal for ch.44.
 *
 * 4. NEW FURNITURE_TABLE_CHAIR_INTENT
 *    "walnut coffee table", "wood stool", "dining table", "accent table" → ch.94
 *    Furniture terms that get misrouted due to other keyword rules.
 *
 * 5. NEW PET_APPAREL_ACCESSORY_INTENT
 *    Pet clothing/accessories that fail ch.61/62 garment rules.
 *    "Dog sweater", "cat costume" → ch.61 or ch.42 depending on item type.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13iiii.ts
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

    // ── 1. FIX COFFEE_BEAN_INTENT: add furniture terms to noneOf ─────────────
    // "walnut coffee table" → 'coffee' fires COFFEE_BEAN_INTENT → allowChapters=['09']
    // But "coffee table" is a type of furniture, not a coffee product.
    {
      const existing = allRules.find(r => r.id === 'COFFEE_BEAN_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'table', 'tables', 'furniture', 'chair', 'chairs', 'desk', 'shelf',
          'shelves', 'cabinet', 'drawer', 'nightstand', 'bookcase', 'wardrobe',
          'dresser', 'bench', 'couch', 'sofa', 'stool', 'ottoman',
          'coffee table', 'side table', 'end table', 'dining table', 'accent table',
        ];
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: existing.description + ' — Fixed: furniture terms (table/furniture/chair) in noneOf prevent false firing on "coffee table".',
            pattern: {
              ...pat,
              noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
            },
          },
        });
        console.log('COFFEE_BEAN_INTENT: added furniture terms to noneOf');
      } else {
        console.log('WARNING: COFFEE_BEAN_INTENT not found');
      }
    }

    // ── 2. FIX AI_CH92_DRUM_STAND_ACCESSORY: add furniture stool context ─────
    // "wood stool" → 'stool' fires drum stand rule → allowChapters=['92'] → wrong ch.92
    // "Bar stool", "step stool", "kitchen stool" are furniture (ch.94), not drum thrones
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_DRUM_STAND_ACCESSORY') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'wood', 'wooden', 'step', 'bar', 'kitchen', 'bathroom', 'bedside',
          'dining', 'counter', 'pub', 'office', 'garden', 'outdoor', 'patio',
          'bar stool', 'step stool', 'kitchen stool', 'counter stool', 'pub stool',
          'wood stool', 'wooden stool', 'furniture', 'accent', 'side', 'folding',
        ];
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: 'Drum/percussion stands, pedals, thrones → ch.92. ' +
              'Fixed: wood/step/bar/kitchen/bathroom stool context means furniture, not drum throne.',
            pattern: {
              ...pat,
              noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
            },
          },
        });
        console.log('AI_CH92_DRUM_STAND_ACCESSORY: added furniture stool context to noneOf');
      } else {
        console.log('WARNING: AI_CH92_DRUM_STAND_ACCESSORY not found');
      }
    }

    // ── 3. NEW CHARCOAL_WOOD_INTENT ──────────────────────────────────────────
    // "coconut charcoal", "wood charcoal", "charcoal briquettes" → 4402 (ch.44)
    // Without a rule, "coconut charcoal" returns ch.08 (tropical fruits) because
    // semantic search matches "coconut" strongly.
    patches.push({
      priority: 600,
      rule: {
        id: 'CHARCOAL_WOOD_INTENT',
        description: 'Wood/coconut/bamboo charcoal → 4402 (ch.44). ' +
          'Without this rule, "coconut charcoal" gets ch.08 (fruits). ' +
          '"Charcoal" strongly signals ch.44. ' +
          'noneOf activated/carbon to distinguish from ch.38 activated carbon.',
        pattern: {
          anyOf: [
            'charcoal', 'wood charcoal', 'coconut charcoal', 'charcoal briquette',
            'charcoal briquettes', 'lump charcoal', 'hardwood charcoal', 'bamboo charcoal',
            'coconut shell charcoal', 'charcoal fuel', 'bbq charcoal', 'barbeque charcoal',
          ],
          noneOf: [
            'activated', 'activated carbon', 'carbon black', 'filter', 'water filter',
            'activated charcoal', 'charcoal mask', 'charcoal face', 'charcoal soap',
            'charcoal toothpaste', 'drawing charcoal', 'artists charcoal', 'vine charcoal',
            'pencil',
          ],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [
          { prefix: '4402.90.01.00', syntheticRank: 9 }, // Other charcoal of wood
          { prefix: '4402.10.00.00', syntheticRank: 8 }, // Bamboo charcoal
          { prefix: '4402.90.00.00', syntheticRank: 7 }, // Other charcoal
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4402' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW FURNITURE_WOOD_TABLE_INTENT ───────────────────────────────────
    // "walnut coffee table", "oak dining table", "live edge table" → ch.94 (furniture)
    // Many furniture terms get hijacked by material/food keywords.
    patches.push({
      priority: 620,
      rule: {
        id: 'FURNITURE_WOOD_TABLE_INTENT',
        description: 'Wood furniture tables/desks → 9403 (ch.94). ' +
          'Fixes queries like "walnut coffee table" being routed to coffee (ch.09). ' +
          '"coffee table", "dining table", "side table" are furniture terms.',
        pattern: {
          anyOf: [
            'coffee table', 'dining table', 'side table', 'end table', 'accent table',
            'console table', 'sofa table', 'hall table', 'entryway table', 'writing desk',
            'kitchen table', 'farmhouse table', 'rustic table', 'live edge table',
            'bedside table', 'nightstand table', 'patio table', 'outdoor table',
          ],
        },
        whitelist: { allowChapters: ['94'] },
        inject: [
          { prefix: '9403.60.80.41', syntheticRank: 8 }, // Other wooden furniture
          { prefix: '9403.60.80.51', syntheticRank: 7 },
          { prefix: '9403.30.00.20', syntheticRank: 6 }, // Wooden office furniture
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9403' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW FURNITURE_STOOL_SEAT_INTENT ───────────────────────────────────
    // "wood stool", "bar stool", "step stool" → ch.94 (seats 9401 or furniture 9403)
    patches.push({
      priority: 610,
      rule: {
        id: 'FURNITURE_STOOL_SEAT_INTENT',
        description: 'Furniture stools/seats → 9401 (ch.94 seats). ' +
          'Fixes "wood stool", "bar stool" being routed to ch.92 (drum throne). ' +
          'Material/context words like "wood/bar/step" indicate furniture, not instruments.',
        pattern: {
          anyOf: [
            'bar stool', 'bar stools', 'step stool', 'step stools',
            'kitchen stool', 'counter stool', 'pub stool', 'wood stool', 'wooden stool',
            'bamboo stool', 'rattan stool', 'accent stool', 'side stool',
            'bedside stool', 'footstool', 'foot stool',
          ],
        },
        whitelist: { allowChapters: ['94'] },
        inject: [
          { prefix: '9401.69.20.10', syntheticRank: 8 }, // Other seats, wooden frames
          { prefix: '9401.69.40.28', syntheticRank: 7 }, // Other wooden seats
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9401' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch IIII)...`);
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
    console.log(`\nPatch IIII complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
