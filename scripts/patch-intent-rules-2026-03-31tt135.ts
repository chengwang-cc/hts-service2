#!/usr/bin/env ts-node
/**
 * Patch TT135 — 2026-03-31: Fix 3 empty/wrong-result queries
 *
 * Problems fixed:
 *
 * 1. "Genuine Crushed Stone" → EMPTY (conflict: GEM_STONE_LOOSE_CRUSHED_INTENT allows only ch.71
 *    while NATURAL_STONE_RAW_MINERAL_INTENT denies ch.71 for "crushed stone" phrase → impossible)
 *    Fix: remove generic "crushed stone"/"crushed stones" from GEM_STONE_LOOSE_CRUSHED_INTENT anyOf
 *    (only keep specific gemstone phrases like "crushed opal", "crushed turquoise", etc.)
 *
 * 2. "Elevate Brows - The Original DIY Brow Lamination Kit, Thio and Ammonia Free" → EMPTY
 *    Also: "eyebrow lamination" → EMPTY
 *    Root cause: no rules inject ch.33 candidates; semantic search for this query pulls toward
 *    textile lamination (ch.59) or misc., which fall below the 0.25 normalized score threshold.
 *    Fix: new BROW_LASH_LAMINATION_INTENT that fires on "brow lamination", "eyebrow lamination",
 *    "lash lamination" etc. phrases → injects 3305.20 (permanent wave preparations),
 *    restricts to ch.33, boosts 3305.
 *
 * 3. "Amika The Kure Intense Bond Repair Mask - 100 ml" → ch.84 (semiconductor mask manufacturing)
 *    Root cause: no hair-care rule fires (query has no "hair" token); lexical match on "mask"+"repair"
 *    hits 8486.40 "manufacture or repair of masks and reticles".
 *    Fix: add "bond repair" phrase to HAIR_CONDITIONER_INTENT anyOf → triggers allowChapters ["33"],
 *    inject 3305., and boost ch.33; blocking ch.84.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-31tt135.ts
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

    // 1. FIX GEM_STONE_LOOSE_CRUSHED_INTENT — remove "crushed stone"/"crushed stones" from anyOf
    //    These generic phrases conflict with NATURAL_STONE_RAW_MINERAL_INTENT's denyChapters:["71"],
    //    creating an impossible constraint (only ch.71 allowed AND ch.71 denied = empty results).
    //    Keep only specific gemstone phrases (crushed opal, crushed turquoise, etc.)
    {
      const existing = allRules.find(r => r.id === 'GEM_STONE_LOOSE_CRUSHED_INTENT');
      if (existing) {
        const genericCrushed = new Set(['crushed stone', 'crushed stones']);
        const hadGeneric = (existing.pattern.anyOf ?? []).some(t => genericCrushed.has(t));
        if (hadGeneric) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              anyOf: (existing.pattern.anyOf ?? []).filter(t => !genericCrushed.has(t)),
            },
          };
          patches.push({ priority: 0, rule: updated });
          console.log('GEM_STONE_LOOSE_CRUSHED_INTENT: removed "crushed stone"/"crushed stones" from anyOf');
        } else {
          console.log('GEM_STONE_LOOSE_CRUSHED_INTENT: generic phrases already removed, skipping');
        }
      } else {
        console.log('GEM_STONE_LOOSE_CRUSHED_INTENT: not found, skipping');
      }
    }

    // 2. NEW BROW_LASH_LAMINATION_INTENT — fires on brow/eyebrow/lash lamination phrases
    //    Injects 3305.20 (permanent wave preparations) and restricts to ch.33.
    //    Also handles lash lift / brow perm products.
    {
      const existing = allRules.find(r => r.id === 'BROW_LASH_LAMINATION_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BROW_LASH_LAMINATION_INTENT',
          description: 'Brow/lash lamination or perm kits → ch.33 3305.20 (permanent wave preparations)',
          pattern: {
            anyOf: [
              'brow lamination',
              'eyebrow lamination',
              'lash lamination',
              'brow lamination kit',
              'eyebrow lamination kit',
              'lash lamination kit',
              'lash lift',
              'lash lift kit',
              'brow perm',
              'eyebrow perm',
              'brow styling kit',
            ],
          },
          inject: [
            { prefix: '3305.20', syntheticRank: 5 },
            { prefix: '3305.90', syntheticRank: 10 },
          ],
          whitelist: {
            allowChapters: ['33'],
          },
          boosts: [
            { delta: 0.80, prefixMatch: '3305.20' },
            { delta: 0.50, prefixMatch: '3305.90' },
          ],
        } as IntentRule;
        patches.push({ priority: 130, rule: newRule });
        console.log('BROW_LASH_LAMINATION_INTENT: created');
      } else {
        console.log('BROW_LASH_LAMINATION_INTENT: already exists, skipping');
      }
    }

    // 3. UPDATE HAIR_CONDITIONER_INTENT — add "bond repair" phrase to anyOf
    //    Triggers allowChapters:["33"] + inject 3305. + boost ch.33 for hair bond repair products
    //    like "Amika The Kure Intense Bond Repair Mask" that lack "hair" token.
    {
      const existing = allRules.find(r => r.id === 'HAIR_CONDITIONER_INTENT');
      if (existing) {
        const bondRepairPhrases = ['bond repair', 'bond repair mask', 'bond repair treatment', 'hair bond repair', 'protein bond repair', 'bond strengthening'];
        const anyOf = existing.pattern.anyOf ?? [];
        const newPhrases = bondRepairPhrases.filter(p => !anyOf.includes(p));
        if (newPhrases.length > 0) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              anyOf: [...anyOf, ...newPhrases],
            },
          };
          patches.push({ priority: 196, rule: updated });
          console.log(`HAIR_CONDITIONER_INTENT: added ${newPhrases.length} bond repair phrases to anyOf`);
        } else {
          console.log('HAIR_CONDITIONER_INTENT: bond repair phrases already present, skipping');
        }
      } else {
        console.log('HAIR_CONDITIONER_INTENT: not found, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT135)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch TT135 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
