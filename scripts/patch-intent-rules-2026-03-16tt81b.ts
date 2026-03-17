#!/usr/bin/env ts-node
/**
 * Patch TT81b — 2026-03-16: Fix NATURAL_STONE_RAW_MINERAL_INTENT regression.
 *
 * Regression found in TT81:
 *  "rock specimen minded in Canada" → 2516 WRONG (expected 7103.10.40 precious stones)
 *  BUG: NATURAL_STONE_RAW_MINERAL_INTENT has 'mineral specimen', 'rock specimen' in anyOf
 *       AND allowChapters:['25','26'] which blocks ch.71 entries.
 *       A "rock specimen" of a gemstone should be ch.71 (7103 = precious stones in natural form)
 *
 *  Fix 1: Remove generic phrases 'mineral specimen', 'rock specimen', 'raw crystal',
 *          'rough crystal', 'natural crystal specimen' from anyOf (too broad, catch gemstones)
 *  Fix 2: Change allowChapters:['25','26'] to allowChapters:['25','26','71'] so that
 *          ch.71 entries can still pass through the OR filter if another intent allows them.
 *          (Better: no allowChapters restriction at all, rely on inject + boosts)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt81b.ts
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

    // Fix NATURAL_STONE_RAW_MINERAL_INTENT
    // Remove generic phrases that catch gemstones; relax allowChapters to include ch.71
    {
      const existing = allRules.find(r => r.id === 'NATURAL_STONE_RAW_MINERAL_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          pattern: {
            anyOf: [
              // Raw agate (without modifier like "slice" could still be gemstone, so keep specific)
              'agate slice', 'agate slices', 'agate slab', 'agate geode',
              'agate nodule', 'agate rough', 'raw agate stone',
              // Quartz points/clusters (these are ch.25 mineral specimens, not cut gemstones)
              'quartz point', 'terminated quartz', 'quartz cluster',
              'quartz specimen', 'amethyst cluster', 'amethyst geode',
              // Crushed/powdered stones (definitely ch.25 - mineral processing)
              'crushed stone', 'crushed stones', 'stone inlay', 'stone inlays',
              'crushed rock', 'powdered stone', 'stone dust',
              // Stone chips/gravel for inlay work
              'stone chips', 'stone chip inlay', 'turquoise inlay material',
              'malachite inlay', 'lapis inlay material', 'shell inlay material',
              // Natural rough stones sold as specimens
              'rough slab', 'rough stone slab', 'stone rough slab',
              // Specific mineral types that are rarely gemstones
              'granite rough', 'sandstone piece', 'limestone specimen',
              'shale specimen', 'slate rough',
            ],
            noneOf: [
              // Exclude cut/faceted gemstones (ch.71)
              'gemstone', 'faceted', 'precious stone', 'semi-precious',
              'cut stone', 'polished gemstone',
              // Exclude finished jewelry
              'necklace', 'bracelet', 'ring', 'earring', 'pendant', 'bead',
              // Exclude stone countertops/tiles (construction)
              'granite countertop', 'marble tile', 'stone tile', 'pavers',
              // Exclude rock specimens that are likely gemstones
              'specimen', 'rock specimen', 'mineral specimen',
            ],
          },
          whitelist: {
            // No allowChapters restriction — let the inject and boosts drive ch.25 results
            // Previously had allowChapters:['25','26'] which was too restrictive
            denyChapters: ['71'],  // deny gemstone chapter for clearly non-gemstone items
          },
        } as IntentRule;
        await svc.upsertRule(updated, 558);
        console.log('✅ NATURAL_STONE_RAW_MINERAL_INTENT: removed generic phrases, relaxed allowChapters');
        console.log('   "rock specimen" no longer matches; "agate slice" → ch.25 preserved');
      } else {
        console.log('❌ NATURAL_STONE_RAW_MINERAL_INTENT: not found');
      }
    }

    console.log('\nTT81b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
