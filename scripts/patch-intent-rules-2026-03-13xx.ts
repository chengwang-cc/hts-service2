#!/usr/bin/env ts-node
/**
 * Patch XX — 2026-03-13:
 *
 * Fix remaining cross-chapter routing failures after patch WW.
 * Starting accuracy: 86.86% (608/700), 2 empty results.
 *
 * Root causes and fixes:
 *
 * 1.  AI_CH75_NICKEL_BAR_ROD_WIRE: 'copper-nickel' in noneOf doesn't work because
 *     tokenizer strips hyphens: 'copper-nickel'→'coppernickel' (token).
 *     Replace with 'coppernickel','cupronickel', and add 'copper','brass','bronze'.
 *
 * 2.  NEW COPPER_BAR_ROD_INTENT: copper/brass/bronze + bar/rod → ch.74
 *     Fixes "copper-nickel bars/rods" routed to ch.79 (zinc)
 *
 * 3.  NEW HAIR_CLIPPER_INTENT: hair + clipper/clippers → ch.85
 *     Fixes "parts of hair clippers" routed to ch.96
 *
 * 4.  AI_CH40_RUBBER_CELLULAR_FOAM: add noneOf phrase 'whether or not covered'
 *     Fixes "cellular rubber whether or not covered" (ch.94 mattresses) routed to ch.40
 *
 * 5.  CARDBOARD_PAPER_INTENT: add noneOf 'photographic'
 *     Fixes "Photographic plates film paperboard...not developed" (ch.37) routed to ch.48
 *
 * 6.  AI_CH37_PHOTO_FILM_35MM: add allowChapters:[37]
 *     So photographic media queries include ch.37 in allowSet
 *
 * 7.  AI_CH37_DEVELOPED_FILM_SLIDES: add allowChapters:[37]
 *
 * 8.  AI_CH53_BURLAP_HESSIAN: add allowChapters:[53]
 *     Fixes "Woven fabrics of jute" (ch.53) routed to ch.64
 *
 * 9.  AI_CH64_ESPADRILLE: add noneOf phrases for textile/woven context
 *     Prevents jute textile fabrics from triggering the espadrille footwear rule
 *
 * 10. AI_CH56_TWINE_BALER: add noneOf phrases for textile/woven context
 *     Prevents jute textile fabrics from triggering twine rule
 *
 * 11. JAM_PRESERVE_INTENT: add noneOf 'petroleum','petrolatum','paraffin'
 *     Fixes "Petroleum jelly paraffin wax" (ch.27) routed to ch.20
 *
 * 12. PRESERVED_FOOD_CH20_INTENT: same fix
 *
 * 13. AI_CH92_TUNING_FORK_PITCH_PIPE: change bare 'fork'/'forks' to phrases
 *     Fixes "Mattocks picks hoes forks rakes" (ch.82 hand tools) routed to ch.92
 *
 * 14. NEW VANADIUM_SLAG_ORE_INTENT: "containing mainly vanadium" → ch.26
 *     Fixes "Containing mainly vanadium Other" (ch.26 slag) routed to ch.81
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13xx.ts
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
    const allRules = svc.getAllRules();

    function getExisting(id: string): IntentRule | undefined {
      return allRules.find((r) => r.id === id) as IntentRule | undefined;
    }

    // Helper: merge additional noneOf terms into an existing rule's pattern
    function addNoneOf(existing: IntentRule, extraNoneOf: string[]): IntentRule {
      const pat = existing.pattern as Record<string, unknown>;
      const existingNoneOf: string[] = (pat.noneOf as string[]) ?? [];
      const merged = Array.from(new Set([...existingNoneOf, ...extraNoneOf]));
      return { ...existing, pattern: { ...pat, noneOf: merged } };
    }

    // Helper: set or add allowChapters to a rule's whitelist
    function addAllowChapters(existing: IntentRule, chapters: string[]): IntentRule {
      const wl = (existing.whitelist as Record<string, unknown>) ?? {};
      const existing_allow: string[] = (wl.allowChapters as string[]) ?? [];
      const merged = Array.from(new Set([...existing_allow, ...chapters]));
      return { ...existing, whitelist: { ...wl, allowChapters: merged } };
    }

    type Patch = { rule: IntentRule; priority: number };
    const patches: Patch[] = [];

    // ── 1. AI_CH75_NICKEL_BAR_ROD_WIRE — fix hyphenated noneOf tokens ────────────
    // 'copper-nickel' in noneOf is checked as tokens.has('copper-nickel') but the
    // tokenizer strips hyphens so the token is 'coppernickel'. Must use the stripped form.
    patches.push({
      priority: 640,
      rule: {
        id: 'AI_CH75_NICKEL_BAR_ROD_WIRE',
        description:
          'Nickel bars, rods, wire, profiles → ch.75. ' +
          'WW: Added cupro/copper-nickel noneOf (but hyphen issue — those tokens do not match). ' +
          'XX: Replaced copper-nickel→coppernickel, cupro→cupronickel (token forms), ' +
          'added copper/brass/bronze so copper-dominant alloys route to ch.74 instead.',
        pattern: {
          anyOf: [
            'bar', 'bars', 'rod', 'rods', 'wire', 'profile', 'profiles',
            'round', 'hex', 'hexagonal', 'stock',
          ],
          noneOf: [
            'percent', 'percentage', 'by weight', 'weight of', 'weight of nickel',
            'containing', 'alloy', 'stainless', 'steel', 'iron',
            // copper-dominant alloys → ch.74 not ch.75
            'copper', 'brass', 'bronze', 'cupronickel', 'coppernickel',
          ],
          required: ['nickel'],
        },
        whitelist: { allowChapters: ['75'] },
      },
    });

    // ── 2. NEW COPPER_BAR_ROD_INTENT — copper/brass/bronze bars/rods → ch.74 ────
    patches.push({
      priority: 650,
      rule: {
        id: 'COPPER_BAR_ROD_INTENT',
        description:
          'Copper/brass/bronze bars, rods, profiles → ch.74. ' +
          'Fixes copper-nickel (cupro-nickel) bars routed to ch.79 (zinc) or ch.75 (nickel). ' +
          'anyOfGroups: must match copper-family metal AND bar/rod/profile shape.',
        pattern: {
          anyOfGroups: [
            ['copper', 'brass', 'bronze', 'cupronickel', 'coppernickel', 'gunmetal'],
            ['bar', 'bars', 'rod', 'rods', 'profile', 'profiles'],
          ],
          noneOf: [
            // Organ pipes / musical instruments → ch.92
            'organ', 'flute', 'clarinet',
            // Vacuum tube / electron tube → ch.85
            'electron', 'vacuum tube', 'cathode',
          ],
        },
        whitelist: { allowChapters: ['74'] },
      },
    });

    // ── 3. NEW HAIR_CLIPPER_INTENT — hair clippers → ch.85 ─────────────────────
    patches.push({
      priority: 650,
      rule: {
        id: 'HAIR_CLIPPER_INTENT',
        description:
          'Hair clippers (electric, hand-operated) → ch.85. ' +
          'Parts of hair clippers classified 8510 (ch.85). Without this rule, semantic ' +
          'confuses "hair clippers" with ch.96 misc. articles. ' +
          'anyOfGroups: must match "hair" AND "clipper/clippers".',
        pattern: {
          anyOfGroups: [
            ['hair'],
            ['clipper', 'clippers'],
          ],
        },
        whitelist: { allowChapters: ['85'] },
      },
    });

    // ── 4. AI_CH40_RUBBER_CELLULAR_FOAM — exclude furniture/bedding context ─────
    {
      const ex = getExisting('AI_CH40_RUBBER_CELLULAR_FOAM');
      if (ex) {
        patches.push({
          priority: 640,
          rule: addNoneOf(ex, [
            // ch.94 mattresses/cushions phrase → cellular rubber or plastics whether or not covered
            'whether or not covered',
          ]),
        });
      }
    }

    // ── 5. CARDBOARD_PAPER_INTENT — exclude photographic media ─────────────────
    {
      const ex = getExisting('CARDBOARD_PAPER_INTENT');
      if (ex) {
        patches.push({
          priority: 640,
          rule: addNoneOf(ex, ['photographic', 'photograph', 'photography']),
        });
      }
    }

    // ── 6. AI_CH37_PHOTO_FILM_35MM — add allowChapters:[37] ────────────────────
    {
      const ex = getExisting('AI_CH37_PHOTO_FILM_35MM');
      if (ex) {
        patches.push({ priority: 640, rule: addAllowChapters(ex, ['37']) });
      }
    }

    // ── 7. AI_CH37_DEVELOPED_FILM_SLIDES — add allowChapters:[37] ──────────────
    {
      const ex = getExisting('AI_CH37_DEVELOPED_FILM_SLIDES');
      if (ex) {
        patches.push({ priority: 640, rule: addAllowChapters(ex, ['37']) });
      }
    }

    // ── 8. AI_CH53_BURLAP_HESSIAN — add allowChapters:[53] ─────────────────────
    // Without allowChapters, this rule fires for jute fabrics but adds nothing to allowSet.
    // AI_CH64_ESPADRILLE fires for 'jute' → allowSet=[64] → ch.53 excluded.
    // Fix: give AI_CH53_BURLAP_HESSIAN allowChapters:[53] so it contributes to allowSet.
    {
      const ex = getExisting('AI_CH53_BURLAP_HESSIAN');
      if (ex) {
        patches.push({ priority: 640, rule: addAllowChapters(ex, ['53']) });
      }
    }

    // ── 9. AI_CH64_ESPADRILLE — exclude jute textile woven fabric context ───────
    // 'jute' in anyOf fires for woven jute fabrics (ch.53), not just espadrille shoes.
    // Add noneOf for textile/woven context to prevent misrouting.
    {
      const ex = getExisting('AI_CH64_ESPADRILLE');
      if (ex) {
        patches.push({
          priority: 640,
          rule: addNoneOf(ex, [
            'woven fabric', 'woven fabrics',
            'bast fibers', 'bast fibres',
            'textile bast',
            'heading 5303',
            'woven',  // if query has 'woven' + 'jute' it's textile ch.53 not footwear ch.64
          ]),
        });
      }
    }

    // ── 10. AI_CH56_TWINE_BALER — exclude woven textile fabric context ──────────
    {
      const ex = getExisting('AI_CH56_TWINE_BALER');
      if (ex) {
        patches.push({
          priority: 640,
          rule: addNoneOf(ex, [
            'woven fabric', 'woven fabrics',
            'bast fibers', 'bast fibres',
            'textile bast',
            'heading 5303',
          ]),
        });
      }
    }

    // ── 11. JAM_PRESERVE_INTENT — exclude petroleum/mineral wax ────────────────
    // 'jelly' fires for "petroleum jelly" in paraffin wax queries (ch.27)
    {
      const ex = getExisting('JAM_PRESERVE_INTENT');
      if (ex) {
        patches.push({
          priority: 640,
          rule: addNoneOf(ex, ['petroleum', 'petrolatum', 'paraffin', 'mineral', 'wax']),
        });
      }
    }

    // ── 12. PRESERVED_FOOD_CH20_INTENT — exclude petroleum/mineral wax ──────────
    {
      const ex = getExisting('PRESERVED_FOOD_CH20_INTENT');
      if (ex) {
        patches.push({
          priority: 640,
          rule: addNoneOf(ex, ['petroleum', 'petrolatum', 'paraffin', 'mineral', 'wax']),
        });
      }
    }

    // ── 13. AI_CH92_TUNING_FORK_PITCH_PIPE — use phrases not bare 'fork'/'forks' ─
    // 'fork' and 'forks' fire for agricultural hand tool queries containing "forks and rakes"
    // → allowSet=[92], ch.82 excluded. Replace with specific phrases only.
    patches.push({
      priority: 640,
      rule: {
        id: 'AI_CH92_TUNING_FORK_PITCH_PIPE',
        description:
          'Tuning forks, pitch pipes → ch.92. ' +
          'XX: Replaced bare "fork"/"forks" with phrases "tuning fork"/"tuning forks" to prevent ' +
          'agricultural hand tool queries ("forks and rakes", mattocks) from triggering ch.92.',
        pattern: {
          anyOf: [
            'tuning fork', 'tuning forks',
            'pitch pipe', 'pitch pipes',
            'pitchpipe',
            'tuning pipes',
          ],
        },
        whitelist: { allowChapters: ['92'] },
      },
    });

    // ── 14. NEW VANADIUM_SLAG_ORE_INTENT — vanadium-bearing slag/ash → ch.26 ────
    // "Containing mainly vanadium Other" → 2620.99.10.00 (ch.26 slag/ash/residues)
    // AI_CH81_VANADIUM fires for 'vanadium' but has no allowChapters.
    // No ch.26 rule fires → semantic picks ch.81 (vanadium metal).
    // Fix: new specific rule for slag/residues containing vanadium → ch.26
    patches.push({
      priority: 650,
      rule: {
        id: 'VANADIUM_SLAG_ORE_INTENT',
        description:
          'Slag, ash, residues containing mainly vanadium → ch.26 (2620.99.10). ' +
          'When query contains "containing mainly vanadium" or "vanadium slag/ore/residue", ' +
          'route to ch.26 (ores/slag), not ch.81 (vanadium metal). ' +
          'AI_CH81_VANADIUM fires for raw "vanadium" but has no allowChapters so ' +
          'ch.26 was excluded by other rules.',
        pattern: {
          anyOf: [
            'containing mainly vanadium',
            'mainly vanadium',
            'vanadium slag',
            'vanadium ore',
            'vanadium residue',
            'vanadium-bearing',
            'vanadiferous',
          ],
        },
        whitelist: { allowChapters: ['26'] },
      },
    });

    console.log(`Applying ${patches.length} rule patches (batch XX)...`);

    let success = 0;
    let failed = 0;

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
    console.log(`\nPatch XX complete: ${success} applied, ${failed} failed`);
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
