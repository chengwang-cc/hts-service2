#!/usr/bin/env ts-node
/**
 * Patch LLLL — 2026-03-14:
 *
 * 1. AI_CH67_WIGS_HAIRPIECES: add 'electric' to noneOf
 *    'switch' fires for "Electric Switch" → 'electric' not in previous noneOf additions
 *
 * 2. ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: add more anyOf terms
 *    'electric switch', 'mechanical switch', 'disconnect switch', 'keyboard switch' missing
 *
 * 3. NEW LIGHT_BULB_LAMP_INTENT (ch.85): bulb/led/incandescent → 8539
 *    'bulb' semantically matches plant bulbs (ch.06) → EMPTY for "light bulbs", "vintage nightlight"
 *
 * 4. NEW AUTOMOTIVE_INTERIOR_PARTS_INTENT (ch.70/87): sun visor, rearview mirror → 7009.91
 *    "Toyota Sienna Sun Visor" → ch.70 (7009.91); no rule fires → ch.24 (tobacco) ranks higher
 *
 * 5. NEW PROTECTIVE_GLOVES_INTENT (ch.61): chemical/PVC gloves → 6116.10
 *    "Forcefield Chemical Resistant Gloves PVC Coated" → no rules, EMPTY
 *
 * 6. NEW LANYARD_BADGE_REEL_INTENT (ch.58): lanyards, badge reels → 5807.10
 *    "Lanyard haudenosaunee", "Resin Badge Reel" → expected ch.58 (5807), no rules fire
 *
 * 7. NEW VACUUM_TUBE_INTENT (ch.85): vacuum tubes → 8540
 *    "Matched PAIR 6EJ7 EF184 NOS Matsushita Mullard Tubes NIB" → 8540.81
 *
 * 8. NEW SNEAKER_ATHLETIC_FOOTWEAR_INTENT (ch.64): branded sneakers → 6404.11
 *    "New Balance 530", "Alohas Women's Tb.490" → ch.64 (6404.11), no rules fire
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14llll.ts
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
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed LLLL: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed LLLL: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. AI_CH67_WIGS_HAIRPIECES: add 'electric' to noneOf ────────────────────────
    // 'switch' fires for "Electric Switch" → 'electric' alone (vs 'electrical') not in noneOf
    addNoneOf('AI_CH67_WIGS_HAIRPIECES', [
      'electric', 'disconnect', 'keyboard', 'pressure switch', 'gas pressure',
      'master switch', 'master disconnect', 'pigtail', 'harness',
    ], '"electric" context prevents wig rule from blocking "Electric Switch", "Battery Master Disconnect Switch"');

    // ── 2. ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT: add more anyOf ──────────────────────
    addToAnyOf('ELECTRICAL_AUTOMOTIVE_SWITCH_INTENT', [
      'electric switch', 'mechanical switch', 'keyboard switch', 'keyboard switches',
      'disconnect switch', 'master disconnect', 'battery disconnect', 'gas pressure switch',
      'pressure switch', 'flow switch', 'level switch', 'limit switch',
      'fuse-box', 'fusebox', 'fuse box', 'pigtail connector', 'heater control switch',
      'control switch face', 'nightlight switch',
    ], 'added electric/mechanical/disconnect/keyboard/pressure switch and fuse-box/pigtail terms');

    // ── 3. NEW LIGHT_BULB_LAMP_INTENT ────────────────────────────────────────────────
    // "Light bulbs" → 8539.22.80.40 (ch.85)
    // "vintage childs nightlight" → 8539.22.80.30
    // Without rule, 'bulb' semantically matches plant bulbs in ch.06
    patches.push({
      priority: 578,
      rule: {
        id: 'LIGHT_BULB_LAMP_INTENT',
        description: 'Light bulbs, lamps → ch.85 (8539). ' +
          '"Light bulbs", "incandescent bulb", "vintage nightlight" → 8539. ' +
          'Without rule, "bulb" semantically matches plant bulbs (ch.06) instead of light bulbs.',
        pattern: {
          anyOf: [
            'light bulb', 'light bulbs', 'bulb',
            'incandescent', 'incandescent bulb', 'filament bulb',
            'halogen bulb', 'halogen lamp', 'fluorescent bulb', 'fluorescent lamp',
            'cfl bulb', 'cfl lamp', 'vintage bulb', 'edison bulb',
            'nightlight', 'night light', 'night light bulb',
            'globe bulb', 'candelabra bulb', 'reflector bulb',
          ],
          noneOf: [
            'tulip bulb', 'flower bulb', 'plant bulb', 'garlic bulb',
            'onion', 'succulent', 'tulip', 'hyacinth', 'daffodil',
            'led', 'led bulb', 'led light', 'smart bulb',  // covered by other rules
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8539.22', syntheticRank: 9 }, // Other filament lamps
          { prefix: '8539.29', syntheticRank: 8 }, // Other discharge lamps
          { prefix: '8539.31', syntheticRank: 7 }, // Fluorescent lamps
          { prefix: '8539.50', syntheticRank: 6 }, // LED lamps
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8539' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW AUTOMOTIVE_INTERIOR_PARTS_INTENT ───────────────────────────────────
    // "Toyota Sienna Sun Visor Driver Left Side Sunvisor" → 7009.91.10.10 (ch.70)
    // Without rule, ch.24 (tobacco) ranks higher due to semantic mismatch
    patches.push({
      priority: 566,
      rule: {
        id: 'AUTOMOTIVE_INTERIOR_PARTS_INTENT',
        description: 'Automotive interior parts (sun visor, mirrors) → ch.70 (7009.91). ' +
          '"Toyota Sienna Sun Visor", "car sun visor" → 7009.91 (interior rearview mirrors). ' +
          'Without rule, ch.24 or wrong chapters rank higher.',
        pattern: {
          anyOf: [
            'sun visor', 'sunvisor', 'sun visor driver', 'sun visor passenger',
            'interior sun visor', 'automotive visor', 'car visor', 'truck visor',
            'rearview mirror', 'rear view mirror', 'interior mirror', 'car mirror',
            'side mirror glass', 'wing mirror glass',
          ],
          noneOf: ['helmet', 'motorcycle helmet', 'hat', 'cap'],
        },
        whitelist: { allowChapters: ['70', '87'] },
        inject: [
          { prefix: '7009.91', syntheticRank: 9 }, // Interior rear-view mirrors
          { prefix: '7009.10', syntheticRank: 8 }, // Rear-view mirrors for vehicles
          { prefix: '7009.92', syntheticRank: 7 }, // Other glass mirrors
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7009.91' },
          { delta: 0.4, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW PROTECTIVE_GLOVES_INTENT ──────────────────────────────────────────
    // "Forcefield Chemical Resistant Gloves, Orange PVC Coated, 12" Gauntlet Cuff" → 6116.10 (ch.61)
    // "chemical resistant gloves", "rubber gloves", "PVC gloves" → 6116 (coated/rubber gloves)
    patches.push({
      priority: 564,
      rule: {
        id: 'PROTECTIVE_GLOVES_INTENT',
        description: 'Chemical/rubber/protective gloves → ch.61 (6116). ' +
          '"Chemical resistant gloves", "PVC coated gloves", "rubber gloves" → 6116.10. ' +
          'Without rule, EMPTY for specialized protective glove queries.',
        pattern: {
          anyOf: [
            'chemical resistant gloves', 'chemical resistant glove', 'pvc coated gloves',
            'rubber gloves', 'latex gloves', 'nitrile gloves', 'nitrile glove',
            'gauntlet glove', 'gauntlet cuff', 'protective gloves', 'safety gloves',
            'neoprene gloves', 'butyl gloves', 'acid resistant gloves',
            'coated gloves', 'industrial gloves', 'work gloves',
          ],
          noneOf: ['knit', 'winter gloves', 'leather gloves', 'driving gloves', 'gardening'],
        },
        whitelist: { allowChapters: ['61', '40'] },
        inject: [
          { prefix: '6116.10', syntheticRank: 9 }, // Impregnated/coated/covered gloves
          { prefix: '6116.91', syntheticRank: 8 }, // Of wool/fine animal hair
          { prefix: '4015.19', syntheticRank: 7 }, // Gloves/mittens of vulcanized rubber
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6116.10' },
          { delta: 0.4, chapterMatch: '61' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW LANYARD_BADGE_REEL_INTENT ─────────────────────────────────────────
    // "Lanyard - haudenosaunee" → 5807.10.20.20 (woven narrow fabric labels/badges)
    // "Resin Badge Reel in Grey Penguin shape" → 5807.10.20.20
    // Expected ch.58 (narrow woven fabrics/labels); no rules fire → EMPTY
    patches.push({
      priority: 552,
      rule: {
        id: 'LANYARD_BADGE_REEL_INTENT',
        description: 'Lanyards and badge reels → ch.58 (5807.10). ' +
          '"Lanyard", "badge reel", "name badge holder" → 5807.10 (woven narrow fabrics/labels). ' +
          'Without rule, no HTS entries surface for lanyard queries.',
        pattern: {
          anyOf: [
            'lanyard', 'lanyards', 'badge reel', 'badge reels', 'badge holder',
            'id lanyard', 'id badge lanyard', 'retractable badge', 'badge clip',
            'neck lanyard', 'breakaway lanyard', 'custom lanyard',
            'woven lanyard', 'sublimated lanyard',
          ],
          noneOf: ['key', 'keychain', 'key holder', 'rope', 'climbing'],
        },
        whitelist: { allowChapters: ['58', '39'] },
        inject: [
          { prefix: '5807.10', syntheticRank: 9 }, // Woven labels/badges/similar
          { prefix: '5807.90', syntheticRank: 8 }, // Other labels
          { prefix: '3926.90', syntheticRank: 7 }, // Misc plastic articles (badge reel)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '5807.10' },
          { delta: 0.4, chapterMatch: '58' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW VACUUM_TUBE_INTENT ─────────────────────────────────────────────────
    // "Matched PAIR 6EJ7 EF184 NOS Matsushita /Mullard Tubes NIB Shindo Graaf" → 8540.81 (ch.85)
    // NOS = New Old Stock, these are vintage vacuum tubes for audio amplifiers
    patches.push({
      priority: 580,
      rule: {
        id: 'VACUUM_TUBE_INTENT',
        description: 'Vacuum/thermionic tubes → ch.85 (8540). ' +
          '"NOS vacuum tubes", "Mullard tubes", "EL34 tubes", "6SN7 tubes" → 8540. ' +
          'Without rule, vintage tube model numbers cause EMPTY.',
        pattern: {
          anyOf: [
            'vacuum tube', 'vacuum tubes', 'thermionic tube', 'thermionic valve',
            'mullard', 'telefunken tube', 'nos tube', 'nos tubes',
            'el34', 'el84', '12ax7', '12au7', '6sn7', '6l6', 'kt88',
            'audio tube', 'tube amplifier', 'tube amp tubes',
            'triode', 'pentode', 'rectifier tube', 'power tube',
            'matched pair tubes', 'matched quad',
          ],
          noneOf: ['cardboard tube', 'paper tube', 'test tube', 'inner tube', 'tire'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8540.81', syntheticRank: 9 }, // Receiver/amplifier tubes
          { prefix: '8540.11', syntheticRank: 8 }, // Cathode-ray tubes
          { prefix: '8540.20', syntheticRank: 7 }, // TV camera tubes
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8540.81' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 8. NEW SNEAKER_ATHLETIC_FOOTWEAR_INTENT ───────────────────────────────────
    // "New Balance 530 in Raincloud..." → 6404.11.75.30 (ch.64)
    // "Alohas Women's Tb.490 in Rife Shimmer Silver" → 6404.11.75.60
    // Branded athletic footwear → 6404.11 (rubber/plastic outer sole, textile upper)
    patches.push({
      priority: 556,
      rule: {
        id: 'SNEAKER_ATHLETIC_FOOTWEAR_INTENT',
        description: 'Branded athletic sneakers/footwear → ch.64 (6404.11). ' +
          '"New Balance", "Nike", "Adidas" sneakers → 6404.11 (rubber sole, textile upper). ' +
          'Without rule, branded footwear queries return EMPTY or wrong chapter.',
        pattern: {
          anyOf: [
            'sneaker', 'sneakers', 'athletic shoe', 'athletic shoes', 'running shoe', 'running shoes',
            'new balance', 'alohas', 'trail shoe', 'lifestyle shoe',
            'retro sneaker', 'chunky sneaker', 'platform sneaker',
            'tb.490', 'nb 530', '2002r', '990v',
          ],
          noneOf: ['boot', 'boots', 'sandal', 'sandals', 'flip flop', 'heel'],
        },
        whitelist: { allowChapters: ['64'] },
        inject: [
          { prefix: '6404.11', syntheticRank: 9 }, // Sports footwear, rubber/plastic sole
          { prefix: '6404.19', syntheticRank: 8 }, // Other, rubber/plastic sole
          { prefix: '6402.99', syntheticRank: 7 }, // Other footwear, rubber/plastic
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6404.11' },
          { delta: 0.4, chapterMatch: '64' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch LLLL)...`);
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
    console.log(`\nPatch LLLL complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
