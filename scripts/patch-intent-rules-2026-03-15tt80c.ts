#!/usr/bin/env ts-node
/**
 * Patch TT80c — 2026-03-15: Fix regression from TT80b.
 *
 * Regression from TT80b:
 *  "vacuum attachment" → 3917.39 (expected 8509.90 domestic appliance parts)
 *  Root cause: VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT has broad 'vacuum attachment' in anyOf.
 *  After TT80b added allowChapters:['39'] + denyChapters:['84','85'], this broad phrase
 *  caused "vacuum attachment" (without "plastic" qualifier) to return ch.39 instead of ch.85.
 *
 * Fix: Revert VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT to whitelist:null.
 *  The OR logic then only has PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT's allowChapters:['39']
 *  for specific plastic phrases (e.g. "plastic vacuum attachment", "m18 vacuum attachment").
 *  For the generic "vacuum attachment", only VACUUM_CLEANER_INTENT fires with allowPrefixes,
 *  keeping ch.85 results.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt80c.ts
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

    // Revert VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT to whitelist:null
    // TT80b incorrectly added allowChapters:['39'] to this rule which has 'vacuum attachment'
    // (broad, no plastic qualifier). This caused "vacuum attachment" → 3917 (regression).
    // Only PLASTIC_VACUUM_HOSE_ATTACHMENT_INTENT (plastic-specific phrases only) should
    // have allowChapters:['39'] + denyChapters:['84','85'].
    {
      const existing = allRules.find(r => r.id === 'VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT');
      if (existing) {
        const { whitelist: _, ...withoutWhitelist } = existing as any;
        const updated = withoutWhitelist as IntentRule;
        await svc.upsertRule(updated, (existing as any).priority ?? 500);
        console.log('✅ VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT: reverted whitelist to null');
        console.log('   "vacuum attachment" should return ch.85 again');
      } else {
        console.log('❌ VACUUM_HOSE_ATTACHMENT_PLASTIC_INTENT: not found');
      }
    }

    console.log('\nTT80c complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
