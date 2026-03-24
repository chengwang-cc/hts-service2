#!/usr/bin/env ts-node
/**
 * Patch TT134 — 2026-03-18: Fix bicycle helmet → motorcycle helmet misclassification
 *
 * Problem: "bicycle helmet" returns motorcycle helmets (6506.10.30.30, 6506.10.60.30)
 * at rank #1/#2 instead of athletic/sporting headgear (6506.10.30.45, 6506.10.60.45).
 *
 * Root cause:
 * 1. BICYCLE_INTENT fires for "bicycle helmet" (has 'bicycle' in anyOf), allowChapters: ['87']
 *    This causes ch.87 bicycle codes to pass the OR-logic allow filter.
 * 2. BICYCLE_HELMET_INTENT fires too, but allowPrefixes: ['6506.'] is overridden by BICYCLE_INTENT.
 * 3. Motorcycle helmets have higher vector similarity score (1.0) vs athletic headgear (0.92),
 *    and no denyPrefixes exclude them for bicycle-specific queries.
 *
 * Fixes:
 * 1. BICYCLE_INTENT: add 'helmet'/'helmets' to noneOf → prevents it from firing for helmet queries
 * 2. BICYCLE_HELMET_INTENT: remove 'motorcycle helmet' from anyOf; add 'motorcycle' to noneOf
 * 3. NEW CYCLING_HELMET_INTENT: fires when bicycle+helmet in query; denies motorcycle helmet codes;
 *    boosts and injects correct athletic headgear codes (6506.10.30.45, 6506.10.60.45)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-18tt134.ts
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

    // 1. UPDATE BICYCLE_INTENT — add 'helmet'/'helmets' to noneOf
    //    Prevents bicycle accessory rule from firing for "bicycle helmet" queries,
    //    which was causing ch.87 codes to pass the OR-logic whitelist filter.
    {
      const existing = allRules.find(r => r.id === 'BICYCLE_INTENT');
      if (existing) {
        const noneOf = existing.pattern.noneOf ?? [];
        if (!noneOf.includes('helmet')) {
          const updated: IntentRule = {
            ...existing,
            pattern: {
              ...existing.pattern,
              noneOf: [...noneOf, 'helmet', 'helmets'],
            },
          };
          patches.push({ priority: 60, rule: updated });
          console.log('BICYCLE_INTENT: adding helmet/helmets to noneOf');
        } else {
          console.log('BICYCLE_INTENT: already has helmet in noneOf, skipping');
        }
      } else {
        console.log('BICYCLE_INTENT: not found, skipping');
      }
    }

    // 2. UPDATE BICYCLE_HELMET_INTENT — remove 'motorcycle helmet' from anyOf; add 'motorcycle' to noneOf
    //    Ensures motorcycle helmet queries don't trigger this rule (preventing incorrect denies).
    {
      const existing = allRules.find(r => r.id === 'BICYCLE_HELMET_INTENT');
      if (existing) {
        const anyOf = (existing.pattern.anyOf ?? []).filter(t => t !== 'motorcycle helmet');
        const noneOf = existing.pattern.noneOf ?? [];
        const updated: IntentRule = {
          ...existing,
          pattern: {
            ...existing.pattern,
            anyOf,
            noneOf: noneOf.includes('motorcycle') ? noneOf : [...noneOf, 'motorcycle'],
          },
        };
        patches.push({ priority: 126, rule: updated });
        console.log('BICYCLE_HELMET_INTENT: removed motorcycle helmet from anyOf; added motorcycle to noneOf');
      } else {
        console.log('BICYCLE_HELMET_INTENT: not found, skipping');
      }
    }

    // 3. NEW CYCLING_HELMET_INTENT — explicit rule for bicycle+helmet queries
    //    Fires only when query contains both a bicycle term AND "helmet".
    //    Denies motorcycle helmet codes; injects and boosts correct athletic headgear.
    {
      const existing = allRules.find(r => r.id === 'CYCLING_HELMET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CYCLING_HELMET_INTENT',
          description: 'Cycling/bicycle helmet → 6506.10.30.45/6506.10.60.45; deny motorcycle helmet codes',
          pattern: {
            required: ['helmet'],
            anyOf: ['bicycle', 'bike', 'cycling', 'cycle'],
            noneOf: ['motorcycle'],
          },
          inject: [
            { prefix: '6506.10.30.45', syntheticRank: 18 },
            { prefix: '6506.10.60.45', syntheticRank: 20 },
          ],
          whitelist: {
            allowPrefixes: ['6506.'],
            denyPrefixes: ['6506.10.30.30', '6506.10.60.30'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6506.10.30.45' },
            { delta: 0.90, prefixMatch: '6506.10.60.45' },
          ],
        } as IntentRule;
        patches.push({ priority: 126, rule: newRule });
        console.log('CYCLING_HELMET_INTENT: created');
      } else {
        console.log('CYCLING_HELMET_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT134)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ❌ ${rule.id}: ${msg}`);
      }
    }
    console.log(`\nPatch TT134 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
