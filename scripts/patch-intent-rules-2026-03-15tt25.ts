#!/usr/bin/env ts-node
/**
 * Patch TT25 — 2026-03-15: Cotton jackets + inline skates + sports equipment + baby knit + leather straps.
 * Current: ~32.04% (after TT23; TT24 pending eval)
 *
 * Targets:
 *  1. MEN_COTTON_JACKET_ANORAK_INTENT → 6201.30 (cotton work jackets, denim jackets, vest jackets)
 *     "Carhartt Work Jacket" → 6201.30.20; "Vintage Denim Jacket" → 6201.30.50; 12 entries
 *  2. INLINE_SKATE_SKI_EQUIPMENT_INTENT → 9506.70 (inline skates, alpine skis, ski poles)
 *     "110 Plus Eclipse T Inline Skates" → 9506.70.20; "Alpine Ski Poles" → 9506.70.20; 12 entries
 *  3. SPORTS_BAT_STICK_ARCHERY_INTENT → 9506.99 (bats, hockey sticks, archery, sports articles)
 *     "Composite softball bat" → 9506.99.15; "Hockey Sticks" → 9506.99.25; 13 entries
 *  4. INFANT_BABY_COTTON_KNIT_INTENT → 6111.20 (babies' cotton knit garments, babywear, singlets)
 *     "Baby cotton singlet" → 6111.20.20; "Cotton baby's clothing set" → 6111.20.40; 13 entries
 *  5. LEATHER_STRAP_ARTICLE_INTENT → 4205.00 (leather straps, guitar straps, dog leads, shoelaces)
 *     "Custom leather guitar strap" → 4205.00.05; "leather dog leads" → 4205.00.10; 13 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt25.ts
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

    // 1. MEN_COTTON_JACKET_ANORAK_INTENT → 6201.30 (men's woven cotton jackets/anoraks)
    //    "Carhartt For Women Canvas Work Jacket" → 6201.30.20.10
    //    "Carhartt Work Vest Jacket" → 6201.30.20.10
    //    "cotton jacket made in the USA" → 6201.30.20.10
    //    "denim men jacket" → 6201.30.50.31; "Vintage Denim Jacket" → 6201.30.50.31
    //    6201.30 = men's/unisex anoraks, windbreakers, work jackets of cotton (woven)
    //    NOTE: noneOf for polyester/nylon to avoid conflict with JERSEY_SPORTS_APPAREL_INTENT
    {
      const existing = allRules.find(r => r.id === 'MEN_COTTON_JACKET_ANORAK_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MEN_COTTON_JACKET_ANORAK_INTENT',
          description: 'Cotton woven jackets, denim jackets, work jackets, vests → ch.62 (6201.30)',
          pattern: {
            anyOf: [
              'denim jacket', 'denim coat', 'jean jacket', 'jeans jacket',
              'vintage denim jacket', 'mens denim jacket', 'denim men jacket',
              'work jacket', 'work vest jacket', 'canvas work jacket', 'chore jacket',
              'chore coat', 'barn jacket', 'field jacket', 'utility jacket',
              'cotton jacket', 'mens cotton jacket', 'cotton work jacket',
              'carhartt jacket', 'carhartt vest', 'workwear jacket',
              'puffer jacket cotton', 'puff jacket', 'quilted cotton jacket',
            ],
            noneOf: ['polyester jacket', 'nylon jacket', 'leather jacket', 'down jacket',
                     'fleece jacket', 'wool jacket', 'blazer', 'suit jacket', 'sport coat'],
          },
          inject: [{ prefix: '6201.30', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6201.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('MEN_COTTON_JACKET_ANORAK_INTENT: created (cotton/denim jackets → 6201.30)');
      }
    }

    // 2. INLINE_SKATE_SKI_EQUIPMENT_INTENT → 9506.70 (inline skates, alpine skis, ski poles)
    //    "110 Plus Eclipse T Inline Skates - 41EU" → 9506.70.20.10
    //    "3D Adapt Inline Boots - 38EU" → 9506.70.20.10
    //    "80mm Urban Inline Skates" → 9506.70.20.10
    //    "Alpine Ski Poles" → 9506.70.20.90; "Alpine Skis - 157cm" → 9506.70.20.90
    //    9506.70 = ice skates, roller skates, ice and snow skis/poles
    {
      const existing = allRules.find(r => r.id === 'INLINE_SKATE_SKI_EQUIPMENT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'INLINE_SKATE_SKI_EQUIPMENT_INTENT',
          description: 'Inline skates, roller skates, alpine skis, ski poles → ch.95 (9506.70)',
          pattern: {
            anyOf: [
              'inline skate', 'inline skates', 'inline skate boots', 'inline roller skate',
              'roller skate', 'roller skates', 'quad skate', 'roller blade', 'rollerblade',
              'ice skate', 'ice skates', 'hockey skate', 'figure skate', 'speed skate',
              'alpine ski', 'alpine skis', 'alpine ski poles', 'ski pole', 'ski poles',
              'downhill ski', 'cross country ski', 'skis', 'slalom ski',
              'skateboard', 'longboard', 'cruiser board',
            ],
            noneOf: ['ski mask', 'ski boot bag', 'ski bag', 'ski jacket', 'ski pants', 'ski gloves'],
          },
          inject: [{ prefix: '9506.70', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9506.7' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('INLINE_SKATE_SKI_EQUIPMENT_INTENT: created (inline skates/alpine skis → 9506.70)');
      }
    }

    // 3. SPORTS_BAT_STICK_ARCHERY_INTENT → 9506.99 (sports equipment: bats, sticks, archery, general)
    //    "Beginner Bow and Arrow Set" → 9506.99.05.20
    //    "Composite softball bat" → 9506.99.15.00
    //    "Composite or alloy baseball bat" → 9506.99.15.00
    //    "mini Hockey Stick NHL" → 9506.99.25.40; "composite Hockey Sticks" → 9506.99.25.40
    //    9506.99 = other sports articles (not elsewhere classified)
    {
      const existing = allRules.find(r => r.id === 'SPORTS_BAT_STICK_ARCHERY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SPORTS_BAT_STICK_ARCHERY_INTENT',
          description: 'Sports bats, hockey sticks, archery sets, sports equipment → ch.95 (9506.99)',
          pattern: {
            anyOf: [
              'softball bat', 'baseball bat', 'composite bat', 'alloy bat', 'wood bat',
              'cricket bat', 'lacrosse stick', 'lacrosse shaft',
              'hockey stick', 'composite hockey stick', 'mini hockey stick', 'hockey shaft',
              'field hockey stick', 'floor hockey stick',
              'bow and arrow', 'archery bow', 'archery set', 'recurve bow', 'compound bow',
              'archery arrow', 'archery arrows', 'crossbow',
              'golf club', 'golf iron', 'golf driver', 'golf wedge', 'golf putter',
              'fishing rod', 'fishing reel', 'spinning rod',
            ],
            noneOf: ['toy bat', 'toy bow', 'toy archery'],
          },
          inject: [{ prefix: '9506.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9506.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SPORTS_BAT_STICK_ARCHERY_INTENT: created (bats/sticks/archery → 9506.99)');
      }
    }

    // 4. INFANT_BABY_COTTON_KNIT_INTENT → 6111.20 (babies' cotton knit garments)
    //    "Baby cotton singlet" → 6111.20.20.00 (singlet)
    //    "Cotton baby's clothing set" → 6111.20.40.00 (baby clothing set)
    //    "Little Kneeds Babywear 95% Cotton" → 6111.20.60.10
    //    6111.20 = babies' garments of cotton, knitted (ch.61 = knitted)
    //    NOTE: BABY_TODDLER_GARMENT_COTTON_INTENT → 6209.20 handles woven baby garments
    //    These terms are distinct: singlet/babywear/clothing set not in existing rule
    {
      const existing = allRules.find(r => r.id === 'INFANT_BABY_COTTON_KNIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'INFANT_BABY_COTTON_KNIT_INTENT',
          description: 'Babies\' cotton knit garments: singlets, babywear, clothing sets → ch.61 (6111.20)',
          pattern: {
            anyOf: [
              'baby singlet', 'baby cotton singlet', 'infant singlet', 'babywear',
              'cotton babywear', 'baby clothing set', 'cotton baby clothing set',
              'infant clothing set', 'baby knit set', 'newborn clothing set',
              'baby bodysuit set', 'baby outfit set', 'baby layette set',
              'children cotton tshirt', 'children cotton t-shirt', 'kids cotton singlet',
              'baby cotton tee', 'baby cotton top', 'infant cotton top',
            ],
            noneOf: ['dog onesie', 'cat onesie', 'adult onesie', 'dog bib', 'pet bib'],
          },
          inject: [{ prefix: '6111.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6111.2' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('INFANT_BABY_COTTON_KNIT_INTENT: created (baby cotton knit garments → 6111.20)');
      }
    }

    // 5. LEATHER_STRAP_ARTICLE_INTENT → 4205.00 (leather straps, guitar straps, dog leads, shoelaces)
    //    "Custom leather guitar strap" → 4205.00.05.00
    //    "leather guitar strap" → 4205.00.05.00
    //    "leather dog leads" → 4205.00.10.00 (dog leash of leather)
    //    "Sashiko Leather Thimble" → 4205.00.10.00
    //    4205.00 = other articles of leather or composition leather
    {
      const existing = allRules.find(r => r.id === 'LEATHER_STRAP_ARTICLE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LEATHER_STRAP_ARTICLE_INTENT',
          description: 'Leather straps, guitar straps, dog leads, thimbles, leather accessories → ch.42 (4205.00)',
          pattern: {
            anyOf: [
              'leather guitar strap', 'guitar strap leather', 'custom leather strap',
              'leather strap', 'leather dog lead', 'leather dog leash', 'dog lead leather',
              'leather leash', 'leather harness', 'leather collar strap',
              'leather thimble', 'leather apron', 'leather tool belt', 'leather tool pouch',
              'leather camera strap', 'leather watch strap', 'leather watch band',
              'leather key fob', 'leather lanyard', 'leather badge holder',
              'leather cord', 'leather lacing', 'leather lace',
            ],
            noneOf: ['synthetic strap', 'nylon strap', 'fabric strap', 'canvas strap',
                     'rubber strap', 'metal watch band', 'velcro strap'],
          },
          inject: [{ prefix: '4205.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4205' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('LEATHER_STRAP_ARTICLE_INTENT: created (leather straps/leads → 4205.00)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT25)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT25 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
