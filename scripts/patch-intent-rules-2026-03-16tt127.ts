#!/usr/bin/env ts-node
/**
 * Patch TT127 — 2026-03-16: Encyclopedia books, soap pumps, electrical components
 *   (fuses/switches/sockets), appliance control boards, capacitors, power supplies.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt127.ts
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

    // 1. ENCYCLOPEDIA_DICTIONARY_BOOK_INTENT → 4901.91 (encyclopedias/dictionaries)
    //    "Book- THE NOTRE DAME FOOTBALL ENCYCLOPEDIA" → 4901.99 WRONG (expected 4901.91.00.40)
    //    "Set Printed Lego Encyclopedia w/ figure" → 4901.99 WRONG (expected 4901.91.00.40)
    //    Distinction: 4901.91 = dictionaries/encyclopedias vs 4901.99 = other books.
    {
      const existing = allRules.find(r => r.id === 'ENCYCLOPEDIA_DICTIONARY_BOOK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENCYCLOPEDIA_DICTIONARY_BOOK_INTENT',
          description: 'Encyclopedias and dictionaries → 4901.91 (printed books, encyclopedias)',
          pattern: {
            anyOf: [
              'encyclopedia', 'encyclopaedia', 'encyclopedias', 'encyclopaedias',
              'dictionary', 'dictionaries', 'reference dictionary', 'illustrated encyclopedia',
              'lego encyclopedia', 'star wars encyclopedia', 'pokemon encyclopedia',
            ],
            noneOf: [
              // Exclude single volumes of serial publications
              'encyclopedia magazine', 'encyclopedia volume series',
            ],
          },
          inject: [
            { prefix: '4901.91', syntheticRank: 1 },  // encyclopedias/dictionaries
          ],
          whitelist: {
            allowChapters: ['49'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4901.91' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '4901.99' },  // penalize other books
          ],
        } as IntentRule;
        patches.push({ priority: 676, rule: newRule });
        console.log('ENCYCLOPEDIA_DICTIONARY_BOOK_INTENT: created (→4901.91, allowChapters:[49])');
      } else {
        console.log('ENCYCLOPEDIA_DICTIONARY_BOOK_INTENT: already exists, skipping');
      }
    }

    // 2. SOAP_PUMP_DISPENSER_INTENT → 8424.89 (mechanical liquid-projecting appliances)
    //    "replacement soap pump" → 3401.11 WRONG (soap, expected 8424.89.90.00)
    //    "replacement soap pumps" → 3401.20 WRONG (expected 8424.89.90.00)
    //    Root cause: "soap" triggers soap (ch34); pump nozzle/dispenser is a mechanical appliance (8424).
    {
      const existing = allRules.find(r => r.id === 'SOAP_PUMP_DISPENSER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SOAP_PUMP_DISPENSER_INTENT',
          description: 'Soap dispensers/pumps → 8424.89 (mechanical spraying/projecting appliances)',
          pattern: {
            anyOf: [
              'soap pump', 'soap pumps', 'replacement soap pump', 'soap dispenser pump',
              'lotion pump', 'lotion pumps', 'replacement lotion pump',
              'hand soap pump', 'liquid soap pump', 'foam soap pump',
              'foam pump head', 'pump head replacement', 'pump top dispenser',
              'dispenser pump head', 'dispenser nozzle pump',
              'shampoo pump', 'conditioner pump',
            ],
            noneOf: [
              // Actual soap products
              'bar soap', 'liquid soap bottle', 'soap bottle',
              // Water/hydraulic pumps (different heading)
              'water pump', 'fuel pump', 'sump pump', 'irrigation pump',
            ],
          },
          inject: [
            { prefix: '8424.89', syntheticRank: 1 },  // mechanical spraying/dispensing appliances
          ],
          whitelist: {
            allowChapters: ['84'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8424.89' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '3401.' },  // strong penalty for soap (ch34)
            { delta: 0.80, prefixMatch: '8413.' },  // penalize centrifugal pumps (different)
          ],
        } as IntentRule;
        patches.push({ priority: 677, rule: newRule });
        console.log('SOAP_PUMP_DISPENSER_INTENT: created (→8424.89, allowChapters:[84])');
      } else {
        console.log('SOAP_PUMP_DISPENSER_INTENT: already exists, skipping');
      }
    }

    // 3. ELECTRICAL_FUSE_SWITCH_SOCKET_INTENT → 8536 (electrical switching/protection apparatus ≤1kV)
    //    "panel mount fuse holder" → 8536.69 WRONG (expected 8536.10.00.20)
    //    "Buick Regal fuel pump relay module" → 9303.20 WRONG (expected 8536.41.00.05)
    //    "Aquarium Power Bar" → 3926.90 WRONG (expected 8536.50.90.32)
    //    "Radio Tube Socket" → 8540.99 WRONG (expected 8536.69.40.20)
    //    "Barrier Terminal Strips" → 8305.20 WRONG (expected 8536.90.40.00)
    //    "Fuse Holder Panel Mount 3AG" → 8536.69 WRONG (expected 8536.90.60.00)
    //    "Battery Master Disconnect Switch" → 8507.60 WRONG (expected 8536.90.60.00)
    {
      const existing = allRules.find(r => r.id === 'ELECTRICAL_FUSE_SWITCH_SOCKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ELECTRICAL_FUSE_SWITCH_SOCKET_INTENT',
          description: 'Electrical fuses/switches/sockets/relays → 8536 (switching apparatus ≤1kV)',
          pattern: {
            anyOf: [
              // Fuses and fuse holders
              'fuse holder', 'panel mount fuse', 'inline fuse holder', 'fuse panel mount',
              'fuse block', 'fuse box connector', 'fuse pigtail', 'blade fuse holder',
              // Relays
              'relay module', 'fuel pump relay', 'power relay', 'relay switch',
              'solid state relay', 'time delay relay', 'relay board',
              // Switches
              'disconnect switch', 'battery disconnect switch', 'master disconnect',
              'power bar outlet', 'aquarium power bar', 'outlet power bar',
              'switch plate outlet', 'outlet cover plate',
              'gas pressure switch', 'pressure switch electrical',
              // Sockets and connectors
              'tube socket', 'radio tube socket', 'valve socket', 'pcb tube socket',
              'lamp holder socket', 'bulb socket holder',
              // Terminal strips
              'terminal strip', 'barrier terminal', 'terminal block strip',
              'wire terminal block',
            ],
            noneOf: [
              // Circuit breakers → 8535 (different heading)
              'circuit breaker', 'breaker panel',
              // Battery sockets (different)
              'battery socket aa', 'aa battery holder',
            ],
          },
          inject: [
            { prefix: '8536.10', syntheticRank: 1 },  // fuses
            { prefix: '8536.41', syntheticRank: 3 },  // relays ≤ 60V
            { prefix: '8536.50', syntheticRank: 5 },  // other switches
            { prefix: '8536.69', syntheticRank: 7 },  // lamp holders/sockets
            { prefix: '8536.90', syntheticRank: 9 },  // other electrical connectors
          ],
          whitelist: {
            allowChapters: ['85'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8536.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9303.' },  // penalize firearms (relay module → firearm!)
            { delta: 0.85, prefixMatch: '8305.' },  // penalize office articles (terminal strips)
            { delta: 0.85, prefixMatch: '3926.' },  // penalize plastic articles
            { delta: 0.80, prefixMatch: '8507.' },  // penalize batteries
            { delta: 0.80, prefixMatch: '8540.' },  // penalize vacuum tubes
          ],
        } as IntentRule;
        patches.push({ priority: 678, rule: newRule });
        console.log('ELECTRICAL_FUSE_SWITCH_SOCKET_INTENT: created (→8536, allowChapters:[85])');
      } else {
        console.log('ELECTRICAL_FUSE_SWITCH_SOCKET_INTENT: already exists, skipping');
      }
    }

    // 4. APPLIANCE_CONTROL_BOARD_INTENT → 9032 (automatic regulators/thermostats/controllers)
    //    "Refrigerator defrost thermostat" → 9107.00 WRONG (expected 9032.10.00.60)
    //    "889041 True Refrigerator Control Board" → 9107.00 WRONG (expected 9032.89.60.40)
    //    "Automotive Dash Heater Control" → 8516.80 WRONG (expected 9032.10.00.60)
    //    "LG PREMTBVC2 MultiSite Controller with Humidity Sensor" → 9025.19 WRONG (expected 9032.10.00.30)
    //    Root cause: thermostats → time switches (9107); heater controls → electric heaters (8516)
    {
      const existing = allRules.find(r => r.id === 'APPLIANCE_CONTROL_BOARD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'APPLIANCE_CONTROL_BOARD_INTENT',
          description: 'Appliance control boards/thermostats → 9032 (automatic regulating instruments)',
          pattern: {
            anyOf: [
              // Refrigerator/freezer parts
              'refrigerator control board', 'refrigerator defrost thermostat',
              'refrigerator thermostat', 'freezer thermostat', 'defrost thermostat',
              'refrigerator control module', 'freezer control board',
              // HVAC controls
              'hvac controller', 'hvac control board', 'heater control unit',
              'automotive dash heater control', 'dash heater control',
              'multisite controller', 'humidity controller', 'humidity sensor controller',
              'temperature controller', 'temperature control board',
              'appliance control board', 'dishwasher control board',
              'washer control board', 'dryer control board',
              // Programmable controllers
              'programmable controller', 'programmable control module',
              'pid controller', 'setpoint controller',
            ],
            noneOf: [
              // Simple thermostats for heating systems (different item)
              'home thermostat', 'nest thermostat', 'smart thermostat',
              // Manual controls (not auto-regulating)
              'manual control', 'dial control',
            ],
          },
          inject: [
            { prefix: '9032.10', syntheticRank: 1 },  // thermostats
            { prefix: '9032.89', syntheticRank: 3 },  // other automatic regulating instruments
          ],
          whitelist: {
            allowChapters: ['90'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9032.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9107.' },  // penalize time switches
            { delta: 0.85, prefixMatch: '9025.' },  // penalize hydrometers/thermometers
            { delta: 0.85, prefixMatch: '8516.' },  // penalize electric heaters
            { delta: 0.80, prefixMatch: '8536.' },  // penalize switches (different)
          ],
        } as IntentRule;
        patches.push({ priority: 679, rule: newRule });
        console.log('APPLIANCE_CONTROL_BOARD_INTENT: created (→9032, allowChapters:[90])');
      } else {
        console.log('APPLIANCE_CONTROL_BOARD_INTENT: already exists, skipping');
      }
    }

    // 5. CAPACITOR_ELECTRICAL_COMPONENT_INTENT → 8532 (electrical capacitors)
    //    "Vtg Sprague Orange Drop Capacitor" → 0805.10 WRONG (oranges!, expected 8532.10.00.00)
    //    "TEMCo Round Motor Run Capacitor 50/60 Hz" → 9306.21 WRONG (bullets!, expected 8532.22.00.20)
    //    Root cause: "Orange" (drop) → citrus; "Round" → ammunition.
    {
      const existing = allRules.find(r => r.id === 'CAPACITOR_ELECTRICAL_COMPONENT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CAPACITOR_ELECTRICAL_COMPONENT_INTENT',
          description: 'Electrical capacitors → 8532 (fixed/variable/adjustable capacitors)',
          pattern: {
            anyOf: [
              'capacitor', 'capacitors', 'motor run capacitor', 'motor start capacitor',
              'electrolytic capacitor', 'ceramic capacitor', 'film capacitor',
              'tantalum capacitor', 'mylar capacitor', 'uf capacitor',
              'mfd capacitor', 'guitar capacitor', 'amp capacitor',
              'sprague capacitor', 'orange drop capacitor',
              'round motor capacitor', 'oval motor capacitor',
              'ac capacitor', 'hvac capacitor', 'start capacitor',
              'run capacitor', 'dual run capacitor', 'power factor capacitor',
            ],
          },
          inject: [
            { prefix: '8532.10', syntheticRank: 1 },  // fixed tantalum/electrolytic capacitors
            { prefix: '8532.22', syntheticRank: 3 },  // other fixed capacitors (≥ 1µF)
            { prefix: '8532.29', syntheticRank: 5 },  // other fixed capacitors
          ],
          whitelist: {
            allowChapters: ['85'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8532.' },
          ],
          penalties: [
            { delta: 0.95, prefixMatch: '0805.' },   // very strong penalty for citrus (orange!)
            { delta: 0.95, prefixMatch: '9306.' },   // very strong penalty for ammunition (round!)
            { delta: 0.80, prefixMatch: '8533.' },   // penalize resistors (similar component)
          ],
        } as IntentRule;
        patches.push({ priority: 680, rule: newRule });
        console.log('CAPACITOR_ELECTRICAL_COMPONENT_INTENT: created (→8532, allowChapters:[85])');
      } else {
        console.log('CAPACITOR_ELECTRICAL_COMPONENT_INTENT: already exists, skipping');
      }
    }

    // 6. POWER_SUPPLY_CHARGER_ADAPTER_INTENT → 8504.40 (power supplies/chargers)
    //    "used dell computer power supply" → 8501.32 WRONG (expected 8504.40.60.18)
    //    "ELECTRONIC WIRES" → 8549.21 WRONG (expected 8504.40.85.00 - seems wrong eval data)
    //    "battery charger for scooter" → 8507.60 WRONG (expected 8504.40.95.50)
    //    Root cause: power supplies → electric motors (8501); chargers → batteries (8507)
    {
      const existing = allRules.find(r => r.id === 'POWER_SUPPLY_CHARGER_ADAPTER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'POWER_SUPPLY_CHARGER_ADAPTER_INTENT',
          description: 'Power supplies, chargers, adapters → 8504.40 (static converters)',
          pattern: {
            anyOf: [
              'power supply', 'computer power supply', 'atx power supply',
              'switching power supply', 'linear power supply', 'power adapter',
              'ac dc adapter', 'ac adapter', 'wall adapter', 'wall charger',
              'battery charger', 'charger for scooter', 'scooter charger',
              'laptop charger', 'laptop power adapter', 'laptop power supply',
              'power brick', 'power converter', 'dc power supply',
              'bench power supply', 'variable power supply',
              'phone charger adapter', 'usb charger adapter',
              'power supply unit', 'psu', 'power supply replacement',
            ],
            noneOf: [
              // Battery packs (different)
              'battery pack', 'rechargeable battery', 'lithium battery',
              // Solar chargers
              'solar charger', 'solar panel charger',
              // Wireless charger (different heading - radio apparatus)
              'wireless charger', 'qi charger',
            ],
          },
          inject: [
            { prefix: '8504.40', syntheticRank: 1 },  // static converters (power supplies)
            { prefix: '8504.31', syntheticRank: 5 },  // transformers (related)
          ],
          whitelist: {
            allowChapters: ['85'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8504.40' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '8501.' },  // penalize electric motors
            { delta: 0.85, prefixMatch: '8507.' },  // penalize batteries
            { delta: 0.80, prefixMatch: '8549.' },  // penalize electrical waste
          ],
        } as IntentRule;
        patches.push({ priority: 681, rule: newRule });
        console.log('POWER_SUPPLY_CHARGER_ADAPTER_INTENT: created (→8504.40, allowChapters:[85])');
      } else {
        console.log('POWER_SUPPLY_CHARGER_ADAPTER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT127)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT127 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
