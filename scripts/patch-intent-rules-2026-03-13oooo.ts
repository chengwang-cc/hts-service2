#!/usr/bin/env ts-node
/**
 * Patch OOOO — 2026-03-13:
 *
 * Fix 5 additional misfires from cross-chapter failure analysis:
 *
 * 1. AI_CH03_SHARK_FIN fires on 'head' → tool queries route to ch.03 fish
 *    "Agdor Axe Head" → 'head' in anyOf → allowChapters=['03'] → fish → ch.03
 *    Fix: add tool context ('axe', 'hammer', 'hatchet', 'chisel', 'tool') to noneOf
 *
 * 2. AI_CH57_KILIM_FLATWEAVE_RUG fires on 'tapestry' → tapestry needles route to ch.57
 *    "Bohin Tapestry Needles Cross Stitch" → 'tapestry' → allowChapters=['57'] → EMPTY
 *    Fix: add needle/craft context to noneOf of tapestry rug rule
 *
 * 3. SPORTS_JERSEY_GARMENT_INTENT: update to use anyOfGroups to catch "Majestic Jersey"
 *    Current anyOf only catches phrase "authentic jersey" (not adjacent in query).
 *    Add anyOfGroups: jersey + sports team context (MLB, NBA, etc.)
 *
 * 4. NEW ROTISSERIE_GRILL_PART_INTENT
 *    "Weber 7652 Rotisserie" → expected 7321.90 (stove/range parts) → EMPTY
 *    Rotisserie is a grill/stove accessory → ch.73 (7321)
 *
 * 5. NEW HAND_TOOL_AXES_SAWS_INTENT
 *    "Bucksaw", "Axe Head" → expected ch.82 → EMPTY (no semantic match)
 *    Add positive inject rule for hand tools (axes, saws) → 8201/8202
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13oooo.ts
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

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed OOOO: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH03_SHARK_FIN: add tool context to noneOf ─────────────────────
    // 'head' in anyOf targets fish heads → fires on tool queries like "Axe Head"
    // → allowChapters=['03'] → no ch.82 tool in ch.03 → ch.03 result (wrong)
    addNoneOf('AI_CH03_SHARK_FIN', [
      'axe', 'axes', 'axe head', 'hatchet', 'maul', 'cleaver',
      'hammer', 'hammers', 'mallet', 'sledge', 'sledgehammer',
      'chisel', 'chisels', 'tool', 'tools', 'blade', 'blades',
      'handle', 'handles', 'shaft', 'shafts',
      'vintage', 'antique', 'pound', 'lbs', 'oz', 'ounce',
      'steel', 'iron', 'metal', 'forged',
    ], 'tool context (axe/hammer/hatchet/blade) prevents "axe head" routing to fish head rule');

    // ── 2. AI_CH57_KILIM_FLATWEAVE_RUG: add needle/craft context ─────────────
    // 'tapestry' in anyOf fires on "tapestry needles" → allowChapters=['57'] → EMPTY
    // Tapestry needles are sewing/craft supplies (ch.73), not tapestry rugs/floor coverings.
    addNoneOf('AI_CH57_KILIM_FLATWEAVE_RUG', [
      'needle', 'needles', 'sewing needle', 'embroidery needle', 'canvas needle',
      'cross stitch', 'cross-stitch', 'needlepoint', 'embroidery', 'stitching',
      'thread', 'yarn', 'wool yarn', 'kit', 'set', 'sizes', 'gauge',
    ], 'tapestry needles are sewing supplies (ch.73), not tapestry rugs (ch.57)');

    // ── 3. Update SPORTS_JERSEY_GARMENT_INTENT: add anyOfGroups ──────────────
    // Current anyOf only catches "authentic jersey" phrase — misses "Authentic Majestic Jersey"
    // where "Majestic" separates "authentic" and "jersey". Add anyOfGroups for jersey + team.
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        patches.push({
          priority: 610,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_GARMENT_INTENT') +
              ' — OOOO: Added anyOfGroups (jersey + sports league/team) for "Majestic Jersey" pattern.',
            pattern: {
              ...pat,
              // anyOfGroups: must match one from EACH group (AND logic)
              anyOfGroups: [
                ['jersey', 'jerseys'],
                ['MLB', 'NBA', 'NFL', 'NHL', 'MLS', 'WNBA',
                 'majestic', 'authentic', 'replica', 'fan', 'player',
                 'throwback', 'vintage', 'game used', 'game-used',
                 'baseball', 'basketball', 'football', 'hockey', 'soccer', 'sports team',
                 'all star', 'all-star', 'championship', 'world series'],
              ],
            },
          },
        });
        console.log(`SPORTS_JERSEY_GARMENT_INTENT: added anyOfGroups for jersey+team patterns`);
      } else {
        console.log('WARNING: SPORTS_JERSEY_GARMENT_INTENT not found');
      }
    }

    // ── 4. NEW ROTISSERIE_GRILL_PART_INTENT ─────────────────────────────────
    // "Weber 7652 Rotisserie", "grill rotisserie kit" → expected 7321.90 (grill/stove parts)
    // Rotisserie is a cooking appliance accessory → ch.73 (7321) or ch.76 (8516 electric)
    patches.push({
      priority: 560,
      rule: {
        id: 'ROTISSERIE_GRILL_PART_INTENT',
        description: 'Rotisserie kits/motors/accessories → 7321.90 (ch.73 grill parts). ' +
          '"Rotisserie" is a cooking method and equipment → ch.73 stoves/ranges/their parts. ' +
          'Previously EMPTY due to no semantic match for "rotisserie" in HTS descriptions.',
        pattern: {
          anyOf: [
            'rotisserie', 'rotisserie kit', 'rotisserie motor', 'rotisserie attachment',
            'spit roast', 'spit roaster', 'rotisserie basket', 'rotisserie rod',
          ],
          noneOf: [
            'chicken', 'bird', 'poultry', 'meat', 'food', 'grocery', 'store',
          ],
        },
        whitelist: { allowChapters: ['73'] },
        inject: [
          { prefix: '7321.90.50.00', syntheticRank: 9 }, // Parts for stoves, ranges, grates
          { prefix: '7321.11.30.00', syntheticRank: 7 }, // Gas or gas and other fuel cookers
          { prefix: '7321.19.50.00', syntheticRank: 6 }, // Other cooking appliances
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '7321' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW HAND_SAW_AXE_TOOL_INTENT ─────────────────────────────────────
    // "Bucksaw", "Axe Head" etc. → expected ch.82 → EMPTY (semantic mismatch)
    // "bucksaw" doesn't semantically match "hand saws" HTS description well.
    // Add inject to force ch.82 hand tool codes into candidate pool.
    patches.push({
      priority: 550,
      rule: {
        id: 'HAND_SAW_AXE_TOOL_INTENT',
        description: 'Hand saws and axes → ch.82 (8201/8202). ' +
          '"Bucksaw", "bowsaw", "crosscut saw", "axe head", "hatchet" are ch.82 hand tools. ' +
          'Previously EMPTY due to low semantic match between common names and HTS descriptions.',
        pattern: {
          anyOf: [
            'bucksaw', 'buck saw', 'bowsaw', 'bow saw', 'hacksaw', 'hack saw',
            'crosscut saw', 'cross cut saw', 'handsaw', 'hand saw',
            'pruning saw', 'pruning shears', 'pruner',
            'axe head', 'ax head', 'hatchet head', 'maul head',
            'splitting maul', 'splitting axe', 'felling axe', 'broad axe',
            'fireman axe', 'fire axe', 'pickaxe', 'pick axe', 'mattock',
          ],
          noneOf: [
            // Exclude power tools
            'electric', 'power', 'cordless', 'battery', 'circular saw',
            'chainsaw', 'chain saw', 'jigsaw', 'reciprocating',
            // Exclude kitchen/food
            'bread saw', 'cake', 'food', 'kitchen',
          ],
        },
        whitelist: { allowChapters: ['82'] },
        inject: [
          { prefix: '8201.40.60.10', syntheticRank: 9 }, // Axes, adzes, and similar tools
          { prefix: '8202.10.00.00', syntheticRank: 8 }, // Hand saws
          { prefix: '8201.50.00.00', syntheticRank: 7 }, // Secateurs/pruners
          { prefix: '8201.30.00.00', syntheticRank: 6 }, // Mattocks, picks, hoes
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8201' },
          { delta: 0.4, prefixMatch: '8202' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch OOOO)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch OOOO complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
