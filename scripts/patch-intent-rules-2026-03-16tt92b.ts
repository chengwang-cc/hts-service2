#!/usr/bin/env ts-node
/**
 * Patch TT92b — 2026-03-16: Fix LAMP_SHADE_LIGHT_FIXTURE_INTENT regressions.
 *
 * BUG: TT92's LAMP_SHADE_LIGHT_FIXTURE_INTENT injects 9405.11 at rank2 for ALL lamp queries.
 *      This overrides correct semantic results for:
 *        "Woven Texture Pendant Lampshade" exp:9405.21 → got forced to 9405.11 (REGRESSION)
 *        "Wooden floor lamp" exp:9405.29 → got forced to 9405.19 (REGRESSION)
 *        "Glass Lamp Shade" exp:9405.91 → got forced to 9405.19 (REGRESSION)
 *        "Plastic LED light diffuser" exp:9405.92 → got forced to 9405.11 (REGRESSION)
 *        "Winding Machine with Drill Adapter for [lamp?]" exp:8445.40 → got 9405.11 (REGRESSION)
 *
 * FIX: Remove ALL inject entries from LAMP_SHADE_LIGHT_FIXTURE_INTENT.
 *      Keep denyChapters:['95','85'] + allowChapters:['94'] to push cross-chapter failures to ch.94.
 *      The semantic/lexical search determines the correct 9405.xx subheading naturally.
 *      Net effect: items wrongly in ch.95/85 → pushed to ch.94 (correct chapter, correct subheading).
 *                  items already in ch.94 → unaffected (no injection to displace).
 *
 * Also narrow the anyOf to avoid matching non-luminaire machinery queries.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt92b.ts
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

    // Redesign LAMP_SHADE_LIGHT_FIXTURE_INTENT: remove inject, keep chapter filtering
    // The inject was causing subheading regressions by overriding correct 9405.xx results.
    // Without inject, the intent still acts as a ch.94 filter (allowChapters) and
    // denyChapters:['95','85'] to push Christmas decorations/electronics to ch.94 luminaires.
    const redesignedRule: IntentRule = {
      id: 'LAMP_SHADE_LIGHT_FIXTURE_INTENT',
      description: 'Lamp shades, light fixtures, luminaires → ch.94 (9405.xx), fix cross-chapter from ch.95/85',
      pattern: {
        anyOf: [
          // Lamp shades (specific enough to avoid machinery false matches)
          'lamp shade', 'lampshade', 'light shade',
          'pendant shade', 'drum shade', 'pendant lampshade',
          'lamp shade glass', 'lamp shade replacement',
          'ceiling light shade', 'floor lamp shade',
          // Ceiling/wall fixtures (specific phrases)
          'ceiling light fixture', 'wall light fixture',
          'ceiling pendant light', 'pendant light',
          // Floor/table lamps (specific)
          'floor lamp', 'table lamp', 'desk lamp',
          'bedside lamp', 'reading lamp',
          // Specialty lamps
          'plasma lamp', 'neon lamp', 'salt lamp',
          'himalayan salt lamp', 'lava lamp',
          'lamp with clock', 'clock lamp',
          // Christmas tree toppers (key cross-chapter fix: ch.95 → ch.94)
          'christmas tree topper', 'lighted tree topper', 'tree topper light',
          'star tree topper', 'angel tree topper lighted',
          // Night lights (cross-chapter fix)
          'night light', 'night lamp', 'plug in night light',
          'handmade night light', 'led night light',
        ],
        noneOf: [
          // Exclude replacement bulbs (ch.85)
          'light bulb', 'led bulb', 'bulb replacement',
          'fluorescent tube',
          // Exclude lamp oil/wicks
          'lamp oil', 'wick',
          // Exclude "string lights" / "fairy lights" / "christmas lights"
          // (these were causing too many cross-subheading issues — let semantic search handle them)
          'battery pack', 'driver board',
          // Exclude winding machines that contain "lamp" in full query
          'winding machine', 'yarn winder', 'thread winder',
        ],
      },
      // NO inject — let semantic search determine the correct 9405.xx subheading
      inject: [],
      whitelist: {
        allowChapters: ['94'],                     // furniture/lamps chapter only
        denyChapters: ['95', '85'],                // deny toys/games and electronics
      },
      boosts: [
        { delta: 0.60, chapterMatch: '94' },       // moderate boost for ch.94
        { delta: 0.50, prefixMatch: '9405.' },     // boost any 9405 result
      ],
      penalties: [
        { delta: 0.70, chapterMatch: '95' },       // strong penalty for toys (Christmas decor)
        { delta: 0.50, chapterMatch: '85' },       // penalty for electronics
      ],
    } as IntentRule;

    await svc.upsertRule(redesignedRule, 539);
    console.log('✅ LAMP_SHADE_LIGHT_FIXTURE_INTENT: redesigned (removed inject, kept ch.94 filter)');
    console.log('   - denyChapters:["95","85"] still routes cross-chapter failures to ch.94');
    console.log('   - No inject means semantic search determines specific 9405.xx subheading');
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
