#!/usr/bin/env ts-node
/**
 * Patch TT138 — 2026-03-31: Fix coin/numismatic query coverage
 *
 * Problems:
 * 1. "Great Britain 1887 Half 1/2 Crown XF-AU * STUNNING Queen Victoria Silver UK Coin" → EMPTY
 *    No coin rule fires: "half crown" doesn't match because "1/2" sits between "half" and "crown".
 *    "silver coin" doesn't match because "UK" sits between "silver" and "coin".
 *    Fix: add "queen victoria" to COLLECTIBLE_COIN_NUMISMATIC_INTENT anyOf.
 *
 * 2. "1 Set of 2 Rolls Alaska State Quarters" → gets paper (4802) instead of 7118 coin
 *    "state quarters" is not in any coin rule anyOf.
 *    Fix: add "state quarters", "state quarter", "alaska quarter", "quarters roll" phrases.
 *
 * 3. Various British/world coin queries missing due to no phrase match.
 *    Fix: add "king george", "king edward", "half crown", "victoria coin",
 *    "world coin" (already exists), and grade abbreviations "xf-au", "xf au", "ef-au".
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-31tt138.ts
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

    // Add coin-related phrases that were missing from COLLECTIBLE_COIN_NUMISMATIC_INTENT
    {
      const existing = allRules.find(r => r.id === 'COLLECTIBLE_COIN_NUMISMATIC_INTENT');
      if (existing) {
        const newPhrases = [
          'queen victoria',       // British Victorian-era coins
          'king george',          // British George-era coins
          'king edward',          // British Edward-era coins
          'victoria coin',        // More specific
          'state quarters',       // US state quarter rolls/sets
          'state quarter',        // US state quarter
          'quarters roll',        // Coin rolls
          'coin roll',            // Generic coin rolls
          'coin rolls',           // Generic coin rolls
          'xf-au',               // Extremely Fine - About Uncirculated grade
          'xf au',               // Same grade without hyphen
          'ef-au',               // Extremely Fine grade abbreviation
          'half crown',          // British coin denomination
          'british coin',        // Generic British coin reference
          'uk coin',             // UK coin
          'great britain coin',   // Full phrase
        ];
        const anyOf = existing.pattern.anyOf ?? [];
        const toAdd = newPhrases.filter(p => !anyOf.includes(p));
        if (toAdd.length > 0) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              anyOf: [...anyOf, ...toAdd],
            },
          };
          patches.push({ priority: 0, rule: updated });
          console.log(`COLLECTIBLE_COIN_NUMISMATIC_INTENT: adding ${toAdd.length} phrases: [${toAdd.join(', ')}]`);
        } else {
          console.log('COLLECTIBLE_COIN_NUMISMATIC_INTENT: all phrases already present, skipping');
        }
      } else {
        console.log('COLLECTIBLE_COIN_NUMISMATIC_INTENT: not found, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT138)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch TT138 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
