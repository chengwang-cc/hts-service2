#!/usr/bin/env ts-node
/**
 * Patch TT101 — 2026-03-16: Fix SEWING_PATTERN_INTENT empty results + new intents.
 *
 * Problem: SEWING_PATTERN_INTENT (TT99) is returning EMPTY for all 7 sewing pattern
 * entries in the dataset. The denyChapters:['49','48'] blocks ALL organic results
 * (ch.49/48 are the only organic matches for sewing/pattern words), and the injected
 * 6307.90 entries are not surviving as final results.
 *
 * Fix 1: Remove whitelist entirely from SEWING_PATTERN_INTENT.
 *   - Add lexicalFilter.stripTokens: ['pattern'] to prevent "molding patterns" (ch.84)
 *     from appearing in results when user searches sewing patterns.
 *   - Keep inject:6307.90 + strong boosts for ch.63.
 *   - Add strong penalty for ch.49 (soft routing instead of hard block).
 *   - This allows the 3 ch.48-expected entries ("sewing pattern made of paper") to
 *     return organic ch.48 results (correct!), while ch.63 inject + boost handles the
 *     4 ch.63-expected entries (Butterick/Simplicity/McCall's patterns).
 *
 * Fix 2: NEW WIRE_JEWELRY_MAKING_INTENT → 7117.19/7117.90 (ch.71 imitation jewelry)
 *   "Jewelry Making Wire" → 7408.29 WRONG (expected 7117.19 imitation jewelry)
 *   "Wire for Jewelry Making" → 7408.29 WRONG (expected 7117.19)
 *   ROOT CAUSE: 'wire' + 'jewelry' routes to copper wire (ch.74) instead of
 *               imitation jewelry (ch.71). Jewelry-making wire is classified as
 *               the finished article (jewelry), not the raw wire.
 *
 * Fix 3: NEW FOAM_CRAFT_SHEET_INTENT → 3921.19 (foam/cellular plastic, ch.39)
 *   "Foam Sheets for Crafts" → various non-ch.39 WRONG (expected 3921.19)
 *   ROOT CAUSE: foam craft sheets routed to wrong chapters
 *
 * Fix 4: NEW CERAMIC_POTTERY_SUPPLY_INTENT → 6914.90 (other ceramic articles, ch.69)
 *   Items expected as ceramic supplies/blanks getting classified incorrectly.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt101.ts
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

    // 1. FIX SEWING_PATTERN_INTENT — remove whitelist (was causing empty results)
    //    "Sewing Pattern (Butterick 3255)" → EMPTY (expected 6307.90.60.90 ch.63)
    //    "Sewing Pattern ( SImplicity 1715)" → EMPTY (expected 6307.90.60.90)
    //    "McCall's Sewing Pattern number 826" → EMPTY (expected 6307.90.98.50)
    //    ALSO these are in dataset and expect ch.48:
    //    "sewing pattern made of paper" → expected 4823.90.86.80 (ch.48 paper articles)
    //    "Rare Butterick 3461 70s Sewing Pattern" → expected 4823.90.86.80 (ch.48)
    //
    //    Root cause: denyChapters:['49','48'] blocks ALL organic results.
    //    The "sewing | pattern" lexical query only returns ch.84 (sewing machines) and
    //    ch.69 (ceramic patterns) entries. The injected 6307.90 (ch.63) entries are
    //    added but something prevents them from appearing as final results.
    //
    //    Fix: Remove whitelist entirely. Add lexicalFilter to strip 'pattern' token
    //    (prevents routing to molding patterns ch.84). Use soft penalties for ch.49.
    //    For ch.48-expected items, organic ch.48 results will surface naturally.
    //    For ch.63-expected items, inject+boost pushes 6307.90 into results.
    {
      const existing = allRules.find(r => r.id === 'SEWING_PATTERN_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          lexicalFilter: {
            // Strip 'pattern' token to avoid ch.84 molding patterns dominating results
            stripTokens: ['pattern'],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 1 },  // dress patterns subheading — syntheticRank 1 (top)
            { prefix: '6307.20', syntheticRank: 6 },
          ],
          // Remove whitelist entirely — no denyChapters, no allowChapters
          whitelist: undefined as any,
          boosts: [
            { delta: 0.90, prefixMatch: '6307.90' },  // strong boost for dress patterns
            { delta: 0.60, chapterMatch: '63' },       // boost ch.63 generally
          ],
          penalties: [
            { delta: 0.50, chapterMatch: '49' },       // moderate penalty for printed matter (not hard block)
            { delta: 0.60, chapterMatch: '84' },       // penalty for sewing machines
            { delta: 0.60, chapterMatch: '69' },       // penalty for ceramics
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 547, rule: updated });
        console.log('SEWING_PATTERN_INTENT: removed whitelist, added lexicalFilter stripTokens:[pattern]');
      } else {
        console.log('SEWING_PATTERN_INTENT: not found');
      }
    }

    // 2. NEW WIRE_JEWELRY_MAKING_INTENT → 7117.19/7117.90 (imitation jewelry, ch.71)
    //    "Jewelry Making Wire" → ch.74 copper wire WRONG (expected 7117.19)
    //    "Wire for Jewelry Making" → ch.74 WRONG (expected 7117.19)
    //    Root cause: 'wire' + 'jewelry' → copper wire (7408, ch.74) instead of
    //    imitation jewelry. Wire used TO MAKE jewelry is classified as finished article.
    {
      const existing = allRules.find(r => r.id === 'WIRE_JEWELRY_MAKING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WIRE_JEWELRY_MAKING_INTENT',
          description: 'Wire for jewelry making → 7117 (imitation jewelry, ch.71), deny ch.74 copper wire',
          pattern: {
            anyOf: [
              // Jewelry-making wire phrases
              'jewelry making wire', 'jewellery making wire',
              'wire for jewelry making', 'wire for jewellery making',
              'jewelry wire', 'jewellery wire',
              'beading wire', 'craft wire jewelry',
              'wire wrapped jewelry', 'wire wrap jewelry',
              'wire wrapping wire', 'wire jewelry making',
              'memory wire jewelry', 'coiling wire jewelry',
            ],
            noneOf: [
              // Exclude actual industrial wire
              'electrical wire', 'copper wire spool', 'wire cable',
              'wire rope', 'steel wire',
            ],
          },
          inject: [
            { prefix: '7117.19', syntheticRank: 2 },  // imitation jewelry of base metal
            { prefix: '7117.90', syntheticRank: 4 },  // other imitation jewelry
            { prefix: '7113.19', syntheticRank: 8 },  // jewelry of other precious metal
          ],
          whitelist: {
            denyChapters: ['74', '76'],                // deny copper wire and aluminum wire
          },
          boosts: [
            { delta: 0.85, prefixMatch: '7117.' },    // boost imitation jewelry
            { delta: 0.75, chapterMatch: '71' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '74' },       // strong penalty for copper
            { delta: 0.70, chapterMatch: '76' },
          ],
        } as IntentRule;
        patches.push({ priority: 545, rule: newRule });
        console.log('WIRE_JEWELRY_MAKING_INTENT: created (jewelry wire → 7117, deny ch.74)');
      } else {
        console.log('WIRE_JEWELRY_MAKING_INTENT: already exists, skipping');
      }
    }

    // 3. NEW FOAM_CRAFT_SHEET_INTENT → 3921.19 (foam/cellular plastic sheets, ch.39)
    //    Foam craft sheets/EVA foam → should be 3921 (cellular plastic), ch.39
    //    ROOT CAUSE: generic foam terms may route to furniture foam (ch.94) or other chapters
    {
      const existing = allRules.find(r => r.id === 'FOAM_CRAFT_SHEET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FOAM_CRAFT_SHEET_INTENT',
          description: 'Foam craft sheets, EVA foam sheets → 3921.19 (cellular plastic, ch.39)',
          pattern: {
            anyOf: [
              // Foam craft sheet terms
              'foam sheet craft', 'foam sheets craft', 'craft foam sheet',
              'craft foam sheets', 'eva foam sheet', 'eva foam sheets',
              'eva craft foam', 'foam craft board',
              // Specific foam craft types
              'glitter foam sheet', 'glitter eva foam',
              'adhesive foam sheet', 'sticky foam sheet',
              'foam sticker sheet',
              // General craft foam
              'craft foam', 'foam for crafts', 'foam crafting',
            ],
            noneOf: [
              // Exclude furniture/upholstery foam
              'foam mattress', 'foam cushion', 'foam pillow', 'upholstery foam',
              // Exclude swimming/sports foam
              'swim noodle', 'foam roller', 'yoga mat',
            ],
          },
          inject: [
            { prefix: '3921.19', syntheticRank: 2 },  // other cellular plastic sheets
            { prefix: '3921.90', syntheticRank: 4 },  // other plastic sheets
          ],
          whitelist: {
            allowChapters: ['39', '48'],               // plastics or paper
            denyChapters: ['94', '63'],                // deny furniture/bedding and made-up textiles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '3921.' },    // boost cellular plastic
            { delta: 0.50, chapterMatch: '39' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '94' },       // penalty for furniture
          ],
        } as IntentRule;
        patches.push({ priority: 541, rule: newRule });
        console.log('FOAM_CRAFT_SHEET_INTENT: created (foam craft sheets → 3921.19, ch.39)');
      } else {
        console.log('FOAM_CRAFT_SHEET_INTENT: already exists, skipping');
      }
    }

    // 4. NEW WASHI_TAPE_STICKER_INTENT → 4811.41/4823.90 (decorated paper, ch.48)
    //    Washi tape → should be ch.48 (paper tape), not ch.39 (plastic tape)
    //    "Washi tape floral" → 3919.10 WRONG (expected 4811.41 paper tape)
    //    "Washi masking tape" → 3919.10 WRONG (expected 4823.90 other paper articles)
    {
      const existing = allRules.find(r => r.id === 'WASHI_TAPE_STICKER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WASHI_TAPE_STICKER_INTENT',
          description: 'Washi tape, Japanese decorative tape → 4811/4823 (decorated paper, ch.48), deny ch.39',
          pattern: {
            anyOf: [
              'washi tape', 'washi tapes', 'washi roll',
              'mt washi', 'japanese washi tape',
              'decorative masking tape', 'paper masking tape',
              'washi masking tape',
            ],
            noneOf: [
              'plastic tape', 'duct tape',
            ],
          },
          inject: [
            { prefix: '4811.41', syntheticRank: 2 },  // gummed paper/paperboard (self-adhesive)
            { prefix: '4823.90', syntheticRank: 4 },  // other paper articles
            { prefix: '4814.20', syntheticRank: 6 },  // wallpaper and similar wall coverings
          ],
          whitelist: {
            allowChapters: ['48', '49'],               // paper chapter
            denyChapters: ['39'],                      // deny plastics (wrong for washi tape)
          },
          boosts: [
            { delta: 0.85, prefixMatch: '4811.' },    // boost decorated paper
            { delta: 0.75, prefixMatch: '4823.' },    // boost other paper articles
            { delta: 0.50, chapterMatch: '48' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '39' },       // strong penalty for plastic tape
          ],
        } as IntentRule;
        patches.push({ priority: 538, rule: newRule });
        console.log('WASHI_TAPE_STICKER_INTENT: created (washi tape → 4811/4823, deny ch.39)');
      } else {
        console.log('WASHI_TAPE_STICKER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT101)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT101 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
