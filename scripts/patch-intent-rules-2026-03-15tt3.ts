#!/usr/bin/env ts-node
/**
 * Patch TT3 — 2026-03-15: High-impact ch.85 cluster fixes (batch 2).
 * Current: 29.73% (1494/5025)
 *
 * Key findings:
 *  - Guitar effects pedals: 3+ entries → 8543.70 (getting 9207 musical instruments)
 *  - RF bandpass filters: 3+ entries → 8543.70 (getting 8541)
 *  - Programmable remote: → 8543.70 (getting 8526)
 *  - Automotive ECU/BCU/control module: 6+ entries → 8542.31 (getting 8481/misc)
 *  - Power adapters/chargers: 6+ entries → 8504.40 (getting 8504.50/8507)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt3.ts
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

    // 1. GUITAR_EFFECTS_PEDAL_INTENT — guitar effects pedal → 8543.70
    //    "Guitar effects pedal" → getting 9207.90 (musical instruments)
    //    Expected: 8543.70 (other electrical machines/apparatus with individual functions)
    {
      const existing = allRules.find(r => r.id === 'GUITAR_EFFECTS_PEDAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GUITAR_EFFECTS_PEDAL_INTENT',
          description: 'Guitar effects/signal processing pedals → ch.85 (8543.70)',
          pattern: {
            anyOf: [
              'guitar effect', 'guitar effects', 'guitar pedal', 'guitar effects pedal',
              'guitar effect pedal', 'guitar multieffect', 'guitar multi-effect',
              'guitar stomp box', 'stompbox guitar', 'guitar floor processor',
              'line 6 stomp', 'guitar signal processor',
            ],
            noneOf: ['acoustic guitar', 'guitar string', 'guitar pick', 'guitar tuner',
                     'guitar strap', 'guitar case', 'guitar stand'],
          },
          inject: [{ prefix: '8543.70', syntheticRank: 4 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.65, prefixMatch: '8543.7' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('GUITAR_EFFECTS_PEDAL_INTENT: created (guitar pedal → 8543.70)');
      }
    }

    // 2. RF_BANDPASS_FILTER_ELECTRONIC_INTENT — RF/radio bandpass filters → 8543.70
    //    "144-148 MHz Bandpass Filter" → getting 8541.29, expected 8543.70
    //    Also covers programmable remote (infrared) → 8543.70 vs 8526
    {
      const existing = allRules.find(r => r.id === 'RF_BANDPASS_FILTER_ELECTRONIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RF_BANDPASS_FILTER_ELECTRONIC_INTENT',
          description: 'RF/radio bandpass filters, programmable remotes → ch.85 (8543.70)',
          pattern: {
            anyOf: [
              'bandpass filter', 'band pass filter', 'rf filter', 'rf bandpass',
              'mhz bandpass', 'ghz bandpass', 'mhz filter', 'ghz filter',
              'ham radio filter', 'amateur radio filter',
              'programmable remote', 'universal remote control', 'infrared remote control',
              'ir remote programmable', 'learning remote',
            ],
            noneOf: ['air filter', 'water filter', 'oil filter', 'coffee filter',
                     'aquarium filter', 'hvac filter', 'furnace filter'],
          },
          inject: [{ prefix: '8543.70', syntheticRank: 4 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.60, prefixMatch: '8543.7' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('RF_BANDPASS_FILTER_ELECTRONIC_INTENT: created (RF filter → 8543.70)');
      }
    }

    // 3. AUTOMOTIVE_ECU_CONTROL_MODULE_INTENT — automotive ECU/BCU → 8542.31
    //    "Automotive Transmission Control Module" → getting 8481.20, expected 8542.31
    //    "Body Control Unit", "Engine Control Module" → 8542.31 (integrated circuits / electronic control)
    {
      const existing = allRules.find(r => r.id === 'AUTOMOTIVE_ECU_CONTROL_MODULE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'AUTOMOTIVE_ECU_CONTROL_MODULE_INTENT',
          description: 'Automotive ECU/BCU/control modules → ch.85 (8542.31)',
          pattern: {
            anyOf: [
              'engine control module', 'body control unit', 'transmission control module',
              'automotive control module', 'automotive ecu', 'automotive ecm',
              'ecu automotive', 'ecm automotive', 'bcm automotive', 'pcm automotive',
              'engine ecu', 'transmission ecu', 'used ecu', 'oem ecu',
              'body control module', 'engine control unit automotive',
            ],
          },
          inject: [{ prefix: '8542.31', syntheticRank: 4 }],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.60, prefixMatch: '8542.3' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('AUTOMOTIVE_ECU_CONTROL_MODULE_INTENT: created (automotive ECU → 8542.31)');
      }
    }

    // 4. POWER_ADAPTER_AC_CHARGER_INTENT — power adapters/chargers → 8504.40
    //    "Power adaptor", "battery charger for scooter", "laptop charger" → 8504.40
    //    8504.40 = static converters (AC/DC adapters, battery chargers, power supplies)
    //    Problem: system routes to 8504.50 (inductors) or 8507.60 (batteries)
    {
      const existing = allRules.find(r => r.id === 'POWER_ADAPTER_AC_CHARGER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'POWER_ADAPTER_AC_CHARGER_INTENT',
          description: 'AC/DC power adapters, chargers, converters → ch.85 (8504.40)',
          pattern: {
            anyOf: [
              'power adapter', 'power adaptor', 'ac adapter', 'dc adapter',
              'power supply adapter', 'laptop charger', 'phone charger', 'battery charger',
              'charger adapter', 'charge dock', 'charging dock', 'ac charge dock',
              'buck converter', 'step down converter', 'boost converter', 'voltage converter',
              'powerboost', 'power boost charger',
            ],
            noneOf: ['alkaline', 'aa battery', 'aaa battery', 'lithium battery',
                     'battery pack', 'ups', 'solar charger'],
          },
          inject: [
            { prefix: '8504.40', syntheticRank: 4 },
          ],
          whitelist: { allowChapters: ['85'] },
          boosts: [{ delta: 0.60, prefixMatch: '8504.4' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('POWER_ADAPTER_AC_CHARGER_INTENT: created (power adapter → 8504.40)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT3)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT3 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
