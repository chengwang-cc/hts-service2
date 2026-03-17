#!/usr/bin/env ts-node
/**
 * Patch TT80b — 2026-03-15: Fix EMPTY results for vacuum hose attachment queries.
 *
 * Bug found in TT80:
 *  PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT (TT80) and VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT (pre-existing)
 *  both return EMPTY for "plastic vacuum attachment", "m18 vacuum attachment", "vacuum attachment plastic"
 *
 *  Root cause: VACUUM_CLEANER_INTENT has allowPrefixes:['8508.'] and fires for any query containing
 *  "vacuum" (single-word token). When it co-fires with the plastic hose rules:
 *    - OR logic: only VACUUM_CLEANER_INTENT has allowPrefixes → entry must be 8508.xx
 *    - denyChapters:['84','85'] from PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT removes ch.85
 *    - Net: entry must be 8508.xx but 8508 is ch.85 which is denied → EMPTY!
 *
 *  Fix: Add allowChapters:['39'] to both vacuum hose attachment rules so the OR logic
 *  also allows ch.39 entries (3917). The denyChapters:['84','85'] then filters the 8508.xx
 *  entries, leaving only the ch.39 entries (correct behavior).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt80b.ts
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

    // Fix PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT (TT80) — add allowChapters:['39']
    // Bug: VACUUM_CLEANER_INTENT (allowPrefixes:['8508.']) fires whenever "vacuum" appears.
    //      OR logic: only 8508.xx passes → denyChapters:['85'] removes all → EMPTY.
    // Fix: Add allowChapters:['39'] so OR allows ch.39 entries; denyChapters removes 8508.xx.
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowChapters: ['39'],          // allow ch.39 (plastic hoses) in OR filter
            denyChapters: ['84', '85'],     // deny machinery and electrical (vacuum cleaners)
          },
        } as IntentRule;
        await svc.upsertRule(updated, 561);
        console.log('✅ PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT: added allowChapters:[39]');
        console.log('   "m18 vacuum attachment" → should now return 3917.39 instead of EMPTY');
      } else {
        console.log('❌ PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT: not found');
      }
    }

    // Fix VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT (pre-existing) — add allowChapters:['39']
    // Bug: "vacuum attachment plastic" → EMPTY (same root cause)
    //      VACUUM_CLEANER_INTENT allowPrefixes:['8508.'] fires, blocks 3917 inject.
    // Fix: Add allowChapters:['39'] so ch.39 entries pass; denyChapters:['84','85'] removes 8508.xx.
    {
      const existing = allRules.find(r => r.id === 'VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          whitelist: {
            allowChapters: ['39'],          // allow plastic hoses in OR filter
            denyChapters: ['84', '85'],     // deny vacuum cleaners/machinery
          },
        } as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 500);
        console.log('✅ VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT: added allowChapters:[39], denyChapters:[84,85]');
        console.log('   "vacuum attachment plastic" → should now return 3917 instead of EMPTY');
      } else {
        console.log('❌ VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT: not found');
      }
    }

    console.log('\nTT80b complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
