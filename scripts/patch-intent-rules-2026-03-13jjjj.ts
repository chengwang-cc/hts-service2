#!/usr/bin/env ts-node
/**
 * Patch JJJJ — 2026-03-13:
 *
 * Fix 8 rules causing EMPTY results for legitimate consumer product queries.
 * Each fix adds context-specific noneOf terms to prevent misrouting.
 *
 * Root causes found via token isolation:
 *
 * 1. AI_CH91_POCKET_WATCH fires on 'vest' → allowChapters=['91']
 *    "Work vest", "safety vest", "puffer vest" → EMPTY (ch.62, not ch.91)
 *
 * 2. AI_CH31_ORGANIC_ANIMAL_FERTILIZER fires on 'feather' → allowChapters=['31']
 *    "Feather jacket", "down feather jacket" → EMPTY (ch.62, not ch.31 fertilizer)
 *
 * 3. AI_CH03_SHARK_FIN fires on 'tail' → allowChapters=['03']
 *    "Tail light", "tail lamp" → EMPTY (ch.85 automotive lighting, not ch.03 fish)
 *
 * 4. AI_CH03_SMOKED_DRIED_SALTED_FISH fires on 'salt' → allowChapters=['03']
 *    "Salt cellar bowl", "salt shaker" → EMPTY (ch.69/73 tableware, not ch.03 fish)
 *
 * 5. AI_CH02_SALTED_CURED_MEAT fires on 'salt' → allowChapters=['02']
 *    Same 'salt' container issue — also blocks ch.69/73 tableware
 *
 * 6. AI_CH54_RAYON_FABRIC fires on 'acetate' → allowChapters=['54']
 *    "Acrylic acetate project blanks" → EMPTY (ch.39 plastics, not ch.54 textile)
 *
 * 7. AI_CH56_TWINE_BALER fires on 'hemp' → allowChapters=['56']
 *    "Hemp purse", "hemp bag" → EMPTY (ch.42 bags, not ch.56 twine)
 *
 * 8. NEW AUTOMOTIVE_LIGHTING_INTENT
 *    "Tail light", "brake light", "turn signal" → ch.85 (8512.xx)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13jjjj.ts
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

    function patchNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      patches.push({
        priority: 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed: ${note}`,
          pattern: {
            ...pat,
            noneOf: [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))],
          },
        },
      });
      console.log(`${ruleId}: added ${toAdd.length} noneOf terms`);
    }

    // ── 1. AI_CH91_POCKET_WATCH: 'vest' fires on clothing items ─────────────
    // 'vest' in anyOf meant "vest pocket" (pocket watch style), but fires on garments.
    patchNoneOf('AI_CH91_POCKET_WATCH', [
      'work', 'safety', 'hi-vis', 'hi vis', 'high-vis', 'reflective',
      'insulated', 'fleece', 'quilted', 'puffer', 'down vest', 'puffy',
      'jacket', 'coat', 'top', 'wearable', 'garment', 'clothing',
      'polyester', 'cotton', 'wool', 'nylon', 'spandex', 'denim',
      'carhartt', 'columbia', 'patagonia', 'north face',
    ], 'garment/clothing context words prevent "work vest" etc. firing pocket watch rule');

    // ── 2. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: 'feather' fires on garments ───
    // 'feather' in anyOf targets feather meal/fertilizer, but fires on down jackets.
    patchNoneOf('AI_CH31_ORGANIC_ANIMAL_FERTILIZER', [
      'jacket', 'coat', 'vest', 'parka', 'anorak', 'puffer', 'duvet', 'comforter',
      'pillow', 'cushion', 'blanket', 'quilt', 'sleeping bag', 'bedding',
      'apparel', 'clothing', 'garment', 'wearing', 'wearable',
      'feather jacket', 'feather coat', 'feather vest', 'down jacket',
    ], 'garment context words prevent "feather jacket" etc. firing fertilizer rule');

    // ── 3. AI_CH03_SHARK_FIN: 'tail' fires on automotive tail lights ─────────
    // 'tail' in anyOf targets shark fins/fish tails, but fires on car tail lights.
    patchNoneOf('AI_CH03_SHARK_FIN', [
      'light', 'lamp', 'lights', 'lamps', 'lighting',
      'tail light', 'tail lamp', 'tail lights', 'tail lamps',
      'brake light', 'turn signal', 'indicator', 'automotive', 'car', 'vehicle',
      'motorcycle', 'truck', 'assembly', 'housing', 'lens', 'bulb',
      'led', 'halogen', 'headlight', 'signal light', 'running light',
    ], '"tail light/lamp" automotive context prevents fish fin rule misfiring');

    // ── 4. AI_CH03_SMOKED_DRIED_SALTED_FISH: 'salt' fires on salt containers ─
    // 'salt' targets salted fish, but fires on "salt cellar bowl", "salt shaker".
    patchNoneOf('AI_CH03_SMOKED_DRIED_SALTED_FISH', [
      'cellar', 'shaker', 'mill', 'grinder', 'pot', 'dish', 'container',
      'bowl', 'box', 'vessel', 'crock', 'jar', 'holder', 'dispenser',
      'salt cellar', 'salt shaker', 'salt mill', 'salt grinder',
      'salt box', 'salt pot', 'salt dish', 'salt bowl',
      'ceramic', 'porcelain', 'glass', 'wooden', 'silver', 'crystal',
    ], 'salt container/vessel context prevents fish rule misfiring on tableware');

    // ── 5. AI_CH02_SALTED_CURED_MEAT: same 'salt' container issue ────────────
    patchNoneOf('AI_CH02_SALTED_CURED_MEAT', [
      'cellar', 'shaker', 'mill', 'grinder', 'pot', 'dish', 'container',
      'bowl', 'box', 'vessel', 'crock', 'jar', 'holder', 'dispenser',
      'salt cellar', 'salt shaker', 'salt mill', 'salt grinder',
      'salt box', 'salt pot', 'salt dish', 'salt bowl',
      'ceramic', 'porcelain', 'glass', 'wooden', 'silver', 'crystal',
    ], 'salt container context prevents meat rule misfiring on tableware');

    // ── 6. AI_CH54_RAYON_FABRIC: 'acetate' fires on plastic craft blanks ─────
    // 'acetate' targets acetate textile fiber, but fires on acrylic/polymer craft blanks.
    patchNoneOf('AI_CH54_RAYON_FABRIC', [
      'blank', 'blanks', 'project', 'projects', 'craft', 'crafts',
      'sheet', 'sheets', 'block', 'blocks', 'slab', 'panel', 'bar',
      'rod', 'tube', 'ring', 'earring', 'jewelry', 'keychain', 'charm',
      'acrylic blank', 'acrylic blanks', 'laser', 'engrave', 'engraved',
      'sublimation', 'cut', 'shape', 'shaped',
    ], 'craft/blank/project context prevents acetate textile rule misfiring on acrylic craft material');

    // ── 7. AI_CH56_TWINE_BALER: 'hemp' fires on hemp finished goods ─────────
    // 'hemp' targets baling twine, but fires on hemp bags/purses (ch.42).
    patchNoneOf('AI_CH56_TWINE_BALER', [
      'purse', 'bag', 'bags', 'handbag', 'handbags', 'tote', 'totes',
      'wallet', 'wallets', 'pouch', 'pouches', 'backpack', 'clutch',
      'satchel', 'crossbody', 'shoulder bag', 'beach bag', 'market bag',
      'hemp purse', 'hemp bag', 'hemp tote', 'hemp wallet',
      'clothing', 'garment', 'shirt', 'pants', 'dress', 'shoes',
    ], 'finished goods context (purse/bag) prevents twine rule misfiring on hemp accessories');

    // ── 8. NEW AUTOMOTIVE_LIGHTING_INTENT ────────────────────────────────────
    // Creates a positive rule for automotive lights so "tail light", "brake light" etc.
    // get routed to ch.85 (8512.xx electrical lighting for motor vehicles).
    patches.push({
      priority: 610,
      rule: {
        id: 'AUTOMOTIVE_LIGHTING_INTENT',
        description: 'Automotive lights (tail/brake/turn/headlight) → 8512 (ch.85). ' +
          '"Tail light", "brake light", "turn signal" are ch.85 electrical lighting. ' +
          'Previously: "tail" → AI_CH03_SHARK_FIN → ch.03, causing EMPTY.',
        pattern: {
          anyOf: [
            'tail light', 'tail lights', 'tail lamp', 'tail lamps',
            'brake light', 'brake lights', 'brake lamp',
            'turn signal', 'turn signals', 'indicator light', 'blinker',
            'headlight assembly', 'headlamp assembly',
            'fog light', 'fog lamp', 'running light', 'parking light',
            'reverse light', 'backup light', 'reverse lamp',
            'led tail light', 'led brake light', 'led headlight',
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8512.20.40.80', syntheticRank: 9 }, // Lighting equipment for motor vehicles
          { prefix: '8512.20.20.40', syntheticRank: 8 },
          { prefix: '8512.90.60.00', syntheticRank: 7 }, // Parts for lighting
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8512' },
          { delta: 0.3, prefixMatch: '8512.20' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch JJJJ)...`);
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
    console.log(`\nPatch JJJJ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
