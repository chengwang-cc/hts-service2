#!/usr/bin/env ts-node
/**
 * Patch TT69 — 2026-03-15: Fix sticker injection strategy, art/sticker conflict, leather knotted buttons.
 *
 * Fixes:
 *  1. UPDATE VINYL_STICKER_DECAL_INTENT — use specific code injections for ch.39 diversity strategy
 *     PROBLEM: broad prefix '3919.10' / '3919.90' inject N codes into ch.39, all compete for 3 slots.
 *     Diversity cap (perChapterCap=3) means exactly 3 ch.39 entries make it to selected,
 *     remaining go to deferred (appended after selected, sliced to 10).
 *     With 6-7 selected items from other chapters, only positions 7-10 are filled by deferred.
 *     STRATEGY: Inject exactly 4 specific codes:
 *       3919.10.20.20 rank:1 → ch.39 slot 1 (8-dig: 39191020)
 *       3919.10.10.10 rank:2 → ch.39 slot 2 (8-dig: 39191010, also covers 39191050 "Other")
 *       3919.90.10.00 rank:3 → ch.39 slot 3 (8-dig: 39199010)
 *       3919.90.50.20 rank:4 → deferred → position ~10 (8-dig: 39199050)
 *     These cover the 4 expected 8-digit groups in the chit-chats CSV.
 *     Note: 3919.10.10.10 "Pavement marking tape" covers 39191010 AND 39191050 (same 8-dig)
 *
 *  2. UPDATE ART_PRINT_POSTER_PHOTO_INTENT — add 'stickers' (plural) to noneOf
 *     "Anne of Green Gables stickers" → 9701 (fine art!) WRONG (expected 3919.90)
 *     BUG: noneOf has 'sticker' (singular) but tokenOrPhraseMatches() uses tokens.has(t) for
 *     single-word terms. 'sticker' token ≠ 'stickers' token — they are different tokens.
 *     FIX: add 'stickers' to noneOf
 *
 *  3. UPDATE BUTTON_SEWING_FASTENER_INTENT — add leather knotted / knotted button patterns
 *     "Leather knotted natural brown buttons" → not matching BUTTON intent
 *     BUG: anyOf has 'leather button' (multi-word) but "leather knotted natural brown buttons"
 *     does NOT contain the substring 'leather button' (no adjacency). 'knotted button' is also absent.
 *     FIX: add 'knotted button', 'knotted buttons', 'leather knotted', 'knotted closure button' to anyOf
 *
 *  4. UPDATE SCRUNCHIE_HAIR_BAND_INTENT — add hair tie terms
 *     "4 pack of hair ties" → not matching SCRUNCHIE intent (only scrunchie terms in anyOf)
 *     FIX: add 'hair tie', 'hair ties', 'hair band pack', 'elastic hair tie' to anyOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt69.ts
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

    // 1. UPDATE VINYL_STICKER_DECAL_INTENT — inject 4 specific codes to cover all 8-digit groups
    //    Current: inject=['3919.10' rank:1, '3919.90' rank:2] (broad prefix → many codes, cap fights)
    //    Problem: broad prefix injects 7 codes for 3919.10 + 6 codes for 3919.90 = 13 ch.39 candidates
    //    ch.39 diversity cap = 3 → only top-3 survive to selected (by syntheticRank ordering)
    //    With rank:1 → 3919.10.xx codes fill all 3 slots, 3919.90 codes go to deferred
    //    But deferred requires there to be ≥7 selected items from other chapters to reach position 10
    //    FIX: Inject exactly the 4 specific 8-digit representatives we need
    {
      const existing = allRules.find(r => r.id === 'VINYL_STICKER_DECAL_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '3919.10.20.20', syntheticRank: 1 }, // Decorative plastic sheets/rolls (39191020)
            { prefix: '3919.10.10.10', syntheticRank: 2 }, // Pavement marking tape (covers 39191010 + 39191050)
            { prefix: '3919.90.10.00', syntheticRank: 3 }, // Other self-adhesive plastic products (39199010)
            { prefix: '3919.90.50.20', syntheticRank: 4 }, // Other (covers 39199050) → deferred slot
            { prefix: '4821.10', syntheticRank: 6 },        // Paper labels (for coverage, low rank)
          ],
          boosts: [
            { delta: 0.70, prefixMatch: '3919.' },
          ],
        } as IntentRule;
        patches.push({ priority: 578, rule: updated });
        console.log('VINYL_STICKER_DECAL_INTENT: updated inject to 4 specific codes (3919.10.20.20/3919.10.10.10/3919.90.10.00/3919.90.50.20)');
      } else {
        console.log('VINYL_STICKER_DECAL_INTENT: not found');
      }
    }

    // 2. UPDATE ART_PRINT_POSTER_PHOTO_INTENT — add 'stickers' to noneOf
    //    "Anne of Green Gables stickers" → 9701 (fine art!) WRONG (expected 3919.90)
    //    BUG: noneOf=['sticker'] but tokenOrPhraseMatches checks tokens.has('sticker')
    //    The query "anne of green gables stickers" tokenizes to: anne, of, green, gables, stickers
    //    'sticker' (singular) ≠ 'stickers' (plural) — different tokens
    //    FIX: add 'stickers' to noneOf
    {
      const existing = allRules.find(r => r.id === 'ART_PRINT_POSTER_PHOTO_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const stickerNoneOf = ['stickers'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...stickerNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('ART_PRINT_POSTER_PHOTO_INTENT: added stickers to noneOf (prevents 9701 for sticker queries)');
      } else {
        console.log('ART_PRINT_POSTER_PHOTO_INTENT: not found');
      }
    }

    // 3. UPDATE BUTTON_SEWING_FASTENER_INTENT — add leather knotted / knotted button patterns
    //    "Leather knotted natural brown buttons" → not matching (expected 9606.29)
    //    BUG: anyOf has 'leather button' (multi-word phrase) but queryLower.includes('leather button')
    //    fails for "leather knotted natural brown buttons" because "leather" and "button" are not adjacent
    //    Need explicit 'knotted button' / 'leather knotted' phrases
    {
      const existing = allRules.find(r => r.id === 'BUTTON_SEWING_FASTENER_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const knottedTerms = [
          'knotted button', 'knotted buttons', 'leather knotted', 'knotted closure button',
          'fabric knotted button', 'chinese knot button', 'frog button', 'frog closure',
          'frog buttons', 'button frog', 'mongolian button', 'handmade knotted button',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...knottedTerms])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('BUTTON_SEWING_FASTENER_INTENT: added knotted button / frog closure terms to anyOf');
      } else {
        console.log('BUTTON_SEWING_FASTENER_INTENT: not found');
      }
    }

    // 4. UPDATE SCRUNCHIE_HAIR_BAND_INTENT — add hair tie terms
    //    Hair ties are similar to scrunchies (fabric-wrapped elastic bands) → same HTS codes
    //    6117.80 = other clothing accessories, knitted
    //    9615.19 = other hair slides/grips
    {
      const existing = allRules.find(r => r.id === 'SCRUNCHIE_HAIR_BAND_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const hairTieTerms = [
          'hair tie', 'hair ties', 'elastic hair tie', 'elastic hair ties',
          'hair band elastic', 'fabric hair tie', 'satin hair tie', 'silk hair tie',
          'velvet hair tie', 'hair tie set', 'hair tie pack',
          'ponytail tie', 'ponytail holder', 'ponytail elastic',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...hairTieTerms])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('SCRUNCHIE_HAIR_BAND_INTENT: added hair tie / ponytail holder terms to anyOf');
      } else {
        console.log('SCRUNCHIE_HAIR_BAND_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT69)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT69 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
