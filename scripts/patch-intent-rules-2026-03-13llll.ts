#!/usr/bin/env ts-node
/**
 * Patch LLLL — 2026-03-13:
 *
 * Fix KKKK regression: KKKK added overly-broad noneOf terms that caused
 * original 700-entry eval to drop from ~99% to 81.1% (68 EMPTY added).
 *
 * Overly-broad terms added in KKKK:
 *  - AI_CH54_RAYON_FABRIC: 'women', 'womens', "women's", 'men', 'mens', "men's",
 *    'girls', 'boys', 'knitted', 'woven garment', 'wearing', 'wearable', 'tops'
 *    → These prevent ch.54 from suppressing its allowChapters properly for
 *      queries that genuinely include those words WITH rayon/viscose intent
 *    → Too broad: causes unrelated rules to produce wrong allowSets → EMPTY
 *  - AI_CH51_RAW_WOOL: 'hat', 'beanie', 'beret', 'toque', 'headband', 'headbands'
 *    → 'hat' is used in many other contexts (too ambiguous); hat queries now
 *      bypass the wool rule → other rules fire → wrong chapter
 *  - AI_CH56_TWINE_BALER: 'hat', 'socks', 'gloves', 'women', 'men', "men's",
 *    'girls', 'boys', 'kids' → too broad
 *
 * Additionally fixes:
 *  4. AI_CH36_MATCHES: Remove standalone 'safety' from anyOf
 *     "Hi Vis Safety Vest" → 'safety' fires matches rule → allowChapters=['36'] → EMPTY
 *     Fix: Replace 'safety' with 'safety match', 'safety matches'
 *
 *  5. AI_CH65_DISPOSABLE_CAP: Add cymbal/hi-hat terms to noneOf
 *     "hi hat cymbal" → 'hat' fires disposable cap rule → allowChapters=['65']
 *     which overrides cymbal routing → ch.65 (hats) instead of ch.92
 *     Fix: Add cymbal terms to noneOf so the cap rule doesn't fire on cymbal queries
 *
 * Strategy: upsert each rule with current DB state minus the bad KKKK additions.
 * We read the current rule and REMOVE the specific overly-broad terms.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13llll.ts
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

    function removeNoneOf(ruleId: string, toRemove: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const removeSet = new Set(toRemove);
      const newNoneOf = currentNoneOf.filter(t => !removeSet.has(t));
      const removed = currentNoneOf.filter(t => removeSet.has(t));
      patches.push({
        priority: 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed LLLL: ${note}`,
          pattern: { ...pat, noneOf: newNoneOf },
        },
      });
      console.log(`${ruleId}: removed ${removed.length} overly-broad noneOf terms: [${removed.join(', ')}]`);
    }

    // ── 1. AI_CH54_RAYON_FABRIC: remove overly-broad gender/demographic/fabric terms ─
    // KKKK added 'women', 'mens', 'girls', 'boys', 'knitted', 'wearing', 'wearable', 'tops'
    // These are too broad — they fire on unrelated product queries causing wrong allowSets.
    // Keep specific garment-type words (blouse, dress, skirt, shirt, jacket, coat, etc.)
    removeNoneOf('AI_CH54_RAYON_FABRIC', [
      'women', 'womens', "women's", 'men', 'mens', "men's", 'girls', 'boys',
      'knitted', 'woven garment', 'wearing', 'wearable',
    ], 'removed overly-broad gender/demographic terms added in KKKK that caused EMPTY regression');

    // ── 2. AI_CH51_RAW_WOOL: remove ambiguous headwear tokens ────────────────
    // KKKK added 'hat', 'beanie', 'beret', 'toque', 'headband', 'headbands'
    // 'hat' is too generic — causes hat queries where wool rule doesn't fire → EMPTY
    // Remove ambiguous single tokens; keep specific compound terms if any
    removeNoneOf('AI_CH51_RAW_WOOL', [
      'hat', 'beanie', 'beret', 'toque', 'headband', 'headbands', 'wrap',
    ], 'removed ambiguous headwear tokens added in KKKK (hat/beanie/toque too generic → EMPTY)');

    // ── 3. AI_CH56_TWINE_BALER: remove broad demographic and accessory tokens ─
    // KKKK added 'hat', 'socks', 'gloves', 'women', 'men', "men's", 'girls', 'boys', 'kids'
    // These are too broad — prevent the rule from properly scoping allowChapters
    removeNoneOf('AI_CH56_TWINE_BALER', [
      'hat', 'socks', 'gloves', 'women', 'mens', "men's", 'girls', 'boys', 'kids', 'men', "women's", 'womens',
    ], 'removed overly-broad demographic/accessory noneOf added in KKKK');

    // ── 4. AI_CH36_MATCHES: replace standalone 'safety' with phrase ───────────
    // 'safety' alone in anyOf causes "Hi Vis Safety Vest" → allowChapters=['36'] → EMPTY
    // Fix: remove 'safety' from anyOf, add specific phrases 'safety match', 'safety matches'
    {
      const existing = allRules.find(r => r.id === 'AI_CH36_MATCHES') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = currentAnyOf
          .filter(t => t !== 'safety')
          .concat(['safety match', 'safety matches'].filter(t => !currentAnyOf.includes(t)));
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH36_MATCHES') +
              ' — Fixed LLLL: removed standalone "safety" (was firing on "Hi Vis Safety Vest" → ch.36 matches). ' +
              'Replaced with "safety match" / "safety matches" phrases.',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH36_MATCHES: removed standalone 'safety', added 'safety match'/'safety matches'`);
      } else {
        console.log('WARNING: AI_CH36_MATCHES not found');
      }
    }

    // ── 5. AI_CH65_DISPOSABLE_CAP: add cymbal/hihat to noneOf ────────────────
    // "hi hat cymbal" → KKKK removed 'hat' from AI_CH92_CYMBAL anyOf (correct fix)
    // BUT AI_CH65_DISPOSABLE_CAP still has 'hat' in anyOf → fires → allowChapters=['65']
    // → result is ch.65 (hats) instead of ch.92 (cymbals)
    // Fix: add cymbal/percussion terms to noneOf of the cap rule so it doesn't fire
    {
      const existing = allRules.find(r => r.id === 'AI_CH65_DISPOSABLE_CAP') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'cymbal', 'cymbals', 'hi hat', 'hi-hat', 'hihat', 'hi hat cymbal',
          'crash cymbal', 'ride cymbal', 'percussion', 'drum', 'drums',
        ];
        const newNoneOf = [...currentNoneOf, ...toAdd.filter(t => !currentNoneOf.includes(t))];
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH65_DISPOSABLE_CAP') +
              ' — Fixed LLLL: cymbal/percussion terms in noneOf prevent "hi hat cymbal" routing to ch.65 hats.',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH65_DISPOSABLE_CAP: added cymbal/hihat/percussion terms to noneOf`);
      } else {
        console.log('WARNING: AI_CH65_DISPOSABLE_CAP not found');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch LLLL)...`);
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
    console.log(`\nPatch LLLL complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
