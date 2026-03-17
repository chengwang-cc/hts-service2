#!/usr/bin/env ts-node
/**
 * Patch PPPP — 2026-03-13:
 *
 * Fix cross-chapter misfires in new 5025 entry eval:
 *
 * 1. WRISTWATCH_ANALOG_INTENT fires on 'watch' → "button cell watch battery" → ch.91
 *    'watch' alone fires rule → allowChapters=['91'] → watch accessories, not batteries
 *    Fix: add battery/cell context to noneOf
 *
 * 2. NEW OUTERWEAR_JACKET_GARMENT_INTENT
 *    "Black nylon male windbreaker" → 0710 cowpeas (no rule fires → semantic noise)
 *    windbreaker/parka/hoodie/sweatshirt have no intent rule → semantic mismatch
 *    Fix: positive rule → allowChapters=['61','62'] + inject 6101/6201 codes
 *
 * 3. ROTISSERIE_GRILL_PART_INTENT: add 'motor' to noneOf
 *    "Rotisserie bbq motor" → expected 8501 (electric motor), got 7322 (air heaters)
 *    Our ch.73 rule fires on 'rotisserie' even when the user wants the motor itself
 *    Fix: when 'motor' present with rotisserie → bypass grill rule → semantic finds ch.85
 *
 * 4. AI_CH91_POCKET_WATCH: remove 'vest' from anyOf (add 'pocket watch vest pocket' phrases)
 *    'vest' in anyOf fires pocket watch rule when 'vest' used alone as garment
 *    Currently has good noneOf protection but 'vest' alone still matches
 *    Fix: replace 'vest' with 'vest pocket' (phrase) to be more specific
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13pppp.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed PPPP: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. WRISTWATCH_ANALOG_INTENT: add battery context to noneOf ────────────
    // 'watch' in anyOf fires on "button cell watch battery" → allowChapters=['91']
    // When 'battery'/'cell' present, user wants ch.85 primary batteries, not ch.91 watches.
    addNoneOf('WRISTWATCH_ANALOG_INTENT', [
      'battery', 'batteries', 'button cell', 'coin cell', 'watch battery', 'cell battery',
      'lr44', 'sr44', 'cr2032', 'cr2016', 'cr2025', 'cr1620', 'ag13', 'ag3',
      'lithium battery', 'alkaline watch', 'watch charger', 'charger',
    ], 'battery/cell context prevents watch rule from misfiring on battery queries → ch.85');

    // ── 2. ROTISSERIE_GRILL_PART_INTENT: add motor to noneOf ─────────────────
    // "Rotisserie bbq motor" → expected 8501.20.20 (electric motor), got 7322.90 (air heater)
    // When 'motor' or 'electric motor' is explicitly in query, user wants ch.85 electric motor.
    addNoneOf('ROTISSERIE_GRILL_PART_INTENT', [
      'motor', 'electric motor', 'bbq motor', 'grill motor', 'spit motor',
    ], '"rotisserie motor" queries need ch.85 electric motors, not ch.73 grill accessories');

    // ── 3. AI_CH91_POCKET_WATCH: make 'vest' more specific ──────────────────
    // 'vest' alone in anyOf fires pocket watch rule for garment queries.
    // Although noneOf has 'polyester'/'cotton'/'nylon' etc., bare 'vest' queries
    // (e.g. "mesh vest", "safety vest" without other fabric words) still match.
    // Replace 'vest' with 'vest pocket' phrase.
    {
      const existing = allRules.find(r => r.id === 'AI_CH91_POCKET_WATCH') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = currentAnyOf
          .filter(t => t !== 'vest')
          .concat(['vest pocket', 'pocket watch vest'].filter(t => !currentAnyOf.includes(t)));
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH91_POCKET_WATCH') +
              ' — Fixed PPPP: replaced standalone "vest" with "vest pocket" phrase to avoid garment misfire.',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH91_POCKET_WATCH: replaced 'vest' with 'vest pocket' in anyOf`);
      } else {
        console.log('WARNING: AI_CH91_POCKET_WATCH not found');
      }
    }

    // ── 4. NEW OUTERWEAR_JACKET_GARMENT_INTENT ────────────────────────────────
    // "Black nylon male windbreaker" → ch.07 cowpeas (no rule fires → semantic noise)
    // "ski jacket", "rain jacket", "parka", "hoodie" have no intent rules.
    // Without chapter restriction, 'black' semantically matches 'cowpeas (other than black-eye peas)'.
    // Fix: positive rule → allowChapters=['61','62'] + inject common outerwear codes.
    patches.push({
      priority: 580,
      rule: {
        id: 'OUTERWEAR_JACKET_GARMENT_INTENT',
        description: 'Outerwear and jacket-type garments → ch.61/62 (6101/6201/6102/6202). ' +
          'Covers windbreakers, parkas, hoodies, sweatshirts, cardigans, trench coats. ' +
          'Previously EMPTY/wrong-chapter due to no semantic match (e.g. "Black nylon windbreaker"→ cowpeas).',
        pattern: {
          anyOf: [
            'windbreaker', 'wind breaker', 'windcheater', 'wind jacket',
            'parka', 'anorak', 'cagoule',
            'hoodie', 'hoodies', 'hooded sweatshirt', 'zip hoodie',
            'sweatshirt', 'sweatshirts', 'crewneck', 'crew neck sweatshirt',
            'cardigan', 'cardigans',
            'pullover', 'pullovers',
            'fleece jacket', 'fleece vest',
            'ski jacket', 'ski coat', 'snow jacket', 'snowsuit',
            'rain jacket', 'raincoat', 'rain coat', 'rain coat',
            'trench coat', 'trench',
            'puffer jacket', 'puffer coat', 'down jacket', 'down coat',
            'peacoat', 'pea coat', 'overcoat', 'topcoat', 'duster coat',
            'bomber jacket', 'bomber',
            'track jacket', 'track suit', 'tracksuit',
          ],
          noneOf: [
            // Exclude non-garment uses
            'fabric', 'bolt', 'yard', 'metre', 'meter', 'wholesale', 'roll',
            // Exclude literal 'trench' for military contexts
            'military trench', 'warfare', 'battlefield',
          ],
        },
        whitelist: { allowChapters: ['61', '62'] },
        inject: [
          { prefix: '6101.30.20', syntheticRank: 9 }, // Men's MMF overcoats, knit
          { prefix: '6101.20.00', syntheticRank: 8 }, // Men's cotton overcoats/anoraks, knit
          { prefix: '6102.30.10', syntheticRank: 8 }, // Women's MMF overcoats, knit
          { prefix: '6201.93.35', syntheticRank: 7 }, // Men's MMF windbreakers, woven
          { prefix: '6201.92.15', syntheticRank: 7 }, // Men's cotton anoraks/windbreakers, woven
          { prefix: '6110.30.30', syntheticRank: 6 }, // MMF sweaters/sweatshirts, knit
          { prefix: '6110.20.20', syntheticRank: 6 }, // Cotton sweaters/sweatshirts, knit
        ],
        boosts: [
          { delta: 0.35, prefixMatch: '6101' },
          { delta: 0.35, prefixMatch: '6201' },
          { delta: 0.3, prefixMatch: '6110' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch PPPP)...`);
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
    console.log(`\nPatch PPPP complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
