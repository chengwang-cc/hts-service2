#!/usr/bin/env ts-node
/**
 * Patch RR — 2026-03-13:
 *
 * Fix 2 cross-chapter conflicts found in eval-final:
 *
 * 1. AI_CH40_CONDOM: "prophylactic" fires for "therapeutic or prophylactic uses"
 *    in medicament descriptions (3003 ch.30 — pharmaceutical mixtures). The word
 *    "prophylactic" in HTS medicament text means preventive/pharmaceutical, not
 *    condom. Result: allowChapters:[40] blocks ch.30 for medicaments.
 *    Fix: add noneOf for pharmaceutical/medicament context.
 *
 * 2. AI_CH66_TELESCOPIC_UMBRELLA: "folding" fires for "bending folding
 *    straightening or flattening machines" (8462 ch.84 — machine tools).
 *    "Folding" here describes a metal-working operation, not a collapsible umbrella.
 *    Result: allowChapters:[66] blocks ch.84 for machine tools → EMPTY result.
 *    Fix: add noneOf for machinery/machine tool context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13rr.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH40_CONDOM — exclude pharmaceutical/medicament context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH40_CONDOM',
      description: 'Condoms, prophylactics, contraceptive sheaths → ch.40. ' +
        'Added noneOf for pharmaceutical context: "therapeutic or prophylactic uses" ' +
        'appears in medicament descriptions (3003 ch.30) → fires allowChapters:[40]. ' +
        '"Prophylactic" in HTS medicament text = preventive pharmaceutical, not condom. ' +
        'Medicament context identified by "therapeutic","medicament","constituents".',
      pattern: {
        anyOf: [
          'condom', 'condoms', 'prophylactic', 'prophylactics',
          'contraceptive', 'contraceptives', 'sheath',
        ],
        noneOf: [
          // Pharmaceutical/medicament context → ch.30
          'therapeutic', 'medicament', 'medicaments', 'pharmaceutical', 'pharmaceuticals',
          'drug', 'drugs', 'constituents', 'mixed together', 'dosage', 'doses',
          'measured doses', 'retail sale', 'prophylactic uses', 'therapeutic uses',
          'heading 3002', 'heading 3005', 'heading 3006',
        ],
      },
      whitelist: { allowChapters: ['40'] },
    },
  },

  // ── 2. Fix AI_CH66_TELESCOPIC_UMBRELLA — exclude machine tool context ──────────
  {
    priority: 640,
    rule: {
      id: 'AI_CH66_TELESCOPIC_UMBRELLA',
      description: 'Telescopic, folding, travel umbrellas → ch.66. ' +
        'Added noneOf for machine tool context: "bending folding straightening or ' +
        'flattening machines" (8462 ch.84) has "folding" → fires allowChapters:[66]. ' +
        '"Folding" in machine tool descriptions = metal-working operation (bending/folding ' +
        'sheet metal), not a collapsible umbrella. Result: ch.84 EMPTY.',
      pattern: {
        anyOf: [
          'telescopic', 'collapsible', 'compact', 'folding', 'foldable', 'travel',
        ],
        noneOf: [
          // Telescopic sights/optics context → ch.90 (existing)
          'sights', 'sight', 'scope', 'scopes', 'rifle', 'rifles',
          'firearm', 'firearms', 'weapon', 'optic', 'optics',
          'binocular', 'binoculars', 'monocular', 'reticle', 'crosshair', 'aiming',
          // Machine tool / metalworking context → ch.84
          'machinery', 'machines', 'machine tools', 'machine tool',
          'bending', 'straightening', 'flattening', 'shearing', 'punching',
          'notching', 'nibbling', 'numerically controlled', 'press', 'presses',
          'forging', 'hammering', 'rolling', 'drawbench', 'drawbenches',
          'metal carbides', 'slitting', 'cut-to-length',
        ],
      },
      whitelist: { allowChapters: ['66'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch RR)...`);

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
    console.log(`\nPatch RR complete: ${success} applied, ${failed} failed`);
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
