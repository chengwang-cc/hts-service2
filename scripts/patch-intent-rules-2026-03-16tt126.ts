#!/usr/bin/env ts-node
/**
 * Patch TT126 — 2026-03-16: Ceramic decorative articles, cotton thread, vacuum flasks,
 *   textile handbags/tote bags.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt126.ts
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

    // 1. CERAMIC_DECORATIVE_HOME_INTENT → 6907.40 (other glazed ceramics, decorative home items)
    //    "Engraved Ceramic Vase" → 6913.10 WRONG (expected 6907.40.10.11)
    //    "Vintage Ceramic Picture Frame" → 4414.10 WRONG (expected 6907.40.10.11)
    //    "Vintage Ceramic White Dove Candlestick Holder" → 6912 WRONG (expected 6907.40.10.11)
    //    "Mustard Checkers Sponge Holder" → 3924.10 WRONG (expected 6907.40.90.51)
    //    "Hand painted ceramic wall tile" → 6907.23.90 WRONG (expected 6907.40.90.51) - decorative art tile
    //    Root cause: decorative ceramics (6907.40) lose to ornamental (6913), tableware (6912), plastic
    {
      const existing = allRules.find(r => r.id === 'CERAMIC_DECORATIVE_HOME_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CERAMIC_DECORATIVE_HOME_INTENT',
          description: 'Decorative ceramic articles → 6907.40 (other glazed ceramics)',
          pattern: {
            anyOf: [
              // Ceramic frames
              'ceramic picture frame', 'ceramic photo frame', 'vintage ceramic frame',
              // Ceramic candle/incense holders
              'ceramic candle holder', 'ceramic candlestick holder', 'ceramic candleholder',
              'ceramic taper holder', 'ceramic pillar holder',
              // Ceramic sponge/soap holders
              'ceramic sponge holder', 'ceramic soap dish', 'ceramic dish holder',
              // Ceramic art tiles
              'hand painted ceramic', 'hand painted tile', 'painted ceramic tile',
              'ceramic art tile', 'ceramic wall art tile', 'decorative ceramic tile',
              // Ceramic cups/containers as art
              'ceramic art cup', 'ceramic salt pinch', 'pinch pot ceramic',
              // Ceramic vases (engraved/decorated)
              'engraved ceramic vase', 'ceramic engraved vase', 'decorated ceramic vase',
              'glazed ceramic vase',
            ],
            noneOf: [
              // Standard tiles (non-art) → 6907.23
              'bathroom tile', 'floor tile', 'wall tile standard',
              // Porcelain tableware → 6911/6912
              'porcelain mug', 'porcelain plate', 'ceramic dinner plate',
            ],
          },
          inject: [
            { prefix: '6907.40.10', syntheticRank: 1 },  // glazed ceramic articles ≤ $5/doz value
            { prefix: '6907.40.90', syntheticRank: 3 },  // glazed ceramic articles > $5/doz value
          ],
          whitelist: {
            allowChapters: ['69'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6907.40' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '6913.' },   // penalize ornamental ceramics
            { delta: 0.80, prefixMatch: '6912.' },   // penalize ceramic tableware
            { delta: 0.80, prefixMatch: '6911.' },   // penalize porcelain tableware
            { delta: 0.85, prefixMatch: '4414.' },   // penalize picture frames
            { delta: 0.80, prefixMatch: '3924.' },   // penalize plastic household
            { delta: 0.80, prefixMatch: '6907.23.' }, // penalize standard wall/floor tiles
          ],
        } as IntentRule;
        patches.push({ priority: 671, rule: newRule });
        console.log('CERAMIC_DECORATIVE_HOME_INTENT: created (→6907.40, allowChapters:[69])');
      } else {
        console.log('CERAMIC_DECORATIVE_HOME_INTENT: already exists, skipping');
      }
    }

    // 2. COTTON_THREAD_EMBROIDERY_INTENT → 5204.19/5204.20 (cotton sewing thread/embroidery floss)
    //    "skeins cotton thread" → 5204.11 WRONG (expected 5204.20.00.00 - put up for retail)
    //    "Embroidery thread floss. ANCHOR BRAND" → 5204.11 WRONG (expected 5204.19.00.00)
    //    "Hug snug seam binding" → 6109.10 WRONG (expected 5204.19.00.00)
    //    Root cause: 5204.11 (single, not for retail) beats 5204.20 (retail) and 5204.19 (other)
    {
      const existing = allRules.find(r => r.id === 'COTTON_THREAD_EMBROIDERY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_THREAD_EMBROIDERY_INTENT',
          description: 'Cotton embroidery thread/floss/seam binding → 5204.19/5204.20',
          pattern: {
            anyOf: [
              'embroidery thread', 'embroidery floss', 'cotton embroidery thread',
              'cotton floss', 'anchor thread', 'anchor brand thread', 'dmc floss',
              'dmc thread', 'dmc cotton', 'embroidery thread floss',
              'skeins cotton thread', 'cotton thread skein', 'skein cotton',
              'seam binding', 'hug snug', 'bias tape',
              'cotton sewing thread', 'cotton thread', 'cotton yarn skein',
            ],
            noneOf: [
              'polyester thread', 'nylon thread', 'silk thread', 'metallic thread',
              'embroidery machine thread', 'serger thread', 'bobbin thread',
            ],
          },
          inject: [
            { prefix: '5204.20', syntheticRank: 1 },  // cotton sewing thread, put up for retail
            { prefix: '5204.19', syntheticRank: 2 },  // other cotton sewing thread
          ],
          whitelist: {
            allowChapters: ['52'],
            denyPrefixes: ['5204.11.', '5204.12.'],  // block "not for retail" single/cable thread
          },
          boosts: [
            { delta: 0.90, prefixMatch: '5204.20' },
            { delta: 0.80, prefixMatch: '5204.19' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '5204.11' },  // strong penalty for not-for-retail single
            { delta: 0.85, prefixMatch: '6109.' },    // penalize knitted garments
          ],
        } as IntentRule;
        patches.push({ priority: 672, rule: newRule });
        console.log('COTTON_THREAD_EMBROIDERY_INTENT: created (→5204.20/19, denyPrefixes:[5204.11,5204.12])');
      } else {
        console.log('COTTON_THREAD_EMBROIDERY_INTENT: already exists, skipping');
      }
    }

    // 3. VACUUM_FLASK_THERMOS_INTENT → 9617 (vacuum flasks and insulated bottles)
    //    "Kpop Demon Hunters 16oz kids water bottle" → 7323.93 WRONG (expected 9617.00.10.00)
    //    Root cause: "water bottle" → kitchen/household steel (7323) but kids character bottles
    //    are vacuum-insulated = 9617 (vacuum flasks/thermoses).
    {
      const existing = allRules.find(r => r.id === 'VACUUM_FLASK_THERMOS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VACUUM_FLASK_THERMOS_INTENT',
          description: 'Vacuum flasks, thermoses, insulated kids bottles → 9617 (vacuum vessels)',
          pattern: {
            anyOf: [
              'vacuum flask', 'vacuum flasks', 'thermos', 'thermos bottle',
              'thermos flask', 'vacuum insulated bottle', 'insulated vacuum bottle',
              'kids vacuum bottle', 'kids insulated bottle', 'kids character bottle',
              'character water bottle', 'kpop water bottle', 'kpop bottle',
              'licensed water bottle', 'cartoon water bottle', 'anime water bottle',
              'insulated tumbler', 'thermal flask', 'thermal bottle',
              'double wall vacuum', 'double-wall vacuum', 'double walled bottle',
            ],
          },
          inject: [
            { prefix: '9617.00', syntheticRank: 1 },  // vacuum flasks and vacuum vessels
          ],
          whitelist: {
            allowChapters: ['96'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9617.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '7323.' },  // penalize iron/steel household articles
            { delta: 0.80, prefixMatch: '7310.' },  // penalize metal containers
          ],
        } as IntentRule;
        patches.push({ priority: 673, rule: newRule });
        console.log('VACUUM_FLASK_THERMOS_INTENT: created (→9617, allowChapters:[96])');
      } else {
        console.log('VACUUM_FLASK_THERMOS_INTENT: already exists, skipping');
      }
    }

    // 4. TEXTILE_TOTE_BAG_HANDBAG_INTENT → 4202.12/4202.22 (textile handbags/tote bags)
    //    "cotton tote bag" → 4202.92.33.16 WRONG (expected 4202.29.90.00)
    //    "100% Cotton tote bag" → 4202.92.33.16 WRONG (expected 4202.12.40.00)
    //    "Tote Bag" → 4202.92.04.00 WRONG (expected 4202.19.00.00)
    //    "Kobe Bryant Jacquard Tapestry Tote Bag" → 5805 WRONG (expected 4202.22.89.30)
    //    "Handmade Circus Clutch Purse" → 4202.22.40.10 WRONG (expected 4202.12.40.00)
    //    Root cause: tote bags → travel/sports bags (4202.92); clutch purses → shoulder bags
    {
      const existing = allRules.find(r => r.id === 'TEXTILE_TOTE_BAG_HANDBAG_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'TEXTILE_TOTE_BAG_HANDBAG_INTENT',
          description: 'Textile tote bags and fabric handbags → 4202.12/4202.22 (handbags)',
          pattern: {
            anyOf: [
              'tote bag', 'cotton tote bag', 'canvas tote bag', 'linen tote bag',
              'jute tote bag', 'woven tote bag', 'tapestry tote bag',
              'jacquard tote bag', 'fabric tote bag', 'textile tote bag',
              'handmade tote bag', 'reusable tote bag', 'market bag tote',
              'clutch purse handmade', 'handmade clutch purse', 'fabric clutch purse',
              'fabric handbag', 'handmade fabric handbag', 'textile handbag',
              'woven handbag', 'tapestry handbag',
            ],
            noneOf: [
              'leather tote', 'faux leather', 'PU leather', 'vegan leather tote',
              'backpack', 'drawstring bag', 'gift bag',
            ],
          },
          inject: [
            { prefix: '4202.12', syntheticRank: 1 },  // handbags of plastic/textile (with or without handle)
            { prefix: '4202.22', syntheticRank: 2 },  // handbags of textile materials
            { prefix: '4202.19', syntheticRank: 4 },  // handbags of other materials
            { prefix: '4202.29', syntheticRank: 6 },  // other handbags/shoulder bags of other materials
          ],
          whitelist: {
            allowChapters: ['42'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '4202.12' },
            { delta: 0.80, prefixMatch: '4202.22' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '4202.92' },  // penalize travel/sports bags
            { delta: 0.80, prefixMatch: '5805.' },    // penalize tapestry fabric
          ],
        } as IntentRule;
        patches.push({ priority: 674, rule: newRule });
        console.log('TEXTILE_TOTE_BAG_HANDBAG_INTENT: created (→4202.12/22, allowChapters:[42])');
      } else {
        console.log('TEXTILE_TOTE_BAG_HANDBAG_INTENT: already exists, skipping');
      }
    }

    // 5. STEEL_TIN_CAN_CONTAINER_INTENT → 7310.21 (tins/cans of iron/steel)
    //    "4x EMPTY Antique 1920s Standard Brands Tins EMPTY Canada" → 7310.10 WRONG (expected 7310.21)
    //    Root cause: 7310.10 (capacity ≥ 50L) vs 7310.21 (capacity < 50L, tinplate) - tins are small.
    {
      const existing = allRules.find(r => r.id === 'STEEL_TIN_CAN_CONTAINER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STEEL_TIN_CAN_CONTAINER_INTENT',
          description: 'Steel tins/cans (< 50L) → 7310.21 (tins of tinplate) or 7310.29 (other)',
          pattern: {
            anyOf: [
              'antique tin', 'vintage tin', 'collectible tin', 'tin can',
              'tin container', 'biscuit tin', 'cookie tin', 'candy tin',
              'tobacco tin', 'metal tin', 'old tin', 'antique tins',
              'empty tin', 'advertising tin', 'brand tin',
            ],
            noneOf: [
              'tin foil', 'tin sheet', 'tinplate sheet',
              'stainless tin', '50 liter', '50l',
            ],
          },
          inject: [
            { prefix: '7310.21', syntheticRank: 1 },  // cans/tins of tinplate, capacity < 50L
            { prefix: '7310.29', syntheticRank: 4 },  // other cans/tins, capacity < 50L
          ],
          whitelist: {
            allowChapters: ['73'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7310.21' },
            { delta: 0.70, prefixMatch: '7310.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '7310.10' },  // penalize large containers ≥50L
          ],
        } as IntentRule;
        patches.push({ priority: 675, rule: newRule });
        console.log('STEEL_TIN_CAN_CONTAINER_INTENT: created (→7310.21, allowChapters:[73])');
      } else {
        console.log('STEEL_TIN_CAN_CONTAINER_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT126)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT126 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
