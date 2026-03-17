#!/usr/bin/env ts-node
/**
 * Patch HHHH — 2026-03-13:
 *
 * Fix CRYSTAL_GEMSTONE_INTENT EMPTY results.
 *
 * Root cause:
 *   CRYSTAL_GEMSTONE_INTENT fires on 'crystal chips', 'obsidian', 'amethyst', etc.
 *   allowChapters=['71'] → only ch.71 entries allowed in result set.
 *   BUT: ch.71 embedding texts are "Precious stones (other than diamonds)...",
 *   "Unworked", "Cut but not set" — these don't semantically match specific mineral
 *   names. Score falls below 0.35 threshold → EMPTY.
 *
 * Fix:
 *   Add inject to CRYSTAL_GEMSTONE_INTENT so 7103 codes are always in the
 *   candidate pool when the rule fires, regardless of semantic score.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13hhhh.ts
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

    // ── FIX CRYSTAL_GEMSTONE_INTENT: add inject for 7103 codes ───────────────
    // The rule fires for 'crystal chips', 'obsidian', 'amethyst', etc. and
    // restricts to allowChapters=['71']. But ch.71 HTS entries ("Precious stones",
    // "Unworked", "Other") have low semantic similarity to specific mineral names.
    // Result: EMPTY (no ch.71 entry scores above threshold).
    // Fix: inject the main gemstone leaf codes so they always appear in candidates.
    {
      const existing = allRules.find(r => r.id === 'CRYSTAL_GEMSTONE_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 580,
          rule: {
            ...existing,
            description: 'Crystals/gemstones/minerals → 7103 (ch.71). ' +
              'Fixed: semantic scores too low for specific mineral names against generic HTS descriptions. ' +
              'Inject 7103.10.20.00 (unworked), 7103.10.40.00 (other), 7103.99.10.00 (cut for jewelry), ' +
              '7103.99.50.00 (other) into candidate pool.',
            inject: [
              { prefix: '7103.10.20.00', syntheticRank: 9 },  // Unworked semiprecious stones
              { prefix: '7103.10.40.00', syntheticRank: 8 },  // Other unworked/simply sawn
              { prefix: '7103.99.10.00', syntheticRank: 7 },  // Cut but not set, suitable for jewelry
              { prefix: '7103.99.50.00', syntheticRank: 6 },  // Other semiprecious stones
            ],
            boosts: [
              ...(existing.boosts ?? []),
              { delta: 0.5, prefixMatch: '7103' },
            ],
          },
        });
        console.log('CRYSTAL_GEMSTONE_INTENT: added inject for 7103 codes');
      } else {
        console.log('WARNING: CRYSTAL_GEMSTONE_INTENT not found in cache');
      }
    }

    // ── FIX AI_CH56_WADDING_BATTING: add inject for felt codes ───────────────
    // "5' Felt Ball Garland", "Felt Garland" → expected 5602.xx (ch.56 felt)
    // AI_CH56_WADDING_BATTING fires on 'felt' → allowChapters=['56']
    // But "garland" descriptions don't match wadding/batting HTS entries.
    // Fix: inject felt fabric codes.
    {
      const existing = allRules.find(r => r.id === 'AI_CH56_WADDING_BATTING') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 520,
          rule: {
            ...existing,
            description: existing.description + ' — Fixed: add inject for felt leaf codes for garland/craft items.',
            inject: [
              ...(existing.inject ?? []),
              { prefix: '5602.21.00.00', syntheticRank: 7 }, // Felt of wool or fine animal hair, not needleloom
              { prefix: '5602.29.00.00', syntheticRank: 6 }, // Felt of other textile materials
              { prefix: '5602.10.10.10', syntheticRank: 6 }, // Needleloom felt of jute
            ],
          },
        });
        console.log('AI_CH56_WADDING_BATTING: added inject for felt codes');
      } else {
        console.log('WARNING: AI_CH56_WADDING_BATTING not found');
      }
    }

    // ── NEW PLASTIC_TOY_FIGURINE_INTENT ───────────────────────────────────────
    // "100% plastic toy, figurine", "plastic action figure" → ch.95 toys
    // Currently EMPTY — no rule restricts/injects for plastic toys.
    // 9503.00.00.73: Other toy, of plastics (reduced duty).
    patches.push({
      priority: 520,
      rule: {
        id: 'PLASTIC_TOY_FIGURINE_INTENT',
        description: 'Plastic toy figurines/action figures → 9503.00.00.73 (ch.95). ' +
          'These consumer product names ("plastic toy", "action figure") get EMPTY or misrouted. ' +
          'Inject + allow ch.95.',
        pattern: {
          anyOf: [
            'action figure', 'plastic toy', 'plastic figurine', 'toy figurine',
            'doll figurine', 'plastic action figure', 'collectible figurine',
          ],
          noneOf: [
            'ceramic', 'porcelain', 'wood', 'wooden', 'rubber', 'plush', 'stuffed',
            'paper', 'cardboard', 'fabric', 'cloth',
          ],
        },
        whitelist: { allowChapters: ['95'] },
        inject: [{ prefix: '9503.00.00.73', syntheticRank: 8 }],
        boosts: [
          { delta: 0.4, prefixMatch: '9503' },
        ],
      } as IntentRule,
    });

    // ── NEW AUTOMOTIVE_FLOOR_MAT_INTENT ──────────────────────────────────────
    // "WeatherTech FloorLiner HP", "car floor mat", "auto floor liner" → ch.87 (8708.29)
    // Currently EMPTY. Automotive floor mats/liners are vehicle accessories.
    patches.push({
      priority: 530,
      rule: {
        id: 'AUTOMOTIVE_FLOOR_MAT_INTENT',
        description: 'Automotive floor mats/liners → 8708.29.50.60 (ch.87). ' +
          'WeatherTech, rubber/all-weather floor mats are vehicle parts (ch.87). ' +
          'Currently EMPTY due to low semantic match.',
        pattern: {
          anyOf: [
            'floor liner', 'floorliner', 'floor mat', 'floor mats', 'car mat',
            'auto mat', 'all-weather mat', 'all weather mat', 'cargo liner',
            'trunk mat', 'trunk liner', 'weathertech',
          ],
          anyOfGroups: [
            ['car', 'auto', 'automotive', 'vehicle', 'truck', 'suv', 'van'],
            ['mat', 'mats', 'liner', 'liner hp', 'pad'],
          ],
        },
        whitelist: { allowChapters: ['87'] },
        inject: [
          { prefix: '8708.29.50.60', syntheticRank: 8 },
          { prefix: '8708.29.10.00', syntheticRank: 7 },
        ],
        boosts: [{ delta: 0.4, prefixMatch: '8708.29' }],
      } as IntentRule,
    });

    // ── NEW SANDING_ABRASIVE_PAD_INTENT ──────────────────────────────────────
    // "Sanding Pads Fine 120 Grit" → ch.68 (6805.20 or 6805.30 coated abrasives)
    // Currently EMPTY. Sanding pads are coated abrasives (ch.68).
    patches.push({
      priority: 520,
      rule: {
        id: 'SANDING_ABRASIVE_PAD_INTENT',
        description: 'Sanding pads/discs/sheets (abrasives) → 6805 (ch.68). ' +
          'Sandpaper, sanding pads, abrasive discs are coated abrasives. ' +
          'Currently EMPTY due to semantic mismatch.',
        pattern: {
          anyOf: [
            'sanding pad', 'sanding pads', 'sanding disc', 'sanding discs',
            'sanding sheet', 'abrasive pad', 'abrasive disc', 'sanding block',
            'grit sandpaper', 'grit sanding',
          ],
          noneOf: [
            'water filter', 'grinding wheel', 'diamond wheel',
          ],
        },
        whitelist: { allowChapters: ['68'] },
        inject: [
          { prefix: '6805.20.00.00', syntheticRank: 8 }, // On a base of paper or paperboard
          { prefix: '6805.30.10.00', syntheticRank: 7 }, // On other base
          { prefix: '6805.10.00.00', syntheticRank: 6 }, // On textile base
        ],
        boosts: [{ delta: 0.4, prefixMatch: '6805' }],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch HHHH)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch HHHH complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
