#!/usr/bin/env ts-node
/**
 * Patch TT114 — 2026-03-16: Update BALLOON_INTENT + new focused fixes.
 *
 * Fix 1: UPDATE BALLOON_INTENT — add plural forms, inject 4016.95 (rubber balloons)
 *   "36\" Latex Party Balloons" → 4011 (tires!) WRONG (expected 4016.95.00.00)
 *   "tuftex Monster Truck Balloon garland" → HIT via BALLOON_GARLAND_ARCH_INTENT ✓
 *   Root cause: BALLOON_INTENT has "balloon" (singular) but query has "balloons" (plural).
 *   tokenizeQuery doesn't stem, so "balloons" ≠ "balloon" token. Intent doesn't fire.
 *   Fix: Add plural forms "balloons", "latex balloons", "foil balloons" to anyOf.
 *   Also add inject 4016.95 at rank 4 (latex/rubber party balloons) alongside 9505.90.
 *
 * Fix 2: UPDATE WOODEN_COAT_HANGER_INTENT — add more phrases to match wall coat racks.
 *   "Handmade Wood Wall Coat Rack with Shelf" → garment codes WRONG (expected 4421.99.94.00)
 *   "Rustic Wall Organizer with Shelf and Hooks - Handmade Wood Mail Holder" → 0 WRONG
 *   But: "Handmade Wood Wall Coat Rack with Shelf" has "coat rack" in WOODEN_COAT_HANGER_INTENT
 *   but gets caught by noneOf "wall coat rack" (which IS a substring of "wood wall coat rack").
 *   Fix approach: For wall coat racks and organizers, add a separate WALL_COAT_RACK_INTENT
 *   targeting "wall coat rack", "wall organizer with hooks", etc. → 4421.99.94.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt114.ts
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

    // 1. UPDATE BALLOON_INTENT — add plural forms and inject 4016.95
    //    "36 Latex Party Balloons" has "balloons" token but rule only matches "balloon" (singular).
    //    tokenizeQuery doesn't stem, so the intent doesn't fire for plural queries.
    //    Adding plural forms to anyOf and injecting 4016.95 (rubber inflatable) at rank 4.
    {
      const existing = allRules.find(r => r.id === 'BALLOON_INTENT');
      if (existing) {
        const currentAnyOf = (existing as any).pattern?.anyOf || [];
        const addAnyOf = [
          'balloons', 'latex balloons', 'foil balloons',
          'helium balloons', 'mylar balloons', 'party balloon',
          'party balloons', 'balloon number', 'number balloon',
          'letter balloon', 'shape balloon',
        ];
        const currentInject = (existing as any).inject || [];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            anyOf: [...new Set([...currentAnyOf, ...addAnyOf])],
          },
          inject: [
            { prefix: '4016.95', syntheticRank: 4 },  // rubber/latex party balloons (NEW, higher priority)
            { prefix: '9505.90', syntheticRank: 8 },   // festive articles (was rank 22)
            { prefix: '8801.00', syntheticRank: 15 },  // balloons/airships (for foil number balloons)
          ],
          boosts: [
            { delta: 0.70, prefixMatch: '4016.95' },  // strong boost for rubber balloons
            { delta: 0.55, chapterMatch: '95' },        // moderate boost for festive
          ],
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 560, rule: updated });
        console.log('BALLOON_INTENT: added plural forms, inject 4016.95 rank4, 9505.90 rank8');
      } else {
        console.log('BALLOON_INTENT: not found');
      }
    }

    // 2. NEW WALL_COAT_RACK_SHELF_INTENT → 4421.99.94.00 (edge-glued lumber)
    //    "Handmade Wood Wall Coat Rack with Shelf" → garment codes (expected 4421.99.94.00)
    //    "Rustic Wall Organizer with Shelf and Hooks - Handmade Wood Mail Holder" → empty
    //    "Rustic Farmhouse Wall Shelf with Hooks - Handmade Reclaimed Wood Entryway Organizer"
    //    These are wall-mounted coat racks/organizers made of wood → 4421.99.94.00.
    //    WOODEN_COAT_HANGER_INTENT excluded them via noneOf (wall coat rack / shelf with hooks).
    //    WOODEN_FURNITURE_HOUSEHOLD_INTENT routes wood items to ch.94 (furniture).
    //    4421.99.94 is "edge-glued lumber" which is what dataset uses for wall wood organizers.
    {
      const existing = allRules.find(r => r.id === 'WALL_COAT_RACK_SHELF_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WALL_COAT_RACK_SHELF_INTENT',
          description: 'Wall-mounted wood coat racks, organizers with hooks → 4421.99.94.00 (edge-glued lumber)',
          pattern: {
            anyOf: [
              'wall coat rack', 'wall coat rack with shelf',
              'wall organizer with hooks', 'wall organizer with shelf',
              'wall shelf with hooks', 'shelf with hooks',
              'entryway organizer', 'entryway coat rack',
              'key rack', 'wall key rack',
              'wood mail holder', 'mail holder with hooks',
            ],
            noneOf: [
              // Exclude items that are clearly furniture (not wall-mounted small articles)
              'shoe rack', 'bike rack', 'dish rack', 'wine rack',
            ],
          },
          inject: [
            { prefix: '4421.99.94', syntheticRank: 1 },  // edge-glued lumber (wall organizers)
            { prefix: '4421.99.98', syntheticRank: 4 },  // other wood articles
          ],
          whitelist: {
            allowChapters: ['44'],     // positive filter: only allow ch.44 wood articles
            denyChapters: ['61', '62'],  // hard-block garment chapters
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4421.99.94' },  // very strong boost
            { delta: 0.60, prefixMatch: '4421.' },         // general wood boost
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9403.' },  // penalty for furniture
            { delta: 0.90, prefixMatch: '6201.' },  // penalty for coats
            { delta: 0.90, prefixMatch: '6202.' },  // penalty for women's coats
          ],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('WALL_COAT_RACK_SHELF_INTENT: created (wall coat rack → 4421.99.94.00, allowChapters:[44])');
      } else {
        console.log('WALL_COAT_RACK_SHELF_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT114)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT114 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
