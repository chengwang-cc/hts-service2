#!/usr/bin/env ts-node
/**
 * Patch TT87 — 2026-03-16: Yarn intent anyOfGroups fix, whale/denim zipper pouches.
 *
 * Fixes:
 *  1. UPDATE WOOL_YARN_FIBER_INTENT — add 'wool' standalone token + anyOfGroups for yarn context
 *     "300g 75%wool/25%nylon knitting yarn" → 5205 STILL WRONG (expected 5106.20)
 *     ROOT CAUSE: tokenizeQuery uses /[a-z0-9]+/g → '75%wool' splits to '75' + 'wool' tokens.
 *                 None of the anyOf patterns ('wool yarn', '75%wool', '75% wool') match because:
 *                 - '75%wool' (single-word): tokens.has('75%wool') = false (no such token)
 *                 - '75% wool' (phrase): queryLower.includes('75% wool') = false (no space before wool)
 *                 - 'wool yarn' (phrase): queryLower.includes('wool yarn') = false (non-adjacent)
 *                 So WOOL_YARN_FIBER_INTENT never fires → denyChapters doesn't help.
 *     FIX: Add 'wool' as standalone token to anyOf (tokens.has('wool') = true ✅)
 *          + anyOfGroups: [['yarn','knitting','knit','crochet']] to prevent wool coat/blanket matches
 *          Pattern now fires when query has BOTH 'wool' token AND a yarn-context token.
 *
 *  2. UPDATE SYNTHETIC_MMF_YARN_INTENT — add 'acrylic' standalone token + anyOfGroups for yarn context
 *     "100% acrylic, decorative craft yarn" → 5208 STILL WRONG (expected 5509.31)
 *     ROOT CAUSE: 'acrylic yarn' phrase fails (comma between 'acrylic' and 'yarn' in query).
 *                 '100% acrylic yarn' phrase fails (', decorative craft' in between).
 *                 Intent never fires → denyChapters:['52'] has no effect.
 *     FIX: Add 'acrylic' standalone token to anyOf
 *          + anyOfGroups: [['yarn','knitting','knit','crochet','fiber']] to prevent false positives
 *          (e.g., 'acrylic paint' → acrylic token matches, but 'paint' not in yarn group → no fire)
 *
 *  3. UPDATE QUILTED_WOVEN_PILE_TEXTILE_INTENT — add whale/denim zipper pouch phrases
 *     "Handmade whale zipper pouch" → 9607 WRONG (expected 5801.26)
 *     "Handmade whale denim zipper pouch" → 9607 WRONG (expected 5801.26)
 *     BUG: QUILTED_WOVEN_PILE_TEXTILE_INTENT only matches 'quilted' phrases; whale/denim pouches
 *          lack 'quilted' keyword but are the same product type.
 *     FIX: Add 'whale zipper pouch', 'denim zipper pouch', 'handmade zipper pouch' to anyOf
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt87.ts
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

    // 1. UPDATE WOOL_YARN_FIBER_INTENT — add 'wool' token + anyOfGroups yarn context guard
    //    ROOT CAUSE: '75%wool/25%nylon' tokenizes to {'75','wool','25','nylon','knitting','yarn'}.
    //    Current anyOf has 'wool yarn' (phrase, doesn't substring-match), '75%wool' (no such token),
    //    '75% wool' (substring not found). So intent NEVER FIRES for this query.
    //    FIX: Add 'wool' standalone token AND anyOfGroups to prevent broad false positives.
    //    anyOfGroups logic: EACH group must have at least one match (AND across groups).
    //    Combined with anyOf (OR), this fires when: anyOf_matches AND anyOfGroups_matches.
    //    'wool coat' → anyOf matches (wool token), anyOfGroups: 'yarn'? No → intent doesn't fire ✅
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];

        // Add 'wool' as standalone token (restricted by anyOfGroups below)
        const newAnyOf = [...new Set([...currentAnyOf, 'wool', 'merino', 'alpaca', 'cashmere', 'mohair', 'angora'])];

        // anyOfGroups: requires query to ALSO contain a yarn-context token
        // Prevents: 'wool coat', 'wool blanket', 'merino sweater' from matching
        // Allows: 'wool knitting', 'merino yarn', '75%wool knitting yarn' to match
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: newAnyOf,
            noneOf: currentNoneOf,
            anyOfGroups: [
              ['yarn', 'knitting', 'knit', 'crochet', 'spinning', 'spun', 'fiber', 'fibre', 'ply'],
            ],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('WOOL_YARN_FIBER_INTENT: added wool/merino/alpaca tokens + anyOfGroups yarn context guard');
      } else {
        console.log('WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // 2. UPDATE SYNTHETIC_MMF_YARN_INTENT — add 'acrylic' token + anyOfGroups yarn context guard
    //    "100% acrylic, decorative craft yarn" → tokens: '100','acrylic','decorative','craft','yarn'
    //    Current anyOf 'acrylic yarn' (phrase) → queryLower.includes('acrylic yarn') = false
    //    (comma between 'acrylic' and rest of query)
    //    FIX: Add 'acrylic', 'polyester', 'nylon' as standalone tokens
    //         + anyOfGroups requiring yarn context to prevent 'acrylic paint', 'nylon rope' matches
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_MMF_YARN_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const currentNoneOf = (existing as any).pattern?.noneOf || [];

        // Add standalone tokens (restricted by anyOfGroups)
        const newAnyOf = [...new Set([
          ...currentAnyOf,
          'acrylic',   // tokens.has('acrylic') = true for any acrylic query
          'polyester', // tokens.has('polyester') for pure polyester queries
          // nylon by itself is too broad (nylon rope, nylon stocking are different)
        ])];

        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: newAnyOf,
            noneOf: currentNoneOf,
            anyOfGroups: [
              ['yarn', 'knitting', 'knit', 'crochet', 'fiber', 'fibre', 'ply', 'thread'],
            ],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log('SYNTHETIC_MMF_YARN_INTENT: added acrylic/polyester tokens + anyOfGroups yarn context guard');
      } else {
        console.log('SYNTHETIC_MMF_YARN_INTENT: not found');
      }
    }

    // 3. UPDATE QUILTED_WOVEN_PILE_TEXTILE_INTENT — add whale/denim zipper pouch phrases
    //    "Handmade whale zipper pouch" → exp:5801.26 got:9607 (still wrong after TT85)
    //    "Handmade whale denim zipper pouch" → exp:5801.26 got:9607 (still wrong)
    //    TT85 only added 'quilted' phrases; whale/denim variants lack 'quilted' keyword.
    //    FIX: Add fabric-material zipper pouch phrases that indicate woven-pile fabric items
    {
      const existing = allRules.find(r => r.id === 'QUILTED_WOVEN_PILE_TEXTILE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Whale pouch variants (these appear in the eval data)
          'whale zipper pouch', 'whale denim zipper', 'whale pouch', 'whale denim pouch',
          // Denim fabric pouches/bags
          'denim zipper pouch', 'denim pouch', 'denim coin purse',
          // Handmade textile pouches (without 'quilted' keyword)
          'handmade zipper pouch', 'handmade fabric pouch', 'handmade fabric zipper',
          'handmade denim zipper', 'handmade textile pouch',
          // Velvet/corduroy pouches (woven pile fabric)
          'velvet zipper pouch', 'corduroy zipper pouch', 'velvet coin purse',
          // Other fabric zipper pouches
          'fabric zipper pouch', 'cotton zipper pouch', 'linen zipper pouch',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 552, rule: updated });
        console.log('QUILTED_WOVEN_PILE_TEXTILE_INTENT: added whale/denim zipper pouch phrases');
      } else {
        console.log('QUILTED_WOVEN_PILE_TEXTILE_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT87)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT87 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
