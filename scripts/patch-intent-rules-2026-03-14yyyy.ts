#!/usr/bin/env ts-node
/**
 * Patch YYYY — 2026-03-14:
 *
 * Bug fixes to existing rules (2):
 * 1. GLASS_FLAT_SHEET_BUILD_INTENT noneOf: remove 'build plate' — it prevents the rule from
 *    firing for "310x310mm Glass Build Surface | 3D Printer Glass Bed | Smooth Build Plate"
 *    because 'build plate' IS in the query (it's a glass build plate!).
 *    Add 'glass build plate' to anyOf instead to explicitly match glass build plates.
 * 2. ELECTRIC_MOTOR_ACTUATOR_INTENT noneOf: remove 'linear actuator' — many legitimate
 *    actuators are rotary (HVAC damper), but we're blocking too broadly. The linear actuator
 *    noneOf blocks e.g. "motorized linear actuator" which expects ch.85 8501.10.
 *
 * New rules (3):
 * 3. PROFIBUS_FIELD_INSTRUMENT_INTENT (ch.90): Profibus analyzers, fieldbus instruments → 9026.20
 *    "Procentec ProfitraceV2.9.7" → EMPTY result; Profibus = industrial fieldbus diagnostic tool
 * 4. TRADING_CARD_COLLECTIBLE_INTENT (ch.95): Pokemon/TCG/graded cards → 9504.40
 *    "Umbreon VMAX Evolving Skies Auraslab (Graded)" → ch.76 (aluminum slab!); ch.95 correct
 * 5. WOODWORKING_LUMBER_INTENT (ch.44): sawn lumber/plank/wood board → 4407.xx
 *    "Wood art", "wood colour samples" → 4407.19/4407.93; getting 4420 (wood ornaments)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14yyyy.ts
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

    // ── 1. Fix GLASS_FLAT_SHEET_BUILD_INTENT: remove 'build plate' from noneOf ─
    // Full query: "310x310mm Glass Build Surface | 3D Printer Glass Bed | Smooth Build Plate"
    // 'build plate' is in noneOf → rule doesn't fire for the actual query!
    // Fix: remove 'build plate' from noneOf + add 'glass build plate' to anyOf
    {
      const existing = allRules.find(r => r.id === 'GLASS_FLAT_SHEET_BUILD_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = (pat.noneOf ?? []).filter((t: string) => t !== 'build plate');
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = [...currentAnyOf, ...['glass build plate', 'borosilicate bed', 'glass print bed', 'glass bed surface'].filter(t => !currentAnyOf.includes(t))];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'GLASS_FLAT_SHEET_BUILD_INTENT') + ' — Fixed YYYY: remove build plate from noneOf + add glass build plate to anyOf',
            pattern: { ...pat, anyOf: newAnyOf, noneOf: currentNoneOf },
          },
        });
        console.log('GLASS_FLAT_SHEET_BUILD_INTENT: removed build plate from noneOf, added glass build plate to anyOf');
      } else {
        console.log('WARNING: GLASS_FLAT_SHEET_BUILD_INTENT not found');
      }
    }

    // ── 2. Fix ELECTRIC_MOTOR_ACTUATOR_INTENT noneOf ──────────────────────────
    // 'linear actuator' in noneOf is too broad - many actuators ARE linear but expected 8501
    // Keep 'pneumatic actuator' and 'hydraulic actuator' as those are not electric motors
    {
      const existing = allRules.find(r => r.id === 'ELECTRIC_MOTOR_ACTUATOR_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = (pat.noneOf ?? []).filter((t: string) => t !== 'linear actuator' && t !== 'valve actuator');
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'ELECTRIC_MOTOR_ACTUATOR_INTENT') + ' — Fixed YYYY: remove linear actuator from noneOf',
            pattern: { ...pat, noneOf: currentNoneOf },
          },
        });
        console.log('ELECTRIC_MOTOR_ACTUATOR_INTENT: removed linear actuator from noneOf');
      } else {
        console.log('WARNING: ELECTRIC_MOTOR_ACTUATOR_INTENT not found');
      }
    }

    // ── 3. NEW PROFIBUS_FIELD_INSTRUMENT_INTENT ───────────────────────────────
    // "Procentec ProfitraceV2.9.7" → ch.90 (9026.20 or 9030.xx measurement instruments)
    // ProfiTrace = Profibus field diagnostic/monitoring device
    // EMPTY result - no rules fire
    patches.push({
      priority: 551,
      rule: {
        id: 'PROFIBUS_FIELD_INSTRUMENT_INTENT',
        description: 'Profibus network analyzers and industrial fieldbus instruments → ch.90 (9030.39). ' +
          '"ProfiTrace", "Profibus analyzer", "fieldbus diagnostic" → 9030.39. ' +
          'Without rule, EMPTY result for industrial network diagnostic tool queries.',
        pattern: {
          anyOf: [
            'profibus', 'profitrace', 'procentec', 'fieldbus', 'profinet',
            'network analyzer', 'bus analyzer', 'protocol analyzer',
            'industrial analyzer', 'plc analyzer', 'scada instrument',
          ],
          noneOf: ['wifi analyzer', 'spectrum analyzer', 'network cable tester'],
        },
        whitelist: { allowChapters: ['90', '85'] },
        inject: [
          { prefix: '9030.39', syntheticRank: 22 }, // Instruments for measuring electrical quantities
          { prefix: '9030.82', syntheticRank: 20 }, // Other instruments for measuring
          { prefix: '9026.20', syntheticRank: 18 }, // Instruments for measuring pressure
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '90' },
          { delta: 0.4, prefixMatch: '9030' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW TRADING_CARD_COLLECTIBLE_INTENT ────────────────────────────────
    // "Umbreon VMAX 215/203 | Evolving Skies Auraslab (Graded)" → ch.95 (9504.40)
    // Getting ch.76 (aluminum) because "slab" (graded card case) triggers aluminum?
    // Graded trading cards in protective slabs → ch.95 (games, puzzles, sports equipment)
    patches.push({
      priority: 565,
      rule: {
        id: 'TRADING_CARD_COLLECTIBLE_INTENT',
        description: 'Trading cards, collectible cards, graded cards → ch.95 (9504.40). ' +
          '"Pokemon card graded", "TCG card", "Auraslab graded" → 9504.40. ' +
          'Without rule, semantic returns ch.76 (aluminum slab) for graded card queries.',
        pattern: {
          anyOf: [
            'trading card', 'trading cards', 'pokemon card', 'pokemon cards',
            'graded card', 'tcg', 'magic the gathering', 'mtg card', 'yugioh card',
            'auraslab', 'psa graded', 'bgs graded', 'cgc graded',
            'evolving skies', 'card slab', 'graded slab', 'card collection',
            'sports card', 'baseball card', 'basketball card',
          ],
          noneOf: ['aluminum slab', 'metal slab', 'concrete slab', 'wood slab'],
        },
        whitelist: { allowChapters: ['95', '49'] },
        inject: [
          { prefix: '9504.40', syntheticRank: 22 }, // Playing cards
          { prefix: '4901.99', syntheticRank: 20 }, // Other printed books/brochures
          { prefix: '9504.50', syntheticRank: 18 }, // Video game consoles and machines
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9504.40' },
          { delta: 0.4, chapterMatch: '95' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW WOODWORKING_LUMBER_SAWN_INTENT ─────────────────────────────────
    // "Wood art" → 4407.19 (sawn wood) expected; getting 4420.11 (wood ornaments)
    // "wood colour samples" → 4407.93; getting 4412.33 (plywood)
    // Both should be sawn/roughed wood (4407) not finished wood products (4420/4412)
    patches.push({
      priority: 547,
      rule: {
        id: 'WOODWORKING_LUMBER_SAWN_INTENT',
        description: 'Sawn lumber, wood planks, and raw wood materials → ch.44 (4407.xx). ' +
          '"Wood art", "wood sample", "sawn wood", "wood plank" → 4407.19. ' +
          'Without rule, semantic returns 4420 (ornaments) or 4412 (plywood) for raw wood queries.',
        pattern: {
          anyOf: [
            'wood sample', 'wood samples', 'wood colour sample', 'wood color sample',
            'lumber', 'plank', 'planks', 'wood plank', 'wood board', 'sawn wood',
            'rough lumber', 'dimensional lumber', 'wood slab', 'live edge',
            'hardwood board', 'softwood board', 'wood strip', 'wood strips',
          ],
          noneOf: ['decking', 'flooring', 'parquet', 'laminate', 'mdf'],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [
          { prefix: '4407.19', syntheticRank: 22 }, // Other sawn wood (tropical)
          { prefix: '4407.93', syntheticRank: 20 }, // Alder sawn wood
          { prefix: '4407.10', syntheticRank: 18 }, // Coniferous sawn wood
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4407' },
          { delta: 0.4, chapterMatch: '44' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch YYYY)...`);
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
    console.log(`\nPatch YYYY complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
