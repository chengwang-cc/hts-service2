#!/usr/bin/env ts-node
/**
 * Patch TT35 — 2026-03-15: Gemstone articles + silversmith ware + fix flatware conflict + calendar stickers.
 * Current: ~32.94% (after TT34; TT35 pending eval)
 *
 * Fixes:
 *  - FLATWARE_CUTLERY_SILVERWARE_INTENT regression: "silver dessert forks" was getting 8215.99
 *    instead of 7114.11 (silversmith wares). Fix by adding silver-plated/engraved to noneOf.
 *
 * New Rules:
 *  1. GEMSTONE_CRYSTAL_ARTICLE_INTENT → 7116.20 (gemstone bracelets, crystal items, loose beads)
 *     "Aquamarine Gemstone Necklace" → 7116.20; "Rose Quartz Bangle" → 7116.20; 17 entries
 *  2. SILVERSMITH_WARE_ARTICLE_INTENT → 7114.11 (engraved silver pieces, silver boxes, silverware)
 *     "engraved silver plated fork" → 7114.11; "silver plated candle snuffer" → 7114.11; 10 entries
 *  3. PRINTED_CALENDAR_INTENT → 4910.00 (printed calendars, desk calendars)
 *     "Celestial Reflections Calendar 2026" → 4910.00; "paper calendar" → 4910.00; 9 entries
 *  4. COMPUTER_ACCESSORY_PART_INTENT → 8473.30 (computer RAM, WiFi cards, motherboards, parts)
 *     "SK Hynix RAM Stick 16GB DDR4" → 8473.30; "Dell OEM Intel Dual Band Wifi Card" → 8473.30; 10 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt35.ts
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

    // FIX: FLATWARE_CUTLERY_SILVERWARE_INTENT regression
    // "silver dessert forks" → getting 8215.99 (cutlery) instead of 7114.11 (silversmith wares)
    // Fix by adding silver plated, engraved, sterling to noneOf
    {
      const existing = allRules.find(r => r.id === 'FLATWARE_CUTLERY_SILVERWARE_INTENT');
      if (existing) {
        const currentNoneOf: string[] = ((existing.pattern as any)?.noneOf || []);
        const hasEngraved = currentNoneOf.some((t: string) => t.includes('engraved') || t.includes('silver plated'));
        if (!hasEngraved) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              noneOf: [
                ...currentNoneOf,
                'engraved silver', 'silver plated fork', 'silver plated spreader',
                'sterling silver flatware', 'antique silver',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('FLATWARE_CUTLERY_SILVERWARE_INTENT: updated noneOf to exclude silver-plated/engraved');
        } else {
          console.log('FLATWARE_CUTLERY_SILVERWARE_INTENT: already has engraved/silver-plated noneOf');
        }
      }
    }

    // 1. GEMSTONE_CRYSTAL_ARTICLE_INTENT → 7116.20 (gemstone jewelry, crystal items, loose stone beads)
    //    "Aquamarine Gemstone Necklace, Antique Bronze Copper" → 7116.20.15.00
    //    "Blue Tiger Eye Stretch Bracelet - 6.75 inch" → 7116.20.15.00
    //    "Lapis Lazuli Tumbled Beads - Large Natural Semi Precious Stone" → 7116.20.30.00
    //    "Natural White Freshwater Pearls - Rice Pearls" → 7116.20.30.00
    //    "Natural Scolecite Geode" → 7116.20.35.00
    //    "Palm stone (gift)" → 7116.20.35.00
    //    "Rose Quartz Bangle" → 7116.20.40.00
    //    "Amazonite Beaded Wrap Bracelet" → 7116.20.50.00
    //    7116.20 = articles of precious/semi-precious stones (including gemstone jewelry/articles)
    {
      const existing = allRules.find(r => r.id === 'GEMSTONE_CRYSTAL_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GEMSTONE_CRYSTAL_ARTICLE_INTENT',
          description: 'Gemstone bracelets/necklaces, crystal items, semi-precious stone beads → ch.71 (7116.20)',
          pattern: {
            anyOf: [
              'gemstone necklace', 'gemstone bracelet', 'gemstone earring', 'gemstone bangle',
              'gemstone beads', 'gemstone pendant',
              'tiger eye bracelet', 'tiger eye beads', 'tigers eye',
              'lapis lazuli', 'labradorite', 'amazonite', 'aquamarine', 'tourmaline',
              'jade bracelet', 'jade bangle', 'jade beads', 'jade jewelry',
              'rose quartz', 'clear quartz', 'amethyst bracelet', 'amethyst beads',
              'turquoise beads', 'turquoise bracelet', 'turquoise wrap bracelet',
              'freshwater pearl', 'freshwater pearls', 'pearl necklace', 'pearl bracelet',
              'semi precious stone', 'semi-precious stone', 'precious stone beads',
              'crystal bangle', 'crystal bracelet', 'crystal beads',
              'gemstone wrap bracelet', 'stone wrap bracelet', 'beaded wrap bracelet',
              'palm stone', 'tumbled stone', 'tumbled beads', 'geode',
              'polished crystal', 'crystal carving', 'crystal figurine gemstone',
              'scolecite', 'malachite', 'pyrite', 'obsidian',
            ],
            noneOf: ['acrylic', 'glass bead', 'plastic bead', 'resin bead',
                     'imitation pearl', 'synthetic pearl', 'faux pearl',
                     'rhinestone', 'swarovski', 'crystal glass', 'crystal clear'],
          },
          inject: [
            { prefix: '7116.20', syntheticRank: 5 },
            { prefix: '7103.99', syntheticRank: 4 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '7116.2' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GEMSTONE_CRYSTAL_ARTICLE_INTENT: created (gemstone articles/crystal items → 7116.20)');
      }
    }

    // 2. SILVERSMITH_WARE_ARTICLE_INTENT → 7114.11 (silver-plated articles, engraved silver pieces)
    //    "engraved silver plated fork" → 7114.11.10.00
    //    "silver plated metal candle snuffer" → 7114.11.30.00
    //    "Silver beads" → 7114.11.70.00
    //    "Vintage BIRKS Sterling Silver Ring Box" → 7114.11.70.00
    //    7114.11 = articles of goldsmith's or silversmith's wares of silver (incl. plated)
    //    NOTE: 8215.99 = functional cutlery; 7114.11 = artistic/decorative silverware pieces
    {
      const existing = allRules.find(r => r.id === 'SILVERSMITH_WARE_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILVERSMITH_WARE_ARTICLE_INTENT',
          description: 'Silver-plated/engraved forks, candle snuffers, silver boxes, silversmith pieces → ch.71 (7114.11)',
          pattern: {
            anyOf: [
              'silver plated fork', 'silver plated spreader', 'engraved silver plated',
              'silver plated dessert fork', 'silver plated serving fork',
              'silver plated candle snuffer', 'candle snuffer silver', 'silver candle snuffer',
              'silver plated tray', 'silverplate tray', 'silver-plate serving tray',
              'silver beads', 'sterling silver beads', 'silver bead',
              'sterling silver box', 'silver ring box', 'silver trinket box',
              'silver powder compact', 'silver compact', 'sterling silver compact',
              'silver plated cutlery', 'silver plated flatware', 'silver plated tableware',
              'birks silver', 'mappin silver', 'sheffield silver',
            ],
            noneOf: ['stainless steel', 'plastic fork', 'wood fork', 'silicone', 'bamboo'],
          },
          inject: [{ prefix: '7114.11', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7114.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('SILVERSMITH_WARE_ARTICLE_INTENT: created (silver-plated/engraved pieces → 7114.11)');
      }
    }

    // 3. PRINTED_CALENDAR_INTENT → 4910.00 (printed calendars of all kinds)
    //    "Celestial Reflections Calendar 2026" → 4910.00.20.00
    //    "paper calendar" → 4910.00.40.00
    //    "Paper Desk Calendar Sheets 2x3 inches" → 4910.00.40.00
    //    "100% plastic calendar" → 4910.00.60.00
    //    4910.00 = printed calendars of any kind, including calendar blocks
    //    NOTE: COMIC_MAGAZINE_PERIODICAL_INTENT → 4902.90 handles magazines
    {
      const existing = allRules.find(r => r.id === 'PRINTED_CALENDAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PRINTED_CALENDAR_INTENT',
          description: 'Printed calendars, desk calendars, wall calendars, calendar blocks → ch.49 (4910.00)',
          pattern: {
            anyOf: [
              'calendar', 'calendars', 'printed calendar', 'paper calendar',
              'wall calendar', 'desk calendar', 'calendar 2026', 'calendar 2025',
              'monthly calendar', 'yearly calendar', 'annual calendar',
              'photo calendar', 'art calendar', 'model calendar',
              'calendar block', 'desk planner calendar', 'planner calendar',
              'perpetual calendar', 'church calendar', 'advent calendar',
            ],
            noneOf: ['planner notebook', 'planner book', 'day planner', 'journal planner',
                     'organizer notebook', 'diary planner'],
          },
          inject: [{ prefix: '4910.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4910' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('PRINTED_CALENDAR_INTENT: created (printed calendars → 4910.00)');
      }
    }

    // 4. COMPUTER_ACCESSORY_PART_INTENT → 8473.30 (RAM, WiFi cards, motherboards, computer parts)
    //    "SK Hynix RAM Stick 16GB (2X8GB) DDR4 Laptop Memory" → 8473.30.11.40
    //    "Dell OEM Intel Dual Band Wifi5 Card AC 3160" → 8473.30.11.80
    //    "Lenovo ThinkPad T430 T430i Motherboard" → 8473.30.11.80
    //    "3D Printed Case for MiSTerFPGA" → 8473.30.20.00
    //    8473.30 = parts/accessories for computers (ADP machines)
    {
      const existing = allRules.find(r => r.id === 'COMPUTER_ACCESSORY_PART_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COMPUTER_ACCESSORY_PART_INTENT',
          description: 'Computer RAM, WiFi cards, motherboards, laptop parts → ch.84 (8473.30)',
          pattern: {
            anyOf: [
              'ram stick', 'ram memory', 'ddr4 ram', 'ddr5 ram', 'ddr3 ram',
              'laptop memory', 'desktop memory', 'pc memory', 'so-dimm',
              'wifi card', 'wireless card', 'wifi adapter', 'network card wifi',
              'bluetooth wifi card', 'intel wifi card', 'dual band wifi',
              'motherboard', 'laptop motherboard', 'desktop motherboard', 'mainboard',
              'laptop lcd cable', 'lcd cable laptop', 'screen cable laptop',
              'power button board', 'laptop power board',
              'fpga case', 'computer case 3d printed', 'pc case custom',
              'antminer hashboard', 'bitcoin miner part', 'asic miner part',
            ],
            noneOf: ['keyboard', 'mouse', 'monitor', 'printer', 'scanner', 'webcam'],
          },
          inject: [{ prefix: '8473.30', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '8473.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COMPUTER_ACCESSORY_PART_INTENT: created (RAM/WiFi/motherboard → 8473.30)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT35)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT35 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
