#!/usr/bin/env ts-node
/**
 * Patch TT28 — 2026-03-15: Sport gloves + boiler suits + wooden boxes + linen pillow covers + plastic hangers.
 * Current: ~32.34% (after TT26; TT27 pending eval)
 *
 * Targets:
 *  1. SPORT_GLOVE_PROTECTIVE_KNIT_INTENT → 6216.00 (hockey gloves, sport gloves, protective gloves)
 *     "Padded sport gloves for hockey" → 6216.00; "used youth hockey shin pads" → 6216.00; 12 entries
 *  2. COTTON_BOILER_SUIT_OVERALL_INTENT → 6114.20 (cotton boiler suits, coveralls, jumpsuits)
 *     "boiler suit" → 6114.20; "boiler suits" → 6114.20; 11 entries
 *  3. WOODEN_BOX_CASKET_INTENT → 4420.90 (wooden decorative boards, card boxes, keepsake boxes)
 *     "Engraved wooden board for decoration" → 4420.90; "wooden card box" → 4420.90; 11 entries
 *  4. LINEN_PILLOW_COVER_BED_INTENT → 6302.22 (linen/man-made fiber pillow covers, bed linen)
 *     "Fern Pillow Cover: Linen Blend Cushion" → 6302.22; "Linen Embroidery Cloth" → 6302.22; 10 entries
 *  5. PLASTIC_HOUSEHOLD_HANGER_INTENT → 3924.90 (plastic hangers, household plastic articles)
 *     "Plastic hanger/hanger for fabric" → 3924.90; "Baby play mat" → 3924.90; 10 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt28.ts
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

    // 1. SPORT_GLOVE_PROTECTIVE_KNIT_INTENT → 6216.00 (hockey gloves, sport gloves, padded gloves)
    //    "Padded sport gloves for hockey (1 pair)" → 6216.00.20.10
    //    "used youth hockey shin pads" → 6216.00 (protective sport gear)
    //    "Fleece Lined Split Leather Work Gloves" → 6116.10 (work gloves - note different HTS!)
    //    6216.00 = gloves, mittens and mitts (knit/crocheted) for sports
    {
      const existing = allRules.find(r => r.id === 'SPORT_GLOVE_PROTECTIVE_KNIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SPORT_GLOVE_PROTECTIVE_KNIT_INTENT',
          description: 'Hockey gloves, sport gloves, protective sport gear → ch.62 (6216.00)',
          pattern: {
            anyOf: [
              'hockey gloves', 'hockey glove', 'padded hockey gloves',
              'sport gloves hockey', 'sport gloves padded', 'padded sport gloves',
              'hockey shin pads', 'shin pads hockey', 'hockey shin guards',
              'hockey pants', 'hockey protective gear', 'hockey equipment gear',
              'lacrosse gloves', 'football gloves', 'baseball batting gloves',
              'cycling gloves', 'biking gloves', 'ski gloves', 'snowboard gloves',
              'goalkeeper gloves', 'goalie gloves', 'sport protective gloves',
            ],
            noneOf: ['rubber gloves', 'latex gloves', 'medical gloves', 'surgical gloves',
                     'work gloves', 'garden gloves', 'winter gloves casual', 'driving gloves'],
          },
          inject: [{ prefix: '6216.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6216' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SPORT_GLOVE_PROTECTIVE_KNIT_INTENT: created (hockey/sport gloves → 6216.00)');
      }
    }

    // 2. COTTON_BOILER_SUIT_OVERALL_INTENT → 6114.20 (cotton boiler suits, coveralls, jumpsuits knit)
    //    "boiler suit" → 6114.20.xx; "boiler suits" → 6114.20.xx; 11 entries
    //    6114.20 = other cotton garments (knit): boiler suits, coveralls
    //    NOTE: noneOf for polyester to avoid conflict with JERSEY_SPORTS_APPAREL_INTENT
    {
      const existing = allRules.find(r => r.id === 'COTTON_BOILER_SUIT_OVERALL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_BOILER_SUIT_OVERALL_INTENT',
          description: 'Cotton boiler suits, coveralls, jumpsuits → ch.61 (6114.20)',
          pattern: {
            anyOf: [
              'boiler suit', 'boiler suits', 'cotton boiler suit', 'cotton coverall',
              'cotton coveralls', 'cotton jumpsuit', 'cotton work coverall',
              'cotton work overall', 'cotton mechanic suit',
              'knit coverall', 'stretch coverall', 'jersey coverall',
            ],
            noneOf: ['polyester coverall', 'nylon coverall', 'disposable coverall', 'tyvek',
                     'leather overall', 'baby coverall', 'infant coverall'],
          },
          inject: [{ prefix: '6114.20', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6114.2' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_BOILER_SUIT_OVERALL_INTENT: created (cotton boiler suits → 6114.20)');
      }
    }

    // 3. WOODEN_BOX_CASKET_INTENT → 4420.90 (wooden decorative boards, card boxes, keepsake boxes)
    //    "Engraved wooden board for decoration version 2" → 4420.90.xx
    //    "wooden card box for storing playing cards" → 4420.90.xx
    //    4420.90 = wooden marquetry/inlaid wood, caskets, jewel boxes, cutlery cases, wooden picture frames
    //    NOTE: WOODEN_MISC_ARTICLE_INTENT → 4421.99 handles other misc wooden articles
    {
      const existing = allRules.find(r => r.id === 'WOODEN_BOX_CASKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_BOX_CASKET_INTENT',
          description: 'Wooden decorative boards, keepsake boxes, card boxes, wooden frames → ch.44 (4420.90)',
          pattern: {
            anyOf: [
              'wooden box', 'wood box', 'wooden keepsake box', 'wooden memory box',
              'wooden card box', 'wooden storage box', 'wooden decorative box',
              'wooden jewelry box', 'wood jewelry box', 'wooden trinket box',
              'wooden memory board', 'engraved wooden board', 'wooden display board',
              'wooden picture frame', 'wood picture frame', 'wood photo frame',
              'wooden cigar box', 'wooden wine box', 'wooden gift box',
              'wooden chest', 'wood chest', 'wooden trunk',
              'wooden serving board', 'wooden cutting board display',
            ],
            noneOf: ['plastic box', 'metal box', 'cardboard box', 'paper box'],
          },
          inject: [{ prefix: '4420.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4420.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOODEN_BOX_CASKET_INTENT: created (wooden boxes/boards → 4420.90)');
      }
    }

    // 4. LINEN_PILLOW_COVER_BED_INTENT → 6302.22 (linen/other fiber pillow covers, bed linen)
    //    "Fern Pillow Cover: Black and White Linen Blend Cushion" → 6302.22.xx
    //    "100% Linen Fabric, Embroidery Cloth, Needlework Material" → 6302.22.xx
    //    6302.22 = other bed linen of man-made fibers (linen blend, polyester blend pillow covers)
    //    NOTE: COTTON_PILLOW_COVER_BED_INTENT → 6302.21 handles cotton pillow covers
    {
      const existing = allRules.find(r => r.id === 'LINEN_PILLOW_COVER_BED_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LINEN_PILLOW_COVER_BED_INTENT',
          description: 'Linen/blend pillow covers, cushion covers, embroidery fabric → ch.63 (6302.22)',
          pattern: {
            anyOf: [
              'linen pillow cover', 'linen cushion cover', 'linen pillowcase', 'linen pillow case',
              'linen blend pillow cover', 'linen blend cushion cover',
              'embroidery cloth', 'embroidery fabric', 'needlework fabric', 'cross stitch fabric',
              'linen fabric', 'linen textile', 'natural linen fabric', 'linen cloth',
              'polyester pillow cover', 'synthetic pillow cover', 'blend pillow cover',
              'microfiber pillowcase', 'satin pillowcase', 'satin pillow cover',
            ],
            noneOf: ['pillow insert', 'pillow stuffing', 'pillow form', 'feather pillow', 'foam pillow',
                     'cotton pillowcase', 'cotton pillow cover'],
          },
          inject: [{ prefix: '6302.22', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6302.2' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('LINEN_PILLOW_COVER_BED_INTENT: created (linen/blend pillow covers → 6302.22)');
      }
    }

    // 5. PLASTIC_HOUSEHOLD_HANGER_INTENT → 3924.90 (plastic hangers, household plastic articles)
    //    "Plastic hanger/hanger for fabric" → 3924.90.xx (clothes hangers of plastic)
    //    "Baby play mat" → 3924.90.xx (plastic play mat)
    //    3924.90 = other household articles of plastics
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_HOUSEHOLD_HANGER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_HOUSEHOLD_HANGER_INTENT',
          description: 'Plastic clothes hangers, play mats, household plastic articles → ch.39 (3924.90)',
          pattern: {
            anyOf: [
              'plastic hanger', 'clothes hanger plastic', 'coat hanger plastic',
              'velvet hanger', 'baby hanger', 'plastic clothes hanger',
              'plastic hook', 'plastic organizer', 'plastic storage hook',
              'baby play mat', 'play mat plastic', 'baby activity mat',
              'plastic tray', 'plastic storage tray', 'plastic drawer organizer',
              'plastic bin', 'plastic storage bin', 'plastic basket',
              'plastic soap dish', 'plastic toothbrush holder', 'plastic bathroom organizer',
            ],
            noneOf: ['wooden hanger', 'metal hanger', 'fabric hanger'],
          },
          inject: [{ prefix: '3924.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '3924.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('PLASTIC_HOUSEHOLD_HANGER_INTENT: created (plastic hangers/household → 3924.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT28)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT28 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
