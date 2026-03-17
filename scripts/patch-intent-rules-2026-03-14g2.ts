#!/usr/bin/env ts-node
/**
 * Patch G2 — 2026-03-14:
 *
 * Fixes from F2 regressions:
 * 1. Re-enable GLASS_DECANTER_VESSEL_INTENT without allowChapters restriction.
 *    Without allowChapters=['70'], ch.96 (thermos carafes) won't be blocked.
 *    The inject+boost should push 7010.90/7013 to top without restricting ch.96.
 *    Also inject 7013 codes for "Decanter and Shot Glass Set" type queries.
 *
 * New fixes:
 * 2. FRESH_FLOWER_INTENT noneOf: remove overly-broad terms that block actual flower queries.
 *    Keep only: decanter, carafe, vase, essential oil, soap, lotion, perfume (product-specific)
 *    Remove: crystal, stone, fabric, tie, necktie — these might block legitimate flower+material combos
 *
 * 3. INDOOR_PLANT_INTENT noneOf fix: 'herb' fires for too many non-plant queries.
 *    Add 'herbal' to noneOf? No — 'herb' and 'herbal' are different tokens.
 *    Actually check if 'herb' causes issues.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14g2.ts
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

    // ── 1. Re-enable GLASS_DECANTER_VESSEL_INTENT without allowChapters ───────
    // F2 disabled it because allowChapters=['70'] blocked ch.96 (thermos) for carafes.
    // Solution: remove allowChapters → ch.96 can still win for thermos/vacuum carafes
    // but we inject/boost ch.70 codes so they beat the semantic winner for glass decanters.
    // Also: inject both 7010.90 (food containers) AND 7013 (glassware for table) to cover
    // both "Decanter Set" (7010.90) and "Decanter and Shot Glass Set" (7013.28.60).
    patches.push({
      priority: 575,
      rule: {
        id: 'GLASS_DECANTER_VESSEL_INTENT',
        description: 'Glass decanters, carafes, and glass vessels for spirits/drinks → ch.70. ' +
          '"Decanter set", "whisky carafe", "glass carafe" → 7010.90 or 7013. ' +
          'No allowChapters so thermos/insulated carafes (9617) can still rank first. ' +
          'F2 fix: removed allowChapters to avoid blocking ch.96.',
        pattern: {
          anyOf: [
            'decanter', 'decanters', 'decanter set', 'whisky decanter', 'whiskey decanter',
            'wine decanter', 'carafe', 'carafes', 'glass carafe', 'water carafe',
            'glass bottle set', 'spirit decanter',
          ],
          noneOf: ['plastic decanter', 'ceramic decanter', 'insulated carafe',
            'thermos carafe', 'vacuum carafe', 'thermal carafe'],
        },
        // NO allowChapters - let semantic rank ch.96 for thermos naturally
        inject: [
          { prefix: '7010.90', syntheticRank: 9 }, // Glass containers for food/drink
          { prefix: '7013.28', syntheticRank: 8 }, // Glassware for table (crystal)
          { prefix: '7013.37', syntheticRank: 7 }, // Other glassware for table
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '7010.90' },
          { delta: 0.5, prefixMatch: '7013' },
          { delta: 0.3, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 2. FRESH_FLOWER_INTENT: narrow the noneOf from F2 ────────────────────
    // Remove some overly broad noneOf terms added in F2 that might block valid flower queries
    // Keep: decanter, carafe, vase, essential oil, soap, lotion, perfume (clearly non-flower products)
    // Keep: fabric (rose fabric, lily fabric pattern → non-flower)
    // Remove from noneOf: crystal, stone, quartz, tie, necktie, lapel, pocket square
    //   (these could appear in product names alongside actual flowers)
    {
      const existing = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT') as IntentRule | undefined;
      if (existing) {
        const toRemoveFromNoneOf = new Set(['quartz', 'crystal', 'stone', 'tie', 'necktie', 'lapel', 'pocket square']);
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const newNoneOf = currentNoneOf.filter((t: string) => !toRemoveFromNoneOf.has(t));
        if (newNoneOf.length !== currentNoneOf.length) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'FRESH_FLOWER_INTENT') + ' — Fixed G2: narrowed noneOf (kept decanter/soap/fabric; removed crystal/stone/tie)',
              pattern: { ...pat, noneOf: newNoneOf },
            },
          });
          console.log(`FRESH_FLOWER_INTENT: removed ${currentNoneOf.length - newNoneOf.length} overly-broad noneOf terms`);
        }
      } else {
        console.log('WARNING: FRESH_FLOWER_INTENT not found');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch G2)...`);
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
    console.log(`\nPatch G2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
