#!/usr/bin/env ts-node
/**
 * Patch F2 — 2026-03-14:
 *
 * Regression fixes from E2:
 * 1. ELECTRIC_MOTOR_ACTUATOR_INTENT anyOf: REMOVE 'rotisserie', 'oven motor', 'grill motor',
 *    'range hood motor' — too broad:
 *    "Weber 7652 Rotisserie" → 7321.90 (grill parts, ch.73) expected; 'rotisserie' single-word
 *    fires ELECTRIC_MOTOR_ACTUATOR_INTENT → allowChapters=['85','84'] → ch.73 blocked.
 *    Keep: 'bbq motor', 'rotisserie motor' (phrases, require both words)
 *
 * 2. GLASS_DECANTER_VESSEL_INTENT: disable it — causing regressions:
 *    "Glass Decanter and Shot Glass Set" → 7013 expected, getting 7010 (wrong 7010 injected)
 *    "Rotpunkt Insulated Carafe" → 9617 expected, getting 7010 (carafe = thermos here)
 *    Instead: add 'decanter', 'carafe' to FRESH_FLOWER_INTENT noneOf to fix the root cause.
 *
 * 3. PAPER_DIECUT_CRAFT_INTENT: remove allowChapters, add 'mousepad' noneOf
 *    "Cute Die Cut Mousepad" → 5906 (rubberized textile) expected; allowChapters=['48'] blocked
 *    ch.59. Without allowChapters, inject+boost still pushes ch.48 for actual die cut queries.
 *
 * 4. FRESH_FLOWER_INTENT noneOf: add 'decanter', 'carafe', 'diffuser', 'essential oil',
 *    'wallpaper', 'fabric', 'earring', 'pendant', 'bangle', 'brooch', 'hair' terms
 *    to prevent flower rule from firing for non-flower products.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14f2.ts
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

    // ── 1. Fix ELECTRIC_MOTOR_ACTUATOR_INTENT: remove broad single words ──────
    // 'rotisserie' as single word fires for "Weber 7652 Rotisserie" → blocks ch.73
    // Similarly 'oven motor', 'grill motor' are too contextually ambiguous
    {
      const existing = allRules.find(r => r.id === 'ELECTRIC_MOTOR_ACTUATOR_INTENT') as IntentRule | undefined;
      if (existing) {
        const toRemove = new Set(['rotisserie', 'oven motor', 'grill motor', 'range hood motor', 'spit motor', 'ceiling fan motor']);
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = currentAnyOf.filter((t: string) => !toRemove.has(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'ELECTRIC_MOTOR_ACTUATOR_INTENT') + ' — Fixed F2: removed rotisserie/oven motor (blocked ch.73 for grill parts)',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`ELECTRIC_MOTOR_ACTUATOR_INTENT: removed ${currentAnyOf.length - newAnyOf.length} overly-broad terms`);
      } else {
        console.log('WARNING: ELECTRIC_MOTOR_ACTUATOR_INTENT not found');
      }
    }

    // ── 2. Disable GLASS_DECANTER_VESSEL_INTENT ───────────────────────────────
    // allowChapters=['70'] is blocking ch.96 (thermos) for "Insulated Carafe" queries
    // and injecting wrong 7010.90 subheadings for decanter+glasses sets (expected 7013).
    // Will fix root cause via FRESH_FLOWER_INTENT noneOf instead.
    await (svc as any).repo.update({ ruleId: 'GLASS_DECANTER_VESSEL_INTENT' }, { enabled: false });
    console.log('GLASS_DECANTER_VESSEL_INTENT: disabled');

    // ── 3. Fix PAPER_DIECUT_CRAFT_INTENT: remove allowChapters, add mousepad noneOf
    {
      const existing = allRules.find(r => r.id === 'PAPER_DIECUT_CRAFT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAddNoneOf = ['mousepad', 'mouse pad', 'computer pad', 'gaming pad',
          'rubber mat', 'foam mat'].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PAPER_DIECUT_CRAFT_INTENT') + ' — Fixed F2: removed allowChapters (blocked ch.59 for mousepad); added mousepad noneOf',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAddNoneOf] },
            whitelist: undefined, // Remove allowChapters restriction
          } as IntentRule,
        });
        console.log('PAPER_DIECUT_CRAFT_INTENT: removed allowChapters, added mousepad noneOf');
      } else {
        console.log('WARNING: PAPER_DIECUT_CRAFT_INTENT not found');
      }
    }

    // ── 4. FRESH_FLOWER_INTENT noneOf: add common non-flower product contexts ─
    // 'rose' fires for "Rose Gold Satin Tie", "Rose Quartz Bangle" etc.
    // 'lily' fires for "Lily of the Valley Soap" (but 'soap' should block it)
    // Add noneOf terms that indicate non-flower products mentioning flower names
    {
      const existing = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          // Glass/vessel products
          'decanter', 'carafe', 'diffuser', 'reed diffuser', 'vase',
          // Fabric/textile products
          'fabric', 'wallpaper', 'wall paper', 'curtain', 'textile',
          // Jewelry/accessories
          'earring', 'earrings', 'pendant', 'necklace', 'bangle', 'brooch',
          'pocket square', 'tie', 'necktie', 'lapel',
          // Materials (rose quartz, etc.)
          'quartz', 'crystal', 'stone',
          // Beauty/cosmetics
          'essential oil', 'soap', 'lotion', 'perfume', 'candle holder',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FRESH_FLOWER_INTENT') + ' — Fixed F2: add noneOf for decanter/carafe/fabric/jewelry to reduce false flower triggers',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`FRESH_FLOWER_INTENT: adding ${toAdd.length} noneOf terms`);
      } else {
        console.log('WARNING: FRESH_FLOWER_INTENT not found');
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch F2)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch F2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
