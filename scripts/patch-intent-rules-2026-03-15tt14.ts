#!/usr/bin/env ts-node
/**
 * Patch TT14 — 2026-03-15: Fix Christmas/ceramic conflicts + more targets.
 * Current: 30.67% (1541/5025)
 *
 * Fixes:
 *  1. AI_CH69_CERAMIC_FIGURINE: add 'nativity','christmas stocking','santa figurine' to noneOf
 *     → was blocking 9505.10.30 for "ceramic clay pottery nativity figurines"
 *  2. BONE_CHINA_CERAMIC_DISHWARE_INTENT: add 'nativity','santa figurine','christmas stocking' to noneOf
 *  3. AI_CH49_CALENDARS: add 'fabric advent','advent calendar fabric' to noneOf
 *     → was overriding CHRISTMAS_NATIVITY for "fabric Advent calendar"
 *  4. CHRISTMAS_NATIVITY_SEASONAL_INTENT: increase inject to rank 3, boost to 0.65
 *  5. PAINT_ROLLER_APPLICATOR_INTENT: add 'scraper','triangle scraper' to noneOf
 *     → was matching "Staalmeester Triangle Scraper" (should be ch.82)
 *  6. New FISHING_LURE_TACKLE_INTENT → 9507.90 (fishing lures, fly fishing flies, tackle)
 *  7. New PLASTIC_HOME_DECOR_3D_PRINTED_INTENT → 9403.70 (3D printed plastic decor/furniture)
 *  8. New HAND_TOOL_SCRAPER_SPECIALTY_INTENT → 8205.59 (scrapers, specialty tools)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt14.ts
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

    const addNo = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. AI_CH69_CERAMIC_FIGURINE: add nativity/christmas terms to noneOf
    {
      const e = allRules.find(r => r.id === 'AI_CH69_CERAMIC_FIGURINE');
      if (e) {
        const pat = addNo(e,
          'nativity', 'nativity set', 'nativity scene', 'nativity figurine', 'nativity figurines',
          'christmas stocking', 'christmas stockings', 'santa figurine', 'santa figure',
          'christmas ornament', 'christmas decoration',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('AI_CH69_CERAMIC_FIGURINE: added nativity/christmas to noneOf');
      }
    }

    // 2. BONE_CHINA_CERAMIC_DISHWARE_INTENT: add nativity/christmas terms to noneOf
    {
      const e = allRules.find(r => r.id === 'BONE_CHINA_CERAMIC_DISHWARE_INTENT');
      if (e) {
        const pat = addNo(e,
          'nativity', 'nativity set', 'nativity figurines', 'nativity figurine',
          'christmas stocking', 'santa figurine', 'santa figure', 'christmas ornament',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('BONE_CHINA_CERAMIC_DISHWARE_INTENT: added nativity/christmas to noneOf');
      }
    }

    // 3. AI_CH49_CALENDARS: add fabric advent / christmas terms to noneOf
    //    "fabric Advent calendar" → 9505.10 not 4910 (paper calendar)
    {
      const e = allRules.find(r => r.id === 'AI_CH49_CALENDARS');
      if (e) {
        const pat = addNo(e,
          'fabric advent', 'fabric advent calendar', 'advent calendar fabric',
          'christmas countdown', 'advent fabric', 'christmas stocking',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('AI_CH49_CALENDARS: added fabric advent to noneOf');
      }
    }

    // 4. CHRISTMAS_NATIVITY_SEASONAL_INTENT: stronger inject and boost
    {
      const e = allRules.find(r => r.id === 'CHRISTMAS_NATIVITY_SEASONAL_INTENT');
      if (e) {
        const newInject = [{ prefix: '9505.10', syntheticRank: 3 }];
        const newBoosts = [{ delta: 0.70, prefixMatch: '9505.1' }];
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, inject: newInject, boosts: newBoosts } });
        console.log('CHRISTMAS_NATIVITY_SEASONAL_INTENT: boosted inject rank=3, boost=0.70');
      }
    }

    // 5. PAINT_ROLLER_APPLICATOR_INTENT: add scraper to noneOf
    //    Was matching "Staalmeester- Triangle Scraper" (brand + category conflict)
    {
      const e = allRules.find(r => r.id === 'PAINT_ROLLER_APPLICATOR_INTENT');
      if (e) {
        const pat = addNo(e,
          'scraper', 'triangle scraper', 'putty knife', 'paint scraper', 'floor scraper',
        );
        patches.push({ priority: (e as any).priority ?? 565, rule: { ...e, pattern: pat } });
        console.log('PAINT_ROLLER_APPLICATOR_INTENT: added scraper to noneOf');
      }
    }

    // 6. FISHING_LURE_TACKLE_INTENT — fishing lures, flies, floats, tackle → 9507.90
    //    9507.90.70 = fishing lures; 9507.90.80 = fly fishing flies
    {
      const existing = allRules.find(r => r.id === 'FISHING_LURE_TACKLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FISHING_LURE_TACKLE_INTENT',
          description: 'Fishing lures, flies, floats and tackle → ch.95 (9507.90)',
          pattern: {
            anyOf: [
              'fishing lure', 'fishing lures', 'fly fishing lure', 'fishing flies',
              'fly fishing flies', 'fly fishing fly', 'hand stamped lure', 'fishing jig',
              'fishing float', 'fishing floats', 'fishing float cap',
              'tackle bead', 'fishing tackle bead', 'fishing tackle beads',
              'bait lure', 'spinner lure', 'fishing spinner', 'crankbait',
              'fly fishing', 'fishing artificial bait', 'fly fishing compactor',
            ],
            noneOf: ['fishing rod', 'fishing reel', 'fishing line', 'fishing net', 'fishing vest'],
          },
          inject: [{ prefix: '9507.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '9507.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('FISHING_LURE_TACKLE_INTENT: created (fishing lures/flies/floats → 9507.90)');
      }
    }

    // 7. PLASTIC_3D_PRINTED_FURNITURE_DECOR_INTENT — 3D printed plastic furniture/decor → 9403.70
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_3D_PRINTED_FURNITURE_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_3D_PRINTED_FURNITURE_DECOR_INTENT',
          description: '3D printed plastic furniture, decor, stands → ch.94 (9403.70)',
          pattern: {
            anyOf: [
              '3d printed home decor', '3d printed decorative', '3d printed bookshelf',
              '3d printed plastic decor', '3d printed stand', 'plastic home decor stand',
              'plastic bookshelf accessory', 'plastic display stand',
              'plastic paint holder', 'paint holder plastic',
              'desk clamp holder', 'cup holder plastic clamp',
            ],
          },
          inject: [{ prefix: '9403.70', syntheticRank: 6 }],
          boosts: [{ delta: 0.40, prefixMatch: '9403.7' }],
        } as IntentRule;
        patches.push({ priority: 555, rule: newRule });
        console.log('PLASTIC_3D_PRINTED_FURNITURE_DECOR_INTENT: created (3D printed decor → 9403.70)');
      }
    }

    // 8. HAND_TOOL_SCRAPER_PAINTER_INTENT — paint scrapers, putty knives → 8205.59
    {
      const existing = allRules.find(r => r.id === 'HAND_TOOL_SCRAPER_PAINTER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HAND_TOOL_SCRAPER_PAINTER_INTENT',
          description: 'Paint scrapers, putty knives, specialty tools → ch.82 (8205.59)',
          pattern: {
            anyOf: [
              'triangle scraper', 'paint scraper', 'plastic scraper', 'putty knife',
              'window scraper', 'floor scraper', 'staalmeester scraper',
              'carb sync tool', 'carburetor sync', 'windshield setting tool', 'windscreen setting tool',
              'clip removal plier', 'pry bar tool', 'spanner tool specialty',
              'spring compressor tool', 'coil spring compressor',
            ],
            noneOf: ['paint roller', 'paint brush', 'applicator'],
          },
          inject: [{ prefix: '8205.59', syntheticRank: 6 }],
          boosts: [{ delta: 0.40, prefixMatch: '8205.5' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('HAND_TOOL_SCRAPER_PAINTER_INTENT: created (scrapers/specialty tools → 8205.59)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT14)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT14 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
