#!/usr/bin/env ts-node
/**
 * Patch TT91 — 2026-03-16: Wool/nylon noneOf fix, silicone molds, glassblowing torches, stabilized wood blanks.
 *
 * Fixes:
 *  1. FIX WOOL_YARN_FIBER_INTENT — remove 'nylon' from noneOf
 *     "300g 75%wool/25%nylon knitting yarn" → 5205.26 WRONG (expected 5106.20)
 *     "100g 75%wool/25%nylon knitting yarn" → 5205.26 WRONG (expected 5106.20)
 *     ROOT CAUSE: noneOf has 'nylon' — tokens.has('nylon')=true for '25%nylon' → intent blocked.
 *     FIX: Remove 'nylon' from noneOf so 75%wool/25%nylon blends trigger WOOL_YARN_FIBER_INTENT.
 *          The denyChapters:['52','55'] + inject 5106.20 then correctly route to combed wool yarn.
 *
 *  2. NEW SILICONE_CRAFT_MOLD_INTENT → 8480.79/8480.71/8480.60 (molds for plastics/glass)
 *     "4.5- Druzy snowflake resin silicone mold" → 3924.10 WRONG (expected 8480.79)
 *     "4.5- Druzy Angel wings silicone mold" → 3924.10 WRONG (expected 8480.79)
 *     "silicone mold" → 3924.10 WRONG (expected 8480.79)
 *     BUG: Craft silicone molds (for resin casting, chocolate, soap) classified as plastic tableware.
 *     8480.79 = molds for rubber or plastics (excl. injection/compression molds)
 *     FIX: New intent → 8480.79, denyChapters:['39']
 *
 *  3. NEW GLASSBLOWING_TORCH_PARTS_INTENT → 8419.89/8419.90 (scientific glass torch systems)
 *     "torch part" → 8205.60 WRONG (expected 8419.89)
 *     "Mega Minor Base Torch Only" → 8205.60 WRONG (expected 8419.90)
 *     "midrange base only torch" → 8205.60 WRONG (expected 8419.90)
 *     "Nortel ribbon torch tips" → 8468.10 WRONG (expected 8419.89)
 *     "Nortel midrange special burner parts" → 8416.20 WRONG (expected 8419.90)
 *     BUG: Scientific/glassblowing torch systems (Nortel brand) classified as blowtorches (8205.60)
 *          or burner equipment (8416.20), not industrial heaters/furnaces (8419).
 *     8419 = industrial or laboratory furnaces/ovens; hot-press/heat treatment apparatus
 *     FIX: New intent → 8419.89/8419.90, denyChapters:['82','84'] (82=hand tools, 84=other machinery)
 *          Note: allowChapters:['84'] since target IS ch.84
 *
 *  4. NEW STABILIZED_WOOD_BLANK_INTENT → 4403/4407 (raw/sawn wood)
 *     "Stabilized wood blanks - Alaskan yellow cedar burl" → 4420.11 WRONG (expected 4403.12)
 *     "Stabilized wood blanks - Birds eye maple" → 4420.11 WRONG (expected 4403.12)
 *     "Stabilized wood blanks - Black ash burl" → 4420.11 WRONG (expected 4403.12)
 *     BUG: Stabilized/resin-infused wood blanks (for pen turning, knife handles) classified as
 *          ornamental wood articles (4420). They are raw material: 4403 = wood in the rough.
 *     FIX: New intent → 4403.12/4407.10/4407.21, allowChapters:['44'], denyChapters:['95']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt91.ts
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

    // 1. FIX WOOL_YARN_FIBER_INTENT — remove 'nylon' from noneOf
    //    "300g 75%wool/25%nylon knitting yarn": tokens {300,g,75,wool,25,nylon,knitting,yarn}
    //    noneOf had 'nylon' → tokens.has('nylon')=TRUE → intent never fires for this query.
    //    The anyOfGroups:[['yarn']] + anyOf 'wool' still restrict to wool yarn queries.
    //    After removing 'nylon', denyChapters:['52','55'] blocks cotton/MMF results → ch.51 wins.
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        // Remove 'nylon' (blocks valid 75%wool/25%nylon queries) but keep other synthetic filters
        const updatedNoneOf = currentNoneOf.filter((t: string) => t !== 'nylon');
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: updatedNoneOf,
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 500, rule: updated });
        console.log(`WOOL_YARN_FIBER_INTENT: removed 'nylon' from noneOf (was blocking 75%wool/25%nylon queries)`);
        console.log(`  Updated noneOf: ${JSON.stringify(updatedNoneOf)}`);
      } else {
        console.log('WOOL_YARN_FIBER_INTENT: not found');
      }
    }

    // 2. NEW SILICONE_CRAFT_MOLD_INTENT → 8480.79/8480.71/8480.60 (molds for plastics/glass)
    //    Craft silicone molds (for resin, soap, chocolate, clay, epoxy casting) = 8480.79
    //    Ring casting molds for jewelry (glass/metal) = 8480.60 or 8480.71
    //    8480.71 = injection or compression type molds for rubber or plastics
    //    8480.79 = other molds for rubber or plastics
    //    8480.60 = molds for glass
    {
      const existing = allRules.find(r => r.id === 'SILICONE_CRAFT_MOLD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILICONE_CRAFT_MOLD_INTENT',
          description: 'Silicone/resin craft molds, casting molds, pottery molds → 8480 (molds for plastics/glass)',
          pattern: {
            anyOf: [
              // Silicone molds (craft/decorative)
              'silicone mold', 'silicone molds', 'silicone casting mold',
              'resin silicone mold', 'druzy silicone mold',
              'silicone soap mold', 'silicone candle mold',
              'silicone chocolate mold', 'silicone baking mold',
              'silicone cake mold', 'silicone ice mold',
              'silicone epoxy mold', 'silicone resin mold',
              // Craft/resin casting molds
              'resin mold', 'resin casting mold', 'epoxy mold',
              'casting mold', 'pour mold',
              // Ring/jewelry casting molds
              'ring casting mold', 'ring mold casting', 'casting ring mold',
              'jewelry casting mold', 'metal casting mold',
              // Pottery/ceramic molds
              'pottery mold', 'ceramic mold', 'clay mold',
              'slump mold', 'pottery slump mold',
              // Glass molds
              'glass mold', 'fusing mold', 'kiln mold',
            ],
            noneOf: [
              // Exclude mold/mildew (different concept)
              'mold removal', 'mold cleaner', 'mold treatment',
              'mold inhibitor', 'anti mold',
              // Exclude injection molding machines (8477)
              'injection molding machine', 'extrusion machine',
            ],
          },
          inject: [
            { prefix: '8480.79', syntheticRank: 2 },  // molds for rubber/plastics (other)
            { prefix: '8480.71', syntheticRank: 4 },  // injection/compression molds for rubber/plastics
            { prefix: '8480.60', syntheticRank: 6 },  // molds for glass
            { prefix: '8480.41', syntheticRank: 8 },  // injection molds for metals
          ],
          whitelist: {
            allowChapters: ['84'],                     // machinery chapter
            denyChapters: ['39', '73'],                // deny plastic tableware and iron/steel
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8480.' },
            { delta: 0.50, chapterMatch: '84' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '39' },       // strong penalty for plastic articles
            { delta: 0.50, chapterMatch: '73' },       // penalize iron/steel articles
          ],
        } as IntentRule;
        patches.push({ priority: 542, rule: newRule });
        console.log('SILICONE_CRAFT_MOLD_INTENT: created (craft molds → 8480.79, deny ch.39)');
      } else {
        console.log('SILICONE_CRAFT_MOLD_INTENT: already exists, skipping');
      }
    }

    // 3. NEW GLASSBLOWING_TORCH_PARTS_INTENT → 8419.89/8419.90 (scientific torch systems)
    //    These are Nortel-brand scientific/glassblowing torch systems and parts.
    //    They are heat treatment apparatus (8419), not hand-held blowtorches (8205.60).
    //    8419.89 = other industrial/laboratory furnaces and ovens; heating apparatus
    //    8419.90 = parts of industrial furnaces/ovens/heating apparatus
    //    8205.60 = blowtorches (hand-held torch tool) — WRONG for these systems
    {
      const existing = allRules.find(r => r.id === 'GLASSBLOWING_TORCH_PARTS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GLASSBLOWING_TORCH_PARTS_INTENT',
          description: 'Scientific/glassblowing torch systems and parts → 8419.89/8419.90 (heating apparatus)',
          pattern: {
            anyOf: [
              // Nortel brand (scientific glassblowing torches)
              'nortel ribbon torch', 'nortel midrange', 'nortel minor', 'nortel mega minor',
              'nortel torch', 'nortel burner', 'nortel torch tips', 'nortel burner parts',
              // Torch system parts (implying multi-gas industrial torch, not hand torch)
              'torch part', 'torch parts', 'torch body', 'torch head assembly',
              'torch base', 'torch only', 'ribbon burner', 'minor torch base',
              'mega minor base', 'midrange base', 'midrange torch',
              'bench burner', 'bench torch', 'flameworking torch',
              'lampworking torch', 'glassblowing torch',
              // Specific burner torch parts
              'burner torch part', 'burner torch assembly',
            ],
            noneOf: [
              // Exclude simple hand-held torches/flashlights
              'flashlight', 'led torch', 'pocket torch',
              // Exclude propane hand torches
              'propane torch kit', 'plumbing torch',
              // Exclude torch lighters/kitchen torches
              'kitchen torch', 'chef torch', 'creme brulee torch',
              'butane torch lighter',
            ],
          },
          inject: [
            { prefix: '8419.89', syntheticRank: 2 },  // other industrial/lab heating apparatus
            { prefix: '8419.90', syntheticRank: 4 },  // parts of industrial heating apparatus
            { prefix: '8468.10', syntheticRank: 6 },  // hand-directed torches/blowpipes
          ],
          whitelist: {
            allowChapters: ['84'],                     // machinery/equipment chapter
            denyChapters: ['82'],                      // deny hand tools (blowtorches at 8205.60)
          },
          boosts: [
            { delta: 0.85, prefixMatch: '8419.' },
            { delta: 0.50, chapterMatch: '84' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '82' },       // strong penalty for hand tools
            { delta: 0.40, prefixMatch: '8205.' },     // penalize blowtorches specifically
          ],
        } as IntentRule;
        patches.push({ priority: 541, rule: newRule });
        console.log('GLASSBLOWING_TORCH_PARTS_INTENT: created (torch parts → 8419.89/8419.90, deny ch.82)');
      } else {
        console.log('GLASSBLOWING_TORCH_PARTS_INTENT: already exists, skipping');
      }
    }

    // 4. NEW STABILIZED_WOOD_BLANK_INTENT → 4403/4407 (raw/sawn wood)
    //    "Stabilized wood blanks" are wood pieces (burls, blanks) infused with resin for turning.
    //    They are raw material in the form of wood, classifiable as 4403 (wood in rough).
    //    4403.12 = coniferous wood in rough (treated)
    //    4407.10 = coniferous wood, sawn/chipped lengthwise
    //    4407.21/4407.29 = non-coniferous wood (oak, tropical, etc.)
    {
      const existing = allRules.find(r => r.id === 'STABILIZED_WOOD_BLANK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STABILIZED_WOOD_BLANK_INTENT',
          description: 'Stabilized wood blanks, pen blanks, turning blanks → 4403/4407 (raw/sawn wood)',
          pattern: {
            anyOf: [
              // Stabilized wood blanks (resin-infused raw wood)
              'stabilized wood blank', 'stabilized wood blanks',
              'stabilized burl blank', 'stabilized burl blanks',
              'stabilized maple blank', 'stabilized oak blank',
              'stabilized cedar blank', 'stabilized ash blank',
              'stabilized wood burl',
              // Pen blanks (raw wood for pen turning)
              'pen blank', 'pen blanks', 'wood pen blank',
              'acrylic pen blank',  // though acrylic, sold like wood blanks at ch.44 adjacent
              // Turning blanks (lathe/woodworking)
              'turning blank', 'turning blanks', 'bowl blank', 'bowl turning blank',
              'spindle blank', 'knife blank', 'handle blank', 'scales blank',
              // Knife handle scales/blanks
              'knife handle blank', 'knife scale', 'handle scale',
              // Wood burl (raw)
              'wood burl', 'wood burl blank', 'burl blank',
              'maple burl', 'cedar burl', 'ash burl', 'walnut burl',
            ],
            noneOf: [
              // Exclude finished wood products
              'finished', 'lacquered', 'polished', 'varnished',
              // Exclude wood furniture
              'chair', 'table', 'shelf', 'drawer',
              // Exclude wood carving kits
              'carving kit',
            ],
          },
          inject: [
            { prefix: '4403.12', syntheticRank: 2 },  // coniferous wood in rough (treated)
            { prefix: '4403.49', syntheticRank: 4 },  // other non-coniferous wood in rough
            { prefix: '4407.10', syntheticRank: 6 },  // coniferous wood, sawn/chipped
            { prefix: '4407.21', syntheticRank: 8 },  // non-coniferous wood (oak)
            { prefix: '4407.99', syntheticRank: 10 }, // other sawn wood
          ],
          whitelist: {
            allowChapters: ['44'],                     // wood and articles of wood
            denyChapters: ['95', '42'],                // deny toys/games and leather goods
          },
          boosts: [
            { delta: 0.85, prefixMatch: '4403.' },
            { delta: 0.75, prefixMatch: '4407.' },
            { delta: 0.40, chapterMatch: '44' },
          ],
          penalties: [
            { delta: 0.60, chapterMatch: '95' },       // penalize toys
            { delta: 0.50, prefixMatch: '4420.' },     // penalize ornamental wood articles
          ],
        } as IntentRule;
        patches.push({ priority: 540, rule: newRule });
        console.log('STABILIZED_WOOD_BLANK_INTENT: created (wood blanks → 4403/4407, deny ch.95)');
      } else {
        console.log('STABILIZED_WOOD_BLANK_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT91)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT91 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
