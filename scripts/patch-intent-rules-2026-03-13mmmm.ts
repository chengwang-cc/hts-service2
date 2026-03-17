#!/usr/bin/env ts-node
/**
 * Patch MMMM — 2026-03-13:
 *
 * Fix 5 cross-chapter misfires found via garment failure analysis (848 ch.61/62 entries):
 *
 * 1. FRESH_FRUIT_INTENT fires on 'orange' (color) → allowChapters=['08'] → EMPTY for garments
 *    "Orange Cat T-Shirt XL", "Chemical Resistant Gloves Orange PVC"
 *    Fix: add clothing/product context to noneOf
 *
 * 2. AI_CH36_SIGNAL_FLARES fires on 'flare' → allowChapters=['36'] → EMPTY for flare skirts
 *    "Girls Flare Skirt - Soft Terry - Black / 14", "flare jeans", "bell bottom"
 *    Fix: add fashion flare context (skirt, jeans, pants, dress) to noneOf
 *
 * 3. AI_CH60_TERRY_KNIT_FABRIC fires on 'terry' → allowChapters=['60'] → EMPTY for terry garments
 *    "Girls Flare Skirt - Soft Terry" → 'flare'→ch.36 + 'terry'→ch.60 = allowSet {36,60} → EMPTY
 *    Fix: add garment terms to noneOf (skirt, dress, shirt, top, garment, clothing)
 *
 * 4. AI_CH51_RAW_WOOL fires on 'wool' → wool suits/blazers/kilts route to ch.51 raw fiber
 *    "used 100% wool blazer", "Mens wool suit", "Used 100% Wool Girls Kilt"
 *    Fix: add 'blazer', 'blazers', 'suit', 'suits', 'kilt', 'kilts', 'jacket', 'jackets'
 *
 * 5. NEW BLOUSE_WOVEN_GARMENT_INTENT
 *    "BLOUSE 68%viscose 32%polyester" → semantic noise from "32" token → ch.32 dyes
 *    'blouse' with fiber% descriptions should route to ch.62 (woven garments)
 *    Fix: positive rule for blouse → allowChapters=['62'] + inject ch.62
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13mmmm.ts
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
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed MMMM: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. FRESH_FRUIT_INTENT: add garment/clothing context ──────────────────
    // 'orange' fires this rule for "Orange Cat T-Shirt", "Orange PVC Gloves", etc.
    // → allowChapters=['08'] → no ch.08 garment → EMPTY
    addNoneOf('FRESH_FRUIT_INTENT', [
      'shirt', 't-shirt', 'tshirt', 'tee', 'jacket', 'vest', 'coat', 'parka',
      'gloves', 'glove', 'mittens', 'socks', 'pants', 'shorts', 'dress', 'skirt',
      'hoodie', 'sweater', 'leggings', 'top', 'blouse', 'apparel', 'clothing', 'garment',
      'PVC', 'rubber', 'coated', 'chemical resistant', 'chemical-resistant',
      'safety', 'reflective', 'high visibility', 'hi-vis', 'hi vis',
      'cat', 'dog', 'pet', 'animal',
    ], 'garment/clothing/PPE context prevents color word "orange/lemon/lime" firing fruit rule');

    // ── 2. AI_CH36_SIGNAL_FLARES: add fashion flare context to noneOf ────────
    // 'flare' in anyOf targets distress signal flares, but fires on:
    //   "Girls Flare Skirt", "flare jeans", "bell-bottom trousers", "wide-leg pants"
    // These are fashion terms describing flared garment silhouettes, not pyrotechnics.
    addNoneOf('AI_CH36_SIGNAL_FLARES', [
      'skirt', 'skirts', 'dress', 'dresses', 'jeans', 'jean', 'pants', 'trousers',
      'shorts', 'leggings', 'jumpsuit', 'romper',
      'flare jeans', 'flare skirt', 'flare dress', 'flare pants',
      'bell bottom', 'bell-bottom', 'wide leg', 'wide-leg',
      'bootcut', 'boot cut', 'a-line',
    ], 'fashion flare context (skirt/jeans/pants) prevents signal flare rule misfiring on garments');

    // ── 3. AI_CH60_TERRY_KNIT_FABRIC: add garment terms to noneOf ────────────
    // 'terry' (standalone) fires this rule → allowChapters=['60'] (knit fabric)
    // Combined with 'flare' → ch.36, the allowSet {36, 60} excludes ch.61 garments → EMPTY.
    // When garment terms are present, 'terry' describes the fabric of the garment (ch.61/62).
    addNoneOf('AI_CH60_TERRY_KNIT_FABRIC', [
      'skirt', 'skirts', 'dress', 'dresses', 'shirt', 'shirts', 'top', 'tops',
      'blouse', 'shorts', 'pants', 'jacket', 'vest', 'robe', 'onesie', 'romper',
      'garment', 'garments', 'clothing', 'apparel',
    ], 'garment context prevents terry fabric rule from misfiring on terry-fabric garments');

    // ── 4. AI_CH51_RAW_WOOL: add suit/blazer/kilt to noneOf ──────────────────
    // "Mens wool suit", "100% wool blazer", "Girls Kilt" → ch.51 raw wool fiber.
    // Suits, blazers, kilts are finished garments (ch.62), not raw wool.
    addNoneOf('AI_CH51_RAW_WOOL', [
      'suit', 'suits', 'blazer', 'blazers', 'kilt', 'kilts',
      'jacket', 'jackets', 'coat', 'coats', 'pant', 'pants', 'trousers',
      'shorts', 'jumper', 'jumpers', 'jersey', 'jerseys',
    ], '"wool suit/blazer/kilt/jacket" are finished garments (ch.62), not raw wool (ch.51)');

    // ── 5. NEW BLOUSE_WOVEN_GARMENT_INTENT ────────────────────────────────────
    // "BLOUSE 68%viscose 32%polyester" → token "32" semantically matches ch.32 HTS entries
    // (tanning extracts, dyes — described with "32 percent" etc.) → ch.32 wrong chapter.
    // Fix: positive rule for 'blouse' → whitelist ch.62 + inject ch.62 woven garment codes.
    patches.push({
      priority: 580,
      rule: {
        id: 'BLOUSE_WOVEN_GARMENT_INTENT',
        description: 'Blouses and woven shirts → ch.62 (6206/6205). ' +
          'Fixes: "BLOUSE 68%viscose 32%polyester" routing to ch.32 dyes due to ' +
          '"32" number token creating semantic noise. Blouse queries reliably indicate ' +
          'woven garments (ch.62).',
        pattern: {
          anyOf: [
            'blouse', 'blouses', 'womens blouse', "women's blouse", 'ladies blouse',
            'silk blouse', 'chiffon blouse', 'satin blouse', 'woven blouse',
            'dress shirt', 'woven shirt', 'button down shirt', 'button-down shirt',
            'oxford shirt', 'dress blouse',
          ],
          noneOf: [
            // Exclude fabric-only queries (not finished garments)
            'fabric', 'bolt', 'yard', 'metre', 'meter', 'wholesale', 'roll',
          ],
        },
        whitelist: { allowChapters: ['62'] },
        inject: [
          { prefix: '6206.10.00.00', syntheticRank: 9 }, // Women's silk blouses/shirts
          { prefix: '6206.30.30.10', syntheticRank: 8 }, // Women's cotton blouses, not knit
          { prefix: '6206.40.30.10', syntheticRank: 8 }, // Women's MMF blouses, not knit
          { prefix: '6205.20.20.10', syntheticRank: 7 }, // Men's cotton dress shirts, not knit
          { prefix: '6205.30.20.10', syntheticRank: 7 }, // Men's MMF dress shirts, not knit
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '6206' },
          { delta: 0.3, prefixMatch: '6205' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch MMMM)...`);
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
    console.log(`\nPatch MMMM complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
