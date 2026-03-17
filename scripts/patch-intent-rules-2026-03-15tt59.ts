#!/usr/bin/env ts-node
/**
 * Patch TT59 — 2026-03-15: Fix EMPTY regressions from TT58 + new cross-chapter fixes.
 * Current: ~35.04% (1761/5025), EMPTY: 24 (up from 21 due to TT58 denyChapters: ['34'])
 *
 * Fixes:
 *  1. UPDATE CANDLE_ACCESSORY_SNUFFER_INTENT — remove denyChapters: ['34'] causing EMPTY
 *     "candle snuffer" → EMPTY (TT58 denies ch.34 but injection doesn't survive threshold)
 *     "silver plated candle snuffer" → EMPTY
 *     FIX: remove denyChapters to prevent EMPTY; inject + boost handles ranking
 *  2. NEW SEMIPRECIOUS_LOOSE_STONE_BEADS_INTENT → 7103.99 (loose unworked stones)
 *     "semi precious gemstone beads" → 7116.20 (articles of stones!) WRONG — 7103 = raw stones
 *     "turquoise beads" → 7116.20 WRONG — should be 7103.99 (unworked/simply sawn)
 *     BUG: "gemstone beads" triggers 7116 (articles = worked jewelry) not 7103 (raw stones)
 *  3. NEW OIL_DIPSTICK_ENGINE_PART_INTENT → 8413.30 (parts for engine oil systems)
 *     "Automotve oil level dipstick" → 2710.91 (petroleum oils!) WRONG
 *     BUG: "oil" triggers petroleum chapter (ch.27) instead of engine parts (ch.84)
 *  4. NEW AMETHYST_CRYSTAL_MINERAL_INTENT → 7103.10 (precious/semi-precious stones, unworked)
 *     "amethyst crystal cluster" → 7103.91 / wrong sub
 *     "amethyst stone beads" → 7018.10 (glass beads!) WRONG — "crystal" triggers glass
 *     BUG: "crystal" in mineral context triggers glass chapter (7018)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt59.ts
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

    // 1. UPDATE CANDLE_ACCESSORY_SNUFFER_INTENT — remove denyChapters: ['34'] causing EMPTY
    //    TT58 added denyChapters: ['34'] which removes ALL ch.34 candidates
    //    When 7323.99 injection doesn't survive 0.35 threshold → EMPTY results
    //    FIX: remove denyChapters, keep inject + boost — boost handles ranking without EMPTY risk
    {
      const existing = allRules.find(r => r.id === 'CANDLE_ACCESSORY_SNUFFER_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            // Remove denyChapters: ['34'] — was causing EMPTY results
            // Just inject the right code with a strong boost instead
          },
          inject: [
            { prefix: '7323.99', syntheticRank: 5 },
            { prefix: '7326.90', syntheticRank: 5 },
            { prefix: '7114.11', syntheticRank: 5 }, // silver-plated snuffers go to 7114
          ],
          boosts: [
            { delta: 0.65, prefixMatch: '7323.' },
            { delta: 0.60, prefixMatch: '7114.' },
          ],
        } as IntentRule;
        patches.push({ priority: 574, rule: updated });
        console.log('CANDLE_ACCESSORY_SNUFFER_INTENT: removed denyChapters[34] (was causing EMPTY)');
      } else {
        console.log('CANDLE_ACCESSORY_SNUFFER_INTENT: not found (apply TT58 first)');
      }
    }

    // 2. SEMIPRECIOUS_LOOSE_STONE_BEADS_INTENT → 7103.99 (raw/unworked semi-precious stones)
    //    "semi precious gemstone beads" → 7116.20.30 (articles of stones!) WRONG
    //    "turquoise beads" → 7116.20 WRONG — should be 7103.99
    //    "gemstone beads lot" → 7116.20 WRONG
    //    7103 = precious/semi-precious stones, not mounted or set (raw stones, beads)
    //    7116 = articles OF precious/semi-precious stones (finished jewelry, figurines)
    //    BUG: "gemstone beads" triggers 7116 (articles) not 7103 (raw stones)
    {
      const existing = allRules.find(r => r.id === 'SEMIPRECIOUS_LOOSE_STONE_BEADS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SEMIPRECIOUS_LOOSE_STONE_BEADS_INTENT',
          description: 'Loose semi-precious stone beads, gemstone bead lots → ch.71 (7103.99)',
          pattern: {
            anyOf: [
              // Generic stone bead terms
              'gemstone beads', 'gemstone bead', 'semi precious beads', 'semi precious stone beads',
              'semiprecious beads', 'precious stone beads',
              // Turquoise
              'turquoise beads', 'turquoise bead', 'turquoise stone beads',
              'turquoise chips', 'turquoise nugget beads',
              // Labradorite
              'labradorite beads', 'labradorite bead',
              // Moonstone
              'moonstone beads', 'moonstone bead',
              // Jasper
              'jasper beads', 'red jasper beads', 'picture jasper beads',
              // Other stone beads
              'onyx beads', 'onyx stone beads', 'tiger eye beads',
              'malachite beads', 'lapis lazuli beads',
              'obsidian beads', 'hematite beads',
              // Loose bead lots
              'loose gemstone beads', 'gemstone bead lot', 'stone bead lot',
              'bulk gemstone beads', 'strand of beads gemstone',
            ],
            noneOf: [
              // Exclude glass/seed beads
              'glass beads', 'seed beads', 'glass seed beads',
              // Exclude finished articles (go to 7116)
              'beaded necklace', 'beaded bracelet', 'beaded jewelry',
              // Exclude crystal/quartz in jewelry context (covered by CRYSTAL_GEMSTONE_JEWELRY_INTENT)
              'crystal jewelry', 'crystal necklace',
            ],
          },
          inject: [
            { prefix: '7103.99', syntheticRank: 5 },
            { prefix: '7103.91', syntheticRank: 5 },
            { prefix: '7103.10', syntheticRank: 4 },
          ],
          whitelist: {
            denyPrefixes: ['7116.20', '7116.10'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '7103.' }],
        } as IntentRule;
        patches.push({ priority: 576, rule: newRule });
        console.log('SEMIPRECIOUS_LOOSE_STONE_BEADS_INTENT: created (gemstone beads → 7103.99)');
      }
    }

    // 3. OIL_DIPSTICK_ENGINE_PART_INTENT → 8413.30 (fuel/oil pumps, engine parts)
    //    "Automotve oil level dipstick" → 2710.91 (petroleum oils!) WRONG
    //    BUG: "oil" keyword triggers ch.27 (mineral oils/petroleum) instead of ch.84 (machinery)
    //    8413.30 = fuel, lubricating or cooling medium pumps for internal combustion engines
    //    8413.91 = parts of pumps (includes dipsticks/measuring rods)
    {
      const existing = allRules.find(r => r.id === 'OIL_DIPSTICK_ENGINE_PART_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'OIL_DIPSTICK_ENGINE_PART_INTENT',
          description: 'Oil dipsticks, oil gauges, engine oil level indicators → ch.84 (8413.30)',
          pattern: {
            anyOf: [
              // Dipsticks
              'oil dipstick', 'oil level dipstick', 'engine oil dipstick',
              'automotive dipstick', 'car oil dipstick', 'dipstick oil',
              'transmission dipstick', 'engine dipstick',
              // Oil level gauges / sight glasses
              'oil level gauge', 'oil level indicator', 'oil sight glass',
              'engine oil gauge', 'oil level sensor',
            ],
            noneOf: [
              'motor oil', 'engine oil quart', 'synthetic oil', 'oil change',
              'oil filter', 'lubricant',
            ],
          },
          inject: [
            { prefix: '8413.30', syntheticRank: 5 },
            { prefix: '8413.91', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['27'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '8413.' }],
        } as IntentRule;
        patches.push({ priority: 572, rule: newRule });
        console.log('OIL_DIPSTICK_ENGINE_PART_INTENT: created (oil dipsticks → 8413.30, deny ch.27)');
      }
    }

    // 4. MINERAL_CRYSTAL_SPECIMEN_INTENT → 7103.10 / 2616 (mineral specimens, not glass)
    //    "amethyst stone beads" → 7018.10 (glass beads!) WRONG — "crystal" triggers glass
    //    "rose quartz crystal raw" → 7103.91 (ok but wrong sub sometimes)
    //    "amethyst crystal cluster" → 7103.91 (close)
    //    BUG: "crystal" triggers glass chapter (7018) instead of mineral chapter (7103)
    //    7103.10 = precious/semi-precious stones, unworked or simply sawn
    //    NOTE: amethyst beads should be 7103.91 (simply sawn/shaped), not 7018 (glass)
    {
      const existing = allRules.find(r => r.id === 'MINERAL_CRYSTAL_SPECIMEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MINERAL_CRYSTAL_SPECIMEN_INTENT',
          description: 'Raw mineral crystals, amethyst clusters, quartz specimens → ch.71 (7103.10)',
          pattern: {
            anyOf: [
              // Amethyst minerals
              'amethyst crystal', 'amethyst cluster', 'amethyst geode',
              'amethyst stone bead', 'amethyst stone beads',
              'raw amethyst', 'natural amethyst',
              // Rose quartz
              'rose quartz crystal', 'rose quartz raw', 'rose quartz stone',
              'rose quartz cluster', 'rose quartz geode',
              // Clear/smoky quartz
              'quartz crystal cluster', 'clear quartz crystal',
              'smoky quartz crystal', 'smoky quartz stone',
              // Other raw mineral crystals
              'crystal cluster', 'mineral specimen', 'raw crystal',
              'geode crystal', 'crystal geode',
              'citrine crystal', 'citrine cluster',
              'selenite crystal', 'selenite wand',
              'obsidian raw', 'raw obsidian',
              'labradorite crystal', 'raw labradorite',
            ],
            noneOf: [
              // Exclude glass crystal products
              'crystal glass', 'crystal vase', 'crystal decanter', 'crystal bowl',
              'lead crystal', 'crystal goblet',
              // Exclude crystal jewelry (covered by CRYSTAL_GEMSTONE_JEWELRY_INTENT)
              'crystal necklace', 'crystal earrings', 'crystal bracelet',
            ],
          },
          inject: [
            { prefix: '7103.10', syntheticRank: 5 },
            { prefix: '7103.91', syntheticRank: 5 },
            { prefix: '7103.99', syntheticRank: 4 },
          ],
          whitelist: {
            denyPrefixes: ['7018'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '7103.' }],
        } as IntentRule;
        patches.push({ priority: 574, rule: newRule });
        console.log('MINERAL_CRYSTAL_SPECIMEN_INTENT: created (raw mineral crystals → 7103.10, deny 7018)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT59)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT59 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
