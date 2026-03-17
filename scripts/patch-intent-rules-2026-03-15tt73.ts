#!/usr/bin/env ts-node
/**
 * Patch TT73 — 2026-03-15: Fix passive diffuser OR-logic, diamond painting wax phrases, rubber elastic.
 *
 * Fixes:
 *  1. UPDATE PASSIVE_DIFFUSER_FRESHENER_INTENT — add allowChapters:['33','34'] + specific boost
 *     "Glade Electric Wax Melt Warmer Air Freshener" → 3307.41 (incense!) WRONG (expected 3307.49)
 *     "car air freshener" → 3307.41 WRONG (expected 3307.49)
 *     BUG (a): WAX_MELT_INTENT has allowChapters:['34']. When BOTH fire, OR logic blocks 3307.49
 *             (ch.33) because PASSIVE_DIFFUSER has no positive filter to allow ch.33 in OR.
 *     BUG (b): General '3307.' boost applies to 3307.41 too (both get +0.70), so organic 3307.41
 *             (high vector score from "freshener"/"scent") beats injected 3307.49.
 *     FIX: Add allowChapters:['33','34'] (fix OR logic), change boost to be specific to 3307.49,
 *          add penalty for 3307.41.
 *
 *  2. UPDATE DIAMOND_PAINTING_WAX_INTENT — add phrase variations for "adhesive wax diamond painting"
 *     "mixed wax shapes adhesive wax diamond painting" → 3407 (polymer clay!) WRONG (expected 3404.90)
 *     "Scented/Coloured wax-used as an adhesive wax for use with diamond painting" → 3506 WRONG
 *     BUG: anyOf has 'mixed wax shapes diamond' but queries have "mixed wax shapes adhesive wax diamond"
 *          and "adhesive wax for use with diamond painting" — substrings don't match exactly
 *     FIX: Add 'adhesive wax diamond', 'wax for diamond', 'diamond painting adhesive wax',
 *          'wax tool diamond', 'wax pen diamond', 'wax diamond painting'
 *
 *  3. NEW RUBBER_SEWING_ELASTIC_INTENT → 4008.21 (vulcanized rubber strips)
 *     "Rubber Swimwear Elastic" → 6112 (swimwear textile!) WRONG (expected 4008.21.00.00)
 *     "Swimwear Elastic" → 6112 WRONG (expected 4008.21.00.00)
 *     BUG: "swimwear" triggers ch.61/62 swimwear chapter; "rubber" alone → rubber gloves (4015)
 *     4008.21 = vulcanized rubber strips (used as sewing elastic for swimwear waistbands)
 *     FIX: New intent for rubber elastic strips → 4008.21, deny ch.61/62/63
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt73.ts
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

    // 1. UPDATE PASSIVE_DIFFUSER_FRESHENER_INTENT — fix OR logic + specific boost
    //    BUG: WAX_MELT_INTENT fires for "wax melt warmer" with allowChapters:['34']
    //         In OR logic: PASSIVE_DIFFUSER has no positive filter → only WAX_MELT's filter applies
    //         → 3307.49 (ch.33) blocked because WAX_MELT only allows ch.34
    //    BUG: Boost '3307.' applies to BOTH 3307.41 and 3307.49 → organic 3307.41 still wins
    //    FIX: Add allowChapters:['33','34'] + specific boost for '3307.49' + penalty for '3307.41'
    {
      const existing = allRules.find(r => r.id === 'PASSIVE_DIFFUSER_FRESHENER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowChapters: ['33', '34'],     // ch.33=3307.49, ch.34=3406 wax melts
            denyChapters: ['84', '85'],      // deny electric machinery
          },
          boosts: [
            { delta: 0.80, prefixMatch: '3307.49' }, // specific boost: passive/non-electric fresheners
            { delta: 0.50, prefixMatch: '3307.30' }, // room deodorizers
            { delta: 0.30, chapterMatch: '33' },     // general ch.33 boost
          ],
          penalties: [
            { delta: 0.65, prefixMatch: '3307.41' }, // penalize incense (wrong for air fresheners)
            { delta: 0.65, chapterMatch: '84' },     // penalize electric machinery
          ],
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('PASSIVE_DIFFUSER_FRESHENER_INTENT: added allowChapters:[33,34], specific boost for 3307.49, penalize 3307.41');
      } else {
        console.log('PASSIVE_DIFFUSER_FRESHENER_INTENT: not found');
      }
    }

    // 2. UPDATE DIAMOND_PAINTING_WAX_INTENT — add phrase variations
    //    "mixed wax shapes adhesive wax diamond painting" → 3407 WRONG (expected 3404.90.51)
    //    Current anyOf has 'mixed wax shapes diamond' but query has "mixed wax shapes adhesive wax diamond"
    //    (not adjacent) — phrase match fails
    {
      const existing = allRules.find(r => r.id === 'DIAMOND_PAINTING_WAX_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Variations of "adhesive wax for diamond painting"
          'adhesive wax diamond', 'diamond painting adhesive wax',
          'wax for diamond painting', 'wax for diamond',
          'wax used for diamond', 'wax adhesive diamond',
          // Coloured/scented wax for diamond painting
          'coloured wax diamond', 'scented wax diamond painting',
          'wax tool diamond painting', 'wax pen diamond painting',
          'pick up wax diamond', 'wax diamond painting',
          // Mixed wax shapes variations
          'mixed wax diamond', 'wax shapes diamond painting',
          // Additional diamond painting kit terms
          'diamond art wax', 'diamond dotz wax', '5d diamond wax',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('DIAMOND_PAINTING_WAX_INTENT: added phrase variations for adhesive wax diamond painting queries');
      } else {
        console.log('DIAMOND_PAINTING_WAX_INTENT: not found');
      }
    }

    // 3. NEW RUBBER_SEWING_ELASTIC_INTENT → 4008.21 (vulcanized rubber strips for sewing)
    //    "Rubber Swimwear Elastic" → 6112 (swimwear!) WRONG (expected 4008.21.00.00)
    //    "Swimwear Elastic" → 6112 WRONG (expected 4008.21.00.00)
    //    BUG: "swimwear" triggers synthetic swimwear chapter (6112); "rubber" alone → gloves/clothing (4015)
    //    4008.21 = plates/sheets/strip of vulcanized rubber (non-cellular) — used as sewing elastic
    //    FIX: New intent for rubber elastic strips/bands used in sewing → 4008.21, deny ch.61/62/63
    {
      const existing = allRules.find(r => r.id === 'RUBBER_SEWING_ELASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RUBBER_SEWING_ELASTIC_INTENT',
          description: 'Rubber elastic strips for sewing (swimwear/lingerie elastic) → ch.40 (4008.21)',
          pattern: {
            anyOf: [
              'swimwear elastic', 'rubber swimwear elastic', 'swimwear rubber elastic',
              'rubber elastic band sewing', 'rubber elastic strip sewing',
              'lingerie rubber elastic', 'bra rubber elastic',
              'rubber elastic fabric', 'rubber sewing elastic',
              'natural rubber elastic', 'latex elastic band',
              'rubber waistband elastic', 'swimsuit elastic rubber',
            ],
            noneOf: [
              // Exclude actual swimwear garments
              'swimsuit', 'swim suit', 'swimwear garment',
              // Exclude hair elastics (textile)
              'hair elastic', 'hair tie',
            ],
          },
          inject: [
            { prefix: '4008.21', syntheticRank: 2 }, // strips/rods of vulcanized rubber (non-cellular)
            { prefix: '4008.11', syntheticRank: 5 }, // strips/rods of cellular rubber (foam)
            { prefix: '4006.10', syntheticRank: 8 }, // camel-back strips (unvulcanized rubber)
          ],
          whitelist: {
            denyChapters: ['61', '62', '63'], // deny textile garments
          },
          boosts: [
            { delta: 0.75, prefixMatch: '4008.' },
            { delta: 0.40, chapterMatch: '40' },
          ],
        } as IntentRule;
        patches.push({ priority: 574, rule: newRule });
        console.log('RUBBER_SEWING_ELASTIC_INTENT: created (swimwear elastic → 4008.21, deny ch.61/62/63)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT73)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT73 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
