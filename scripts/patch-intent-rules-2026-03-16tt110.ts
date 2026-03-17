#!/usr/bin/env ts-node
/**
 * Patch TT110 — 2026-03-16: Fix THROW PILLOW COVER → 6302 regression caused by CUSHION_INTENT.
 *
 * Root cause: CUSHION_INTENT has anyOf:["cushion","cushions","throw"] with anyOfGroups:[["pillow",...]].
 * For "throw pillow cover" queries, CUSHION_INTENT fires (throw + pillow matches) and its
 * denyPrefixes:["6302."] blocks ALL 6302 (bed linen/pillow cases) entries.
 * This caused "throw pillow cover" to return 0 results and "DECORATIVE RED COTTON THROW PILLOW COVER"
 * to return wrong garment items (ch.62/61 cotton items) with TT109's lexicalFilter approach.
 *
 * Fix: Add noneOf phrases to CUSHION_INTENT to exclude "throw pillow cover/case" queries
 * where "throw" refers to the pillow product name, not a decorative throw/blanket.
 *
 * TT109's lexicalFilter.stripTokens on THROW_PILLOW_COVER_WOVEN_INTENT was correct logic,
 * just blocked by CUSHION_INTENT's denyPrefixes. After this fix:
 *   - "throw pillow cover" → CUSHION_INTENT excluded → 6302 not denied → 6302.21 returns ✓
 *   - "throw" alone or "throw blanket" → CUSHION_INTENT still fires ✓
 *   - "decorative throw" alone → CUSHION_INTENT fires ✓
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt110.ts
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

    // FIX CUSHION_INTENT — add noneOf for "throw pillow cover" queries
    // CUSHION_INTENT fires when query has "throw" + "pillow" (via anyOf + anyOfGroups).
    // Its denyPrefixes:['6302.'] blocks all 6302 bed linen entries.
    // "throw pillow cover" is a product name (pillow COVER for a throw pillow),
    // not a decorative throw/blanket or stuffed cushion — it should return 6302.21.
    // Adding noneOf prevents CUSHION_INTENT from firing for pillow-cover queries.
    {
      const existing = allRules.find(r => r.id === 'CUSHION_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const addNoneOf = [
          'throw pillow cover', 'throw pillow covers',
          'throw pillow case', 'throw pillow cases',
          'decorative throw pillow cover', 'decorative throw pillow case',
          'cotton throw pillow cover', 'cotton throw pillow case',
          'woven throw pillow cover',
          'throw pillow cover set',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...addNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 31, rule: updated });
        console.log('CUSHION_INTENT: added noneOf for throw-pillow-cover phrases (prevents denyPrefixes:[6302.] from blocking pillow cases)');
      } else {
        console.log('CUSHION_INTENT: not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT110)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT110 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
