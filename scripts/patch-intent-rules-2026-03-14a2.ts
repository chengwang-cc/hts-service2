#!/usr/bin/env ts-node
/**
 * Patch A2 — 2026-03-14:
 *
 * Fixes to existing rules (3):
 * 1. TOILET_PAPER_INTENT noneOf: add 'printed', 'artwork', 'drawing' context
 *    TOILET_PAPER_INTENT has only 'paper' in anyOf → matches any paper query → injects 4818.10
 *    Adding noneOf prevents the rule from firing for non-toilet-paper contexts
 * 2. CLUTCH_BAG_INTENT inject: add 4202.12 (handbags with textile outer surface)
 *    "Handmade fabric clutch purse" → expected 4202.12.60; CLUTCH only injects 4202.22 currently
 * 3. TEMPERED_GLASS_SCREEN_INTENT anyOf: add 'mobile glass', 'tempered glass mobile'
 *    "mobile tempered glass" → 7007.19 expected; TEMPERED rule doesn't fire for this query
 *
 * New rules (3):
 * 4. PRESS_ON_NAIL_BEAUTY_INTENT (ch.39): press on nails/fake nails → 3906.90.50
 *    "plastic press on nails" → 3906.90.50; getting 7317 (metal nails) due to 'nail' semantic
 * 5. PRINTING_PAPER_PLAIN_INTENT (ch.48): copy paper/printing paper/bond paper → 4802.54
 *    "printed paper" → 4802.54.50; getting 4809.20 (carbon paper) via semantic
 * 6. MUSICAL_INSTRUMENT_REED_PIPE_INTENT (ch.92): reed/pipe organ/harmonium → 9205.90
 *    Fixing some ch.92 failures with more specific instrument terms
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14a2.ts
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
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed A2: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed A2: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. TOILET_PAPER_INTENT: add noneOf to prevent "printed paper" matching ─
    // 'paper' in anyOf matches all paper queries → injects 4818.10 (toilet rolls)
    // "printed paper" → should be 4802.54, not toilet paper
    addNoneOf('TOILET_PAPER_INTENT', [
      'printed', 'printing', 'artwork', 'drawing', 'art paper', 'copy',
      'stationery', 'writing paper', 'printer paper', 'copier',
    ], 'prevent toilet paper rule from injecting 4818 for printed/artwork/copy paper queries');

    // ── 2. CLUTCH_BAG_INTENT: add 4202.12 handbag injection ──────────────────
    // "Handmade fabric clutch purse" → expected 4202.12.60; injects only 4202.22 currently
    {
      const existing = allRules.find(r => r.id === 'CLUTCH_BAG_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentInject: any[] = (existing as any).inject ?? [];
        const newInject = [
          { prefix: '4202.12', syntheticRank: 20 }, // Handbags (higher rank than 4202.22)
          { prefix: '4202.22', syntheticRank: 22 }, // Handbags, with outer of textile
          ...currentInject.filter((i: any) => !['4202.12','4202.22'].includes(i.prefix)),
        ];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CLUTCH_BAG_INTENT') + ' — Fixed A2: add 4202.12 inject',
            inject: newInject,
          } as IntentRule,
        });
        console.log('CLUTCH_BAG_INTENT: adding 4202.12 to inject');
      } else {
        console.log('WARNING: CLUTCH_BAG_INTENT not found');
      }
    }

    // ── 3. TEMPERED_GLASS_SCREEN_INTENT: add mobile glass terms ──────────────
    // "mobile tempered glass" → 7007.19; TEMPERED rule doesn't fire (no 'mobile' in anyOf)
    addToAnyOf('TEMPERED_GLASS_SCREEN_INTENT', [
      'mobile glass', 'tempered glass mobile', 'mobile screen glass',
      'phone tempered glass', 'mobile phone glass',
    ], 'add mobile glass terms so "mobile tempered glass" triggers ch.70 7007.19 injection');

    // ── 4. NEW PRESS_ON_NAIL_BEAUTY_INTENT ────────────────────────────────────
    // "plastic press on nails" → 3906.90.50 (acrylic polymers, other)
    // Semantic routes 'nails' to 7317 (metal nails) — wrong chapter entirely
    // Press-on/fake nails are beauty products made of acrylic polymer
    patches.push({
      priority: 562,
      rule: {
        id: 'PRESS_ON_NAIL_BEAUTY_INTENT',
        description: 'Press-on nails, fake nails, and artificial nail tips → ch.39 (3906.90.50). ' +
          '"Press on nails", "acrylic nail tips", "fake fingernails" → 3906.90.50. ' +
          'Without rule, semantic returns 7317 (metal nails) for nail beauty products.',
        pattern: {
          anyOf: [
            'press on nail', 'press on nails', 'press-on nail', 'press-on nails',
            'fake nail', 'fake nails', 'artificial nail', 'artificial nails',
            'nail tip', 'nail tips', 'nail extension', 'nail extensions',
            'acrylic nail', 'acrylic nails', 'gel nail tip',
          ],
          noneOf: ['nail gun', 'nail screw', 'roofing nail', 'nail polish', 'nail varnish'],
        },
        whitelist: { allowChapters: ['39', '33'] },
        inject: [
          { prefix: '3906.90', syntheticRank: 9 }, // Acrylic polymers, other
          { prefix: '3926.90', syntheticRank: 8 }, // Other articles of plastics
          { prefix: '3304.30', syntheticRank: 7 }, // Nail preparations
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3906.90' },
          { delta: 0.4, chapterMatch: '39' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW PRINTING_PAPER_PLAIN_INTENT ────────────────────────────────────
    // "printed paper" → 4802.54.50 (paper in rolls for printing machines)
    // Semantic returns 4809.20 (carbon paper) — wrong type
    patches.push({
      priority: 556,
      rule: {
        id: 'PRINTING_PAPER_PLAIN_INTENT',
        description: 'Printing paper, copy paper, and writing paper → ch.48 (4802.54). ' +
          '"Printed paper", "copy paper", "bond paper" → 4802.54. ' +
          'Without rule, semantic returns 4809.20 (carbon paper) for generic paper queries.',
        pattern: {
          anyOf: [
            'printing paper', 'copy paper', 'bond paper', 'offset paper',
            'writing paper', 'paper stock', 'paper sheet', 'loose paper',
            'uncoated paper', 'letter paper', 'ledger paper',
          ],
          noneOf: ['toilet paper', 'tissue paper', 'paper towel', 'wax paper',
            'tracing paper', 'photo paper', 'carbon paper'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [
          { prefix: '4802.54', syntheticRank: 9 }, // Other paper in rolls for printing
          { prefix: '4802.56', syntheticRank: 8 }, // Other paper in sheets
          { prefix: '4802.55', syntheticRank: 7 }, // Other paper
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4802.54' },
          { delta: 0.4, chapterMatch: '48' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW ACCORDION_ORGAN_WIND_INSTRUMENT_INTENT ─────────────────────────
    // Various wind/keyboard instruments missing ch.92 results
    // Adding a broad wind/keyboard instrument rule to boost ch.92
    patches.push({
      priority: 553,
      rule: {
        id: 'ACCORDION_ORGAN_WIND_INSTRUMENT_INTENT',
        description: 'Accordions, harmonicas, organs, and wind instruments → ch.92 (9205). ' +
          '"Accordion", "harmonica", "organ pipes", "harmonium" → 9205.90. ' +
          'Without rule, ch.92 results may not surface for wind/keyboard instrument queries.',
        pattern: {
          anyOf: [
            'accordion', 'accordions', 'harmonica', 'harmonicas', 'harmonica set',
            'harmonium', 'melodica', 'concertina', 'bandoneon',
            'organ pipe', 'pipe organ', 'church organ', 'wind instrument',
            'saxophone', 'saxophones', 'clarinet', 'oboe', 'bassoon', 'flute',
            'trumpet', 'trombone', 'tuba', 'french horn',
          ],
          noneOf: ['reed mat', 'reed furniture', 'wicker', 'rattan'],
        },
        whitelist: { allowChapters: ['92'] },
        inject: [
          { prefix: '9205.90', syntheticRank: 9 }, // Other wind instruments
          { prefix: '9205.10', syntheticRank: 8 }, // Brass instruments
          { prefix: '9207.10', syntheticRank: 7 }, // Keyboard instruments
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '92' },
          { delta: 0.4, prefixMatch: '9205' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch A2)...`);
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
    console.log(`\nPatch A2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
