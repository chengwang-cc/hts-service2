#!/usr/bin/env ts-node
/**
 * Patch VVVV — 2026-03-13:
 *
 * Fix AI_CH14_PLAITING_MATERIALS misfiring on garment/apparel queries:
 *
 * Problem: AI_CH14_PLAITING_MATERIALS has 'bamboo' in anyOf with allowChapters=['14'].
 * When 'bamboo' appears in garment queries ("bamboo t-shirt", "bamboo leggings",
 * "bamboo fabric dress"), the rule fires → allowSet={'14'} → ch.61/62 results blocked → EMPTY.
 * Raw bamboo culms are ch.14 (plaiting materials), NOT bamboo garments (ch.61/62).
 *
 * Fix: Add garment/apparel/clothing terms to noneOf so the rule doesn't fire
 * when bamboo is used as a fabric descriptor for clothing.
 *
 * Also fix AI_CH46_WICKER_BASKET and AI_CH46_WOVEN_MAT_MATTING for similar issues:
 * "bamboo" in anyOfGroups[1] — if someone searches "bamboo phone case" or "bamboo jewelry",
 * group 2 matches but group 1 (basket/mat) might not → actually both groups required so ok.
 * But AI_CH14_PLAITING_MATERIALS has simple anyOf (not anyOfGroups) so 'bamboo' alone fires.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13vvvv.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed VVVV: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── Fix AI_CH14_PLAITING_MATERIALS ────────────────────────────────────────
    // 'bamboo' in anyOf fires for garment queries → allowChapters=['14'] → EMPTY
    // "bamboo t-shirt", "bamboo leggings", "bamboo socks", "bamboo fabric" → NOT ch.14
    // Ch.14 is for raw plaiting materials (bamboo stalks, canes, reeds).
    // Add garment/fabric/clothing terms to noneOf.
    addNoneOf('AI_CH14_PLAITING_MATERIALS', [
      // Garment types
      'shirt', 'shirts', 'tshirt', 'tshirts', 't-shirt', 't-shirts',
      'pants', 'leggings', 'shorts', 'dress', 'skirt',
      'jacket', 'coat', 'vest', 'hoodie', 'sweater', 'sweatshirt',
      'socks', 'underwear', 'bra', 'pajamas', 'loungewear',
      // Fabric/textile
      'fabric', 'cloth', 'textile', 'knit', 'jersey', 'material',
      'blend', 'blended',
      // Accessories
      'hat', 'cap', 'scarf', 'gloves', 'mittens',
      // General apparel context
      'clothing', 'apparel', 'garment', 'wear',
      'toothbrush',  // bamboo toothbrush → ch.96, not ch.14
      'cutting board', 'chopping board', 'kitchen',  // bamboo cutting board → ch.44, not ch.14
    ], 'garment/fabric context prevents bamboo plaiting material rule from firing on clothing queries');

    console.log(`Applying ${patches.length} rule patches (batch VVVV)...`);
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
    console.log(`\nPatch VVVV complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
