#!/usr/bin/env ts-node
/**
 * Patch UU — 2026-03-13:
 *
 * Fix ch.68 friction materials EMPTY — three rules fire for the long
 * HTS 6813.89 query "Friction material...sheets rolls strips segments
 * discs washers pads not mounted for brakes...of cellulose...asbestos":
 *
 * 1. SCREW_BOLT_INTENT: "washers" in anyOf fires → allowChapters:[73].
 *    Friction material shapes (washers/pads/discs used in brakes/clutches)
 *    are ch.68, not fastener washers (ch.73). Fix: add noneOf=['brake',
 *    'brakes','clutch','clutches','friction','asbestos'].
 *
 * 2. AI_CH40_RUBBER_GASKET_SEAL: "washers" in anyOf fires → allowChapters:[40].
 *    "Washers" in brake/friction context are mineral/cellulose-based, not rubber.
 *    Fix: add noneOf=['friction','asbestos','mineral substances'].
 *
 * 3. AI_CH47_WOODPULP: "cellulose" fires for "of cellulose whether or not
 *    combined with textile" in friction materials description → allowChapters:[47].
 *    Cellulose as a BASE MATERIAL in friction products is ch.68, not ch.47 pulp.
 *    GARMENT_DENY_COTTON_PULP then denies ch.47 (via "sheets","rolls","strips")
 *    → ch.47 blocked → surviving=[73,40] only → EMPTY (ch.68 not in set).
 *    Fix: add noneOf=['asbestos','friction material','friction materials'].
 *
 * Result: All three rules stop firing → query becomes open → semantic returns
 * correct ch.68 friction material HTS codes.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13uu.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix SCREW_BOLT_INTENT — exclude brake/friction component context ─────────
  {
    priority: 640,
    rule: {
      id: 'SCREW_BOLT_INTENT',
      description: 'Screws, bolts, nuts, washers → ch.73. ' +
        'Added noneOf for brake/friction context: "washers pads...not mounted for ' +
        'brakes...asbestos" (6813.89 ch.68 friction materials) has "washers" → fires ' +
        'allowChapters:[73]. Friction material washers/discs/pads are brake/clutch ' +
        'components (ch.68), not metal fastener washers (ch.73). ' +
        'Also keeps vegetable/plant noneOf from patch KK.',
      pattern: {
        anyOf: [
          'screws', 'screw', 'wood screw', 'machine screw', 'self-tapping screw',
          'bolts', 'bolt', 'hex bolt', 'carriage bolt',
          'nuts', 'hex nut', 'lock nut', 'wing nut',
          'washers', 'washer', 'flat washer',
        ],
        noneOf: [
          'firearms', 'firearm', 'pistol', 'revolver', 'revolvers',
          'rifle', 'rifles', 'shotgun', 'shotguns', 'military weapons',
          'military weapon', 'carbine', 'muzzle-loading', 'ammunition',
          'blank ammunition', 'captive-bolt', 'captive',
          // Vegetable/plant context (from patch KK)
          'vegetable', 'vegetables', 'fruit', 'fruits', 'plant', 'plants',
          'botanical', 'edible', 'food', 'peel', 'flesh', 'kernel', 'kernels',
          // Brake/friction component context → ch.68
          'brake', 'brakes', 'clutch', 'clutches', 'friction', 'asbestos',
        ],
      },
      whitelist: { allowChapters: ['73'] },
    },
  },

  // ── 2. Fix AI_CH40_RUBBER_GASKET_SEAL — exclude friction/asbestos context ───────
  {
    priority: 640,
    rule: {
      id: 'AI_CH40_RUBBER_GASKET_SEAL',
      description: 'Rubber gaskets, washers, O-rings, seals → ch.40. ' +
        'Added noneOf for friction/asbestos context: friction material washers ' +
        '(ch.68) have "washers" in the description → fires allowChapters:[40]. ' +
        'Friction material washers/pads are mineral/cellulose-based (ch.68), ' +
        'not rubber (ch.40). Key discriminator: "friction","asbestos".',
      pattern: {
        anyOf: [
          'gasket', 'gaskets', 'washer', 'washers', 'oring', 'orings',
          'seal', 'seals', 'grommet', 'grommets',
        ],
        noneOf: [
          // Brake/friction component context → ch.68
          'friction', 'asbestos', 'mineral substances', 'mineral substance',
          'brake', 'brakes', 'clutch', 'clutches',
        ],
      },
      whitelist: { allowChapters: ['40'] },
    },
  },

  // ── 3. Fix AI_CH47_WOODPULP — exclude asbestos/friction cellulose context ───────
  {
    priority: 640,
    rule: {
      id: 'AI_CH47_WOODPULP',
      description: 'Wood pulp, cellulose pulp for papermaking → ch.47. ' +
        'Added noneOf for asbestos/friction context: "of cellulose whether or not ' +
        'combined with textile" in friction material descriptions (6813.89 ch.68) ' +
        'has "cellulose" → fires allowChapters:[47]. Cellulose as a BASE MATERIAL ' +
        'in friction products is ch.68, not ch.47 pulp. ' +
        'Also keeps machinery noneOf (JJ) and film noneOf (SS).',
      pattern: {
        anyOf: [
          'pulp', 'woodpulp', 'wood pulp', 'cellulose', 'dissolving',
          'kraft pulp', 'kraft wood pulp', 'sulfite pulp', 'sulfate pulp', 'soda pulp',
          'coniferous pulp', 'nonconiferous pulp', 'chemical pulp', 'mechanical pulp',
          'chemi-mechanical', 'dissolving grades',
        ],
        noneOf: [
          'hoopwood', 'chipwood', 'poles', 'piles', 'stakes', 'lumber', 'timber',
          'sawn', 'joinery', 'carpentry', 'plywood', 'veneer', 'boards', 'planks',
          'wrapping paper', 'tissue', 'printing paper', 'writing paper',
          'bags', 'sacks', 'boxes', 'cartons',
          // Machinery context → ch.84 (from JJ)
          'machinery', 'machines', 'equipment', 'apparatus', 'calender',
          'pressing', 'winding', 'drying machine',
          // Cellulose derivative plastic film context → ch.39 (from SS)
          'cellulose derivative', 'cellulose derivatives',
          'cellulose acetate', 'cellophane', 'film', 'film strip',
          // Asbestos/friction material context → ch.68
          'asbestos', 'friction material', 'friction materials',
          'brake', 'brakes', 'clutch', 'clutches',
        ],
      },
      whitelist: { allowChapters: ['47'] },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch UU)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch UU complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
