#!/usr/bin/env ts-node
/**
 * Patch B2 — 2026-03-14:
 *
 * Root-cause fixes:
 * 1. SILVER_BULLION_SCRAP_INTENT anyOf: add 'sterling silver', 'shavings', 'silver scrap'
 *    Rule was NOT FIRING for "Genuine Sterling silver .925 shavings" — none of the existing
 *    anyOf phrases ('silver shavings', 'sterling shavings') are substrings of the query
 *    because '.925' sits between "silver" and "shavings". 'sterling silver' IS a substring.
 *
 * 2. TEMPERED_GLASS_SCREEN_INTENT anyOf: add plain 'tempered glass'
 *    Rule NOT FIRING for "mobile tempered glass" — 'tempered glass screen', 'tempered glass mobile'
 *    etc. are NOT substrings of "mobile tempered glass". 'tempered glass' IS.
 *    Also add penalty for 7007.21 (laminated glass) to push 7007.19 (tempered) to top.
 *
 * 3. PRINTING_PAPER_PLAIN_INTENT anyOf: add 'printed paper'
 *    Rule does not fire for "printed paper" query — only 'printing paper' is in anyOf.
 *
 * New rules (2):
 * 4. CLUTCH_EVENING_BAG_INTENT (ch.42): fabric clutch/evening bag → 4202.12.60
 *    "Handmade fabric clutch purse" → 4202.12.60; current inject hits 4202.12.89 not .60
 *    Need to inject 4202.12.60 specifically for textile outer surface handbags
 * 5. SOLAR_PANEL_MODULE_INTENT (ch.85): solar panel/module/pv → 8541.40
 *    Common query area with EMPTY or wrong results
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14b2.ts
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

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed B2: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. SILVER_BULLION_SCRAP_INTENT: add 'sterling silver' so rule fires ──
    // "Genuine Sterling silver .925 shavings" — query has 'sterling silver' as substring
    // but '.925' sits between 'silver' and 'shavings' so 'silver shavings' phrase fails.
    // Once rule fires, penalty -1.5 on 7114 should demote silverware below 7106.10
    addToAnyOf('SILVER_BULLION_SCRAP_INTENT', [
      'sterling silver', 'shavings', 'silver scrap', 'silver flakes',
      'silver grain', 'silver grains', 'silver pellets', '.925 silver',
    ], 'add sterling silver phrase + shavings so rule fires for "sterling silver .925 shavings"');

    // ── 2. TEMPERED_GLASS_SCREEN_INTENT: add plain 'tempered glass' ───────────
    // "mobile tempered glass" — none of the current phrases are substrings:
    //   'tempered glass screen'.includes() = false (extra word)
    //   'tempered glass mobile'.includes() = false (order is mobile...tempered not tempered...mobile)
    // 'tempered glass' IS a substring of "mobile tempered glass".
    // Also add penalty for 7007.21 (laminated) to prevent it from beating 7007.19 (tempered).
    {
      const existing = allRules.find(r => r.id === 'TEMPERED_GLASS_SCREEN_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newTerms = ['tempered glass', 'toughened glass', 'safety glass tempered',
          'glass screen film', 'screen glass'].filter(t => !currentAnyOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TEMPERED_GLASS_SCREEN_INTENT') + ' — Fixed B2: add tempered glass phrase + penalty 7007.21',
            pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
            penalties: [
              { delta: 0.6, prefixMatch: '7007.21' }, // Penalize laminated safety glass
              { delta: 0.6, prefixMatch: '7007.11' }, // Penalize laminated glass for vehicles
            ],
          } as IntentRule,
        });
        console.log(`TEMPERED_GLASS_SCREEN_INTENT: adding ${newTerms.length} anyOf terms + 7007.21 penalty`);
      } else {
        console.log('WARNING: TEMPERED_GLASS_SCREEN_INTENT not found');
      }
    }

    // ── 3. PRINTING_PAPER_PLAIN_INTENT: add 'printed paper' ──────────────────
    // "printed paper" query — 'printing paper' in anyOf ≠ 'printed paper' (different word)
    addToAnyOf('PRINTING_PAPER_PLAIN_INTENT', [
      'printed paper', 'printer paper', 'copier paper', 'ream of paper',
      'a4 paper', 'letter size paper', 'paper ream', 'copy paper sheets',
    ], 'add printed paper / printer paper so the rule fires for common copy paper queries');

    // ── 4. NEW CLUTCH_EVENING_BAG_TEXTILE_INTENT ──────────────────────────────
    // "Handmade fabric clutch purse" → 4202.12.60 (handbag, outer textile, ≤ $20)
    // CLUTCH_BAG_INTENT injects 4202.12 but the specific subheading 4202.12.60 not winning
    // Need to explicitly inject 4202.12.60 at high rank for fabric/textile clutch queries
    patches.push({
      priority: 574,
      rule: {
        id: 'CLUTCH_EVENING_BAG_TEXTILE_INTENT',
        description: 'Fabric/textile clutch bags and evening bags → ch.42 (4202.12.60). ' +
          '"Handmade fabric clutch purse", "textile evening bag" → 4202.12.60. ' +
          'CLUTCH_BAG_INTENT injects 4202.12 but not specifically .60 for textile outer.',
        pattern: {
          anyOf: [
            'fabric clutch', 'cloth clutch', 'textile clutch', 'handmade clutch',
            'fabric purse', 'fabric bag', 'woven clutch', 'cotton clutch',
            'evening bag', 'evening clutch', 'fabric evening bag',
          ],
          noneOf: ['leather clutch', 'suede clutch', 'vinyl clutch', 'pvc clutch'],
        },
        whitelist: { allowChapters: ['42'] },
        inject: [
          { prefix: '4202.12.60', syntheticRank: 9 }, // Handbags, textile outer, ≤ $20 FOB
          { prefix: '4202.12.89', syntheticRank: 8 }, // Handbags, textile outer, > $20 FOB
          { prefix: '4202.22.40', syntheticRank: 7 }, // Handbags, textile outer surface
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '4202.12.60' },
          { delta: 0.4, prefixMatch: '4202.12' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW SOLAR_PANEL_MODULE_INTENT ──────────────────────────────────────
    // Solar panels, PV modules → 8541.40 (photosensitive semiconductor devices)
    // Common category with potential EMPTY or wrong ch.73/76 results
    patches.push({
      priority: 558,
      rule: {
        id: 'SOLAR_PANEL_MODULE_INTENT',
        description: 'Solar panels, photovoltaic modules → ch.85 (8541.40). ' +
          '"Solar panel", "PV module", "solar cell" → 8541.40. ' +
          'Without rule, may get ch.73 (metal) or ch.76 (aluminum) for solar panel frames.',
        pattern: {
          anyOf: [
            'solar panel', 'solar panels', 'solar module', 'solar modules',
            'pv module', 'pv panel', 'photovoltaic', 'solar cell',
            'solar array', 'solar kit', 'solar power panel',
          ],
          noneOf: ['solar light', 'solar lamp', 'solar charger', 'solar bag'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8541.40', syntheticRank: 9 }, // Photosensitive semiconductor devices
          { prefix: '8541.43', syntheticRank: 8 }, // Photovoltaic cells (in modules)
          { prefix: '8541.49', syntheticRank: 7 }, // Other photovoltaic cells
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8541.4' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch B2)...`);
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
    console.log(`\nPatch B2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
