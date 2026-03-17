#!/usr/bin/env ts-node
/**
 * Patch TT63 — 2026-03-15: Fix carved shell/bone, dog grooming brush, lace crown, makeup brushes.
 *
 * Fixes:
 *  1. NEW CARVED_NATURAL_SHELL_BONE_INTENT → 9601.90 (worked shell, bone, ivory articles)
 *     "handmade carved seashell brooch pin" → 7117.90 (jewelry!) WRONG
 *     "bone tablet weaving cards" → 8471.30 (computers!) WRONG — "tablet" triggers PC
 *     "beaded necklace made of shell material" → 7117 WRONG (but hits in top-10)
 *     BUG: "brooch pin" triggers jewelry chapter; "tablet" triggers computer chapter
 *     9601.90 = worked bone, shell, horn, ivory (not coral, not natural unworked)
 *  2. NEW PET_GROOMING_BRUSH_KIT_INTENT → 9603.29 (brushes/brooms)
 *     "Dog grooming starter brush kit" → 8510.20 (electric shavers!) WRONG
 *     BUG: "grooming" triggers electric grooming/shavers (8510) even for manual brush kits
 *     9603.29 = other brushes (pet brushes, nail brushes, etc.)
 *  3. NEW LACE_CROWN_HAT_HEADPIECE_INTENT → 6502.00 (hat-shapes, not knitted)
 *     "cotton lace crown" → 5804.30 (lace fabric!) WRONG — "lace" triggers fabric
 *     BUG: "lace" in "cotton lace crown" triggers lace fabric chapter (58)
 *     6502.00 = hat shapes/hoods of felt or woven/plaited material (includes lace headpieces)
 *  4. UPDATE MAKEUP_BRUSH existing intent to ensure correct classification
 *     "make up brush" → 3304.10 (cosmetics!) at position 1, but 9603 hits in top-10
 *     No rule needed if it's hitting; verify only
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt63.ts
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

    // 1. CARVED_NATURAL_SHELL_BONE_INTENT → 9601.90 (worked shell, bone, horn, ivory)
    //    "handmade carved seashell brooch pin made from natural seashell" → 7117.90 WRONG
    //    "Bone Tablet Weaving Cards (set of 4)" → 8471.30 (computers!) WRONG — "tablet" triggers PC
    //    "ANTIQUE POWDER HORN" → 0507.10 (unworked horn) — close but 9601 is more specific
    //    BUG: "brooch pin" triggers jewelry (7117) — brooch = jewelry piece
    //    BUG: "tablet" triggers computer tablets (8471) — bone tablet = a flat bone piece
    //    9601.10 = worked ivory (elephant, walrus, narwhal tusk)
    //    9601.90 = other worked materials (shell, bone, horn, tortoiseshell, coral)
    {
      const existing = allRules.find(r => r.id === 'CARVED_NATURAL_SHELL_BONE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CARVED_NATURAL_SHELL_BONE_INTENT',
          description: 'Carved seashell brooches, bone weaving cards, horn artifacts → ch.96 (9601.90)',
          pattern: {
            anyOf: [
              // Seashell/shell carved articles
              'carved seashell', 'seashell brooch', 'seashell brooch pin',
              'natural seashell carving', 'shell brooch', 'shell carving',
              'carved shell', 'shell pin brooch',
              // Bone carved articles
              'bone weaving cards', 'bone tablet weaving', 'bone comb',
              'carved bone', 'bone carving', 'antler carving',
              'bone handle', 'bone bead',
              // Horn/antler artifacts
              'powder horn', 'antique powder horn', 'horn snuff box',
              'antler button', 'horn button',
              // Coral carved
              'carved coral', 'coral figurine',
            ],
            noneOf: [
              // Exclude actual jewelry (precious metal settings)
              '14k gold', '18k gold', 'sterling silver', 'gold set',
              // Exclude glass/plastic imitations
              'faux shell', 'synthetic shell',
            ],
          },
          inject: [
            { prefix: '9601.90', syntheticRank: 5 },
            { prefix: '9601.10', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['71', '84'],
            denyPrefixes: ['7113', '7117.90'],
          },
          boosts: [{ delta: 0.65, prefixMatch: '9601.' }],
        } as IntentRule;
        patches.push({ priority: 584, rule: newRule });
        console.log('CARVED_NATURAL_SHELL_BONE_INTENT: created (shell/bone articles → 9601.90, deny ch.71/84)');
      }
    }

    // 2. PET_GROOMING_BRUSH_KIT_INTENT → 9603.29 (other brushes)
    //    "Dog grooming starter brush kit" → 8510.20 (electric shavers!) WRONG
    //    BUG: "grooming" triggers electric pet grooming category (8510 = shavers/trimmers)
    //    9603.29 = other brushes (including pet brushes, slicker brushes, dematting brushes)
    //    8510.20 = electric shavers/hair-clippers (includes electric pet clippers)
    //    Key distinction: "brush kit" = manual brushes, "clippers" = electric
    {
      const existing = allRules.find(r => r.id === 'PET_GROOMING_BRUSH_KIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PET_GROOMING_BRUSH_KIT_INTENT',
          description: 'Pet/dog grooming manual brushes, slicker brushes, pet brush kits → ch.96 (9603.29)',
          pattern: {
            anyOf: [
              // Dog/pet grooming brush kits
              'dog grooming brush kit', 'grooming brush kit', 'pet brush kit',
              'dog brush kit', 'cat brush kit',
              // Manual pet brushes
              'slicker brush dog', 'slicker brush pet', 'pet slicker brush',
              'dematting brush', 'deshedding brush', 'undercoat brush',
              'pin brush dog', 'bristle brush dog', 'fur brush pet',
              // Grooming starter kits with brushes
              'grooming starter kit brush', 'starter brush kit dog',
              'pet grooming brush', 'dog brush manual',
            ],
            noneOf: [
              // Exclude electric grooming (clippers, trimmers)
              'electric clipper', 'grooming clippers', 'pet clipper',
              'cordless groomer', 'electric trimmer pet',
            ],
          },
          inject: [
            { prefix: '9603.29', syntheticRank: 5 },
            { prefix: '9603.21', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['85'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '9603.' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('PET_GROOMING_BRUSH_KIT_INTENT: created (pet brush kits → 9603.29, deny ch.85 electric)');
      }
    }

    // 3. LACE_CROWN_HAT_HEADPIECE_INTENT → 6502.00 (hat-shapes of plaited/woven material)
    //    "cotton lace crown" → 5804.30 (lace fabric!) WRONG — "lace" triggers fabric chapter
    //    BUG: "lace" in product name triggers ch.58 (lace/embroidery) not ch.65 (headgear)
    //    6502.00 = hat shapes/hoods of felt, woven, or of plaited/assembled material
    //    6505.00 = hats and headgear, knitted/crocheted or of any material
    {
      const existing = allRules.find(r => r.id === 'LACE_CROWN_HAT_HEADPIECE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LACE_CROWN_HAT_HEADPIECE_INTENT',
          description: 'Lace crowns, lace headpieces, cotton lace hats → ch.65 (6502.00/6505.00)',
          pattern: {
            anyOf: [
              // Lace crowns/headpieces
              'lace crown', 'cotton lace crown', 'lace headpiece', 'lace crown hat',
              'bridal lace crown', 'wedding lace crown',
              'lace tiara', 'lace fascinator',
              'crochet crown hat', 'lace sun hat',
              // Straw/woven hat shapes
              'woven hat crown', 'plaited hat', 'straw hat crown',
            ],
            noneOf: [
              'dental crown', 'crown jewel', 'crown molding', 'crown ring',
            ],
          },
          inject: [
            { prefix: '6502.00', syntheticRank: 5 },
            { prefix: '6505.00', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['58', '57'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '6502.' }],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('LACE_CROWN_HAT_HEADPIECE_INTENT: created (lace crown → 6502.00, deny ch.58 lace fabric)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT63)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT63 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
