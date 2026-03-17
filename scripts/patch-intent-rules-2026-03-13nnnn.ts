#!/usr/bin/env ts-node
/**
 * Patch NNNN — 2026-03-13:
 *
 * Fix 6 misfires identified in garment/consumer-product failure analysis:
 *
 * 1. AI_CH54_ELASTOMERIC_YARN fires on 'spandex'/'elastane' → ch.54 for garments
 *    "Cotton Spandex Shorts", "90%polyester 10%elastane skirt" → ch.54 elastic yarn
 *    Fix: add garment terms to noneOf
 *
 * 2. AI_CH60_STRETCH_FABRIC fires on 'spandex'/'stretch' → ch.60 for garments
 *    Same queries, combined with #1: allowSet={54,60} → no ch.61 garment → EMPTY/ch.54
 *    Fix: add garment terms to noneOf
 *
 * 3. AI_CH75_NICKEL_MESH_CLOTH fires on 'mesh' → ch.75 for safety vests
 *    "5-Point Tear-Away Mesh Traffic Vest", "mesh vest" → ch.75 nickel mesh → EMPTY
 *    Fix: add garment/safety context to noneOf
 *
 * 4. MEAT_POULTRY_INTENT fires on 'duck' → ch.02 for duck canvas workwear
 *    "Cotton Duck Hi Vis Safety Vest" → allowChapters=['02'] → EMPTY
 *    Fix: add 'canvas', 'duck canvas', 'vest', 'jacket', 'safety' to noneOf
 *
 * 5. AI_CH92_WHISTLE_DECOY fires on 'duck' → ch.92 for duck canvas workwear
 *    Same query, combined with #4: allowSet={02,92} → no vest → EMPTY
 *    Fix: add same garment/canvas context to noneOf
 *
 * 6. AI_CH60_DOUBLE_KNIT_INTERLOCK fires on 'jersey' → ch.60 for sports jerseys
 *    "American MLB All Star Game Authentic Majestic Jersey Size 48" → ch.48 (semantic noise)
 *    Jersey (knit fabric) fires → allowChapters=['60'], then "48" → ch.48 in allowSet noise
 *    Fix: add sports/team jersey context to noneOf + new SPORTS_JERSEY_GARMENT_INTENT
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13nnnn.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed NNNN: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH54_ELASTOMERIC_YARN: add garment noneOf ──────────────────────
    // 'spandex', 'elastane', 'lycra' fires this rule → allowChapters=['54']
    // These appear in garment fabric blends (10%elastane, cotton/spandex shorts).
    // When garment terms present, item is ch.61/62, not ch.54 elastic yarn.
    addNoneOf('AI_CH54_ELASTOMERIC_YARN', [
      'shorts', 'pants', 'trousers', 'skirt', 'skirts', 'dress', 'dresses',
      'shirt', 'shirts', 't-shirt', 'tshirt', 'top', 'tops', 'blouse', 'blouses',
      'jacket', 'jackets', 'vest', 'vests', 'coat', 'coats', 'hoodie', 'hoodies',
      'sweater', 'cardigan', 'leggings', 'tights', 'bodysuit', 'swimsuit', 'swimwear',
      'garment', 'garments', 'clothing', 'apparel', 'underwear', 'bra',
      'women', "women's", 'womens', 'men', "men's", 'mens', 'girls', 'boys', 'ladies',
    ], 'garment context (shorts/skirt/blouse) prevents elastomeric yarn rule misfiring on blended-fiber garments');

    // ── 2. AI_CH60_STRETCH_FABRIC: add garment noneOf ────────────────────────
    // 'spandex', 'stretch' fires → allowChapters=['60']. Combined with AI_CH54_ELASTOMERIC_YARN
    // firing, allowSet={54,60} excludes ch.61 garments → EMPTY or wrong chapter.
    addNoneOf('AI_CH60_STRETCH_FABRIC', [
      'shorts', 'pants', 'trousers', 'skirt', 'skirts', 'dress', 'dresses',
      'shirt', 'shirts', 't-shirt', 'tshirt', 'top', 'tops', 'blouse', 'blouses',
      'jacket', 'jackets', 'vest', 'vests', 'coat', 'coats', 'hoodie', 'hoodies',
      'sweater', 'cardigan', 'leggings', 'tights', 'bodysuit', 'swimsuit', 'swimwear',
      'jeans', 'denim', 'waistband', 'cuff', 'collar',
      'garment', 'garments', 'clothing', 'apparel',
      'women', "women's", 'womens', 'men', "men's", 'mens', 'girls', 'boys', 'ladies',
    ], 'garment context prevents stretch fabric rule from misfiring on stretch-blend garments (ch.60 fabric, not garment)');

    // ── 3. AI_CH75_NICKEL_MESH_CLOTH: add garment/safety context ─────────────
    // 'mesh' fires → allowChapters=['75'] (nickel mesh/cloth)
    // "Mesh Traffic Vest", "mesh safety vest" → no ch.75 vest → EMPTY
    addNoneOf('AI_CH75_NICKEL_MESH_CLOTH', [
      'vest', 'vests', 'jacket', 'jackets', 'shirt', 'shirts', 'top', 'tops',
      'safety', 'hi-vis', 'hi vis', 'high visibility', 'reflective', 'traffic',
      'athletic', 'sports', 'running', 'cycling', 'football', 'soccer', 'basketball',
      'garment', 'garments', 'clothing', 'apparel', 'workwear', 'work wear',
      'tear-away', 'tear away', 'tearaway',
    ], 'garment/safety context prevents nickel mesh rule firing on mesh safety vests');

    // ── 4. MEAT_POULTRY_INTENT: add duck canvas context to noneOf ────────────
    // 'duck' in anyOf targets duck/goose meat (ch.02), but fires on "duck canvas" workwear.
    // "Cotton Duck Hi Vis Safety Vest" → allowChapters=['02'] → EMPTY
    addNoneOf('MEAT_POULTRY_INTENT', [
      'canvas', 'duck canvas', 'cotton canvas', 'sailcloth',
      'vest', 'vests', 'jacket', 'jackets', 'coat', 'coats', 'overalls', 'coveralls',
      'workwear', 'work wear', 'safety', 'hi-vis', 'hi vis', 'reflective',
      'bill', 'billed', 'cap', 'hat',  // duck-bill/duck-billed products
    ], '"duck canvas" is a heavy cotton fabric (ch.52), not poultry (ch.02)');

    // ── 5. AI_CH92_WHISTLE_DECOY: add duck canvas context to noneOf ──────────
    // 'duck' also fires this rule → allowChapters=['92'] (duck call/decoy)
    // Combined with MEAT_POULTRY_INTENT: allowSet={02,92} → no vest → EMPTY
    addNoneOf('AI_CH92_WHISTLE_DECOY', [
      'canvas', 'duck canvas', 'cotton canvas',
      'vest', 'vests', 'jacket', 'jackets', 'coat', 'coats', 'overalls', 'coveralls',
      'workwear', 'work wear', 'safety', 'hi-vis', 'hi vis', 'reflective',
    ], '"duck canvas" fabric context prevents duck decoy/call rule from misfiring');

    // ── 6. AI_CH60_DOUBLE_KNIT_INTERLOCK: add sports jersey context ───────────
    // 'jersey' in anyOf targets jersey knit fabric (ch.60), but fires on sports jerseys.
    // "MLB All Star Jersey Size 48" → allowChapters=['60'], then "48" → ch.48 noise → wrong
    // Sports jerseys (for wearing) should be ch.61 (knitted garments).
    addNoneOf('AI_CH60_DOUBLE_KNIT_INTERLOCK', [
      'baseball jersey', 'football jersey', 'basketball jersey', 'soccer jersey',
      'hockey jersey', 'sports jersey', 'team jersey', 'game jersey',
      'authentic jersey', 'replica jersey', 'fan jersey',
      'MLB', 'NBA', 'NFL', 'NHL', 'MLS', 'WNBA',
      'majestic', 'nike jersey', 'adidas jersey', 'under armour',
      'jersey size', 'size xl', 'size large', 'size medium', 'size small',
      'vintage jersey', 'throwback jersey', 'name number', 'player jersey',
    ], 'sports team jersey context prevents knit fabric (jersey) rule from misfiring on wearable sports jerseys');

    // ── NEW: SPORTS_JERSEY_GARMENT_INTENT ─────────────────────────────────────
    // Positive rule for sports jerseys (for wearing) → ch.61 (knitted garments)
    // MLB, NBA, NFL sports jerseys are knitted garments (6109.90 or 6110.20).
    patches.push({
      priority: 610,
      rule: {
        id: 'SPORTS_JERSEY_GARMENT_INTENT',
        description: 'Sports team jerseys (for wearing) → ch.61 (6109/6110). ' +
          'MLB, NBA, NFL, NHL sports jerseys are knitted garments. ' +
          'Previously: AI_CH60_DOUBLE_KNIT_INTERLOCK fires on "jersey" → ch.60 (jersey fabric) ' +
          'then "Size 48" number causes semantic routing to ch.48 (paper).',
        pattern: {
          anyOf: [
            'baseball jersey', 'football jersey', 'basketball jersey', 'soccer jersey',
            'hockey jersey', 'sports jersey', 'team jersey', 'game jersey',
            'authentic jersey', 'replica jersey', 'fan jersey', 'player jersey',
            'throwback jersey', 'vintage jersey',
          ],
        },
        whitelist: { allowChapters: ['61'] },
        inject: [
          { prefix: '6109.90.10.07', syntheticRank: 9 }, // T-shirts, other fibers, other (sports jerseys)
          { prefix: '6109.90.80.10', syntheticRank: 8 }, // Other, man-made fibers
          { prefix: '6110.20.20.10', syntheticRank: 7 }, // Cotton knit sweaters/pullovers
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '6109' },
          { delta: 0.3, prefixMatch: '6110' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch NNNN)...`);
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
    console.log(`\nPatch NNNN complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
