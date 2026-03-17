#!/usr/bin/env ts-node
/**
 * Patch KKKK — 2026-03-13:
 *
 * Fix 6 high-impact bugs found in garment failure analysis:
 *
 * 1. AI_CH04_BLUE_CHEESE: 'blue' alone routes ALL blue-colored garments to ch.04 (cheese)
 *    "Blue jacket", "Blue Nitrile Gloves" → ch.04 cheese. Remove 'blue' standalone token.
 *
 * 2. AI_CH92_CYMBAL: 'hi' and 'hat' as standalone tokens → ALL hi-vis/hat queries → ch.92 cymbal
 *    "Hi Vis Safety Vest", "baseball hat" → 9206.00.40.00 cymbals!
 *    Replace standalone 'hi'/'hat' with 'hi hat'/'hi-hat' phrases.
 *
 * 3. AI_CH51_RAW_WOOL: 'wool' routes to raw wool fiber (ch.51) instead of wool garments (ch.62)
 *    "100% wool cardigan", "wool mittens", "wool dress" → ch.51 raw wool.
 *    Add missing garment terms to noneOf.
 *
 * 4. PEN_PENCIL_INTENT: 'pencil' routes to ch.96 → "pencil skirt" → pencil stationery
 *    Add 'skirt', 'dress' to noneOf.
 *
 * 5. AI_CH56_TWINE_BALER: 'hemp' blocks garments (ch.61) — from JJJJ we added bags,
 *    but forgot garment terms: 'skirt', 'dress', 'shirt', 'blouse', etc.
 *
 * 6. AI_CH54_RAYON_FABRIC: 'viscose'/'rayon' blocks finished garments (ch.61/62)
 *    "BLOUSE 68%viscose 32%polyester" → ch.54 (rayon fabric, not finished blouse)
 *    Add garment terms to noneOf.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13kkkk.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      patches.push({
        priority: 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed KKKK: ${note}`,
          pattern: {
            ...pat,
            noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
          },
        },
      });
      console.log(`${ruleId}: added ${toAdd.length} noneOf terms`);
    }

    // ── 1. AI_CH04_BLUE_CHEESE: remove 'blue' standalone, add context noneOf ─
    // 'blue' alone is too generic — routes ALL blue-colored garments/products to ch.04.
    // Fix: replace 'blue' with 'blue cheese', 'blue-veined' in anyOf. Keep gorgonzola etc.
    {
      const existing = allRules.find(r => r.id === 'AI_CH04_BLUE_CHEESE') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        // Remove standalone 'blue', replace with specific phrases
        const newAnyOf = currentAnyOf
          .filter(t => t !== 'blue')
          .concat(['blue cheese', 'blue-veined', 'blue veined', 'bleu cheese', 'danish blue cheese']);
        patches.push({
          priority: 550,
          rule: {
            ...existing,
            description: 'Blue-veined cheese (gorgonzola/roquefort/stilton) → ch.04. ' +
              'Fixed KKKK: removed standalone "blue" token (routes all blue-colored items to cheese!). ' +
              'Now uses "blue cheese" and "blue-veined" phrases only.',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH04_BLUE_CHEESE: removed standalone 'blue', added phrase-based anyOf`);
      }
    }

    // ── 2. AI_CH92_CYMBAL: remove 'hi' and 'hat' standalone tokens ───────────
    // 'hi' fires on "hi vis", 'hat' fires on "baseball hat" → both → cymbal rule → ch.92
    // Fix: replace with phrase-based matching only.
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_CYMBAL') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        // Remove 'hi' and 'hat' standalone, keep specific cymbal terms
        const newAnyOf = currentAnyOf
          .filter(t => t !== 'hi' && t !== 'hat')
          .concat(['hi hat', 'hi-hat', 'hihat', 'hi hat cymbal']);
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: 'Cymbals (crash/ride/hihat/splash) → ch.92 (9206). ' +
              'Fixed KKKK: removed standalone "hi" and "hat" tokens that fired on "hi-vis" and "baseball hat". ' +
              'Now uses "hi hat" / "hi-hat" phrases.',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH92_CYMBAL: replaced 'hi'/'hat' with 'hi hat'/'hi-hat' phrases`);
      }
    }

    // ── 3. AI_CH51_RAW_WOOL: add missing garment noneOf terms ────────────────
    // "100% wool cardigan", "wool mittens", "wool dress", "wool scarf" → ch.51 raw wool.
    // The rule has 'sweater' and 'coat' in noneOf but missing other garment types.
    addNoneOf('AI_CH51_RAW_WOOL', [
      'cardigan', 'cardigans', 'pullover', 'pullovers', 'hoodie', 'hoodies',
      'sweatshirt', 'sweatshirts', 'dress', 'dresses', 'skirt', 'skirts',
      'scarf', 'scarves', 'mittens', 'mitten', 'glove', 'gloves', 'socks',
      'leggings', 'vest', 'vests', 'shawl', 'shawls', 'poncho', 'sweater vest',
      'beanie', 'hat', 'beret', 'toque', 'headband', 'headbands', 'wrap',
    ], 'garment types (cardigan/mittens/scarf/dress) prevent wool routing to raw fiber (ch.51)');

    // ── 4. PEN_PENCIL_INTENT: add 'skirt' to noneOf ──────────────────────────
    // "pencil skirt", "pencil dress" → ch.96 pencils instead of ch.61/62 garments.
    addNoneOf('PEN_PENCIL_INTENT', [
      'skirt', 'skirts', 'dress', 'dresses', 'case', 'holder', 'drawing charcoal',
      'eyebrow pencil', 'lip pencil', 'eyeliner pencil', 'cosmetic',
    ], '"pencil skirt/dress" is a garment style, not stationery');

    // ── 5. AI_CH56_TWINE_BALER: add garment noneOf for hemp clothing ─────────
    // JJJJ added bags/purses but missed garment terms.
    // "55% hemp 45% cotton women's skirt" → ch.56 twine instead of ch.62.
    addNoneOf('AI_CH56_TWINE_BALER', [
      'skirt', 'skirts', 'dress', 'dresses', 'shirt', 'shirts', 'blouse', 'blouses',
      'pants', 'trousers', 'shorts', 'jacket', 'jackets', 'top', 'tops',
      'sweater', 'cardigan', 'hoodie', 'sweatshirt', 'leggings', 'coat',
      'socks', 'gloves', 'scarf', 'hat', 'apparel', 'clothing', 'garment', 'garments',
      'women', 'womens', "women's", 'men', 'mens', "men's", 'girls', 'boys', 'kids',
    ], 'garment context prevents hemp twine rule from misfiring on hemp clothing');

    // ── 6. AI_CH54_RAYON_FABRIC: add garment noneOf for viscose blends ────────
    // "BLOUSE 68%viscose 32%polyester", "viscose dress" → ch.54 (fabric) instead of ch.61/62.
    // Viscose/rayon as a fiber in a finished garment should route to ch.61/62, not ch.54.
    addNoneOf('AI_CH54_RAYON_FABRIC', [
      'blouse', 'blouses', 'dress', 'dresses', 'skirt', 'skirts', 'shirt', 'shirts',
      'jacket', 'jackets', 'coat', 'coats', 'pants', 'trousers', 'shorts',
      'sweater', 'cardigan', 'hoodie', 'top', 'tops', 'leggings', 'vest',
      'garment', 'garments', 'clothing', 'apparel', 'wearing', 'wearable',
      'women', 'womens', "women's", 'men', 'mens', "men's", 'girls', 'boys',
      'knitted', 'woven garment', 'scarf', 'scarves', 'underwear', 'lingerie',
    ], 'finished garment context (blouse/dress/shirt) prevents rayon rule misfiring on viscose blend garments');

    console.log(`Applying ${patches.length} rule patches (batch KKKK)...`);
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
    console.log(`\nPatch KKKK complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
