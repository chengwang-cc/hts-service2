#!/usr/bin/env ts-node
/**
 * Patch VVfix — 2026-03-13:
 *
 * Fix side effect from VV: AI_CH36_EXPLOSIVES noneOf had 'liquids','projecting',
 * 'dispersing' which would prevent "liquid explosives" / liquid propellants from
 * routing to ch.36. Remove these overly broad terms, keep specific agricultural/
 * spraying context discriminators.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13vvfix.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── Fix AI_CH36_EXPLOSIVES — remove overly broad noneOf terms ─────────────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH36_EXPLOSIVES',
      description: 'Explosives, dynamite, blasting agents → ch.36. ' +
        'VVfix: Removed "liquids","projecting","dispersing" from noneOf — these were ' +
        'too broad and would block "liquid explosives"/"liquid propellants". ' +
        'Kept agricultural/spraying/extinguisher context discriminators which are ' +
        'sufficient to prevent the agricultural sprayer (8424.82 ch.84) false fire.',
      pattern: {
        anyOf: [
          'explosives', 'explosive', 'dynamite', 'blasting', 'anfo',
          'detonating', 'detonator', 'detonators', 'propellant', 'gunpowder', 'powder',
        ],
        noneOf: [
          'firearms', 'firearm', 'pistol', 'revolver', 'revolvers',
          'rifle', 'rifles', 'shotgun', 'shotguns', 'military weapons',
          'military weapon', 'carbine', 'muzzle-loading', 'ammunition',
          'blank ammunition', 'captive-bolt', 'captive',
          'leather', 'hide', 'hides', 'waste', 'parings', 'dust',
          'composition leather',
          // Sand/abrasive blasting and agricultural spraying machinery → ch.84
          'appliances', 'sand', 'sand blasting', 'abrasive',
          'agricultural', 'horticultural',
          'spraying', 'spray gun', 'spray guns',
          'extinguisher', 'extinguishers', 'fire extinguisher', 'fire extinguishers',
        ],
      },
      whitelist: { allowChapters: ['36'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch VVfix)...`);

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
    console.log(`\nPatch VVfix complete: ${success} applied, ${failed} failed`);
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
