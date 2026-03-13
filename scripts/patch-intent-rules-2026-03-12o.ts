#!/usr/bin/env ts-node
/**
 * Patch O — 2026-03-12:
 *
 * Fix 5 more overly-broad AI rules that conflict with patch-M rules:
 *
 * 1. AI_CH36_SIGNAL_FLARES: "marine" in anyOf → fires for "marine propulsion engines"
 *    → allowChapters:['36'] survives after my rule denies ch.91 → wrong ch.36 result
 *    Fix: add noneOf for propulsion/engine context.
 *
 * 2. AI_CH91_DASHBOARD_CLOCK: "marine", "vessel" in anyOf → same issue
 *    Fix: add noneOf for propulsion context.
 *
 * 3. AI_CH91_MARINE_CHRONOMETER: "marine" in anyOf → same issue
 *    Fix: add noneOf for propulsion context.
 *
 * 4. AI_CH89_FISHING_VESSEL: "lobster", "shrimp" in anyOf → fires for
 *    "prepared meals Lobster" query → allowChapters:['89'] wins over ch.16
 *    Fix: add noneOf for prepared/canned food context.
 *
 * 5. AI_CH03_ROE_CAVIAR: "eggs", "caviar" in anyOf → fires for
 *    "Prepared or preserved fish caviar...fish eggs" query → allowChapters:['03']
 *    conflicts with PREPARED_FISH_SEAFOOD_HTS_INTENT denyChapters:['03'] → EMPTY
 *    Fix: add noneOf for prepared/preserved context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12o.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH36_SIGNAL_FLARES — don't fire for propulsion/engine context ──
  {
    priority: 610,
    rule: {
      id: 'AI_CH36_SIGNAL_FLARES',
      description: 'Signal flares, fog signals, rain rockets, distress signals → 3604.90. ' +
        'Added noneOf for propulsion/engine context to prevent firing on marine propulsion engine queries.',
      pattern: {
        anyOf: ['flare', 'flares', 'signal flare', 'fog signal', 'distress signal', 'rain rocket',
          'pyrotechnic', 'smoke signal', 'emergency flare'],
        noneOf: ['propulsion', 'engine', 'engines', 'motor', 'thrust', 'turbine', 'piston'],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

  // ── 2. Fix AI_CH91_DASHBOARD_CLOCK — don't fire for propulsion/engine context ─
  {
    priority: 610,
    rule: {
      id: 'AI_CH91_DASHBOARD_CLOCK',
      description: 'Dashboard clock / car clock / vehicle instrument panel clock / boat clock → 9104. ' +
        'Added noneOf for propulsion/engine vocabulary to prevent conflict with marine engine queries.',
      pattern: {
        anyOf: ['dashboard clock', 'car clock', 'boat clock', 'instrument clock', 'panel clock',
          'cockpit clock', 'vehicle clock', 'automotive clock', 'aircraft clock',
          'dashboard', 'dash'],
        noneOf: ['propulsion', 'engine', 'engines', 'motor', 'motors', 'thrust', 'turbine',
          'cylinder', 'piston', 'crankshaft', 'horsepower', 'rpm'],
      },
      whitelist: { allowChapters: ['91'] },
    },
  },

  // ── 3. Fix AI_CH91_MARINE_CHRONOMETER — don't fire for propulsion context ────
  {
    priority: 610,
    rule: {
      id: 'AI_CH91_MARINE_CHRONOMETER',
      description: 'Marine chronometer / ship clock / nautical clock → 9105.99. ' +
        'Added noneOf for propulsion/engine vocabulary to prevent conflict with marine engine queries.',
      pattern: {
        anyOf: ['chronometer', 'marine chronometer', 'ship clock', 'nautical clock',
          'nautical', 'navigation clock', 'navigator clock'],
        noneOf: ['propulsion', 'engine', 'engines', 'motor', 'motors', 'thrust',
          'turbine', 'cylinder', 'piston', 'crankshaft'],
      },
      whitelist: { allowChapters: ['91'] },
    },
  },

  // ── 4. Fix AI_CH89_FISHING_VESSEL — don't fire for prepared food context ────
  {
    priority: 610,
    rule: {
      id: 'AI_CH89_FISHING_VESSEL',
      description: 'Fishing boats, trawlers, factory ships, fish processing vessels → 8902. ' +
        'Removed bare "lobster", "shrimp" from anyOf (too broad — caused prepared seafood queries ' +
        'to match fishing vessels). Now requires vessel-specific vocabulary.',
      pattern: {
        anyOf: [
          // Vessel-specific terms only
          'fishing vessel', 'fishing boat', 'fishing trawler',
          'trawler', 'trawlers',
          'factory ship', 'factory vessel',
          'fish processing vessel',
          'lobster boat', 'lobster vessel',
          'shrimp boat', 'shrimp trawler',
        ],
        noneOf: ['rod', 'lure', 'reel', 'hook', 'prepared meals', 'airtight', 'in oil', 'canned'],
      },
      whitelist: { allowChapters: ['89'] },
    },
  },

  // ── 5. Fix AI_CH03_ROE_CAVIAR — don't fire for prepared/preserved context ──
  {
    priority: 610,
    rule: {
      id: 'AI_CH03_ROE_CAVIAR',
      description: 'Fresh fish roe, raw caviar, fresh fish eggs → 0303.91, 0305.20. ' +
        'Added noneOf for "prepared or preserved" context — caviar described as ' +
        '"prepared or preserved fish caviar substitutes" belongs to ch.16, not ch.03. ' +
        'Also removed bare "eggs" (too broad: fires for "fish eggs" in preparation context).',
      pattern: {
        anyOf: ['roe', 'caviar', 'ikura', 'tobiko', 'masago', 'tarama', 'bottarga', 'kazunoko',
          'fish roe', 'salmon roe', 'fish eggs'],
        noneOf: [
          'prepared or preserved',
          'preserved fish',
          'substitutes',
          'in oil',
          'neither cooked',
          'prepared meals',
          'airtight containers',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch O)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
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
    console.log(`\nPatch O complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
