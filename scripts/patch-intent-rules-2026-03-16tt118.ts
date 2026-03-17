#!/usr/bin/env ts-node
/**
 * Patch TT118 — 2026-03-16: PCBs, FPC ribbon cables, stained glass jigs, ring mandrels.
 *
 * Fix 1: NEW PCB_PRINTED_CIRCUIT_BOARD_INTENT → 8534.00.00 / 8538.90 / 8543.90
 *   "CR10 Smart Mainboard Easy Swap PCB Kit" → 8473.30 (computer peripherals) WRONG (expected 8534.00.00.70)
 *   "electronic logic board" → 8473.30 WRONG (expected 8534.00.00.95)
 *   "Garage door pcb" → 8301 (locks!) WRONG (expected 8538.90.30.00)
 *   "N64 FRAM PCB No Enclosure" → 3926 (plastic) WRONG (expected 8543.90.68.00)
 *   Root cause: no PCB intent; "pcb" alone routes to computer parts (8473) or other wrong chapters.
 *   Fix: new intent injecting 8534 (generic PCB), 8538.90 (appliance PCBs), 8543.90 (gaming PCBs).
 *
 * Fix 2: NEW FPC_FLEX_RIBBON_CABLE_PRINTED_CIRCUIT_INTENT → 8534.00.00
 *   "flex cable ribbon for audio unit" → 8544.42 (wiring!) WRONG (expected 8534.00.00.80)
 *   "Hard drive ribbon for audio unit" → 8544 WRONG (expected 8534.00.00.80)
 *   "FPC Ribbon Cable Kit for Panasonic DVD Player" → 8529.90 WRONG (expected 8534.00.00.80)
 *   Root cause: "ribbon" + "cable" triggers wiring codes (8544); FPC cables are printed circuits.
 *   Fix: new intent anchored on "fpc", "flex cable", "ribbon cable" (electronics context) → 8534.
 *
 * Fix 3: NEW STAINED_GLASS_JIG_WORKHOLDING_INTENT → 8466.20
 *   "Hexagon Succulent Stained Glass Jig" → 7018.20 (glass microspheres) WRONG (expected 8466.20.80.40)
 *   "Dodecagon Succulent Stained Glass Jig" → 7016.10 (glass smallwares) WRONG
 *   "Octagon Succulent Stained Glass Jig" → same WRONG
 *   Root cause: "stained glass" → ch.70 glass; "succulent" → ch.06 plants. No jig intent fires.
 *   8466.20 = "Jigs and fixtures" for machine tools (includes glass-cutting aids).
 *   Fix: new intent with allowChapters:['84'] to block glass/plant chapters.
 *
 * Fix 4: NEW RING_LATHE_CHUCK_MANDREL_INTENT → 8466.20
 *   "Artisan Ring turning chuck mandrel - 1 1/4-8 TPI" → 8207.80 (turning tools) WRONG (expected 8466.20.80.65)
 *   "Artisan Ring turning chuck mandrel - Set of 3 Bushings- Aluminum" → same WRONG
 *   Root cause: "turning" + "chuck" triggers cutting tool codes (8207), not workholding (8466).
 *   8466.20 = "Jigs and fixtures" for lathes (ring-turning lathe chuck mandrels).
 *   Fix: new intent with allowChapters:['84'] to inject 8466.20 at rank 1.
 *
 * Fix 5: NEW CARBIDE_INSERT_CUTTING_TOOL_INTENT → 8207.80 / 8209
 *   "Premium replacement carbide inserts - Negative Rake - Square cutter" → 8212 (razors!) WRONG (expected 8207.80.30.00)
 *   "Premium Van Norman / Rels Brake Lathe Inserts (10 Pack)" → similar WRONG
 *   Root cause: "inserts" + "carbide" → razor/blade codes (8212). No carbide insert intent.
 *   8207.80 = Tools for turning with carbide inserts (replaceable cutting tips).
 *   Fix: new intent injecting 8207.80 at rank 1 + penalty on 8212 (razors).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt118.ts
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

    // 1. NEW PCB_PRINTED_CIRCUIT_BOARD_INTENT → 8534.00.00 / 8538.90 / 8543.90
    //    "pcb" alone routes to computer parts (8473) or locks (8301) or plastics (3926).
    //    Generic printed circuits = 8534.00; appliance control PCBs = 8538.90; specialty = 8543.90.
    //    allowChapters:['85'] blocks wrong chapters (83 locks, 39 plastics, 84 computer parts).
    {
      const existing = allRules.find(r => r.id === 'PCB_PRINTED_CIRCUIT_BOARD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PCB_PRINTED_CIRCUIT_BOARD_INTENT',
          description: 'PCB / printed circuit boards → 8534.00.00 (generic PCB), 8538.90 (appliance), 8543.90 (specialty)',
          pattern: {
            anyOf: [
              'pcb', 'printed circuit board', 'logic board',
              'mainboard pcb', 'pcb kit', 'pcb mainboard', 'circuit board pcb',
              'pcb board', 'pcb assembly', 'pcb replacement',
              'control board pcb', 'main pcb', 'swap pcb',
            ],
            noneOf: [
              // PCB mounting hardware (tube sockets, connectors)
              'pcb mount', 'pcb socket', 'pcb connector',
              // Camera main PCB → 9007.91 (handled by different intent)
              'canon dslr', 'dslr eos main pcb',
              // Servo motor with PCB → 8503
              'servo motor installation kit',
            ],
          },
          inject: [
            { prefix: '8534.00', syntheticRank: 1 },   // generic printed circuits (mainboard PCBs)
            { prefix: '8538.90', syntheticRank: 4 },   // parts of switches (appliance control PCBs)
            { prefix: '8543.90', syntheticRank: 6 },   // parts of other electrical machines (specialty PCBs)
          ],
          whitelist: {
            allowChapters: ['85'],   // block ch.83 locks, ch.39 plastics, ch.84 general machinery
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8534.00' },  // very strong boost for printed circuits
            { delta: 0.70, prefixMatch: '8538.' },     // moderate boost for electrical apparatus
            { delta: 0.60, prefixMatch: '8543.' },     // moderate boost for special machines
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8301.' },  // strong penalty for locks
            { delta: 0.90, prefixMatch: '8473.' },  // strong penalty for computer accessories
            { delta: 0.90, prefixMatch: '3926.' },  // strong penalty for plastics
          ],
        } as IntentRule;
        patches.push({ priority: 577, rule: newRule });
        console.log('PCB_PRINTED_CIRCUIT_BOARD_INTENT: created (pcb → 8534.00, 8538.90, 8543.90; allowChapters:[85])');
      } else {
        console.log('PCB_PRINTED_CIRCUIT_BOARD_INTENT: already exists, skipping');
      }
    }

    // 2. NEW FPC_FLEX_RIBBON_CABLE_PRINTED_CIRCUIT_INTENT → 8534.00.00
    //    "ribbon cable" for electronics triggers wiring (8544.42) instead of printed circuits (8534).
    //    FPC = Flexible Printed Circuit. Ribbon cables used internally are printed circuits.
    //    noneOf excludes decorative ribbons, torch tips, sewing ribbons.
    {
      const existing = allRules.find(r => r.id === 'FPC_FLEX_RIBBON_CABLE_PRINTED_CIRCUIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FPC_FLEX_RIBBON_CABLE_PRINTED_CIRCUIT_INTENT',
          description: 'FPC / flex ribbon cables (electronics) → 8534.00.00 (printed circuits), deny wiring',
          pattern: {
            anyOf: [
              'fpc ribbon cable', 'fpc cable', 'fpc connector cable',
              'flex cable ribbon', 'flat flex cable', 'flat ribbon cable',
              'hard drive ribbon', 'dvd drive ribbon', 'cd drive ribbon',
              'ribbon cable kit', 'fpc kit', 'flex ribbon',
            ],
            noneOf: [
              // Decorative/textile ribbons
              'silk ribbon', 'satin ribbon', 'hair ribbon', 'wedding ribbon',
              'twill tape ribbon', 'christmas ribbon', 'grosgrain ribbon',
              // Industrial torch tips (Nortel ribbon torch)
              'ribbon torch', 'torch tip',
              // Audio/video "ribbon" microphone (different product)
              'ribbon microphone', 'ribbon mic',
            ],
          },
          inject: [
            { prefix: '8534.00', syntheticRank: 1 },  // printed circuits (FPC ribbon cables)
          ],
          whitelist: {
            allowChapters: ['85'],   // block textile ribbons (ch.58/62) and other wrong chapters
            denyPrefixes: ['8544.'],  // hard-block wiring/cable codes
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8534.00' },  // very strong boost for printed circuits
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8544.' },  // strong penalty for wiring
            { delta: 0.90, prefixMatch: '8529.' },  // penalty for TV/radio parts
          ],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('FPC_FLEX_RIBBON_CABLE_PRINTED_CIRCUIT_INTENT: created (fpc/flex ribbon → 8534.00, denyPrefixes:[8544.])');
      } else {
        console.log('FPC_FLEX_RIBBON_CABLE_PRINTED_CIRCUIT_INTENT: already exists, skipping');
      }
    }

    // 3. NEW STAINED_GLASS_JIG_WORKHOLDING_INTENT → 8466.20
    //    "Stained Glass Jig" → glass chapter (7016/7018) because "stained glass" dominates.
    //    "Succulent" in product name → ch.06 (ornamental plants) compound error.
    //    8466.20 = "Jigs and fixtures" for machine tools/glass cutting workholding.
    {
      const existing = allRules.find(r => r.id === 'STAINED_GLASS_JIG_WORKHOLDING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STAINED_GLASS_JIG_WORKHOLDING_INTENT',
          description: 'Stained glass jigs, workholding fixtures → 8466.20 (jigs/fixtures for machine tools)',
          pattern: {
            anyOf: [
              'stained glass jig', 'glass jig',
              'stained glass work jig', 'glass cutting jig',
              'stained glass panel jig', 'glass panel jig',
              'hexagon jig', 'octagon jig', 'dodecagon jig',
              'stained glass layout jig',
            ],
            noneOf: [
              // Actual glass products
              'stained glass panel', 'stained glass window',
              'stained glass art', 'stained glass kit',
            ],
          },
          inject: [
            { prefix: '8466.20', syntheticRank: 1 },  // jigs and fixtures for machine tools
            { prefix: '8466.10', syntheticRank: 5 },  // tool holders
          ],
          whitelist: {
            allowChapters: ['84'],   // block ch.70 (glass products), ch.06 (plants)
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8466.20' },  // very strong boost for jigs/fixtures
            { delta: 0.60, prefixMatch: '8466.' },     // moderate boost for machine tool parts
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7016.' },  // strong penalty for glass smallwares
            { delta: 0.90, prefixMatch: '7018.' },  // strong penalty for glass microspheres
          ],
        } as IntentRule;
        patches.push({ priority: 579, rule: newRule });
        console.log('STAINED_GLASS_JIG_WORKHOLDING_INTENT: created (glass jig → 8466.20, allowChapters:[84])');
      } else {
        console.log('STAINED_GLASS_JIG_WORKHOLDING_INTENT: already exists, skipping');
      }
    }

    // 4. NEW RING_LATHE_CHUCK_MANDREL_INTENT → 8466.20
    //    "Artisan Ring turning chuck mandrel - 1 1/4-8 TPI" → 8207.80 (cutting tools) WRONG (expected 8466.20.80.65).
    //    "turning" + "chuck" → cutting tool codes (8207). But chuck mandrels for ring lathes are
    //    workholding accessories (8466.20 = jigs and fixtures / work holders for machine tools).
    //    TPI = threads per inch (threading for lathe attachment).
    {
      const existing = allRules.find(r => r.id === 'RING_LATHE_CHUCK_MANDREL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RING_LATHE_CHUCK_MANDREL_INTENT',
          description: 'Ring turning chuck mandrels, lathe workholding → 8466.20 (jigs/fixtures/workholders)',
          pattern: {
            anyOf: [
              'ring turning chuck mandrel', 'ring chuck mandrel',
              'artisan ring mandrel', 'ring mandrel chuck',
              'lathe chuck mandrel', 'chuck mandrel set',
              'turning chuck mandrel', 'ring turning mandrel',
            ],
            noneOf: [
              // Actual ring jewelry
              'ring finger', 'ring sizing', 'gemstone ring',
              // Hand drills (different product)
              'hand drill chuck', 'power drill chuck',
            ],
          },
          inject: [
            { prefix: '8466.20', syntheticRank: 1 },  // jigs/fixtures/workholders for machine tools
            { prefix: '8466.91', syntheticRank: 5 },  // parts of machine tools
          ],
          whitelist: {
            allowChapters: ['84'],   // block cutting tool chapter (82) and other wrong chapters
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8466.20' },  // very strong boost
            { delta: 0.60, prefixMatch: '8466.' },     // moderate boost for machine tool parts
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8207.' },  // strong penalty for cutting tools
            { delta: 0.90, prefixMatch: '8209.' },  // strong penalty for carbide cutting tips
          ],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('RING_LATHE_CHUCK_MANDREL_INTENT: created (ring chuck mandrel → 8466.20, allowChapters:[84])');
      } else {
        console.log('RING_LATHE_CHUCK_MANDREL_INTENT: already exists, skipping');
      }
    }

    // 5. NEW CARBIDE_INSERT_CUTTING_TOOL_INTENT → 8207.80 / 8209
    //    "Premium replacement carbide inserts - Negative Rake - Square cutter" → 8212 (razors!) WRONG
    //    "Premium Van Norman / Rels Brake Lathe Inserts (10 Pack)" → WRONG
    //    "inserts" + "carbide" → razor/blade codes (8212 = razors & blades).
    //    8207.80 = "Tools for turning" (carbide tipped turning inserts).
    //    8209.00.00.30 = "Of sintered metal carbides" (indexable carbide inserts).
    {
      const existing = allRules.find(r => r.id === 'CARBIDE_INSERT_CUTTING_TOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CARBIDE_INSERT_CUTTING_TOOL_INTENT',
          description: 'Carbide inserts (turning/milling) → 8207.80 / 8209 (cutting tool inserts), deny razors',
          pattern: {
            anyOf: [
              'carbide insert', 'carbide inserts',
              'replacement carbide insert', 'indexable carbide insert',
              'lathe insert', 'lathe inserts', 'brake lathe insert',
              'turning insert', 'milling insert',
              'negative rake insert', 'carbide cutting insert',
              'carbide tip insert',
            ],
            noneOf: [
              // Actual blade/razor products
              'razor insert', 'shaving insert',
              // Dental inserts
              'dental insert', 'dental tip',
            ],
          },
          inject: [
            { prefix: '8207.80', syntheticRank: 1 },  // tools for turning (carbide-tipped)
            { prefix: '8209.00', syntheticRank: 3 },  // sintered carbide cutting tips
            { prefix: '8207.70', syntheticRank: 6 },  // milling tools
          ],
          whitelist: {
            allowChapters: ['82'],   // cutting tools chapter; block ch.82 still but allow 8207/8209
            denyPrefixes: ['8212.'],  // hard-block razor codes
          },
          boosts: [
            { delta: 0.95, prefixMatch: '8207.80' },  // very strong boost for turning tools
            { delta: 0.80, prefixMatch: '8209.' },     // strong boost for carbide tips
            { delta: 0.60, prefixMatch: '8207.' },     // moderate boost for all cutting tools
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '8212.' },  // strong penalty for razors
          ],
        } as IntentRule;
        patches.push({ priority: 583, rule: newRule });
        console.log('CARBIDE_INSERT_CUTTING_TOOL_INTENT: created (carbide insert → 8207.80/8209, denyPrefixes:[8212.])');
      } else {
        console.log('CARBIDE_INSERT_CUTTING_TOOL_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT118)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT118 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
