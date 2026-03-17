#!/usr/bin/env ts-node
/**
 * Patch SS1 — 2026-03-15: Targeted fixes based on post-QQ2+RR1 accuracy analysis.
 * Baseline post-QQ2+RR1: 29.43% hit@10 (1479/5025), EMPTY: 24
 *
 * Key remaining failures:
 *  ch.62: 325 (garment fiber subcode — mostly within-chapter)
 *  ch.61: 308 (garment fiber subcode — mostly within-chapter)
 *  ch.85: 245 (motor subcode — within-chapter)
 *  ch.39: 231 (plastic/polymer — within-chapter paint vs article)
 *  ch.42: 134 (bag subcategory — within-chapter)
 *  ch.84: 134 — "bearing set" → 8483 instead of 8409 (within ch.84)
 *  ch.70: 128 — "crystal figurine" → within ch.70 (scoring)
 *  ch.71: 119 — "semi precious gemstone bead" → 7104 instead of 7103
 *  ch.44: 116 — "tangwood bracelet" → 7113 instead of 4403 (pure ranking)
 *
 * Fixes in this patch:
 *  1. NATURAL_GEMSTONE_BEAD_INTENT: "semi precious"/"natural gemstone bead" → ch.71 (7103)
 *     inject 7103 prefix to fix synthetic vs natural gem routing
 *  2. ENGINE_BEARING_SET_INTENT: add inject 8409 prefix (was already restricting to ch.84
 *     but ranking within ch.84 favors 8483 bearing housing over 8409 engine part)
 *  3. MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: add inject 8501.20 (small universal motors)
 *  4. INFLATABLE_TOY_BALL_INTENT: "inflatable beach ball" / "squeeze toy" → ch.95 + inject 9503
 *  5. CROCHET_KNIT_TOY_INTENT: "crochet toy"/"amigurumi"/"knit toy" → ch.95 + inject 9503
 *  6. POLYPROPYLENE_POLYMER_INTENT: "polypropylene" / "polyethylene" raw resin → ch.39 (3901-3903)
 *  7. WOOD_BRACELET_JEWELRY_FIX: JEWELRY_BRACELET_INTENT: ensure noneOf "tangwood" applied
 *     + NEW WOOD_ACCESSORY_JEWELRY_INTENT to steer wood jewelry to ch.44
 *  8. WALLET_TRIFOLD_BIFOLD_INTENT: bifold/trifold wallet → ch.42 (4202.31/4202.32)
 *  9. GARMENT_JACKET_KNIT_INTENT: "knit jacket"/"knitted jacket" → ch.61 (not ch.62 woven)
 * 10. SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT: "crystal chip"/"healing crystal" → ch.71 (7103)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss1.ts
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
    const addInject = (e: IntentRule, prefix: string, syntheticRank = 25) => {
      const existing = (e as any).inject ?? [];
      const alreadyHas = existing.some((s: any) => s.prefix === prefix);
      if (alreadyHas) return (e as any).inject;
      return [...existing, { prefix, syntheticRank }];
    };

    // 1. New: NATURAL_GEMSTONE_BEAD_INTENT
    //    Fixes: "semi precious gemstone bead" → 7103.99.10 (natural), got 7104.10.00 (synthetic)
    {
      const existing = allRules.find(r => r.id === 'NATURAL_GEMSTONE_BEAD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'NATURAL_GEMSTONE_BEAD_INTENT',
          description: 'Natural/semi-precious gemstone beads → ch.71 (7103 natural stones)',
          pattern: {
            anyOf: [
              'semi precious', 'semi-precious', 'natural gemstone', 'gemstone bead',
              'natural stone bead', 'turquoise bead', 'amethyst bead', 'jasper bead',
              'obsidian bead', 'labradorite bead', 'agate bead', 'lava bead',
              'howlite bead', 'tiger eye bead', 'rose quartz bead', 'malachite bead',
            ],
            noneOf: [
              'synthetic', 'lab created', 'lab grown', 'man made', 'simulated',
              'cubic zirconia', 'moissanite', 'cz gem', 'glass bead',
            ],
          },
          inject: [{ prefix: '7103', syntheticRank: 20 }],
          whitelist: { allowChapters: ['71'] },
          boosts: [{ delta: 0.5, prefixMatch: '7103.' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('NATURAL_GEMSTONE_BEAD_INTENT: created (semi precious → ch.71 7103)');
      }
    }

    // 2. SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT: healing crystals / crystal chips → ch.71 (7103)
    //    Fixes: "30g Crystal Chips", "Black Obsidian Crystal Pentacle" → EMPTY or wrong ch
    {
      const existing = allRules.find(r => r.id === 'SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT',
          description: 'Healing crystals / crystal chips → ch.71 (7103 semi-precious stones)',
          pattern: {
            anyOf: [
              'crystal chip', 'crystal chips', 'healing crystal', 'healing crystals',
              'raw crystal', 'rough crystal', 'crystal pentacle', 'crystal palm stone',
              'crystal tumble', 'tumbled crystal', 'crystal sphere', 'crystal tower',
              'crystal point', 'crystal wand',
            ],
            noneOf: ['crystal glass', 'crystal clear', 'crystal vase', 'swarovski', 'crystal figurine', 'crystal wine glass'],
          },
          inject: [{ prefix: '7103', syntheticRank: 20 }],
          whitelist: { allowChapters: ['71'] },
          boosts: [{ delta: 0.45, prefixMatch: '7103.' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('SEMI_PRECIOUS_CRYSTAL_CHIP_INTENT: created (crystal chips → ch.71)');
      }
    }

    // 3. ENGINE_BEARING_SET_INTENT: add inject 8409 prefix
    //    Fixes: "bearing set" → 8483.20.40 (bearing housing) instead of 8409.91.99 (engine part)
    //    Rule correctly restricts to ch.84 but 8483 ranks higher than 8409 within ch.84
    {
      const e = allRules.find(r => r.id === 'ENGINE_BEARING_SET_INTENT');
      if (e) {
        const newInject = addInject(e, '8409.91', 22);
        const newInject2 = [...newInject, ...(newInject.some((s: any) => s.prefix === '8409.99') ? [] : [{ prefix: '8409.99', syntheticRank: 22 }])];
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: newInject2 } });
        console.log('ENGINE_BEARING_SET_INTENT: added inject 8409.91, 8409.99');
      }
    }

    // 4. MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: add inject 8501.20 (small universal motors)
    //    Fixes: "Rotisserie bbq motor" → 8501.40.20 (AC motor) instead of 8501.20.20 (universal)
    {
      const e = allRules.find(r => r.id === 'MOTOR_SMALL_BBQ_ROTISSERIE_INTENT');
      if (e) {
        const newInject = addInject(e, '8501.20', 22);
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, inject: newInject } });
        console.log('MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: added inject 8501.20');
      }
    }

    // 5. New: INFLATABLE_TOY_BALL_INTENT: inflatable beach ball / squeeze toy → ch.95 (9503)
    {
      const existing = allRules.find(r => r.id === 'INFLATABLE_TOY_BALL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'INFLATABLE_TOY_BALL_INTENT',
          description: 'Inflatable balls/toys → ch.95 (9503)',
          pattern: {
            anyOf: [
              'inflatable beach ball', 'inflatable ball', 'beach ball', 'squeeze toy',
              'squeeze ball', 'stress ball toy', 'foam ball toy', 'foam toy ball',
              'rubber toy ball', 'blow up ball', 'vinyl toy ball',
            ],
            noneOf: ['gym ball', 'exercise ball', 'yoga ball', 'pilates ball', 'stability ball', 'medicine ball'],
          },
          inject: [{ prefix: '9503', syntheticRank: 25 }],
          whitelist: { allowChapters: ['95', '39'] },
          boosts: [{ delta: 0.5, chapterMatch: '95' }],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('INFLATABLE_TOY_BALL_INTENT: created (inflatable ball → ch.95)');
      }
    }

    // 6. New: CROCHET_KNIT_TOY_INTENT: crochet/amigurumi toys → ch.95 (9503)
    //    Fixes: "100% polyester crochet toy" → ch.95, not ch.63 (textile)
    {
      const existing = allRules.find(r => r.id === 'CROCHET_KNIT_TOY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CROCHET_KNIT_TOY_INTENT',
          description: 'Crochet/knit toys and amigurumi → ch.95 (9503)',
          pattern: {
            anyOf: [
              'crochet toy', 'crochet animal', 'crochet doll', 'amigurumi',
              'knit toy', 'knitted toy', 'crochet stuffed', 'handmade crochet toy',
            ],
          },
          inject: [{ prefix: '9503', syntheticRank: 22 }],
          whitelist: { allowChapters: ['95', '63'] },
          boosts: [{ delta: 0.55, chapterMatch: '95' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('CROCHET_KNIT_TOY_INTENT: created (crochet toy → ch.95)');
      }
    }

    // 7. New: WALLET_TRIFOLD_BIFOLD_INTENT — bifold/trifold wallet → 4202.31/4202.32
    //    Fixes: wallet subcategory routing within ch.42
    {
      const existing = allRules.find(r => r.id === 'WALLET_TRIFOLD_BIFOLD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WALLET_TRIFOLD_BIFOLD_INTENT',
          description: 'Bifold/trifold/cash wallets → ch.42 (4202.31/4202.32)',
          pattern: {
            anyOf: [
              'bifold wallet', 'trifold wallet', 'tri fold wallet', 'bi fold wallet',
              'cash wallet', 'slim wallet', 'money clip wallet', 'card wallet',
              'men wallet', "men's wallet", 'leather wallet', 'genuine leather wallet',
            ],
            noneOf: ['travel wallet', 'passport wallet', 'phone wallet', 'wristlet wallet'],
          },
          inject: [{ prefix: '4202.31', syntheticRank: 22 }, { prefix: '4202.32', syntheticRank: 24 }],
          whitelist: { allowChapters: ['42'] },
          boosts: [{ delta: 0.35, prefixMatch: '4202.3' }],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('WALLET_TRIFOLD_BIFOLD_INTENT: created (bifold wallet → ch.42 4202.31/32)');
      }
    }

    // 8. New: LEATHER_WALLET_BIFOLD_CASH_INTENT — cash binder/stuffing binder → 4202.11
    //    Fixes: "Ribbed A6 Leather Cash Stuffing Binder" → 4202.11.00 (attache/briefcase type)
    {
      const existing = allRules.find(r => r.id === 'LEATHER_CASH_BINDER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LEATHER_CASH_BINDER_INTENT',
          description: 'Leather cash binder/wallet binder → ch.42 (4202.11/4202.12)',
          pattern: {
            anyOf: [
              'cash binder', 'cash stuffing binder', 'budget binder wallet', 'leather binder wallet',
              'cash envelope wallet', 'cash stuffing wallet', 'cash envelopes binder',
              'field wallet', 'field wallet sharpener', 'field notes wallet',
            ],
          },
          inject: [{ prefix: '4202.11', syntheticRank: 22 }, { prefix: '4202.12', syntheticRank: 24 }],
          whitelist: { allowChapters: ['42'] },
          boosts: [{ delta: 0.35, prefixMatch: '4202.1' }],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('LEATHER_CASH_BINDER_INTENT: created (cash binder → ch.42 4202.11/12)');
      }
    }

    // 9. New: GARMENT_KNIT_JACKET_INTENT — knitted jacket/sweater → ch.61 (not ch.62 woven)
    //    "knit jacket", "knitted jacket", "nylon knit jacket"
    {
      const existing = allRules.find(r => r.id === 'GARMENT_KNIT_JACKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GARMENT_KNIT_JACKET_INTENT',
          description: 'Knitted jackets and outerwear → ch.61',
          pattern: {
            anyOf: [
              'knit jacket', 'knitted jacket', 'knit coat', 'knitted coat',
              'knit sweater jacket', 'cardigan jacket', 'fleece knit jacket',
            ],
            noneOf: ['denim jacket', 'leather jacket', 'woven jacket', 'chore jacket'],
          },
          whitelist: { allowChapters: ['61'] },
          boosts: [{ delta: 0.35, chapterMatch: '61' }],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('GARMENT_KNIT_JACKET_INTENT: created (knit jacket → ch.61)');
      }
    }

    // 10. New: WOOD_NATURAL_MATERIAL_BRACELET_INTENT — wood/natural material bracelets → ch.44
    //     Fixes: "100% Tangwood bracelet" still routing to ch.71 jewelry
    {
      const existing = allRules.find(r => r.id === 'WOOD_NATURAL_MATERIAL_BRACELET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_NATURAL_MATERIAL_BRACELET_INTENT',
          description: 'Wood/natural material bracelets → ch.44 (wood articles), not ch.71',
          pattern: {
            anyOf: [
              'wood bracelet', 'wooden bracelet', 'bamboo bracelet', 'teak bracelet',
              'rosewood bracelet', 'cork bracelet', 'wooden bangle', 'wood bangle',
              'tangwood bracelet', 'tangwood',
            ],
          },
          whitelist: { allowChapters: ['44', '46', '83'] },
          boosts: [{ delta: 0.45, chapterMatch: '44' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('WOOD_NATURAL_MATERIAL_BRACELET_INTENT: created (wood bracelet → ch.44)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch SS1)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS1 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
