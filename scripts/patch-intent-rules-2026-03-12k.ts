#!/usr/bin/env ts-node
/**
 * Patch K — 2026-03-12:
 *
 * Fix four conflicts discovered after Patch J verification:
 *
 * 1. Fix AI_CH89_SAILBOAT — bare "laser" in anyOf fires allowChapters['89'] for
 *    "laser cut wood place card", "laser engraved wood" etc. (Laser is a sailboat brand).
 *    Fix: remove bare "laser"; replace with "laser class", "laser sailboat", "laser dinghy";
 *    add noneOf for wood/cut/engraving context.
 *
 * 2. Fix FRESH_FLOWER_INTENT — "rose" fires allowChapters['06'] (live flowers) for
 *    "rose quartz", blocking CRYSTAL_GEMSTONE_INTENT's ch.71 results.
 *    Fix: add noneOf for gemstone/mineral/crystal context.
 *
 * 3. Fix PHONE_ACCESSORY_INTENT — "case"/"cover" in anyOfGroups group 2 causes it to fire
 *    for "phone case"/"custom phone case" queries, giving ch.42 a net penalty (-0.65 + 0.60 = -0.05)
 *    while ch.39 gets +1.00. PHONE_CASE_INTENT (ch.42) can never win.
 *    Fix: remove 'case', 'cases', 'cover', 'covers' from group 2 so PHONE_ACCESSORY_INTENT
 *    doesn't fire for phone-case queries; PHONE_CASE_INTENT's allowChapters['42'] then wins.
 *
 * 4. Fix FRESH_FLOWER_INTENT boost — reduce ch.06 boost from 0.85 to 0.50 so it doesn't
 *    dominate scoring for ambiguous terms like "flower arrangement" (artificial flowers
 *    should go to ch.67, not ch.06).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12k.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH89_SAILBOAT — remove bare "laser" ────────────────────────
  {
    priority: 1000,
    rule: {
      id: 'AI_CH89_SAILBOAT',
      description: 'Sailboats / watercraft → ch.89; not laser-cut crafts or wood products',
      pattern: {
        anyOf: [
          'sailboat', 'sailing', 'sailfish', 'dinghy', 'dingies', 'sloop',
          'catamaran', 'trimaran', 'schooner', 'ketch', 'yacht', 'yawl',
          'sunfish', 'centerboard',
          // "Laser" is a sailboat class — require context words to avoid firing for laser-cut crafts
          'laser class', 'laser sailboat', 'laser dinghy', 'laser pico',
          'laser radial', 'laser standard',
        ],
        noneOf: [
          // laser-cut/laser-engraved wood products
          'laser cut', 'laser engraved', 'laser engrave', 'laser wood',
          'wood blank', 'wood blanks', 'wooden', 'basswood', 'balsa',
          'place card', 'coaster', 'ornament', 'sign', 'engraving',
          'acrylic', 'plywood',
        ],
      },
      whitelist: {
        allowChapters: ['89'],
      },
      boosts: [
        { delta: 0.5, chapterMatch: '89' },
      ],
    },
  },

  // ── 2. Fix FRESH_FLOWER_INTENT — exclude gemstone/mineral context ─────────
  {
    priority: 67,
    rule: {
      id: 'FRESH_FLOWER_INTENT',
      description: 'Fresh/cut flowers → ch.06 (live plants); not gemstone roses or crystal flowers',
      pattern: {
        anyOf: [
          'rose', 'roses', 'orchid', 'orchids', 'tulip', 'tulips',
          'lily', 'lilies', 'carnation', 'carnations', 'flower', 'flowers',
          'bouquet', 'chrysanthemum',
        ],
        noneOf: [
          // artificial/decorative flowers → ch.67
          'artificial', 'silk', 'fake', 'faux', 'plastic', 'dried', 'preserved',
          // gemstone/mineral context — e.g. "rose quartz", "crystal flower"
          'quartz', 'crystal', 'stone', 'stones', 'mineral', 'gemstone', 'gem',
          'amethyst', 'obsidian', 'selenite', 'fluorite', 'calcite', 'agate',
          // other non-flower contexts
          'pot', 'vase', 'print', 'pattern', 'fabric', 'wallpaper',
        ],
      },
      whitelist: {
        allowChapters: ['06'],
      },
      boosts: [
        { delta: 0.50, chapterMatch: '06' },
      ],
      penalties: [
        { delta: 0.8, chapterMatch: '39' },
        { delta: 0.8, chapterMatch: '73' },
      ],
    },
  },

  // ── 3. Fix PHONE_ACCESSORY_INTENT — remove 'case'/'cover' from group 2 ───
  {
    priority: 7,
    rule: {
      id: 'PHONE_ACCESSORY_INTENT',
      description: 'Phone stands / holders / grips / mounts → ch.39 (3926.90); not phone cases (handled by PHONE_CASE_INTENT)',
      pattern: {
        anyOfGroups: [
          ['phone', 'smartphone', 'iphone'],
          // Removed 'case', 'cases', 'cover', 'covers' — phone cases go to ch.42 via PHONE_CASE_INTENT
          ['stand', 'holder', 'grip', 'mount', 'silicone', 'pop socket', 'popsocket',
           'ring holder', 'phone grip', 'phone stand', 'phone mount'],
        ],
      },
      whitelist: {
        allowPrefixes: ['3926.'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '39' },
        { delta: 0.45, prefixMatch: '3926.90' },
      ],
      penalties: [
        { delta: 0.65, chapterMatch: '42' },
        {
          delta: 0.55,
          chapterMatch: '85',
          entryMustHaveAnyToken: ['loudspeaker', 'microphone', 'amplifier'],
        },
        {
          delta: 0.55,
          chapterMatch: '39',
          denyPrefixMatch: '3926.90',
          entryMustHaveAnyToken: ['primary', 'sheet', 'film', 'foil', 'plate'],
        },
      ],
    },
  },
];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch K)...`);

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
    console.log(`\nPatch K complete: ${success} applied, ${failed} failed`);
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
