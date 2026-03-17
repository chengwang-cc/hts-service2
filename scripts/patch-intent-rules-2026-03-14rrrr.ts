#!/usr/bin/env ts-node
/**
 * Patch RRRR — 2026-03-14:
 *
 * noneOf fixes (6 rules):
 * 1. AI_CH02_OFFAL: add quartz/crystal/gemstone context ('heart' fires for "heart shaped quartz")
 * 2. JEWELRY_NECKLACE_INTENT: add pet necklace context (noneOf is empty → blocks ch.42 pet necklaces)
 * 3. AI_CH40_RUBBER_TIRES: add tire blanket/warmer context (blocks ch.63 tire heating blankets)
 * 4. AI_CH40_PNEUMATIC_TIRES: same
 * 5. AI_CH45_CORK_MISC_ARTICLES: add sticker/decal context ('sheet' fires for sticker sheets → blocks ch.48)
 * 6. AI_CH75_NICKEL_SHEET_PLATE_FOIL: add sticker/decal context ('sheet' fires for sticker sheets)
 *
 * New rules (5):
 * 7. HANDMADE_WASHI_PAPER_INTENT (ch.48): washi/chiyogami/handmade paper → 4802.10
 *    "Washi Origami Paper" → 4802.10; system returns wrong 4802.56 sub-code
 * 8. TIRE_WARMER_BLANKET_INTENT (ch.63): tire blanket/tire warmer → 6301.10
 *    "motorcycle tire blamket" → 6301.10; blocked by AI_CH40 tire rules
 * 9. SEMI_PRECIOUS_STONE_MARBLE_INTENT (ch.71): semi precious marble/gemstone marble → 7104.29
 *    "semi precious marble" → 7104.29; no rules fire, gets wrong ch
 * 10. FILM_CANISTER_CAMERA_CASE_INTENT (ch.42): film container/film canister → 4202.12
 *    "135mm Film Container" → 4202.12; semantic routes to 8609 shipping containers
 * 11. STICKER_SHEET_PAPER_INTENT (ch.48): sticker sheet/deco sheet → 4802.55
 *    "Deco Sticker Sheet" → blocked by AI_CH45 (sheet) and AI_CH75 (sheet); expects 4802.55
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14rrrr.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed RRRR: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH02_OFFAL: 'heart' fires for "heart shaped quartz" (ch.71) ─────────
    addNoneOf('AI_CH02_OFFAL', [
      'quartz', 'crystal', 'gemstone', 'gem', 'mineral', 'amethyst', 'tourmaline',
      'opal', 'sapphire', 'ruby', 'emerald', 'jade', 'citrine', 'fluorite', 'shaped',
      'carved', 'stone carving', 'heart shaped', 'crystal heart',
    ], 'quartz/crystal/gemstone context prevents offal rule from blocking ch.71 heart-shaped gemstones');

    // ── 2. JEWELRY_NECKLACE_INTENT: noneOf is empty, blocks "1 Ring Leather Pet Necklace" ─
    // Expected 4201.00.30 (dog equipment), but rule forces allowChapters:['71'] → blocks ch.42
    addNoneOf('JEWELRY_NECKLACE_INTENT', [
      'pet necklace', 'dog necklace', 'cat necklace', 'leather pet', 'animal necklace',
      'pet collar', 'dog collar', 'cat collar',
    ], 'pet necklace context prevents jewelry necklace rule from blocking ch.42 pet equipment');

    // ── 3-4. Tire rules: 'tire' fires for "motorcycle tire blamket" (ch.63) ─────────
    const tireBlanketTerms = [
      'tire blanket', 'tire warmer', 'tire warming', 'tyre blanket', 'tyre warmer',
      'tire heating', 'blanket', 'blamket', 'heating pad', 'race tire warmer',
    ];
    addNoneOf('AI_CH40_RUBBER_TIRES', tireBlanketTerms,
      'tire blanket/warmer context prevents rubber tire rule from blocking ch.63 tire warming blankets');
    addNoneOf('AI_CH40_PNEUMATIC_TIRES', tireBlanketTerms,
      'tire blanket/warmer context prevents pneumatic tire rule from blocking ch.63 tire warming blankets');

    // ── 5. AI_CH45_CORK_MISC_ARTICLES: 'sheet' fires for sticker sheets (ch.48) ──
    addNoneOf('AI_CH45_CORK_MISC_ARTICLES', [
      'sticker', 'sticker sheet', 'sticker sheets', 'decal', 'decals', 'deco sheet',
      'vinyl sticker', 'die cut sticker', 'label sheet', 'holographic sticker',
    ], 'sticker/decal context prevents cork articles rule from blocking ch.48 sticker sheet paper');

    // ── 6. AI_CH75_NICKEL_SHEET_PLATE_FOIL: 'sheet' fires for sticker sheets ─────
    addNoneOf('AI_CH75_NICKEL_SHEET_PLATE_FOIL', [
      'sticker', 'sticker sheet', 'sticker sheets', 'decal', 'decals', 'deco sheet',
      'vinyl sticker', 'die cut sticker', 'label sheet',
    ], 'sticker/decal context prevents nickel sheet rule from blocking ch.48 sticker sheet paper');

    // ── 7. NEW HANDMADE_WASHI_PAPER_INTENT ────────────────────────────────────────
    // "Yuzen Chiyogami Washi Origami Paper" → 4802.10 (handmade paper)
    // System returns 4802.56 (other paper in sheets); washi is handmade Japanese paper
    patches.push({
      priority: 559,
      rule: {
        id: 'HANDMADE_WASHI_PAPER_INTENT',
        description: 'Handmade washi paper, chiyogami, Japanese decorative paper → ch.48 (4802.10). ' +
          '"Washi origami paper", "yuzen chiyogami", "mulberry paper" → 4802.10. ' +
          'Without rule, system returns 4802.56 (machine paper) instead of 4802.10 (handmade).',
        pattern: {
          anyOf: [
            'washi', 'washi paper', 'yuzen', 'chiyogami', 'yuzen chiyogami',
            'handmade paper', 'japanese paper', 'kozo', 'mulberry paper',
            'lokta', 'unryu', 'origami washi', 'decorative washi',
          ],
          noneOf: ['tape', 'washi tape', 'masking tape', 'sticker tape'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [
          { prefix: '4802.10', syntheticRank: 9 }, // Handmade paper and paperboard
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '4802.10' },
          { delta: 0.4, chapterMatch: '48' },
        ],
      } as IntentRule,
    });

    // ── 8. NEW TIRE_WARMER_BLANKET_INTENT ─────────────────────────────────────────
    // "motorcycle tire blamket" → 6301.10 (electric heated blankets)
    // Blocked by AI_CH40 tire rules for 'tire'
    patches.push({
      priority: 549,
      rule: {
        id: 'TIRE_WARMER_BLANKET_INTENT',
        description: 'Tire warming blankets and heated blankets for motorsport → ch.63 (6301.10). ' +
          '"Tire warming blanket", "motorcycle tire blanket", "race tire warmer" → 6301.10. ' +
          'Without rule, AI_CH40 tire rules block ch.63 for tire-warming textile blankets.',
        pattern: {
          anyOf: [
            'tire blanket', 'tyre blanket', 'tire warmer', 'tyre warmer',
            'tire warming', 'tyre warming', 'tire heating blanket', 'race tire warmer',
            'motorcycle blanket', 'motorbike blanket', 'blamket',
          ],
        },
        whitelist: { allowChapters: ['63', '85'] },
        inject: [
          { prefix: '6301.10', syntheticRank: 9 }, // Electric heated blankets
          { prefix: '6301.20', syntheticRank: 8 }, // Blankets of wool/fine animal hair
          { prefix: '6301.40', syntheticRank: 7 }, // Blankets of man-made fibers
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6301' },
          { delta: 0.4, chapterMatch: '63' },
        ],
      } as IntentRule,
    });

    // ── 9. NEW SEMI_PRECIOUS_STONE_MARBLE_INTENT ──────────────────────────────────
    // "semi precious stones marbles" → 7104.29 (synthetic/reconstructed stones)
    // "semi precious marble" used in interchangeable jewelry → no rules fire → wrong ch
    patches.push({
      priority: 560,
      rule: {
        id: 'SEMI_PRECIOUS_STONE_MARBLE_INTENT',
        description: 'Semi-precious stone marbles and small gemstone balls → ch.71 (7104.29). ' +
          '"Semi precious marble", "gemstone marble", "agate marble" → 7104.29. ' +
          'Without rule, gets wrong chapter (firearms 9302 due to semantic confusion).',
        pattern: {
          anyOf: [
            'semi precious marble', 'gemstone marble', 'stone marble', 'agate marble',
            'onyx marble', 'jasper marble', 'tourmaline bead', 'gemstone bead',
            'semi precious bead', 'precious stone bead', 'natural stone bead',
          ],
          noneOf: ['playground', 'marble game', 'glass marble', 'toy marble'],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7104.29', syntheticRank: 9 }, // Other synthetic/reconstructed stones
          { prefix: '7103.10', syntheticRank: 8 }, // Precious/semi-precious stones, unworked
          { prefix: '7103.99', syntheticRank: 7 }, // Other stones, worked
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '71' },
          { delta: 0.4, prefixMatch: '7104' },
        ],
      } as IntentRule,
    });

    // ── 10. NEW FILM_CANISTER_CAMERA_CASE_INTENT ──────────────────────────────────
    // "Retro 135mm Film Container - Holds 2 Rolls" → 4202.12.21.20 (suitcases/camera cases)
    // Semantic routes "container" → 8609 (shipping containers)
    patches.push({
      priority: 558,
      rule: {
        id: 'FILM_CANISTER_CAMERA_CASE_INTENT',
        description: 'Film canisters, camera cases, photography containers → ch.42 (4202.12). ' +
          '"35mm film container", "film canister", "film roll case" → 4202.12. ' +
          'Without rule, semantic returns 8609 shipping containers for "film container" queries.',
        pattern: {
          anyOf: [
            'film container', 'film canister', 'film case', 'film roll', 'film cartridge',
            '35mm film', '135mm film', '120mm film', '110mm film',
            'camera film', 'photo roll', 'film cartridge case',
          ],
          noneOf: ['photographic film', 'cinema film', 'movie film', 'video film'],
        },
        whitelist: { allowChapters: ['42', '37'] },
        inject: [
          { prefix: '4202.12', syntheticRank: 9 }, // Cases for cameras/binoculars
          { prefix: '4202.99', syntheticRank: 8 }, // Other similar containers
          { prefix: '3704.00', syntheticRank: 7 }, // Photographic film, exposed
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4202.12' },
          { delta: 0.4, chapterMatch: '42' },
        ],
      } as IntentRule,
    });

    // ── 11. NEW STICKER_SHEET_PAPER_INTENT ────────────────────────────────────────
    // "Deltarune Mini Tenna Deco Sticker Sheet" → 4802.55 (ch.48, uncoated paper in sheets)
    // Blocked by AI_CH45_CORK (sheet) and AI_CH75_NICKEL_SHEET (sheet)
    patches.push({
      priority: 555,
      rule: {
        id: 'STICKER_SHEET_PAPER_INTENT',
        description: 'Sticker sheets, deco sheets, fan art paper products → ch.48 (4802.55). ' +
          '"Deco sticker sheet", "photocard", "fan sticker" → 4802.55 (paper in sheets). ' +
          'Without rule, AI_CH45 and AI_CH75 block ch.48 for any product with "sheet".',
        pattern: {
          anyOf: [
            'sticker sheet', 'sticker sheets', 'deco sheet', 'decal sheet',
            'die cut sticker', 'holographic sticker', 'fan sticker', 'anime sticker',
            'photocard', 'photo card', 'fanart sticker', 'vinyl decal sheet',
            'kawaii sticker', 'cute sticker', 'planner sticker',
          ],
          noneOf: ['wall decal', 'wall sticker'],
        },
        whitelist: { allowChapters: ['48', '49'] },
        inject: [
          { prefix: '4802.55', syntheticRank: 9 }, // Other paper, in sheets
          { prefix: '4802.56', syntheticRank: 8 }, // Paper in rolls/sheets
          { prefix: '4821.90', syntheticRank: 7 }, // Paper labels, other
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4802.55' },
          { delta: 0.4, chapterMatch: '48' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch RRRR)...`);
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
    console.log(`\nPatch RRRR complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
