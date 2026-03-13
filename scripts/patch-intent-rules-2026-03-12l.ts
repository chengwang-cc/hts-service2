#!/usr/bin/env ts-node
/**
 * Patch L — 2026-03-12:
 *
 * Fix "laser cut wood place card" → empty results:
 *
 * Root cause: AI_CH91_TIME_RECORDER has bare "card" in anyOf → fires allowChapters['91']
 * for ANY query containing the word "card" (place card, business card, playing card, etc.).
 * WOOD_LASER_DECOR_INTENT fires denyChapters['91'].
 * Result: allowChapters restricts to ch.91, denyChapters removes ch.91 → empty.
 *
 * Fixes:
 * 1. AI_CH91_TIME_RECORDER — remove bare "card" from anyOf; it's far too broad.
 *    Replace with "time card" so it only fires for time-recorder queries.
 *    Keep other tokens ("recorder", "punch", "attendance", "timeclock", "timecard").
 *
 * 2. WOOD_LASER_DECOR_INTENT — add allowChapters['44'] so OR logic allows ch.44
 *    entries even when other rules have conflicting allowChapters.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12l.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH91_TIME_RECORDER — remove bare "card" ────────────────────
  {
    priority: 1000,
    rule: {
      id: 'AI_CH91_TIME_RECORDER',
      description: 'Time recorders / punch clocks / attendance machines → ch.91; not greeting cards or place cards',
      pattern: {
        anyOf: [
          'recorder', 'register', 'punch', 'attendance',
          'timeclock', 'timecard', 'time card', 'time recorder', 'punch clock',
          // Removed bare "card" — too broad; fires for "place card", "business card", etc.
        ],
        noneOf: ['dvd', 'blu-ray', 'video', 'audio', 'sound', 'music'],
      },
      whitelist: {
        allowChapters: ['91'],
      },
    },
  },

  // ── 2. Fix WOOD_LASER_DECOR_INTENT — add allowChapters['44'] ─────────────
  {
    priority: 67,
    rule: {
      id: 'WOOD_LASER_DECOR_INTENT',
      description: 'Laser-cut wood / wooden place cards / wood ornaments / wood coasters → ch.44; deny ch.91 (clocks) and ch.95 (toys)',
      pattern: {
        anyOf: [
          'wooden place card', 'wood place card', 'place card holder', 'place cards',
          'laser cut name', 'laser cut names', 'laser engraved wood', 'laser cut wood',
          'wood ornament', 'wooden ornament', 'wood coaster', 'wooden coaster',
          'wood stand', 'wooden stand', 'wood sign', 'wooden sign',
          'wood name tag', 'wood tag', 'name plate wooden', 'table name wooden',
          'basswood', 'balsa wood', 'laser wood blank', 'wood blank', 'wood blanks',
        ],
        noneOf: ['clock', 'watch', 'toy', 'game', 'puzzle', 'flooring', 'floor'],
      },
      inject: [
        { prefix: '4404', syntheticRank: 0 },
        { prefix: '4421', syntheticRank: 3 },
        { prefix: '4419', syntheticRank: 5 },
      ],
      whitelist: {
        allowChapters: ['44'],  // OR logic — compete alongside any other allowChapters rules
        denyChapters: ['91'],
      },
      boosts: [
        { delta: 0.55, chapterMatch: '44' },
      ],
      penalties: [
        { delta: 0.95, chapterMatch: '91' },
        { delta: 0.80, chapterMatch: '95' },
        { delta: 0.70, chapterMatch: '92' },
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

    console.log(`Applying ${PATCHES.length} rule patches (batch L)...`);

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
    console.log(`\nPatch L complete: ${success} applied, ${failed} failed`);
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
