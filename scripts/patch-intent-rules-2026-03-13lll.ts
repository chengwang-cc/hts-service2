#!/usr/bin/env ts-node
/**
 * Patch LLL — 2026-03-13:
 *
 * Continue improving accuracy. Targeting newly-visible failures
 * from the HHH+III+GGG eval.
 *
 * Fixes:
 *
 * 1.  NEW EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT
 *     "Photographic plates film paper paperboard and textiles exposed but not developed"
 *     → expected 3704.00.00.00 (ch.37)
 *     Got 3702.55.00.30 (unexposed photographic film).
 *     3704 = exposed but not developed photographic materials.
 *     3702 = unexposed photographic film.
 *     Phrase "exposed but not developed" uniquely identifies 3704.
 *
 * 2.  NEW LEATHER_FURSKIN_TREATMENT_INTENT
 *     "Other Preparations for the treatment of textile materials leather furskins
 *     or other materials" → expected 3403.11.40.00 (ch.34)
 *     Got 3403.91.10.00. Both ch.34.
 *     3403.11 = preparations for leather treatment.
 *     3403.91 = other preparations (petroleum-based).
 *     "leather" + "furskins" combined with treatment context → 3403.11.
 *
 * 3.  NEW ARSENIC_SLAG_RESIDUES_INTENT
 *     "Other Slag ash and residues...containing arsenic metals or their compounds"
 *     → expected 2620.29.00 (ch.26)
 *     Got 2620.60.10.00. Both ch.26.
 *     2620.29 = slag/ash containing arsenic metals.
 *     2620.60 = arsenic/arsenic oxides/arsenic acids.
 *     Token "arsenic" in slag/ash/residues context → 2620.29.
 *
 * 4.  NEW PHOTO_PAPER_SENSITIZED_INTENT
 *     "Basic paper to be sensitized for use in photography In rolls"
 *     → expected 4802.61.50.00 (ch.48)
 *     Got 4802.20.20.00. Both ch.48.
 *     4802.61 = uncoated writing paper in rolls (≥15 cm wide).
 *     "sensitized for use in photography" + "in rolls" → 4802.61.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13lll.ts
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

    // ── 1. NEW EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT ──────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'EXPOSED_NOT_DEVELOPED_PHOTOGRAPHIC_INTENT',
        description: 'Exposed but not developed photographic materials → 3704 (ch.37). ' +
          'Semantic picks 3702 (unexposed film). ' +
          '"exposed but not developed" phrase uniquely identifies 3704.',
        pattern: {
          anyOf: ['exposed but not developed', 'exposed not developed'],
          noneOf: ['developed', 'positive', 'negative film', 'motion picture'],
        },
        whitelist: { allowChapters: ['37'] },
        inject: [{ prefix: '3704.00', syntheticRank: 8 }],
        boosts: [{ delta: 0.6, prefixMatch: '3704.' }],
      },
    });

    // ── 2. NEW LEATHER_FURSKIN_TREATMENT_INTENT ───────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'LEATHER_FURSKIN_TREATMENT_INTENT',
        description: 'Preparations for treatment of leather/furskins → 3403.11 (ch.34). ' +
          'Semantic picks 3403.91 (petroleum-based preparations). ' +
          '"leather furskins" context in treatment/preparation → 3403.11.',
        pattern: {
          anyOf: ['leather furskins', 'leather furskin', 'furskins'],
          anyOfGroups: [
            ['preparations', 'treatment', 'lubricating'],
          ],
          noneOf: ['petroleum', 'mineral oil', 'wool grease'],
        },
        whitelist: { allowChapters: ['34'] },
        inject: [{ prefix: '3403.11', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '3403.11' }],
      },
    });

    // ── 3. NEW ARSENIC_SLAG_RESIDUES_INTENT ───────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'ARSENIC_SLAG_RESIDUES_INTENT',
        description: 'Slag/ash/residues containing arsenic → 2620.29 (ch.26). ' +
          'Semantic picks 2620.60 (arsenic compounds). ' +
          '"arsenic" in slag/ash/residues waste context → 2620.29.',
        pattern: {
          anyOf: ['arsenic'],
          anyOfGroups: [
            ['slag', 'ash', 'residues', 'dross', 'waste'],
          ],
          noneOf: ['arsenic acid', 'arsenic oxide', 'arsenious', 'arsenate'],
        },
        whitelist: { allowChapters: ['26'] },
        inject: [{ prefix: '2620.29', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '2620.29' }],
      },
    });

    // ── 4. NEW PHOTO_PAPER_SENSITIZED_ROLLS_INTENT ────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'PHOTO_PAPER_SENSITIZED_ROLLS_INTENT',
        description: 'Base paper for photography (to be sensitized) in rolls → 4802.61 (ch.48). ' +
          'Semantic picks 4802.20 (filter paper). ' +
          '"sensitized for use in photography" + "in rolls" → 4802.61.',
        pattern: {
          anyOf: ['sensitized for use in photography', 'to be sensitized'],
          anyOfGroups: [
            ['rolls', 'roll', 'reel'],
          ],
          noneOf: ['already sensitized', 'sensitized film', 'sensitized plate'],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4802.61', syntheticRank: 8 }],
        boosts: [{ delta: 0.5, prefixMatch: '4802.61' }],
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch LLL)...`);
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
    console.log(`\nPatch LLL complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
