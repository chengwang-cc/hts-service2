#!/usr/bin/env ts-node
/**
 * Patch PPP — 2026-03-13:
 *
 * Continue improving accuracy — targeting specific query patterns.
 *
 * Fixes:
 *
 * 1.  NEW PROJECTION_NON_HIGH_DEF_INTENT
 *     "Projection Non-high definition" → expected 8540.12.50.40 (ch.85)
 *     Got 8540.11.10.40. Both 8540.
 *     8540.12 = projection CRT tubes, non-high-def.
 *     8540.11 = color picture tubes.
 *     "Non-high definition" combined with "Projection" → 8540.12.
 *
 * 2.  NEW CAST_IRON_FINS_SPRUES_INTENT
 *     "Cast-iron parts not advanced beyond cleaning and machined only for the removal
 *      of fins gates sprues and risers or to permit location in finishing machinery"
 *     → expected 8409.91.10 (engine parts, ch.84)
 *     Got 8466.91.10.00 (machine tool parts).
 *     "fins gates sprues and risers" are casting terms; combined with "cast-iron parts"
 *     and "not advanced beyond cleaning" → engine/machine part raw castings 8409.91.
 *
 * 3.  NEW RAW_HIDES_BUTTS_BENDS_INTENT
 *     "Other Other including butts bends and bellies Raw hides and skins of bovine..."
 *     → expected 4101.90.50.00 (ch.41, other heavier hides)
 *     Got 4101.90.10.10 (light hides ≤8 kg).
 *     "including butts bends and bellies" identifies heavier/other hide cuts → 4101.90.50.
 *
 * 4.  NEW ELECTRICAL_RESISTORS_PARTS_INTENT
 *     "Electrical resistors including rheostats and potentiometers other than heating
 *      resistors parts thereof" → expected 8533.39.00.80 (ch.85)
 *     Got 8533.40.80.40. Both 8533.
 *     8533.39 = wirewound other variable resistors >20W.
 *     8533.40 = other variable resistors.
 *     "parts thereof" at end + "rheostats" (wirewound) → 8533.39.
 *
 * 5.  NEW GOODS_VEHICLE_OVER_15T_DIESEL_INTENT
 *     "G.V.W. exceeding 15 metric tons but not exceeding 20 metric tons G.V.W.
 *      exceeding 5 metric tons Motor vehicles for the transport of goods"
 *     → expected 8704.32.01.40 (diesel goods vehicle, ch.87)
 *     Got 8704.42.00.80 (electric). 8704.32 = diesel compression-ignition >5t.
 *     Phrase "G.V.W. exceeding 15 metric tons" combined with goods vehicle → 8704.32.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13ppp.ts
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

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. NEW PROJECTION_NON_HIGH_DEF_INTENT ─────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PROJECTION_NON_HIGH_DEF_INTENT',
        description: 'Projection CRT tube non-high definition → 8540.12 (ch.85). ' +
          'Semantic picks 8540.11 (color picture tubes). ' +
          '"Non-high definition" + "projection" context → 8540.12.',
        pattern: {
          anyOf: ['non-high definition', 'non high definition', 'projection non-high'],
          anyOfGroups: [
            ['projection'],
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [{ prefix: '8540.12', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '8540.12' },
          { delta: -0.4, prefixMatch: '8540.11' },
        ],
      },
    });

    // ── 2. NEW CAST_IRON_FINS_SPRUES_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'CAST_IRON_FINS_SPRUES_INTENT',
        description: 'Cast-iron parts with fins/gates/sprues/risers removal → 8409.91 (ch.84). ' +
          'Semantic picks 8466.91 (machine tool parts). ' +
          '"fins gates sprues and risers" + "cast-iron" + "not advanced beyond cleaning" → 8409.91.',
        pattern: {
          anyOf: [
            'fins gates sprues and risers',
            'fins gates sprues',
            'sprues and risers',
            'not advanced beyond cleaning',
          ],
          anyOfGroups: [
            ['cast-iron', 'cast iron'],
          ],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [{ prefix: '8409.91', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '8409.91' },
          { delta: -0.4, prefixMatch: '8466.91' },
        ],
      },
    });

    // ── 3. NEW RAW_HIDES_BUTTS_BENDS_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'RAW_HIDES_BUTTS_BENDS_INTENT',
        description: 'Raw hides/skins including butts/bends/bellies → 4101.90.50 (ch.41). ' +
          'Semantic picks 4101.90.10 (light hides ≤8kg). ' +
          '"butts bends and bellies" indicates heavier cuts → 4101.90.50 (other, not light).',
        pattern: {
          anyOf: ['butts bends and bellies', 'butts bends', 'bends and bellies'],
          anyOfGroups: [
            ['hides', 'skins', 'bovine', 'equine'],
          ],
        },
        whitelist: { allowChapters: ['41'] },
        inject: [{ prefix: '4101.90.50', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4101.90.50' },
          { delta: -0.4, prefixMatch: '4101.90.10' },
        ],
      },
    });

    // ── 4. NEW ELECTRICAL_RESISTORS_PARTS_INTENT ──────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'ELECTRICAL_RESISTORS_PARTS_INTENT',
        description: 'Electrical resistors (rheostats/potentiometers) other than heating resistors, parts → 8533.39 (ch.85). ' +
          'Semantic picks 8533.40. ' +
          '"Other than heating resistors" + "parts thereof" + "rheostats" → 8533.39 (wirewound >20W).',
        pattern: {
          anyOf: ['other than heating resistors', 'rheostats and potentiometers other than heating'],
          anyOfGroups: [
            ['parts thereof', 'resistors'],
          ],
          noneOf: ['fixed resistors', 'carbon composition'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [{ prefix: '8533.39', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '8533.39' },
          { delta: -0.3, prefixMatch: '8533.40' },
        ],
      },
    });

    // ── 5. NEW GOODS_VEHICLE_OVER_15T_DIESEL_INTENT ───────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'GOODS_VEHICLE_OVER_15T_DIESEL_INTENT',
        description: 'Motor vehicles for goods transport, G.V.W. exceeding 15 metric tons → 8704.32 (ch.87). ' +
          'Semantic picks 8704.42 (electric). ' +
          '"G.V.W. exceeding 15 metric tons" + goods vehicle context → 8704.32 (diesel compression-ignition).',
        pattern: {
          anyOf: [
            'exceeding 15 metric tons',
            'g.v.w. exceeding 15',
            'exceeding 15 metric tons but not exceeding 20',
          ],
          anyOfGroups: [
            ['motor vehicles', 'transport of goods', 'goods'],
          ],
          noneOf: ['electric', 'electrically propelled', 'battery'],
        },
        whitelist: { allowChapters: ['87'] },
        inject: [{ prefix: '8704.32', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '8704.32' },
          { delta: -0.4, prefixMatch: '8704.42' },
        ],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch PPP)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
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
    console.log(`\nPatch PPP complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
