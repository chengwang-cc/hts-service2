#!/usr/bin/env ts-node
/**
 * Patch BBB — 2026-03-13:
 *
 * Fix regression from AAA: BUILDING_STONE_INTENT's bare 'mosaic cubes' anyOf term
 * fires for ceramic tile queries (ch.69) → allowSet=[68] → ch.69 excluded → wrong ch.68 result.
 *
 * Fix: Replace BUILDING_STONE_INTENT with updated version that removes bare 'mosaic cubes'
 * (uses only the full phrase 'mosaic cubes and the like of natural stone').
 * Also add 'ceramic','unglazed','glazed','porcelain','earthenware' to noneOf for safety.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13bbb.ts
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

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // Fix BUILDING_STONE_INTENT: 'mosaic cubes' bare term fired for ceramic tile queries (ch.69)
    // Remove 'mosaic cubes' from anyOf; keep only the full phrase which includes "natural stone".
    // Add ceramic material terms to noneOf to prevent ch.69 ceramic tile queries from matching.
    patches.push({
      priority: 650,
      rule: {
        id: 'BUILDING_STONE_INTENT',
        description:
          'Worked building/monumental stone → ch.68 (6801-6803). ' +
          'AAA: Initial version had bare "mosaic cubes" which fired for ceramic tile ch.69 queries. ' +
          'BBB: Removed bare "mosaic cubes"; kept only the phrase "mosaic cubes and the like of natural stone". ' +
          'Added ceramic/unglazed noneOf to prevent ch.69 ceramic tile matches.',
        pattern: {
          anyOf: [
            'monumental or building stone',
            'monumental or building',
            'building stone',
            'building purposes',
            'worked monumental',
            'mosaic cubes and the like of natural stone',
            'chippings and powder of natural stone',
            'artificially colored granules',
            'artificially coloured granules',
          ],
          noneOf: [
            'machinery', 'machine', 'machines', 'equipment',
            'electronics', 'electrical', 'computer',
            // ch.69 ceramic products context
            'ceramic', 'unglazed', 'glazed', 'porcelain', 'earthenware',
            'vitrified', 'stoneware', 'tile', 'tiles', 'brick', 'bricks',
          ],
        },
        whitelist: { allowChapters: ['68'] },
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch BBB)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch BBB complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
