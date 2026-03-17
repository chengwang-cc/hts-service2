#!/usr/bin/env ts-node
/**
 * Patch TT13 — 2026-03-15: Paint tools + Christmas/Nativity + Artist brushes.
 * Current: 30.45% (1530/5025)
 *
 * Targets:
 *  1. PAINT_ROLLER_APPLICATOR_INTENT → 9603.40 (10+ failures: Staalmeester, Alchemy Brush, etc.)
 *  2. ARTIST_PAINT_BRUSH_INTENT → 9603.30 (watercolor brushes, artist brushes)
 *  3. CHRISTMAS_NATIVITY_SEASONAL_INTENT → 9505.10 (nativity set, fabric santa, christmas stocking)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt13.ts
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

    // 1. PAINT_ROLLER_APPLICATOR_INTENT — paint rollers, applicator pads/sponges, professional paintbrushes → 9603.40
    //    Staalmeester brand: rollers and paintbrushes; Alchemy Brush; applicator pads/sponges
    {
      const existing = allRules.find(r => r.id === 'PAINT_ROLLER_APPLICATOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PAINT_ROLLER_APPLICATOR_INTENT',
          description: 'Paint rollers, applicator pads/sponges, professional paintbrushes → ch.96 (9603.40)',
          pattern: {
            anyOf: [
              'staalmeester', 'microfelt roller', 'paint roller', 'roller refill', 'roller cover',
              'foam roller paint', 'paint roller cover', 'microfiber roller',
              'applicator sponge', 'applicator pad', 'applicator pads',
              'alchemy brush', 'oval paintbrush', 'sash paintbrush', 'pro-hybrid paintbrush',
              'flat paintbrush', 'economy brush', 'smooth economy brush',
              'paint applicator', 'paint pad applicator', 'paint applicator pad',
            ],
            noneOf: ['door roller', 'rolling pin', 'hair roller', 'body roller', 'massage roller', 'lint roller'],
          },
          inject: [{ prefix: '9603.40', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '9603.40' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PAINT_ROLLER_APPLICATOR_INTENT: created (paint roller/applicator → 9603.40)');
      }
    }

    // 2. ARTIST_PAINT_BRUSH_INTENT — artists' brushes, watercolor brushes, cosmetic brushes → 9603.30
    {
      const existing = allRules.find(r => r.id === 'ARTIST_PAINT_BRUSH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ARTIST_PAINT_BRUSH_INTENT',
          description: 'Artists\' brushes, watercolor/acrylic/oil paint brushes, cosmetic brushes → ch.96 (9603.30)',
          pattern: {
            anyOf: [
              'watercolor brush', 'watercolor brushes', 'watercolour brush',
              'artist paint brush', 'artist paint brushes', 'artists brush', 'artists brushes',
              'acrylic paint brush', 'oil paint brush', 'paint brush set', 'paintbrush set',
              'cosmetic brush set', 'makeup brush set', 'makeup brushes set',
              'round brush set', 'fan brush art',
            ],
            noneOf: ['staalmeester', 'alchemy brush', 'paint roller', 'applicator pad', 'applicator sponge'],
          },
          inject: [{ prefix: '9603.30', syntheticRank: 5 }],
          boosts: [{ delta: 0.45, prefixMatch: '9603.30' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('ARTIST_PAINT_BRUSH_INTENT: created (artist/watercolor/cosmetic brushes → 9603.30)');
      }
    }

    // 3. CHRISTMAS_NATIVITY_SEASONAL_INTENT — nativity sets, fabric santa, christmas stockings → 9505.10
    //    Nativity set → 9505.10.30.00; fabric santa/advent calendar → 9505.10.25.00;
    //    christmas stockings → 9505.10.50.20
    {
      const existing = allRules.find(r => r.id === 'CHRISTMAS_NATIVITY_SEASONAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CHRISTMAS_NATIVITY_SEASONAL_INTENT',
          description: 'Nativity sets/figures, fabric Christmas items, Christmas stockings → ch.95 (9505.10)',
          pattern: {
            anyOf: [
              'nativity set', 'nativity scene', 'nativity figurine', 'nativity figurines',
              'nativity figures', 'manger scene', 'creche nativity',
              'fabric santa', 'fabric advent calendar', 'advent calendar fabric',
              'handmade fabric santa', 'santa figure', 'santa figurine',
              'christmas stocking', 'christmas stockings', 'holiday stocking',
              'christmas tree skirt', 'christmas wreath fabric',
            ],
            noneOf: ['christmas tree lights', 'christmas light', 'christmas ornament ball', 'christmas ball'],
          },
          inject: [
            { prefix: '9505.10', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '9505.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('CHRISTMAS_NATIVITY_SEASONAL_INTENT: created (nativity/fabric santa/stockings → 9505.10)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT13)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT13 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
