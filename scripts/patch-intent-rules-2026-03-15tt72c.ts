#!/usr/bin/env ts-node
/**
 * Patch TT72c — 2026-03-15: Revert KEYCHAIN_METAL_INTENT anyOfGroups; fix via dual-intent OR logic.
 *
 * Problem discovered:
 *  - TT72 added anyOfGroups to KEYCHAIN_METAL_INTENT (requiring explicit metal keyword)
 *  - TT72b narrowed CHARACTER_KEYCHAIN_PLASTIC_INTENT with anyOfGroups (character/game terms)
 *  - "keychain round M (pre-owned)" now matches NEITHER intent → organic search → 9306.21 (WRONG!)
 *  - Original: KEYCHAIN_METAL_INTENT matched ALL 'keychain' queries → 7326.20 for "keychain round M"
 *
 * Correct approach — dual-intent OR logic:
 *  - REVERT KEYCHAIN_METAL_INTENT to original (no anyOfGroups): matches all 'keychain' without explicit plastic
 *  - Keep CHARACTER_KEYCHAIN_PLASTIC_INTENT with anyOfGroups (game/character terms) + allowChapters:['39','71','95']
 *  - When BOTH fire (e.g. "Omori SMASH Keychains"):
 *    * KEYCHAIN_METAL_INTENT: inject 7326, boost 0.55 (no allowChapters positive filter)
 *    * CHARACTER_KEYCHAIN_PLASTIC_INTENT: inject 3926.90.35, boost 0.65, allowChapters:['39','71','95']
 *    * OR logic: entry must pass AT LEAST ONE rule's positive filter
 *    * KEYCHAIN_METAL_INTENT has no positive filter → doesn't count in OR
 *    * CHARACTER_KEYCHAIN_PLASTIC_INTENT has allowChapters:['39','71','95'] → only ch.39/71/95 pass
 *    * 7326 (ch.73) BLOCKED; 3926.90.35 PASSES → correct!
 *  - When only KEYCHAIN_METAL_INTENT fires ("keychain round M"):
 *    * No positive filter → all organic entries pass → boost for 7326 → 7326.20 correct!
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt72c.ts
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

    // REVERT KEYCHAIN_METAL_INTENT — remove anyOfGroups added in TT72
    // Restore to original: matches 'keychain'/'keychains' with noneOf:[acrylic,resin,pvc,plastic]
    // This allows "keychain round M" to match and get boosted to 7326 (correct)
    // "Omori SMASH Keychains" also matches (no explicit plastic keyword)
    // BUT: CHARACTER_KEYCHAIN_PLASTIC_INTENT also matches "Omori SMASH Keychains" (has "smash")
    //   → its allowChapters:['39','71','95'] blocks 7326.xx from the combined OR result
    {
      const existing = allRules.find(r => r.id === 'KEYCHAIN_METAL_INTENT');
      if (existing) {
        const currentPattern = (existing as any).pattern || {};
        // Remove anyOfGroups — restore to original noneOf-only pattern
        const { anyOfGroups: _, ...patternWithoutGroups } = currentPattern;
        const updated = {
          ...existing,
          pattern: patternWithoutGroups,
        } as IntentRule;
        await svc.upsertRule(updated, 0);
        console.log('✅ KEYCHAIN_METAL_INTENT: reverted anyOfGroups (original pattern restored)');
        console.log('   "keychain round M" → both intents miss CHARACTER → no allowChapters filter → 7326 wins (correct)');
        console.log('   "Omori SMASH Keychains" → both intents fire → CHARACTER allowChapters blocks 7326 → 3926.90.35 wins (correct)');
      } else {
        console.log('❌ KEYCHAIN_METAL_INTENT: not found');
      }
    }

    console.log('\nTT72c complete');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
