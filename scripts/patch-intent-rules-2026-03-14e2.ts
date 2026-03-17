#!/usr/bin/env ts-node
/**
 * Patch E2 — 2026-03-14:
 *
 * Fixes to existing rules (3):
 * 1. FRESH_FLOWER_INTENT anyOf: REMOVE 'flower' and 'flowers' — too broad.
 *    "Decanter Set - Multi Flowers Whisky" → 0603 (live flowers)!!! getting 0603 because
 *    FRESH_FLOWER_INTENT fires for 'flowers' token → allowChapters=['06'] blocks ch.70 glass.
 *    "Handmade Gingham Cotton Hanging Flower Bag" → 4202.19 expected, getting flowers.
 *    No ch.06 eval query uses ONLY 'flower'/'flowers' without rose/orchid/tulip/bouquet etc.
 *    Removing these 2 terms reduces false positives without breaking actual flower queries.
 *
 * 2. ELECTRIC_MOTOR_ACTUATOR_INTENT anyOf: add 'bbq motor', 'rotisserie', 'motor for'
 *    "Rotisseris bbq motor" → 8501.20.20 expected; 'rotisserie motor' phrase doesn't match
 *    due to typo 'rotisseris' and 'bbq' between words. 'bbq motor' as phrase works.
 *
 * 3. INDOOR_PLANT_INTENT anyOf: check for similar over-broad terms like 'plant' and 'herb'
 *    "Herb garden starter kit" → ch.06? Or if 'plant' causes issues for "power plant" etc.
 *    Actually noneOf already has 'factory', 'power', 'industrial'. Keep as-is.
 *
 * New rules (3):
 * 4. GLASS_DECANTER_VESSEL_INTENT (ch.70): decanters, glass vessels, carafes → 7010.90
 *    "Decanter Set", "whisky carafe" → 7010.90 (glass containers for food/drink)
 * 5. ACRYLIC_KEYCHAIN_PLASTIC_INTENT (ch.39): acrylic/plastic keychains as art → 3926.40
 *    Clarify: "100% acrylic keychains" → eval expects 3904.22 but system gets 3926.40.
 *    The 3904.22 expectation seems suspect (PVC for acrylic keychains). Keep existing.
 * 6. PAPER_DIECUT_CRAFT_INTENT (ch.48): paper die cuts for crafts → 4802.56
 *    "dumpling die cuts" → 4802.56.70 expected; getting 9504 (games). Paper craft cuts.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14e2.ts
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

    // ── 1. FRESH_FLOWER_INTENT: remove 'flower', 'flowers' from anyOf ─────────
    // 'flower' fires for product names like "Flower Bag", "Flower Decanter Set".
    // All ch.06 eval queries with ONLY 'flower'/'flowers' as trigger: zero.
    // Real flower queries use rose/orchid/tulip/bouquet/carnation/lily/chrysanthemum.
    {
      const existing = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT') as IntentRule | undefined;
      if (existing) {
        const toRemove = new Set(['flower', 'flowers']);
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = currentAnyOf.filter((t: string) => !toRemove.has(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FRESH_FLOWER_INTENT') + ' — Fixed E2: removed flower/flowers (too broad; fired for "Flower Bag", "Multi Flowers Decanter")',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`FRESH_FLOWER_INTENT: removed 'flower', 'flowers' from anyOf (${newAnyOf.length} terms remain)`);
      } else {
        console.log('WARNING: FRESH_FLOWER_INTENT not found');
      }
    }

    // ── 2. ELECTRIC_MOTOR_ACTUATOR_INTENT: add bbq motor terms ────────────────
    // "Rotisseris bbq motor" → 8501.20.20; the typo 'rotisseris' + 'bbq' between words
    // prevents 'rotisserie motor' phrase from matching. But 'bbq motor' as phrase matches.
    {
      const existing = allRules.find(r => r.id === 'ELECTRIC_MOTOR_ACTUATOR_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const toAdd = ['bbq motor', 'rotisserie', 'spit motor', 'ceiling fan motor',
          'range hood motor', 'oven motor', 'grill motor'].filter(t => !currentAnyOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'ELECTRIC_MOTOR_ACTUATOR_INTENT') + ' — Fixed E2: add bbq motor, rotisserie for rotisserie motor queries',
            pattern: { ...pat, anyOf: [...currentAnyOf, ...toAdd] },
          },
        });
        console.log(`ELECTRIC_MOTOR_ACTUATOR_INTENT: adding ${toAdd.length} terms`);
      } else {
        console.log('WARNING: ELECTRIC_MOTOR_ACTUATOR_INTENT not found');
      }
    }

    // ── 3. NEW GLASS_DECANTER_VESSEL_INTENT ───────────────────────────────────
    // "Decanter Set - Multi Flowers Whisky" → 7010.90.20 (glass containers for food/drink)
    // Gets 0603 (cut flowers) because FRESH_FLOWER_INTENT fires for 'flowers' token.
    // Fix 1: remove 'flower'/'flowers' from FRESH_FLOWER_INTENT (done above)
    // Fix 2: explicitly inject 7010.90 for decanter/carafe queries
    patches.push({
      priority: 575,
      rule: {
        id: 'GLASS_DECANTER_VESSEL_INTENT',
        description: 'Glass decanters, carafes, and glass vessels for spirits → ch.70 (7010.90). ' +
          '"Decanter set", "whisky carafe", "glass carafe" → 7010.90. ' +
          'Without rule, FRESH_FLOWER_INTENT may fire if product has Flowers in name.',
        pattern: {
          anyOf: [
            'decanter', 'decanters', 'decanter set', 'whisky decanter', 'whiskey decanter',
            'wine decanter', 'carafe', 'carafes', 'glass carafe', 'water carafe',
            'glass bottle set', 'glass vessel', 'spirit decanter',
          ],
          noneOf: ['plastic decanter', 'ceramic decanter'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [
          { prefix: '7010.90', syntheticRank: 9 }, // Other glass containers
          { prefix: '7010.20', syntheticRank: 8 }, // Small glass containers
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7010.90' },
          { delta: 0.4, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW PAPER_DIECUT_CRAFT_INTENT ──────────────────────────────────────
    // "dumpling die cuts" → 4802.56.70 (other paper in sheets)
    // Die cuts for scrapbooking/paper crafting → ch.48 (paper)
    // Getting 9504 (games) because 'die' semantically matches dice/game pieces
    patches.push({
      priority: 560,
      rule: {
        id: 'PAPER_DIECUT_CRAFT_INTENT',
        description: 'Paper die cuts for scrapbooking/crafting → ch.48 (4802.56). ' +
          '"Die cuts", "paper die cuts", "scrapbook die cut" → 4802.56. ' +
          'Without rule, semantic routes "die" to dice/games (9504) instead of paper craft.',
        pattern: {
          anyOf: [
            'die cuts', 'die cut', 'diecut', 'diecutting', 'die cutting',
            'paper die', 'paper die cuts', 'scrapbook die',
            'die cut paper', 'craft die cut', 'die cut shapes',
            'punch out', 'punch outs', 'paper punch out',
          ],
          noneOf: ['metal die', 'steel die', 'die press', 'die cast', 'die casting'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [
          { prefix: '4802.56', syntheticRank: 9 }, // Other paper in sheets
          { prefix: '4802.54', syntheticRank: 8 }, // Paper in rolls
          { prefix: '4820.10', syntheticRank: 7 }, // Books, notebooks for paper crafts
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4802.56' },
          { delta: 0.4, chapterMatch: '48' },
        ],
        penalties: [
          { delta: 0.8, prefixMatch: '9504' }, // Penalty for games/dice
        ],
      } as IntentRule,
    });

    // ── 5. FLOWER_BAG_PATTERN_FIX: add 'flower bag', 'floral bag' noneOf ───────
    // Even after removing 'flower'/'flowers', the rule may still have 'rose', 'lily' etc.
    // For product names like "Rose Gold Bag" → 'rose' fires FRESH_FLOWER_INTENT.
    // Add noneOf: 'rose gold' to prevent this common color name from triggering flower rules.
    {
      const existing = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = ['rose gold', 'rosegold', 'rose gold plated', 'rose gold tone',
          'rose wood', 'rosewood', 'lily pad', 'tiger lily seed', 'lily seed'].filter(t => !currentNoneOf.includes(t));
        if (toAdd.length > 0) {
          // Need to patch again since we already patched above — update the most recent patch
          const lastPatch = patches[patches.length - 1];
          // Actually patches[0] is FRESH_FLOWER_INTENT; update it
          const freshFlowerPatch = patches.find(p => (p.rule as any).id === 'FRESH_FLOWER_INTENT');
          if (freshFlowerPatch) {
            const fpat = freshFlowerPatch.rule.pattern as any;
            fpat.noneOf = [...(fpat.noneOf ?? []), ...toAdd];
            console.log(`FRESH_FLOWER_INTENT: also adding ${toAdd.length} noneOf terms`);
          }
        }
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch E2)...`);
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
    console.log(`\nPatch E2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
