#!/usr/bin/env ts-node
/**
 * Patch RRRR — 2026-03-13:
 *
 * Fix 7 cross-chapter misfire patterns (targeting ~95 failures):
 *
 * 1. AI_CH91_TIME_SWITCH_TIMER fires 'switch' → 35 ignition switch → ch.91 failures
 *    "Automotive Ignition Switch Cylinder" → 'switch' anyOf → allowChapters=['91']
 *    Fix: remove standalone 'switch' from anyOf, replace with 'time switch' phrase.
 *    Add automotive/ignition terms to noneOf as belt-and-suspenders.
 *
 * 2. CLARINET_OBOE_INTENT fires 'recorder' → 13 audio recorder → ch.92 failures
 *    "SONY MICROCASSETTE RECORDER" → 'recorder' fires → allowChapters=['92']
 *    A recorder in this context is a cassette/audio recorder (ch.85), not the musical flute.
 *    Fix: add cassette/tape/voice-recorder terms to noneOf
 *
 * 3. AI_CH91_TIME_RECORDER fires 'recorder' → contributes to audio recorder → ch.91 failures
 *    Combined with CLARINET rule, allowSet={91,92} → ch.92 musical result wins.
 *    Fix: add cassette/tape/microcassette/brand terms to noneOf
 *
 * 4. SHAMPOO_HAIR_CARE_INTENT fires 'shampoo' → 11 "shampoo pump" → ch.33 failures
 *    "plastic shampoo pump", "shampoo dispenser" → expected 8413 (pump), got 3305 (shampoo)
 *    Fix: add 'pump', 'dispenser', 'bottle pump', 'lotion pump' to noneOf
 *
 * 5. LEATHER_HIDES_INTENT fires 'leather' → 10 "leather bag" → ch.41 failures
 *    "Vintage leather bag" → expected 4202 (leather article), got 4107 (raw hide)
 *    Fix: add bag/purse/handbag/wallet/backpack to noneOf of leather hides rule
 *
 * 6. NEW WOOL_YARN_FIBER_INTENT
 *    "100% wool yarn", "sheep wool yarn" → expected ch.51, got ch.52 cotton fabric
 *    Wool yarn needs a positive rule → allowChapters=['51'], inject 5106
 *
 * 7. NEW SYNTHETIC_MMF_YARN_INTENT
 *    Bernat/Red Heart/Caron synthetic knitting yarns → expected ch.55, got ch.52 cotton fabric
 *    Brand-name synthetic yarns need positive rule → allowChapters=['55'], inject 5508/5509
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13rrrr.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed RRRR: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH91_TIME_SWITCH_TIMER: remove bare 'switch', add to noneOf ────
    // 'switch' alone fires on "ignition switch", "light switch", "power switch" etc.
    // These are electrical switches (ch.85), not time-operated switches (ch.91).
    // Remove bare 'switch' from anyOf, replace with 'time switch' phrase.
    {
      const existing = allRules.find(r => r.id === 'AI_CH91_TIME_SWITCH_TIMER') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const newAnyOf = currentAnyOf
          .filter(t => t !== 'switch' && t !== 'plug')  // too generic
          .concat(
            ['time switch', 'timer switch', 'programmable timer', 'countdown timer', 'outlet timer', 'wall timer plug']
              .filter(t => !currentAnyOf.includes(t))
          );
        const toAddNoneOf = [
          'ignition', 'ignition switch', 'car ignition', 'automotive ignition',
          'kill switch', 'starter switch', 'fuel switch',
          'light switch', 'dimmer switch', 'rocker switch', 'toggle switch',
          'push button', 'momentary switch', 'reed switch', 'tactile switch',
          'relay', 'contactor', 'circuit breaker',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH91_TIME_SWITCH_TIMER') +
              ' — Fixed RRRR: replaced generic "switch"/"plug" with "time switch" phrases. ' +
              'Added ignition/automotive/electrical noneOf to prevent 35+ ignition-switch ch.91 misfires.',
            pattern: { ...pat, anyOf: newAnyOf, noneOf: [...currentNoneOf, ...toAddNoneOf] },
          },
        });
        console.log(`AI_CH91_TIME_SWITCH_TIMER: removed 'switch'/'plug', added 'time switch' phrase, +${toAddNoneOf.length} noneOf`);
      } else {
        console.log('WARNING: AI_CH91_TIME_SWITCH_TIMER not found');
      }
    }

    // ── 2. CLARINET_OBOE_INTENT: add audio recorder terms to noneOf ───────────
    // 'recorder' in anyOf fires for cassette/voice recorders → allowChapters=['92']
    // A recorder-flute (musical instrument) has context: soprano, alto, baroque, plastic.
    // Audio recorders have: cassette, microcassette, tape, voice, sony, olympus, etc.
    addNoneOf('CLARINET_OBOE_INTENT', [
      'cassette', 'microcassette', 'cassette recorder', 'tape recorder',
      'voice recorder', 'digital voice recorder', 'audio recorder',
      'video recorder', 'dvr', 'vcr', 'vhs',
      'sony', 'olympus', 'panasonic', 'tascam', 'zoom recorder',
    ], 'cassette/tape/voice recorder context prevents "recorder" from matching musical flute rule');

    // ── 3. AI_CH91_TIME_RECORDER: add cassette/tape recorder context ──────────
    // 'recorder' in anyOf also fires time-recorder rule → combined allowSet={91,92}
    // The ch.92 musical instrument result dominates → "SONY MICROCASSETTE RECORDER" → 9205.
    addNoneOf('AI_CH91_TIME_RECORDER', [
      'cassette', 'microcassette', 'tape recorder', 'cassette recorder',
      'voice recorder', 'digital voice recorder', 'audio recorder',
      'sony', 'olympus', 'panasonic',
    ], 'cassette/audio recorder context prevents "recorder" from matching time-recorder rule (ch.91)');

    // ── 4. SHAMPOO_HAIR_CARE_INTENT: add pump/dispenser context ──────────────
    // 'shampoo' in anyOf fires for "shampoo pump", "shampoo dispenser" → allowChapters=['33']
    // These products are pumps/dispensers (ch.84/39), not shampoo/hair preps (ch.33).
    addNoneOf('SHAMPOO_HAIR_CARE_INTENT', [
      'pump', 'pumps', 'dispenser', 'dispensers', 'bottle pump', 'lotion pump',
      'soap dispenser', 'liquid dispenser', 'pump head', 'pump bottle',
      'foamer pump', 'foam pump', 'trigger pump', 'spray pump',
    ], '"shampoo pump/dispenser" are pumping devices (ch.84), not hair preparations (ch.33)');

    // ── 5. LEATHER_HIDES_INTENT: add leather goods terms to noneOf ───────────
    // 'leather' anyOf fires for "leather bag", "vintage leather bag" → ch.41 raw hides.
    // Leather bags/wallets/purses/backpacks are leather articles (ch.42), not raw hides.
    addNoneOf('LEATHER_HIDES_INTENT', [
      'bag', 'bags', 'purse', 'purses', 'handbag', 'handbags',
      'wallet', 'wallets', 'backpack', 'backpacks', 'satchel', 'satchels',
      'clutch', 'clutches', 'tote', 'totes', 'pouch', 'pouches',
      'belt', 'belts', 'strap', 'straps', 'harness', 'glove', 'gloves',
    ], '"leather bag/wallet/backpack/gloves" are leather articles (ch.42), not raw hides (ch.41)');

    // ── 6. NEW WOOL_YARN_FIBER_INTENT ────────────────────────────────────────
    // "100% wool yarn", "sheep wool yarn" → expected 5106 (ch.51), got 5208 (ch.52 cotton fabric)
    // No positive rule for wool yarn → semantic search matches cotton fabric descriptions.
    patches.push({
      priority: 560,
      rule: {
        id: 'WOOL_YARN_FIBER_INTENT',
        description: 'Wool and animal hair yarn → ch.51 (5106/5107/5108). ' +
          '"100% wool yarn", "merino wool yarn", "knitting wool", "sheep wool" → ch.51. ' +
          'Previously routed to ch.52 cotton fabric due to no semantic match for wool yarn in HTS.',
        pattern: {
          anyOf: [
            'wool yarn', 'woolen yarn', 'woolly yarn', 'knitting wool',
            'merino yarn', 'merino wool yarn', 'alpaca yarn', 'cashmere yarn',
            'sheep wool yarn', 'lamb wool yarn', 'lambswool yarn',
            '100% wool yarn', 'pure wool yarn', 'natural wool yarn',
            'tapestry yarn wool', 'rug yarn wool', 'worsted wool',
            'mohair yarn', 'angora yarn',
          ],
          noneOf: [
            'acrylic', 'polyester', 'nylon', 'synthetic', 'blend',
            'cotton yarn', 'bamboo yarn',
            'fabric', 'bolt', 'yard', 'meter',
          ],
        },
        whitelist: { allowChapters: ['51'] },
        inject: [
          { prefix: '5106.10.00', syntheticRank: 9 }, // Carded wool yarn, ≥85% wool
          { prefix: '5106.20.00', syntheticRank: 8 }, // Carded wool yarn, <85% wool
          { prefix: '5107.10.00', syntheticRank: 7 }, // Combed wool yarn, ≥85% wool
          { prefix: '5108.10.00', syntheticRank: 6 }, // Carded yarn of fine animal hair
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '5106' },
          { delta: 0.35, prefixMatch: '5107' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW SYNTHETIC_MMF_YARN_INTENT ─────────────────────────────────────
    // "Bernat Pipsqueak", "Red Heart Super Saver", "Caron Colorama" → expected ch.55 (MMF yarn)
    // These are popular acrylic knitting yarn brands → 5508/5509 (man-made fiber yarn).
    // No rule catches these → semantic matches cotton fabric (ch.52) descriptions.
    patches.push({
      priority: 555,
      rule: {
        id: 'SYNTHETIC_MMF_YARN_INTENT',
        description: 'Man-made fiber (MMF/synthetic) yarn → ch.55 (5508/5509). ' +
          'Acrylic, polyester, nylon knitting yarns, brand name yarns (Bernat, Red Heart, Caron). ' +
          'Previously routed to ch.52 cotton fabric due to no chapter restriction.',
        pattern: {
          anyOf: [
            'acrylic yarn', 'polyester yarn', 'nylon yarn', 'synthetic yarn',
            'mmf yarn', 'man-made fiber yarn', 'microfiber yarn',
            'bernat', 'red heart', 'caron', 'lion brand',
            'super bulky yarn', 'bulky yarn', 'fingering yarn', 'dk yarn',
            'sport weight yarn', 'worsted weight yarn', 'aran yarn',
            'knitting yarn', 'crochet yarn', 'crafting yarn',
          ],
          noneOf: [
            'wool', 'alpaca', 'cashmere', 'merino', 'mohair', 'angora',
            'cotton yarn', 'linen yarn', 'bamboo yarn', 'silk yarn',
            'fabric', 'bolt', 'meter',
          ],
        },
        whitelist: { allowChapters: ['55'] },
        inject: [
          { prefix: '5508.10.00', syntheticRank: 9 }, // Sewing thread of synthetic staple fibers
          { prefix: '5509.31.00', syntheticRank: 8 }, // Yarn of polyester fibers, <85%, mixed with cotton
          { prefix: '5509.21.00', syntheticRank: 7 }, // Single yarn of polyester fibers ≥85%
          { prefix: '5509.51.00', syntheticRank: 6 }, // Single yarn of acrylic fibers ≥85%
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '5508' },
          { delta: 0.35, prefixMatch: '5509' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch RRRR)...`);
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
    console.log(`\nPatch RRRR complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
