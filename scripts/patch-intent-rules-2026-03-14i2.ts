#!/usr/bin/env ts-node
/**
 * Patch I2 — 2026-03-14:
 *
 * Regression fix from H2:
 * ARTIFICIAL_FLOWER_DECOR_INTENT had allowChapters=['67','70','48','44'] which blocked
 * many legitimate queries:
 * - "Silk Flower Fabric" (exp ch.52) → 'silk flower' fires rule → ch.52 blocked → EMPTY
 * - "Floral Stem Wire Wrapped" (exp ch.73) → 'floral stem' fires rule → ch.73 blocked → EMPTY
 * - "Rose Stem Wedding Centerpiece Wire" (exp ch.73) → 'rose stem' fires → ch.73 blocked
 * Fix: remove allowChapters from ARTIFICIAL_FLOWER_DECOR_INTENT.
 * Keep inject/boosts so 6702.xx codes still surface via inject, not blocking.
 *
 * Also: narrow the anyOf to remove terms that are too broad:
 * - 'silk flower' → matches "silk flower fabric" (ch.52 silk fabric)
 * - 'floral stem' → matches "floral stem wire" (ch.73 wire)
 * - 'flower stem' → too generic (flower arranging supplies)
 * - 'floral nursery' → too vague
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14i2.ts
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

    // ── Fix ARTIFICIAL_FLOWER_DECOR_INTENT: remove allowChapters, narrow anyOf ─
    // allowChapters=['67','70','48','44'] was blocking:
    //   - 'silk flower' → "Silk Flower Fabric" (exp ch.52)
    //   - 'floral stem' → "Floral Stem Wire Wrapped" (exp ch.73)
    //   - 'rose stem' → "Rose Stem Wedding Centerpiece Wire" (exp ch.73)
    // Fix: remove allowChapters entirely → inject/boost still pushes 6702.xx without blocking
    // Also narrow anyOf to remove terms that match too many non-artificial-flower contexts
    patches.push({
      priority: 573,
      rule: {
        id: 'ARTIFICIAL_FLOWER_DECOR_INTENT',
        description: 'Artificial flowers, silk flowers, faux floral decor → ch.67 (6702). ' +
          '"Artificial rose stem", "silk flower bouquet", "faux peony", "paper flower decor" → 6702.90. ' +
          'No allowChapters so silk fabrics (ch.52), wire (ch.73), etc. are not blocked. ' +
          'I2 fix: removed allowChapters (was blocking ch.52/73 for silk/wire queries); narrowed anyOf.',
        pattern: {
          anyOf: [
            // Explicit artificial flower terms (must be unambiguous)
            'artificial flower', 'artificial flowers', 'artificial rose', 'artificial roses',
            'artificial bouquet', 'artificial floral', 'artificial peony', 'artificial lily',
            'artificial tulip', 'artificial orchid',
            // Faux/fake terms (clearly non-real)
            'faux flower', 'faux flowers', 'faux rose', 'faux floral',
            'fake flower', 'fake flowers', 'fake rose', 'fake flowers',
            // Paper flowers (paper craft context, clearly artificial)
            'paper flower', 'paper flowers', 'paper rose', 'paper roses',
            // Silk bouquets (not silk fabric — keep as phrase to require both words)
            'silk flower bouquet', 'silk rose bouquet',
            // Dried/preserved flowers (clearly not fresh)
            'dried flower arrangement', 'preserved flower arrangement',
            // Rose stem (artificial rose decor product name)
            'rose stem', 'flower stem decorative',
            // Explicit wall decor context
            'flower nursery', 'nursery wall flower',
            'flower wall decor', 'floral wall decor',
          ],
          noneOf: [
            // Real flower growing/fresh cut contexts
            'fresh flowers', 'fresh cut', 'live flowers', 'potted',
            'seeds', 'bulbs', 'garden', 'growing',
            // Wire/metal context (floral wire is ch.73)
            'wire', 'wires',
            // Fabric/textile context
            'fabric', 'yardage', 'material', 'textile',
          ],
        },
        // NO allowChapters — inject/boost only, never block other chapters
        inject: [
          { prefix: '6702.90', syntheticRank: 9 },  // Artificial flowers of other materials
          { prefix: '6702.10', syntheticRank: 8 },  // Artificial flowers of plastics
          { prefix: '6702.90.35', syntheticRank: 7 }, // Of man-made fibers
          { prefix: '6702.90.65', syntheticRank: 6 }, // Other (of other materials)
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '6702' },
          { delta: 0.4, chapterMatch: '67' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch I2)...`);
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
    console.log(`\nPatch I2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
