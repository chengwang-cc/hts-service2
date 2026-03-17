#!/usr/bin/env ts-node
/**
 * Patch UUUU — 2026-03-14:
 *
 * noneOf fixes (2 rules):
 * 1. AI_CH19_PASTRY_CAKE: add styrofoam/faux/foam context
 *    "Faux decorated cake styrofoam" → ch.39 (3903.19) blocked by 'cake' in anyOf → ch.19
 * 2. AI_CH45_CORK_MISC_ARTICLES: add plastic/hdpe context
 *    "High-Density Polyethylene (HDPE) Plastic Block" → ch.39 (3901.10) blocked by 'block' in anyOf → ch.45
 *
 * New rules (4):
 * 3. PAPER_BANNER_PENNANT_INTENT (ch.48): paper banner/party banner/pennant → 4802.56
 *    "bridal party banner" → 4802.56.70; no rules fire → gets ch.63 textile
 * 4. GLASS_FLAT_SHEET_BUILD_INTENT (ch.70): glass build surface/3D printer glass bed → 7005.29
 *    "310x310mm Glass Build Surface | 3D Printer Glass Bed" → 7005.29; gets ch.69 ceramic
 * 5. SILVER_BULLION_SCRAP_INTENT (ch.71): silver shavings/bullion/scrap → 7106.10
 *    "Genuine Sterling silver .925 shavings" → 7106.10; gets 7114.11 (silverware)
 * 6. POLYSTYRENE_PLASTIC_RAW_INTENT (ch.39): styrofoam/polystyrene/HDPE block → 3903.19 / 3901.10
 *    Unblocked by fixes #1-2; need positive injection to surface ch.39 codes
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14uuuu.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed UUUU: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH19_PASTRY_CAKE: 'cake' fires for foam/faux/styrofoam cakes ─────
    // "Faux decorated cake styrofoam" → 3903.19 (polystyrene) expected
    // 'cake' in anyOf → ch.19 whitelist blocks ch.39 polystyrene result
    addNoneOf('AI_CH19_PASTRY_CAKE', [
      'styrofoam', 'styrofoam cake', 'faux cake', 'fake cake', 'foam cake',
      'decorative cake', 'prop cake', 'display cake', 'foam prop',
      'polystyrene cake', 'dummy cake', 'artificial cake', 'craft foam',
    ], 'styrofoam/faux context prevents pastry rule from blocking ch.39 foam/decorative cake props');

    // ── 2. AI_CH45_CORK_MISC_ARTICLES: 'block' fires for plastic/HDPE blocks ──
    // "High-Density Polyethylene (HDPE) Plastic Block, 2\" x 6\" x 6\"" → 3901.10
    // 'block' in anyOf → ch.45 whitelist blocks ch.39 polyethylene result
    addNoneOf('AI_CH45_CORK_MISC_ARTICLES', [
      'plastic block', 'hdpe', 'polyethylene', 'polypropylene', 'foam block',
      'acrylic block', 'rubber block', 'nylon block', 'delrin', 'plastic sheet',
      'polystyrene', 'abs block', 'pvc block',
    ], 'plastic/hdpe context prevents cork articles rule from blocking ch.39 plastic block materials');

    // ── 3. NEW PAPER_BANNER_PENNANT_INTENT ────────────────────────────────────
    // "bridal party banner" → 4802.56.70 (paper in sheets/rolls for banners)
    // "happy birthday banner" "paper pennant" → ch.48
    // No rules fire → semantic returns ch.63 (textile) or wrong chapter
    patches.push({
      priority: 556,
      rule: {
        id: 'PAPER_BANNER_PENNANT_INTENT',
        description: 'Paper banners, pennants, and party paper decorations → ch.48 (4802.56). ' +
          '"Party banner", "bridal banner", "paper pennant", "birthday banner" → 4802.56. ' +
          'Without rule, semantic returns ch.63 textile for paper banner queries.',
        pattern: {
          anyOf: [
            'paper banner', 'party banner', 'pennant', 'pennants', 'paper pennant',
            'bunting banner', 'birthday banner', 'bridal banner', 'wedding banner',
            'banner paper', 'paper garland', 'paper flag', 'paper flags',
            'paper streamer', 'streamer paper',
          ],
          noneOf: ['vinyl banner', 'fabric banner', 'plastic banner', 'canvas banner',
            'vinyl', 'nylon flag', 'polyester flag'],
        },
        whitelist: { allowChapters: ['48', '49'] },
        inject: [
          { prefix: '4802.56', syntheticRank: 9 }, // Paper in sheets for printing/writing
          { prefix: '4802.55', syntheticRank: 8 }, // Other paper in sheets
          { prefix: '4823.90', syntheticRank: 7 }, // Other paper/paperboard articles
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4802.56' },
          { delta: 0.4, chapterMatch: '48' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW GLASS_FLAT_SHEET_BUILD_INTENT ──────────────────────────────────
    // "310x310mm Glass Build Surface | 3D Printer Glass Bed" → 7005.29 (float glass)
    // Semantic routes to ch.69 (ceramic) or wrong chapter
    // PRINTER_INTENT fires but injects ch.84; need ch.70 float glass injection
    patches.push({
      priority: 566,
      rule: {
        id: 'GLASS_FLAT_SHEET_BUILD_INTENT',
        description: 'Float glass sheets, glass build surfaces, and flat glass panels → ch.70 (7005.29). ' +
          '"3D printer glass bed", "glass build surface", "borosilicate glass bed" → 7005.29. ' +
          'Without rule, semantic returns ch.69 ceramic or ch.84 for glass flat surfaces.',
        pattern: {
          anyOf: [
            'glass build surface', 'glass bed', 'printer glass bed', '3d printer glass',
            'borosilicate glass bed', 'glass print surface', 'glass print bed',
            'float glass sheet', 'float glass', 'glass plate flat', 'mirror glass',
            'glass flat', 'glass panel flat',
          ],
          noneOf: ['plastic', 'pei', 'spring steel', 'magnetic', 'build plate'],
        },
        whitelist: { allowChapters: ['70'] },
        inject: [
          { prefix: '7005.29', syntheticRank: 9 }, // Float glass and surface-ground glass, non-wired, other
          { prefix: '7005.10', syntheticRank: 8 }, // Non-wired glass with absorbent/reflecting layer
          { prefix: '7007.19', syntheticRank: 7 }, // Safety toughened/tempered glass
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7005.29' },
          { delta: 0.4, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW SILVER_BULLION_SCRAP_INTENT ───────────────────────────────────
    // "Genuine Sterling silver .925 shavings" → 7106.10 (silver powder)
    // "silver shavings", "silver granules", "silver scrap" → ch.71
    // Semantic returns 7114.11 (silverware) instead of 7106.10 (unwrought/powder)
    patches.push({
      priority: 557,
      rule: {
        id: 'SILVER_BULLION_SCRAP_INTENT',
        description: 'Silver powder, shavings, granules and unwrought silver → ch.71 (7106.10). ' +
          '"Sterling silver shavings", "silver granules", "silver powder" → 7106.10. ' +
          'Without rule, semantic returns 7114 (silverware) instead of 7106 (unwrought silver).',
        pattern: {
          anyOf: [
            'silver shavings', 'silver powder', 'silver granules', 'silver scrap',
            'silver bullion', 'silver flakes', 'silver dust', 'silver filings',
            'silver chips', 'sterling shavings', 'sterling silver powder',
            'fine silver', 'silver shot', 'silver grain',
          ],
          noneOf: ['necklace', 'bracelet', 'ring', 'earring', 'pendant', 'jewelry',
            'silverware', 'cutlery', 'tableware'],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7106.10', syntheticRank: 9 }, // Silver in powder form
          { prefix: '7106.91', syntheticRank: 8 }, // Unwrought silver, other
          { prefix: '7106.92', syntheticRank: 7 }, // Semi-manufactured silver
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7106' },
          { delta: 0.4, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW POLYSTYRENE_FOAM_RAW_INTENT ───────────────────────────────────
    // "Faux decorated cake styrofoam" → 3903.19 (polystyrene, other)
    // "HDPE Plastic Block" → 3901.10 (polyethylene, ≤0.94 density)
    // Unblocked by UUUU fixes #1-2, need positive injection to surface ch.39 codes
    patches.push({
      priority: 547,
      rule: {
        id: 'POLYSTYRENE_FOAM_RAW_INTENT',
        description: 'Styrofoam, polystyrene and raw plastic materials → ch.39 (3903.19/3901.10). ' +
          '"Styrofoam block", "polystyrene foam", "HDPE plastic" → 3903.19 or 3901.10. ' +
          'Without rule, no ch.39 results surface for raw plastic/foam material queries.',
        pattern: {
          anyOf: [
            'styrofoam', 'polystyrene', 'foam block', 'foam ball', 'foam sheet',
            'eps foam', 'expanded polystyrene', 'polystyrene block', 'foam wreath',
            'hdpe', 'polyethylene block', 'polypropylene block', 'plastic block',
            'delrin block', 'abs plastic block', 'nylon block',
          ],
          noneOf: ['memory foam', 'latex foam', 'mattress foam', 'cushion foam',
            'polyurethane foam', 'seat cushion', 'upholstery foam'],
        },
        whitelist: { allowChapters: ['39'] },
        inject: [
          { prefix: '3903.19', syntheticRank: 9 }, // Polystyrene, other
          { prefix: '3901.10', syntheticRank: 8 }, // Polyethylene, ≤0.94 density
          { prefix: '3901.20', syntheticRank: 7 }, // Polyethylene, >0.94 density
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3903.19' },
          { delta: 0.4, chapterMatch: '39' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch UUUU)...`);
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
    console.log(`\nPatch UUUU complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
