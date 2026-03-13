#!/usr/bin/env ts-node
/**
 * Patch TT — 2026-03-13:
 *
 * Add positive MEDICAMENT_CH30_INTENT rule to help route pharmaceutical
 * queries to ch.30 after RR removed the conflicting AI_CH40_CONDOM rule.
 *
 * Without RR: "Medicaments...therapeutic or prophylactic uses" (3003 ch.30) was
 * routed to ch.40 because AI_CH40_CONDOM fired for "prophylactic". After RR:
 * AI_CH40_CONDOM no longer fires, but ch.30 is now "open" → relies on semantic.
 * Adding MEDICAMENT_CH30_INTENT ensures pharmaceutical compound queries explicitly
 * route to ch.30.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13tt.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. NEW MEDICAMENT_CH30_INTENT: pharmaceutical preparations → ch.30 ──────────
  {
    priority: 660,
    rule: {
      id: 'MEDICAMENT_CH30_INTENT',
      description: 'Medicaments, pharmaceutical preparations, drug mixtures → ch.30. ' +
        'HTS 3003 covers medicaments consisting of mixed constituents for therapeutic ' +
        'or prophylactic uses. "Medicament"/"medicaments" are HTS-specific terms for ' +
        'pharmaceutical preparations. Antiprotozoals, antibiotics, antivirals are all ' +
        'specifically named pharmaceutical classes in ch.30.',
      pattern: {
        anyOf: [
          'medicament', 'medicaments',
          'antiprotozoal', 'antiprotozoals', 'antiparasitic', 'antiparasitics',
          'antibiotic', 'antibiotics', 'antiviral', 'antivirals',
          'antifungal', 'antifungals', 'antineoplastic', 'antineoplastics',
          'antimalarial', 'antimalarials', 'antiretroviral', 'antiretrovirals',
        ],
        noneOf: [
          // Veterinary context might be different — but ch.30 also covers veterinary
          // Cosmetics/toiletries context → ch.33
          'perfume', 'cosmetic', 'cosmetics', 'beauty', 'sunscreen', 'lotion',
          'shampoo', 'soap', 'deodorant',
        ],
      },
      whitelist: { allowChapters: ['30'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch TT)...`);

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
    console.log(`\nPatch TT complete: ${success} applied, ${failed} failed`);
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
