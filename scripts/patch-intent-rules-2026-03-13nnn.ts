#!/usr/bin/env ts-node
/**
 * Patch NNN — 2026-03-13:
 *
 * Continue improving accuracy.
 *
 * Fixes:
 *
 * 1.  NEW UNCOATED_PAPER_GRAPHIC_INTENT
 *     "Other Other Uncoated paper and paperboard of a kind used for writing
 *     printing or other graphic purposes and non perforated punch-cards and
 *     punch tape paper in rolls or rectangular including square sheets of any
 *     size other than paper of heading 4801 or 4803 hand-made paper and paperboard"
 *     → expected 4802.69.30.00 (ch.48)
 *     Got 4802.10.00.00 (handmade paper). Both ch.48.
 *     The heading description includes "hand-made paper" causing semantic to
 *     pick 4802.10 (handmade). "punch tape" and "punchcards" are distinctive
 *     signals in this heading description → 4802.69.
 *
 * 2.  NEW TOBACCO_UNSTEMMED_INTENT
 *     "Other Tobacco not stemmed/stripped" → expected 2401.10.29 (ch.24)
 *     Got 2401.10.61.30. Both in 2401.10 (not stemmed/stripped).
 *     Pure semantic picks the wrong subheading within 2401.10.
 *     "not stemmed stripped" context + noneOf cigarette leaf/flue-cured/virginia
 *     → boost 2401.10.29 (other unstemmed tobacco).
 *
 * 3.  NEW RETREADED_TIRES_OTHER_INTENT
 *     "Other Other Retreaded or used pneumatic tires of rubber solid or cushion
 *     tires tire treads and tire flaps of rubber" → expected 4012.19.80.00 (ch.40)
 *     Got 4012.90.10.00. Both ch.40.
 *     The AI_CH40_RETREADED_TIRES now has inject+boosts for 4012.19.
 *     If still failing, add an extra stronger boost specifically for the
 *     "solid or cushion tires" query to prevent 4012.90 from winning.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13nnn.ts
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

    // ── 1. NEW UNCOATED_PAPER_GRAPHIC_INTENT ──────────────────────────────────
    // "punch-cards" tokenizes to 'punchcards'; "punch tape" is a phrase
    patches.push({
      priority: 660,
      rule: {
        id: 'UNCOATED_PAPER_GRAPHIC_INTENT',
        description: 'Uncoated writing/printing paper with punch-cards/tape context → 4802.69 (ch.48). ' +
          'Semantic picks 4802.10 (handmade) because heading mentions "hand-made paper". ' +
          '"punch tape" / "punchcards" uniquely identify 4802.69 (other writing paper).',
        pattern: {
          anyOf: ['punch tape', 'punchcards', 'punch cards'],
          anyOfGroups: [
            ['uncoated', 'writing', 'graphic', 'printing'],
          ],
        },
        whitelist: { allowChapters: ['48'] },
        inject: [{ prefix: '4802.69', syntheticRank: 8 }],
        boosts: [
          { delta: 0.6, prefixMatch: '4802.69' },
          { delta: -0.5, prefixMatch: '4802.10' },
        ],
      },
    });

    // ── 2. NEW TOBACCO_UNSTEMMED_OTHER_INTENT ────────────────────────────────
    patches.push({
      priority: 660,
      rule: {
        id: 'TOBACCO_UNSTEMMED_OTHER_INTENT',
        description: 'Other unstemmed/unstripped tobacco → 2401.10.29 (ch.24). ' +
          'Semantic picks wrong subheading within 2401.10. ' +
          '"not stemmed" + no cigarette/flue-cured/virginia context → 2401.10.29.',
        pattern: {
          anyOf: ['not stemmed'],
          anyOfGroups: [
            ['tobacco'],
          ],
          noneOf: [
            'cigarette leaf', 'flue-cured', 'virginia', 'burley',
            'dark air', 'oriental', 'partly stemmed', 'wholly stemmed',
            'partly or wholly', 'fire-cured',
          ],
        },
        whitelist: { allowChapters: ['24'] },
        inject: [{ prefix: '2401.10.29', syntheticRank: 8 }],
        boosts: [{ delta: 0.4, prefixMatch: '2401.10.29' }],
      },
    });

    // ── 3. Check if retreaded/used tires 4012.19 is still failing ─────────────
    // GGG added 4012.19 specific boost (delta 0.5) to retreaded rules.
    // If still failing, we might need to add a penalty for 4012.90.
    // This patch adds a moderate penalty for 4012.90 when retreaded query is present.
    const retreaded1 = svc.getAllRules().find(r => r.id === 'AI_CH40_RETREADED_TIRES') as IntentRule | undefined;
    if (retreaded1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingBoosts = (retreaded1.boosts ?? []) as any[];
      // Add penalty for 4012.90 to prevent it from winning over 4012.19
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasPenalty = (retreaded1.penalties ?? []).some((p: any) => p.prefixMatch === '4012.90');
      if (!hasPenalty) {
        patches.push({
          priority: 640,
          rule: {
            ...retreaded1,
            boosts: existingBoosts,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            penalties: [...((retreaded1.penalties ?? []) as any[]), { delta: 0.3, prefixMatch: '4012.90' }],
          },
        });
      }
    }

    console.log(`Applying ${patches.length} rule patches (batch NNN)...`);
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
    console.log(`\nPatch NNN complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
