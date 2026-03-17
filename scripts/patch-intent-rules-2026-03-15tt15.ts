#!/usr/bin/env ts-node
/**
 * Patch TT15 — 2026-03-15: Textile flags + glass drinkware fixes.
 * Current: 30.91% (1553/5025)
 *
 * Fixes:
 *  1. TEXTILE_FLAG_PENNANT_INTENT → 6307.90.85 (polyester flags, pennants)
 *     "Printed Polyester Flag" → 6006; "100% polyester flag" → 5407; etc.
 *  2. GLASS_DRINKWARE_BEER_MUG_INTENT: add vintage tumblers, lowball sets, retro glass
 *     "set 7 vintage lowball glasses" → 7018; "retro tumblers" → 3204 (wrong)
 *  3. GLASSWARE_DRINKING_INTENT: improve inject syntheticRank 22→5, change boost to prefixMatch
 *  4. SILICONE_DOG_TREAT_POUCH_INTENT → 4202.92 (silicone pouch, dog treat pouch)
 *     "Silicone Pouch Dog Treat Pouch" → 2309 (dog food!) — very wrong
 *  5. STUFFED_TEXTILE_TOY_INTENT → 6307.90.75 (stuffed plush toys of textile)
 *     vs 9503 (plastic toys) - for "stuffed toy plush", "snuffle toy"
 *  6. COTTON_CANVAS_POUCH_BAG_INTENT → 4202.92 (cotton/fabric pouches and bags)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt15.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };

    // 1. TEXTILE_FLAG_PENNANT_INTENT — textile flags, pennants, banners → 6307.90
    {
      const existing = allRules.find(r => r.id === 'TEXTILE_FLAG_PENNANT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEXTILE_FLAG_PENNANT_INTENT',
          description: 'Textile flags, pennants and banners → ch.63 (6307.90)',
          pattern: {
            anyOf: [
              'polyester flag', 'nylon flag', 'fabric flag', 'printed flag',
              'pennant flag', 'pennant banner', 'pennant hanging', 'hanging pennant',
              'felt pennant', 'felt nursery pennant', 'cloth flag',
              'double-sided flag', 'single-sided flag', 'double sided flag', 'single sided flag',
              'medicine wheel flag', 'personalized flag', 'custom printed flag',
              'knit flag', 'woven flag',
            ],
            noneOf: ['sticker flag', 'paper flag', 'metal flag', 'enamel flag', 'pin flag'],
          },
          inject: [{ prefix: '6307.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '6307.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('TEXTILE_FLAG_PENNANT_INTENT: created (polyester flag/pennant → 6307.90)');
      }
    }

    // 2. GLASS_DRINKWARE_BEER_MUG_INTENT: add vintage glass/tumbler terms
    {
      const e = allRules.find(r => r.id === 'GLASS_DRINKWARE_BEER_MUG_INTENT');
      if (e) {
        const pat = addAnyOf(e,
          'lowball glasses', 'lowball glass set', 'vintage drinking glasses', 'vintage tumblers',
          'retro tumblers', 'retro glasses set', 'vintage glass set', 'vintage glasses set',
          'glass set of', 'oz glass set', '16 oz glass', '18 oz glass', '25 oz glass',
          'NHL glass', 'beer glass set', 'drinking glass set', 'glassware set',
          'vintage glassware', 'mid century glass', 'mid century tumbler',
          'vintage pint glass', 'frosted glass tumbler', 'iced tea glass',
        );
        patches.push({ priority: (e as any).priority ?? 560, rule: { ...e, pattern: pat } });
        console.log('GLASS_DRINKWARE_BEER_MUG_INTENT: added vintage/retro glass terms');
      }
    }

    // 3. GLASSWARE_DRINKING_INTENT: fix inject ranks 22→5 for 7013.37
    {
      const e = allRules.find(r => r.id === 'GLASSWARE_DRINKING_INTENT');
      if (e) {
        // Change syntheticRank from 22→5 for better competition
        const newInject = [
          { prefix: '7013.22', syntheticRank: 5 },
          { prefix: '7013.37', syntheticRank: 6 },
          { prefix: '7013.28', syntheticRank: 7 },
        ];
        // Change boost from chapterMatch '70' (too broad) to prefixMatch '7013'
        const newBoosts = [{ delta: 0.65, prefixMatch: '7013' }];
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: newInject, boosts: newBoosts } });
        console.log('GLASSWARE_DRINKING_INTENT: fixed inject ranks (22→5) and boost to 7013 prefix');
      }
    }

    // 4. SILICONE_POUCH_BAG_INTENT — silicone pouches, dog treat pouches → 4202.92
    //    "Silicone Pouch Dog Treat Pouch" → 2309 (dog food!) — completely wrong
    {
      const existing = allRules.find(r => r.id === 'SILICONE_POUCH_BAG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILICONE_POUCH_BAG_INTENT',
          description: 'Silicone pouches, dog treat pouches, food pouches → ch.42 (4202.92)',
          pattern: {
            anyOf: [
              'silicone pouch', 'silicone bag', 'dog treat pouch', 'treat pouch dog',
              'pet treat pouch', 'dog treat bag', 'food pouch silicone',
              'reusable food pouch', 'squeeze pouch', 'snack pouch silicone',
            ],
            noneOf: ['paper pouch', 'mylar pouch', 'foil pouch', 'plastic bag standalone'],
          },
          inject: [{ prefix: '4202.92', syntheticRank: 6 }],
          boosts: [{ delta: 0.45, prefixMatch: '4202.9' }],
        } as IntentRule;
        patches.push({ priority: 555, rule: newRule });
        console.log('SILICONE_POUCH_BAG_INTENT: created (silicone pouch/dog treat pouch → 4202.92)');
      }
    }

    // 5. COTTON_FABRIC_TOTE_BAG_INTENT — cotton fabric bags/pouches → 4202.92
    //    "cotton fabric airpod case" → 5212; "cotton keychain wallet" → 4202.32; etc.
    {
      const existing = allRules.find(r => r.id === 'COTTON_FABRIC_TOTE_BAG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_FABRIC_TOTE_BAG_INTENT',
          description: 'Cotton fabric bags, pouches, totes → ch.42 (4202.92)',
          pattern: {
            anyOf: [
              'cotton fabric bag', 'cotton fabric pouch', 'cotton mini tote', 'cotton tote bag',
              'cotton canvas bag', 'canvas tote bag', 'cotton zippered pouch',
              'cotton fabric case', 'cotton sunglasses case', 'cotton eyeglass case',
              'fabric airpod case', 'fabric sunglass case', 'fabric glasses case',
              'cotton quilted bag', 'quilted organizer bag',
            ],
            noneOf: ['leather', 'vinyl', 'plastic', 'nylon', 'polyester bag'],
          },
          inject: [{ prefix: '4202.92', syntheticRank: 6 }],
          boosts: [{ delta: 0.40, prefixMatch: '4202.9' }],
        } as IntentRule;
        patches.push({ priority: 555, rule: newRule });
        console.log('COTTON_FABRIC_TOTE_BAG_INTENT: created (cotton fabric bags/pouches → 4202.92)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT15)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT15 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
