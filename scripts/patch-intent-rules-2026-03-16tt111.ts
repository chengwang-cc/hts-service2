#!/usr/bin/env ts-node
/**
 * Patch TT111 — 2026-03-16: Add EMBROIDERY_HOOP_WOODEN_INTENT + WOODEN_COAT_HANGER_INTENT.
 *
 * Fix 1: NEW EMBROIDERY_HOOP_WOODEN_INTENT → 4421.99.88.00
 *   "Bamboo Embroidery Hoop, Cross Stitch Frame, Wooden Hoop Art" → 4421.91.20.00 WRONG (expected 4421.99.88.00)
 *   "DMC Bamboo Embroidery Hoop" → 4421.91.20.00 WRONG (expected 4421.99.88.00)
 *   "1x Medium Embroidery Hoops with Back Cover" → 4421.91.10.00 WRONG (expected 4421.99.88.00)
 *   Root cause: "embroidery hoop" lands in 4421 but in bamboo sub-codes (4421.91.xx) not 4421.99.88.
 *   4421.99.88.00 "Canoe paddles" is the catch-all for wooden articles not elsewhere specified.
 *   Fix: Inject 4421.99.88 at rank 1, allow 4421. prefix only, deny bamboo sub (4421.91.).
 *   Note: Plastic embroidery hoops → 9605 (exclude with noneOf).
 *
 * Fix 2: NEW WOODEN_COAT_HANGER_INTENT → 4421.10.00.00
 *   "Bold Flowers Coat Hanger" → ch.62 garment WRONG (expected 4421.10.00.00)
 *   "Engraved Wooden Clothes Hanger" → ch.62 garment WRONG (expected 4421.10.00.00)
 *   "wooden clothing rack" → ch.62 or furniture WRONG (expected 4421.10.00.00)
 *   Root cause: "coat" in "coat hanger" triggers garment chapter scoring; semantic matches coats.
 *   Fix: New intent fires for hanger/rack queries, injects 4421.10 at rank 1, denies garment chapters.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt111.ts
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

    // 1. NEW EMBROIDERY_HOOP_WOODEN_INTENT → 4421.99.88.00
    //    Embroidery hoops (wooden/bamboo) are classified as 4421.99.88.00 in dataset.
    //    "embroidery hoop" → lexical lands in 4421 but bamboo sub-code 4421.91.xx not 4421.99.88.
    //    Inject 4421.99.88 at rank 1 and allow only 4421. prefix.
    //    Plastic hoops (9605) excluded via noneOf.
    {
      const existing = allRules.find(r => r.id === 'EMBROIDERY_HOOP_WOODEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'EMBROIDERY_HOOP_WOODEN_INTENT',
          description: 'Wooden/bamboo embroidery hoops → 4421.99.88.00, deny 4421.91 bamboo sub-codes',
          pattern: {
            anyOf: [
              'embroidery hoop', 'embroidery hoops',
              'cross stitch hoop', 'cross stitch frame',
              'needlework hoop', 'needlework frame',
              'wooden embroidery hoop', 'bamboo embroidery hoop',
              'bamboo hoop', 'wooden hoop art',
              'hoop for punch needle', 'hoop for needlework',
            ],
            noneOf: [
              // Plastic hoops → 9605
              'plastic embroidery hoop', 'plastic hoop',
              // Fabric/textile hoops
              'no slip hoop', 'no-slip hoop',
            ],
          },
          inject: [
            { prefix: '4421.99.88', syntheticRank: 1 },  // wooden articles (catch-all for hoops)
            { prefix: '4421.99.40', syntheticRank: 4 },  // other wooden articles
          ],
          whitelist: {
            allowPrefixes: ['4421.'],   // restrict to wooden articles chapter 44 sub-heading
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4421.99.88' },  // very strong boost for target code
            { delta: 0.70, prefixMatch: '4421.' },        // moderate boost for wood articles
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4421.91.' },    // penalty for bamboo sub-code (wrong)
          ],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('EMBROIDERY_HOOP_WOODEN_INTENT: created (embroidery hoop → 4421.99.88.00, allowPrefixes:[4421.])');
      } else {
        console.log('EMBROIDERY_HOOP_WOODEN_INTENT: already exists, skipping');
      }
    }

    // 2. NEW WOODEN_COAT_HANGER_INTENT → 4421.10.00.00
    //    "coat hanger" → lexical + semantic returns ch.62 garment codes (coat = overcoat).
    //    4421.10.00.00 is "Clothes hangers" — correct for wooden/clothing hangers.
    //    noneOf excludes wall-mounted coat racks (→ 4421.99.94 edge-glued lumber).
    //    denyChapters excludes garment chapters 61 + 62.
    {
      const existing = allRules.find(r => r.id === 'WOODEN_COAT_HANGER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_COAT_HANGER_INTENT',
          description: 'Coat/clothes hangers → 4421.10.00.00 (clothes hangers), deny garment chapters',
          pattern: {
            anyOf: [
              'coat hanger', 'coat hangers',
              'clothes hanger', 'clothes hangers',
              'clothing hanger', 'clothing hangers',
              'wooden hanger', 'wooden hangers',
              'wood hanger', 'wood hangers',
              'wooden clothes hanger', 'engraved wooden clothes hanger',
              'clothes rack', 'clothing rack', 'wooden clothing rack',
            ],
            noneOf: [
              // Wall-mounted coat racks with shelf → 4421.99.94
              'wall coat rack', 'wall shelf', 'shelf with hooks',
              // Freestanding furniture racks → 9403
              'household use', 'for household',
            ],
          },
          inject: [
            { prefix: '4421.10', syntheticRank: 1 },     // clothes hangers (top pick)
            { prefix: '4421.99.94', syntheticRank: 4 },  // edge-glued lumber (wall rack fallback)
          ],
          whitelist: {
            denyChapters: ['61', '62'],   // hard-block garment chapters
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4421.10' },  // very strong boost for clothes hangers
            { delta: 0.50, prefixMatch: '4421.' },     // boost for wood articles
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6201.' },  // penalty: men's coats
            { delta: 0.90, prefixMatch: '6202.' },  // penalty: women's coats
            { delta: 0.90, prefixMatch: '9403.' },  // penalty: furniture
          ],
        } as IntentRule;
        patches.push({ priority: 575, rule: newRule });
        console.log('WOODEN_COAT_HANGER_INTENT: created (coat hanger → 4421.10.00.00, denyChapters:[61,62])');
      } else {
        console.log('WOODEN_COAT_HANGER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT111)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT111 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
