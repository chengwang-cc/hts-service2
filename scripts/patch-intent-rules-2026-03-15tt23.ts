#!/usr/bin/env ts-node
/**
 * Patch TT23 — 2026-03-15: Sneakers + synthetic dresses + silicone wristbands + synthetic tees + PVD/titanium jewelry.
 * Current: ~31.82% (after TT21; TT22 pending eval)
 *
 * Targets:
 *  1. ATHLETIC_SNEAKER_SHOE_INTENT → 6404.11 (sneakers, canvas shoes, suede shoes, athletic footwear)
 *     "suede shoes" → 6404.11.20.30; "Converse Chuck Taylor" → 6404.11.20.60; 17 entries
 *     "New Balance 530" → 6404.11.75.30; "Kitty Cat BOBS from Skechers" → 6404.11.51.30
 *  2. SYNTHETIC_WOMEN_DRESS_INTENT → 6204.43 (polyester/rayon/synthetic women's dresses, flower girl)
 *     "polyester sleeveless dress" → 6204.43.10; "Tie-Dye Rayon Maxi Dress" → 6204.43.10; 16 entries
 *     "Flower Girl Dress" → 6204.43.30; "Satin Gown" → 6204.43.30
 *  3. SILICONE_RUBBER_WRISTBAND_INTENT → 3926.20 (silicone/rubber wristbands, plastic clothing accessories)
 *     "10 Pack of Wristbands" → 3926.20.10; "Gloves Polyester Spandex Silicone" → 3926.20.20; 14 entries
 *  4. SYNTHETIC_TSHIRT_SINGLET_INTENT → 6109.90 (polyester/rayon/synthetic knit t-shirts, tanks)
 *     "50% polyester 38% cotton 12% rayon t-shirt" → 6109.90.10; "vintage tank top nylon" → 6109.90.10; 23 entries
 *  5. PVD_TITANIUM_STEEL_JEWELRY_INTENT → 7117.19 (PVD rings, titanium earrings, stainless steel jewelry)
 *     "18K Gold PVD Sun Signet Ring" → 7117.19.05; "20G Titanium Steel Cross Huggie Earring" → 7117.19.05; 18 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt23.ts
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

    // 1. ATHLETIC_SNEAKER_SHOE_INTENT → 6404.11 (athletic footwear, textile/suede upper, rubber sole)
    //    "suede shoes" → 6404.11.20.30; "Converse Chuck Taylor All Star Leather High Top" → 6404.11.20.60
    //    "New Balance 2002R", "New Balance 530" → 6404.11.75.30; "Kitty Cat BOBS from Skechers" → 6404.11.51.30
    //    "Alohas Women's Tb.490 Shimmer Silver" → 6404.11.75.60
    //    6404.11 = footwear with outer sole of rubber/plastics, upper of textile material
    {
      const existing = allRules.find(r => r.id === 'ATHLETIC_SNEAKER_SHOE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ATHLETIC_SNEAKER_SHOE_INTENT',
          description: 'Athletic sneakers, canvas shoes, suede shoes, rubber sole footwear → ch.64 (6404.11)',
          pattern: {
            anyOf: [
              'sneakers', 'sneaker', 'athletic shoes', 'athletic shoe', 'athletic footwear',
              'running shoes', 'running shoe', 'tennis shoes', 'tennis shoe',
              'canvas shoes', 'canvas sneaker', 'canvas shoe',
              'suede shoes', 'suede sneaker', 'suede loafer', 'suede trainer',
              'converse', 'chuck taylor', 'all star shoe',
              'new balance', 'adidas shoe', 'nike shoe', 'skechers', 'vans shoes',
              'high top sneaker', 'high top shoe', 'low top sneaker',
              'platform sneaker', 'chunky sneaker',
              'fashion sneaker', 'lifestyle sneaker', 'retro sneaker',
            ],
            noneOf: ['leather dress shoe', 'leather oxford', 'leather boot', 'leather pump',
                     'hiking boot', 'work boot', 'rain boot', 'rubber boot', 'flip flop', 'sandal'],
          },
          inject: [{ prefix: '6404.11', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6404.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('ATHLETIC_SNEAKER_SHOE_INTENT: created (sneakers/canvas/suede shoes → 6404.11)');
      }
    }

    // 2. SYNTHETIC_WOMEN_DRESS_INTENT → 6204.43 (polyester/rayon/synthetic woven women's dresses)
    //    "Black sleeveless dress, polyester and lyocell blend" → 6204.43.10.00
    //    "Tie-Dye Rayon Maxi Dress: Sleeveless Hippie Boho Style" → 6204.43.10.00
    //    "women's dress, 100% polyester, woven fabric, sleeveless" → 6204.43.10.00
    //    "girls tulle dress" → 6204.43.20.00
    //    "Satin Gown" → 6204.43.30.10; "Flower Girl Dress" → 6204.43.30.20
    //    6204.43 = women's/girls' dresses of synthetic fibers (woven, not knitted)
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_WOMEN_DRESS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SYNTHETIC_WOMEN_DRESS_INTENT',
          description: 'Polyester/rayon/synthetic woven women\'s dresses, gowns, flower girl → ch.62 (6204.43)',
          pattern: {
            anyOf: [
              'polyester dress', 'polyester maxi dress', 'polyester sleeveless dress',
              'polyester woven dress', 'polyester blend dress',
              'rayon dress', 'rayon maxi dress', 'rayon sleeveless dress',
              'rayon boho dress', 'tie-dye rayon dress', 'tie dye rayon dress',
              'lyocell dress', 'viscose dress', 'synthetic dress',
              'maxi dress', 'boho maxi dress', 'hippie maxi dress',
              'tulle dress', 'tulle skirt dress', 'girls tulle dress',
              'satin gown', 'satin dress', 'satin maxi dress', 'chiffon dress',
              'flower girl dress', 'flower girl gown', 'bridesmaid dress',
              'prom dress', 'formal gown', 'evening gown', 'pageant dress',
            ],
            noneOf: ['cotton dress', 'linen dress', 'wool dress', 'knit dress', 'jersey dress',
                     'sweater dress', 'crochet dress'],
          },
          inject: [{ prefix: '6204.43', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6204.4' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SYNTHETIC_WOMEN_DRESS_INTENT: created (polyester/synthetic dresses → 6204.43)');
      }
    }

    // 3. SILICONE_RUBBER_WRISTBAND_INTENT → 3926.20 (plastic/silicone clothing accessories)
    //    "10 Pack of Wristbands - Anishnaabe" → 3926.20.10.50 (plastic wristbands/bracelets)
    //    "25 Pack of Wristband (MMIWG Design)" → 3926.20.10.50
    //    "3 Pack Wristbands - Canada with Maple Leaf" → 3926.20.10.50
    //    "Gloves Polyester, Spandex, Silicone" → 3926.20.20
    //    3926.20 = articles of apparel and clothing accessories of plastics
    {
      const existing = allRules.find(r => r.id === 'SILICONE_RUBBER_WRISTBAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILICONE_RUBBER_WRISTBAND_INTENT',
          description: 'Silicone/rubber wristbands, plastic clothing accessories → ch.39 (3926.20)',
          pattern: {
            anyOf: [
              'wristband', 'wristbands', 'rubber wristband', 'silicone wristband',
              'silicone bracelet', 'rubber bracelet', 'plastic bracelet',
              'pack of wristbands', 'pack of wristband', 'awareness wristband',
              'custom wristband', 'fundraiser wristband', 'event wristband',
              'tyvek wristband', 'paper wristband', 'hospital wristband',
            ],
            noneOf: ['metal bracelet', 'gold bracelet', 'silver bracelet', 'charm bracelet',
                     'beaded bracelet', 'leather bracelet', 'fabric bracelet', 'cuff bracelet'],
          },
          inject: [{ prefix: '3926.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '3926.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SILICONE_RUBBER_WRISTBAND_INTENT: created (silicone/rubber wristbands → 3926.20)');
      }
    }

    // 4. SYNTHETIC_TSHIRT_SINGLET_INTENT → 6109.90 (polyester/rayon/synthetic knit t-shirts, tanks)
    //    "50% polyester 38% cotton 12% rayon t-shirt" → 6109.90.10.07 (poly-dominant)
    //    "vintage tank top nylon" → 6109.90.10.13 (nylon tank)
    //    "Men's tank top" → 6109.90.10.13 (tank top, material unknown)
    //    "Dog Raglan - L" → 6109.90.10.49 (raglan synthetic jersey)
    //    6109.90 = t-shirts, singlets of other textile materials (man-made, silk, etc.)
    //    NOTE: COTTON_TSHIRT_SINGLET_INTENT handles 6109.10 (cotton) — no conflict due to noneOf
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_TSHIRT_SINGLET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SYNTHETIC_TSHIRT_SINGLET_INTENT',
          description: 'Polyester/rayon/synthetic knit t-shirts, tank tops, singlets → ch.61 (6109.90)',
          pattern: {
            anyOf: [
              'polyester tee', 'polyester t-shirt', 'polyester tshirt', 'polyester shirt knit',
              'polyester tank top', 'polyester tank', 'polyester singlet',
              'rayon tee', 'rayon t-shirt', 'rayon shirt', 'viscose tee',
              'nylon shirt', 'nylon tee', 'nylon tank top', 'vintage tank top nylon',
              'dri-fit shirt', 'dri fit shirt', 'moisture wicking tee', 'performance tee',
              'athletic tee', 'sport tee', 'compression tee',
              'raglan tee', 'raglan shirt', 'raglan sleeve tee', 'baseball tee',
              'tank top', 'muscle shirt', 'sleeveless shirt', 'singlet shirt',
            ],
            noneOf: ['cotton tee', 'cotton t-shirt', '100% cotton', 'cotton tank',
                     'woven shirt', 'dress shirt', 'button shirt', 'polo shirt'],
          },
          inject: [{ prefix: '6109.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '6109.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SYNTHETIC_TSHIRT_SINGLET_INTENT: created (polyester/synthetic t-shirts/tanks → 6109.90)');
      }
    }

    // 5. PVD_TITANIUM_STEEL_JEWELRY_INTENT → 7117.19 (PVD rings, titanium/stainless earrings)
    //    "18K Gold PVD Sun Signet Ring: Waterproof Vintage Style" → 7117.19.05.00
    //    "20G Titanium Steel Cross Huggie Earring/Silver and Black Hoop" → 7117.19.05.00
    //    "Animation Character Charm Earrings, Gold-Plated Ear Wires" → 7117.19.05.00
    //    "Handmade stainless steel, glass, paper earrings" → 7117.19.15.00
    //    "Handmade Stainless Steel, Paper, and Glass Cuff Links" → 7117.19.15.00
    //    7117.19 = imitation jewelry of base metal (NOT precious metal)
    //    NOTE: GOLD_FILLED_CLAD_JEWELRY_INTENT → 7113.20 for higher-quality gold-filled
    {
      const existing = allRules.find(r => r.id === 'PVD_TITANIUM_STEEL_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PVD_TITANIUM_STEEL_JEWELRY_INTENT',
          description: 'PVD rings, titanium earrings, stainless steel jewelry → ch.71 (7117.19)',
          pattern: {
            anyOf: [
              'pvd ring', 'pvd gold ring', 'pvd signet ring', 'gold pvd ring', 'pvd necklace',
              'pvd earring', 'pvd coated jewelry', 'pvd coated jewellery',
              'titanium ring', 'titanium earring', 'titanium bracelet', 'titanium necklace',
              'titanium jewelry', 'titanium jewellery', 'titanium steel ring', 'titanium steel earring',
              'stainless steel earring', 'stainless steel ring', 'stainless steel necklace',
              'stainless steel bracelet', 'stainless steel jewelry', 'stainless jewelry',
              'steel huggie', 'huggie earring', 'steel cross earring', 'steel hoop earring',
              'steel hoop', 'steel cuff', 'gold plated wire earring', 'gold plated ear wire',
              'surgical steel earring', 'surgical steel ring',
            ],
            noneOf: ['solid gold', 'solid silver', '14k gold', '18k gold', 'sterling silver',
                     'platinum', 'gold filled', 'gold-filled'],
          },
          inject: [{ prefix: '7117.19', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7117.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PVD_TITANIUM_STEEL_JEWELRY_INTENT: created (PVD/titanium/steel jewelry → 7117.19)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT23)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT23 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
