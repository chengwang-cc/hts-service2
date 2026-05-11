#!/usr/bin/env ts-node
/**
 * Patch TT136 — 2026-03-31: Fix remaining "Genuine Crushed Stone" empty result
 *
 * Problem: After TT135 removed "crushed stone" from GEM_STONE_LOOSE_CRUSHED_INTENT,
 * GEMSTONE_CABOCHON_INTENT still has "crushed stone" + allowChapters:["71"],
 * while NATURAL_STONE_RAW_MINERAL_INTENT has denyChapters:["71"].
 * → allowChapters restricts to ch.71, denyChapters denies ch.71 → impossible → empty.
 *
 * Fix: remove "crushed stone" and "stone dust" and "stone powder" from GEMSTONE_CABOCHON_INTENT anyOf.
 * These generic phrases belong to NATURAL_STONE_RAW_MINERAL_INTENT which handles them with ch.25 inject.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-31tt136.ts
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

    // Remove "crushed stone", "stone dust", "stone powder" from GEMSTONE_CABOCHON_INTENT anyOf.
    // These generic phrases conflict with NATURAL_STONE_RAW_MINERAL_INTENT denyChapters:["71"].
    // Specific gemstone phrases like "crushed opal" are fine since they reference actual gemstones.
    {
      const existing = allRules.find(r => r.id === 'GEMSTONE_CABOCHON_INTENT');
      if (existing) {
        const genericPhrases = new Set(['crushed stone', 'stone dust', 'stone powder', 'crushed stones']);
        const toRemove = (existing.pattern.anyOf ?? []).filter(t => genericPhrases.has(t));
        if (toRemove.length > 0) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              anyOf: (existing.pattern.anyOf ?? []).filter(t => !genericPhrases.has(t)),
            },
          };
          patches.push({ priority: 0, rule: updated });
          console.log(`GEMSTONE_CABOCHON_INTENT: removing [${toRemove.join(', ')}] from anyOf`);
        } else {
          console.log('GEMSTONE_CABOCHON_INTENT: generic phrases already removed, skipping');
        }
      } else {
        console.log('GEMSTONE_CABOCHON_INTENT: not found, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT136)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch TT136 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
