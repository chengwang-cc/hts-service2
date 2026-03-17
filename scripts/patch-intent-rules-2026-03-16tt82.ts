#!/usr/bin/env ts-node
/**
 * Patch TT82 — 2026-03-16: Overhead console → automotive, AIDA fabric → cotton, pillow covers.
 *
 * Fixes:
 *  1. UPDATE AUTOMOTIVE_CENTER_CONSOLE_INTENT — add 'overhead console', 'dome map light'
 *     "2000 Dodge Dakota Overhead Console Dome Map Light" → 9504 WRONG (expected 8512.20)
 *     "2002 Honda CR-V Overhead Console Dome Map Light Lamp" → 9504 WRONG
 *     BUG: "overhead console" not in anyOf; "console" triggers gaming context → 9504
 *     8512.20 = lighting equipment for motor vehicles; 9401.80 = other seats; 9403 = other furniture
 *     FIX: Add 'overhead console', 'dome map light', 'dome console light' etc.
 *
 *  2. NEW CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT → 5208 (cotton woven fabrics)
 *     "14ct AIDA Fabric Set - 10" Navy, White, Green Cross Stitch" → 5911 WRONG (expected 5208.33)
 *     "14ct AIDA Kitchen Towel to Cross Stitch by Dohler" → 6302 WRONG (expected 5208.33)
 *     BUG: "AIDA fabric" is woven cotton fabric for cross-stitch; goes to textile machinery (5911)
 *          or household textile (6302) instead of cotton woven fabric chapter (5208)
 *     5208.33 = woven cotton fabrics, plain weave, printed; AIDA is specific open-weave cotton
 *     FIX: New intent for AIDA fabric, cross-stitch cotton fabric → 5208
 *
 *  3. NEW COTTON_PILLOW_COVER_HOUSEHOLD_LINEN_INTENT → 6302 (household linen)
 *     "DECORATIVE RED COTTON THROW PILLOW COVER" → 9404 WRONG (expected 6302.21)
 *     "cotton decorative throw pillow cover, woven fabric, home textile" → 9404 WRONG
 *     "silk eye pillow" → 9404 WRONG (expected 6302.22)
 *     BUG: "throw pillow cover" → 9404 (mattresses/cushions = includes pillows WITH stuffing)
 *          Pillow COVERS (no stuffing) = 6302 (household linen)
 *     6302 = bed linen, table linen, toilet and kitchen linen (includes pillowcases/covers)
 *     FIX: New intent for pillow covers/cases/pillowcases → 6302, deny ch.94
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt82.ts
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

    // 1. UPDATE AUTOMOTIVE_CENTER_CONSOLE_INTENT — add overhead console terms
    //    "2000 Dodge Dakota Overhead Console Dome Map Light" → 9504 WRONG (expected 8512.20)
    //    BUG: "overhead console" not in anyOf → falls to gaming console (9504)
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_CENTER_CONSOLE_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const newPhrases = [
          // Overhead console (roof-mounted storage/light console in vehicle)
          'overhead console', 'overhead console light', 'overhead console lamp',
          'dome console', 'dome map light', 'dome light console',
          'overhead map light', 'overhead dome light',
          // Specific vehicle overhead console types
          'overhead storage console', 'headliner console', 'roof console',
          'mini overhead console', 'sunroof overhead console',
          // Interior console/overhead assemblies
          'interior console assembly', 'console dome light',
          'console map light', 'interior dome lamp assembly',
          // OEM vehicle console/cluster
          'oem overhead console', 'oem center console',
          'cluster dash console', 'instrument cluster console',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...newPhrases])],
          },
        } as IntentRule;
        patches.push({ priority: 560, rule: updated });
        console.log('AUTOMOTIVE_CENTER_CONSOLE_INTENT: added overhead console, dome map light terms');
      } else {
        console.log('AUTOMOTIVE_CENTER_CONSOLE_INTENT: not found');
      }
    }

    // 2. NEW CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT → 5208 (cotton woven fabrics)
    //    "14ct AIDA Fabric Set" → 5911 WRONG (expected 5208.33)
    //    BUG: AIDA fabric (open-weave cotton for cross-stitch) → textile machinery/filter cloth
    //    5208.33 = cotton plain weave woven, printed; 5208.11 = unbleached; 5208.21 = bleached
    //    FIX: New intent for AIDA fabric, even-weave fabric, cross-stitch fabric → 5208
    {
      const existing = allRules.find(r => r.id === 'CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT',
          description: 'AIDA/even-weave cross-stitch cotton fabric → 5208 (woven cotton fabrics)',
          pattern: {
            anyOf: [
              // AIDA fabric (count variations)
              'aida fabric', 'aida cloth', 'aida cross stitch',
              '14ct aida', '18ct aida', '28ct aida', '32ct aida',
              '11ct aida', '16ct aida', '22ct aida',
              'count aida', 'aida set',
              // Even-weave fabric for embroidery
              'evenweave fabric', 'even weave fabric', 'even-weave cloth',
              'linen evenweave', 'evenweave linen',
              // Cross-stitch fabric types
              'cross stitch fabric', 'cross-stitch fabric',
              'hardanger fabric', 'hardanger cloth',
              // Kitchen towel for cross-stitch
              'aida kitchen towel', 'aida towel',
              'kitchen towel cross stitch', 'cross stitch towel',
              // Monk's cloth (weaving/rug fabric)
              'monks cloth', "monk's cloth",
              'huck toweling', 'huck cloth',
            ],
            noneOf: [
              // Exclude canvas bags
              'canvas bag', 'canvas tote',
              // Exclude other textile goods
              'rug canvas', 'painted canvas',
            ],
          },
          inject: [
            { prefix: '5208.33', syntheticRank: 2 },  // cotton plain weave, printed
            { prefix: '5208.11', syntheticRank: 4 },  // cotton plain weave, unbleached
            { prefix: '5208.21', syntheticRank: 6 },  // cotton plain weave, bleached
            { prefix: '5208.31', syntheticRank: 8 },  // cotton plain weave, dyed
          ],
          whitelist: {
            allowChapters: ['52', '58', '63'],        // cotton fabric OR special woven OR made-up textile
            denyChapters: ['59', '42', '48', '49'],   // deny technical textiles, bags, paper, printed matter
          },
          boosts: [
            { delta: 0.85, prefixMatch: '5208.' },
            { delta: 0.40, chapterMatch: '52' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '59' },      // penalize technical textiles
          ],
        } as IntentRule;
        patches.push({ priority: 556, rule: newRule });
        console.log('CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT: created (AIDA fabric → 5208, deny ch.59)');
      } else {
        console.log('CROSS_STITCH_AIDA_COTTON_FABRIC_INTENT: already exists, skipping');
      }
    }

    // 3. NEW COTTON_PILLOW_COVER_HOUSEHOLD_LINEN_INTENT → 6302 (household linen)
    //    "DECORATIVE RED COTTON THROW PILLOW COVER" → 9404 WRONG (expected 6302.21)
    //    "cotton decorative throw pillow cover, woven fabric" → 9404 WRONG
    //    BUG: "pillow cover" → 9404 (includes filled pillows); covers without stuffing = 6302
    //    6302.21 = other bed linen of cotton; 6302.22 = bed linen of man-made fibers
    //    Key: "cover" or "case" = 6302 (linen), "pillow" alone = 9404 (filled cushion)
    {
      const existing = allRules.find(r => r.id === 'COTTON_PILLOW_COVER_LINEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_PILLOW_COVER_LINEN_INTENT',
          description: 'Pillow covers/cases/shams (no stuffing) → 6302 (household bed linen)',
          pattern: {
            anyOf: [
              // Throw pillow covers
              'throw pillow cover', 'throw pillow case', 'throw pillow covers',
              'decorative pillow cover', 'decorative pillow case', 'decorative pillow sham',
              'pillow cover cotton', 'cotton pillow cover', 'pillow cover linen',
              'pillow case cotton', 'cotton pillow case',
              // Cushion covers (without stuffing)
              'cushion cover', 'cushion covers', 'cushion case',
              'cotton cushion cover', 'linen cushion cover', 'velvet cushion cover',
              'sofa cushion cover', 'couch cushion cover',
              // Pillowcases / bedding
              'pillowcase', 'pillow sham', 'standard pillowcase',
              'king pillowcase', 'queen pillowcase',
              'cotton pillowcase', 'linen pillowcase', 'satin pillowcase',
              // Eye pillows
              'eye pillow cover', 'silk eye pillow',
              // Bolster covers
              'bolster cover', 'bolster case',
            ],
            noneOf: [
              // Exclude filled/stuffed pillows
              'throw pillow insert', 'pillow insert', 'filled pillow', 'stuffed pillow',
              'pillow form', 'down pillow', 'feather pillow',
              // Exclude outdoor/garden cushions
              'patio cushion', 'outdoor cushion',
            ],
          },
          inject: [
            { prefix: '6302.21', syntheticRank: 2 },  // bed linen of cotton
            { prefix: '6302.22', syntheticRank: 5 },  // bed linen of man-made fiber
            { prefix: '6302.29', syntheticRank: 8 },  // bed linen of other textile
          ],
          whitelist: {
            allowChapters: ['63', '62', '61'],        // made-up textile OR woven/knitted articles
            denyChapters: ['94', '84'],               // deny furniture/mattresses, machinery
          },
          boosts: [
            { delta: 0.80, prefixMatch: '6302.' },
            { delta: 0.40, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '94' },      // penalize furniture/stuffed pillows
          ],
        } as IntentRule;
        patches.push({ priority: 555, rule: newRule });
        console.log('COTTON_PILLOW_COVER_LINEN_INTENT: created (pillow covers → 6302, deny ch.94)');
      } else {
        console.log('COTTON_PILLOW_COVER_LINEN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT82)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT82 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
