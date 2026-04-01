#!/usr/bin/env ts-node
/**
 * Patch TT137 — 2026-03-31: Fix "Crushed stone for inlaying and crafting" empty result
 *
 * Problem: NATURAL_STONE_RAW_MINERAL_INTENT fires on "crushed stone" phrase → denyChapters:["71"].
 * GEMSTONE_CABOCHON_INTENT fires on "for inlaying" phrase → allowChapters:["71"].
 * Same impossible intersection pattern: allowChapters:["71"] AND denyChapters:["71"] = empty.
 *
 * Fix: Add "inlaying", "inlay", "for inlaying" to NATURAL_STONE_RAW_MINERAL_INTENT noneOf.
 * When query contains gem-inlay language, NATURAL_STONE_RAW_MINERAL_INTENT should not fire,
 * allowing GEMSTONE_CABOCHON_INTENT's allowChapters:["71"] to take effect cleanly.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-31tt137.ts
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

    // Add "inlaying", "inlay", "for inlaying", "inlay work" to NATURAL_STONE_RAW_MINERAL_INTENT noneOf.
    // When a query mentions gem inlay work, the raw mineral intent should not fire (it has
    // denyChapters:["71"]), allowing GEMSTONE_CABOCHON_INTENT (allowChapters:["71"]) to take effect.
    {
      const existing = allRules.find(r => r.id === 'NATURAL_STONE_RAW_MINERAL_INTENT');
      if (existing) {
        const inlayPhrases = ['inlaying', 'inlay', 'for inlaying', 'inlay work', 'stone inlay'];
        const currentNoneOf = existing.pattern.noneOf ?? [];
        const newPhrases = inlayPhrases.filter(p => !currentNoneOf.includes(p));
        if (newPhrases.length > 0) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              noneOf: [...currentNoneOf, ...newPhrases],
            },
          };
          patches.push({ priority: 0, rule: updated });
          console.log(`NATURAL_STONE_RAW_MINERAL_INTENT: adding [${newPhrases.join(', ')}] to noneOf`);
        } else {
          console.log('NATURAL_STONE_RAW_MINERAL_INTENT: inlay phrases already in noneOf, skipping');
        }
      } else {
        console.log('NATURAL_STONE_RAW_MINERAL_INTENT: not found, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT137)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch TT137 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
