#!/usr/bin/env ts-node
/**
 * Patch TT8 — 2026-03-15: RAM/memory, soap pumps, gold-filled jewelry.
 * Current: 30.17% (1516/5025)
 *
 * Fixes:
 *  1. COMPUTER_RAM_MEMORY_INTENT: DDR4/RAM stick → 8473.30 (not livestock ch.1!)
 *  2. SOAP_SPRAY_PUMP_DISPENSER_INTENT: soap pump/spray pump → 8424.89
 *  3. GOLD_FILLED_PLATED_JEWELRY_INTENT: gold-filled/gold-plated jewelry → 7113.20
 *  4. SILICONE_CASTING_MOLD_INTENT: silicone/resin molds → 8480.60/8480.79
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt8.ts
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

    // 1. COMPUTER_RAM_MEMORY_INTENT — DDR/RAM memory modules → 8473.30
    //    "SK Hynix RAM Stick 16GB DDR4" → getting 0104.10 (sheep!) because RAM = sheep
    //    Expected: 8473.30.11.40 (computer parts - memory modules)
    {
      const existing = allRules.find(r => r.id === 'COMPUTER_RAM_MEMORY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COMPUTER_RAM_MEMORY_INTENT',
          description: 'Computer RAM/memory sticks → ch.84 (8473.30)',
          pattern: {
            anyOf: [
              'ram stick', 'ram module', 'memory stick ram', 'ddr4 ram', 'ddr3 ram', 'ddr5 ram',
              'ddr4 memory', 'ddr3 memory', 'ddr5 memory', 'dimm memory', 'sodimm memory',
              'laptop ram', 'pc ram', 'computer memory module',
              'hynix ram', 'kingston ram', 'corsair ram', 'crucial ram',
            ],
          },
          inject: [{ prefix: '8473.30', syntheticRank: 4 }],
          whitelist: { allowChapters: ['84'] },
          boosts: [{ delta: 0.65, prefixMatch: '8473.3' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('COMPUTER_RAM_MEMORY_INTENT: created (RAM stick → 8473.30)');
      }
    }

    // 2. SOAP_SPRAY_PUMP_DISPENSER_INTENT — soap/spray pump → 8424.89
    //    "replacement soap pump" → getting 3401.11 (soap), expected 8424.89.90
    //    "replacement spray pump" → getting 8413.60 (pump), expected 8424.89.90
    //    8424.89 = mechanical appliances for projecting/dispersing liquids
    {
      const existing = allRules.find(r => r.id === 'SOAP_SPRAY_PUMP_DISPENSER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SOAP_SPRAY_PUMP_DISPENSER_INTENT',
          description: 'Soap/spray pump dispensers → ch.84 (8424.89)',
          pattern: {
            anyOf: [
              'soap pump', 'soap dispenser pump', 'soap pump dispenser',
              'spray pump', 'spray pump replacement', 'pump dispenser',
              'lotion pump', 'hand soap pump', 'foaming soap pump',
              'replacement pump dispenser', 'dispenser pump replacement',
            ],
            noneOf: ['garden spray pump', 'pesticide spray', 'paint sprayer'],
          },
          inject: [{ prefix: '8424.89', syntheticRank: 4 }],
          whitelist: { allowChapters: ['84'] },
          boosts: [{ delta: 0.60, prefixMatch: '8424.8' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SOAP_SPRAY_PUMP_DISPENSER_INTENT: created (soap pump → 8424.89)');
      }
    }

    // 3. GOLD_FILLED_CLAD_JEWELRY_INTENT — gold-filled/gold-clad jewelry → 7113.20
    //    "Gold Filled Discreet Day Collar" → getting 7108.13 (gold bars!), expected 7113.20
    //    "18K Gold-Plated Necklace Set" → getting 7117.90, expected 7113.20
    //    7113.20 = articles of base metal clad with precious metal (gold-filled, gold-plated)
    {
      const existing = allRules.find(r => r.id === 'GOLD_FILLED_CLAD_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GOLD_FILLED_CLAD_JEWELRY_INTENT',
          description: 'Gold-filled/gold-plated jewelry → ch.71 (7113.20)',
          pattern: {
            anyOf: [
              'gold filled', 'gold-filled', 'gold fill', 'gold filled necklace',
              'gold filled bracelet', 'gold filled pendant', 'gold filled earring',
              'gold filled ring', 'gold filled collar',
              '18k gold plated', '14k gold plated', 'gold plated necklace',
              'gold plated jewelry', 'gold plated bracelet',
            ],
            noneOf: ['solid gold', 'pure gold', 'fine gold', 'gold bar', 'gold bullion'],
          },
          inject: [{ prefix: '7113.20', syntheticRank: 4 }],
          whitelist: { allowChapters: ['71'] },
          boosts: [{ delta: 0.65, prefixMatch: '7113.2' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GOLD_FILLED_CLAD_JEWELRY_INTENT: created (gold-filled → 7113.20)');
      }
    }

    // 4. SILICONE_RESIN_CASTING_MOLD_INTENT — silicone/resin casting molds → 8480.79
    //    "Ring casting molds Large round" → getting 9306.21 (ammunition), expected 8480.60
    //    "4.5 Druzy Angel wings silicone mold" → 8480.79 (already passing at rank 4)
    {
      const existing = allRules.find(r => r.id === 'SILICONE_RESIN_CASTING_MOLD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILICONE_RESIN_CASTING_MOLD_INTENT',
          description: 'Silicone/resin casting molds → ch.84 (8480.60/8480.79)',
          pattern: {
            anyOf: [
              'casting mold', 'casting molds', 'resin mold', 'resin molds',
              'silicone mold', 'silicone molds', 'ring mold', 'ring casting mold',
              'epoxy mold', 'slump mold', 'pottery mold', 'ceramic mold',
              'silicone casting', 'resin casting mold', 'mold for resin',
            ],
            noneOf: ['injection mold', 'plastic injection', 'rubber mold tire'],
          },
          inject: [
            { prefix: '8480.60', syntheticRank: 4 },
            { prefix: '8480.79', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '8480.' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SILICONE_RESIN_CASTING_MOLD_INTENT: created (casting mold → 8480)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT8)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT8 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
