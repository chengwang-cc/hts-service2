#!/usr/bin/env ts-node
/**
 * Patch TT4 — 2026-03-15: Sticker/decal cluster + cookie cutters.
 * Current: 29.87% (1501/5025)
 *
 * Key findings:
 *  - Vinyl stickers: 12+ entries → 3919.10/3919.90 (getting ch.48 paper labels)
 *  - Bumper stickers, sticker packs, vinyl decals → ch.39 self-adhesive
 *  - Cookie cutters: 3+ entries → 3916.90.10 (baking cookie cutters of plastic)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt4.ts
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

    // 1. VINYL_STICKER_DECAL_INTENT — vinyl/plastic stickers → 3919 (NOT ch.48 paper labels)
    //    "100% Vinyl Sticker" → getting 4821.90 (paper labels), expected 3919.10.10.50
    //    "Baby Bumper Sticker" → getting 4821.10 (paper labels), expected 3919.90.10.00
    //    "2.5 inch Handmade Vinyl Sticker" → getting 4821 (paper), expected 3919.90.50.60
    {
      const existing = allRules.find(r => r.id === 'VINYL_STICKER_DECAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_STICKER_DECAL_INTENT',
          description: 'Vinyl/plastic stickers, decals, bumper stickers → ch.39 (3919)',
          pattern: {
            anyOf: [
              'vinyl sticker', 'vinyl stickers', 'vinyl decal', 'vinyl decals',
              'bumper sticker', 'bumper stickers', 'sticker pack', 'sticker sheet',
              'custom sticker', 'custom stickers', 'handmade vinyl sticker',
              'sticker label set', 'sticker label', 'holographic sticker',
              'die cut sticker', 'kiss cut sticker', 'clear sticker',
            ],
            noneOf: ['paper sticker', 'paper label', 'kraft sticker', 'kraft label'],
          },
          inject: [
            { prefix: '3919.10', syntheticRank: 4 },
            { prefix: '3919.90', syntheticRank: 5 },
          ],
          boosts: [
            { delta: 0.65, prefixMatch: '3919.' },
          ],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('VINYL_STICKER_DECAL_INTENT: created (vinyl sticker → 3919)');
      }
    }

    // 2. COOKIE_CUTTER_BAKING_INTENT — cookie cutters → 3916.90.10 (plastic profile shapes)
    //    "Science Cookie Cutter Set" → getting 8205.90 (tools), expected 3916.90.10.00
    //    "3D Printed Flower Bouquet Cookie Cutter" → expected 3924.10.40
    {
      const existing = allRules.find(r => r.id === 'COOKIE_CUTTER_BAKING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COOKIE_CUTTER_BAKING_INTENT',
          description: 'Plastic cookie cutters/baking cutters → ch.39 (3916.90/3924)',
          pattern: {
            anyOf: [
              'cookie cutter', 'cookie cutters', 'baking cookie cutter',
              'fondant cutter', 'pastry cutter', 'biscuit cutter',
              '3d cookie cutter', 'clay cutter',
            ],
            noneOf: ['metal cookie cutter', 'stainless cookie cutter', 'tin cookie cutter'],
          },
          inject: [
            { prefix: '3916.90', syntheticRank: 4 },
            { prefix: '3924.10', syntheticRank: 5 },
          ],
          boosts: [
            { delta: 0.55, prefixMatch: '3916.9' },
            { delta: 0.45, prefixMatch: '3924.1' },
          ],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COOKIE_CUTTER_BAKING_INTENT: created (cookie cutter → 3916.90)');
      }
    }

    // 3. PLASTIC_TABLEWARE_DISPENSER_INTENT — plastic bottle dispensers, cheese shakers → 3924.10
    //    "Plastic cheese shaker" → getting 0406 (cheese food!), expected 3924.10.10.00
    //    "Plastic shower bottle dispenser" → expected 3924.10.10.00
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_TABLEWARE_DISPENSER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_TABLEWARE_DISPENSER_INTENT',
          description: 'Plastic tableware, dispensers, shakers, kitchen plastic → ch.39 (3924.10)',
          pattern: {
            anyOf: [
              'plastic cheese shaker', 'plastic bottle dispenser', 'plastic shaker',
              'plastic spice shaker', 'plastic condiment dispenser', 'plastic salt shaker',
              'plastic shower dispenser', 'plastic soap dispenser',
              'plastic mixing bowl', 'plastic serving dish', 'plastic tray kitchen',
            ],
            noneOf: ['stainless', 'metal', 'glass', 'ceramic', 'silicone'],
          },
          inject: [{ prefix: '3924.10', syntheticRank: 4 }],
          boosts: [{ delta: 0.60, prefixMatch: '3924.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PLASTIC_TABLEWARE_DISPENSER_INTENT: created (plastic shaker → 3924.10)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT4)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT4 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
