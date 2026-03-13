#!/usr/bin/env ts-node
/**
 * Patch OO — 2026-03-13:
 *
 * Fix 1 rule:
 *
 * 1. AI_CH22_CIDER_PERRY_MEAD_SAKE: bare "hard" fires for "Hard magnetic disk drive
 *    units Other" (8471 ch.84) → allowChapters:[22] blocks ch.84. "Hard" as in
 *    "hard cider" or "hard liquor" is an alcoholic beverage modifier, but "hard" also
 *    appears in many non-beverage contexts (hard disk, hard material, hard coal, etc.).
 *    Also bare "Jun" is too generic. Fix: replace with phrases.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13oo.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH22_CIDER_PERRY_MEAD_SAKE — remove bare "hard" and "Jun" ──────
  {
    priority: 640,
    rule: {
      id: 'AI_CH22_CIDER_PERRY_MEAD_SAKE',
      description: 'Fermented beverages: cider, perry, mead, sake → ch.22. ' +
        'Removed bare "hard" from anyOf: "Hard magnetic disk drive units" (8471 ch.84) has ' +
        '"hard" → fires allowChapters:[22]. "Hard" in beverage context means "hard cider/ ' +
        'seltzer" but the bare word fires for many non-beverage contexts. ' +
        'Replaced with phrases. Also removed bare "Jun" (too generic).',
      pattern: {
        anyOf: [
          'cider', 'perry', 'mead', 'sake',
          'hard cider', 'hard seltzer', 'hard kombucha', 'hard lemonade',
          'jun tea', 'jun kombucha',
          // "hard" and "Jun" removed — too generic, fire in non-beverage contexts
        ],
        noneOf: ['vinegar'],
      },
      whitelist: { allowChapters: ['22'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch OO)...`);

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
    console.log(`\nPatch OO complete: ${success} applied, ${failed} failed`);
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
