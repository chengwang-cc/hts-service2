#!/usr/bin/env ts-node
/**
 * Patch QQQQ — 2026-03-14:
 *
 * inject/boosts fixes (2 rules):
 * 1. AI_CH51_CASHMERE_FIBER: add inject 5108.10 + boosts → score too low for cashmere yarn queries
 * 2. AI_CH51_RAW_WOOL: add inject 5107.10/5106.10 + boosts → score too low for wool yarn queries
 *
 * New rules (4):
 * 3. MUSICAL_MOUTHPIECE_PART_INTENT (ch.92): mouthpiece/reed/ligature/rosin → 9209.91
 *    "BG A11 L Mouthpiece Patch" → ch.92 (9209 musical instrument parts/accessories)
 * 4. CHORE_COAT_WORKWEAR_INTENT (ch.62): chore coat/work jacket/chore jacket → 6201.90
 *    "vintage gap chore" → ch.62; no rules fire for "chore" vocabulary
 * 5. SIKH_TURBAN_ACCESSORY_INTENT (ch.74): turban pin/pagg pin/dastar → 7419.99
 *    "Khanda Sikh Baaj/Salai and Pagg Pin for Turban" → ch.74 (copper articles)
 * 6. HAND_TOOL_CARBURETOR_INTENT (ch.82): carburetor tool/synchronizer/synchro → 8205.90
 *    "Edelbrock 4025 unisyn" → ch.82 (hand tools); unisyn = carburetor synchronizer
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14qqqq.ts
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

    function addInjectAndBoosts(ruleId: string, inject: any[], boosts: any[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const currentInject: any[] = (existing as any).inject ?? [];
      const currentPrefixes = new Set(currentInject.map((i: any) => i.prefix));
      const newInject = inject.filter(i => !currentPrefixes.has(i.prefix));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed QQQQ: ${note}`,
          inject: [...currentInject, ...newInject],
          boosts,
        } as IntentRule,
      });
      console.log(`${ruleId}: adding ${newInject.length} inject entries + boosts`);
    }

    // ── 1. AI_CH51_CASHMERE_FIBER: add inject + boosts ────────────────────────────
    // "70/20/10 Wool/Cashmere/Nylon YarnKit" → ch.51; rule fires but no inject → no candidates
    addInjectAndBoosts('AI_CH51_CASHMERE_FIBER', [
      { prefix: '5108.10', syntheticRank: 9 }, // Carded yarn of fine animal hair
      { prefix: '5108.20', syntheticRank: 8 }, // Combed yarn of fine animal hair
      { prefix: '5112.19', syntheticRank: 7 }, // Woven fabrics of cashmere
    ], [
      { delta: 0.5, chapterMatch: '51' },
      { delta: 0.4, prefixMatch: '5108' },
    ], 'add inject 5108.10 + boosts so cashmere yarn queries return ch.51 results');

    // ── 2. AI_CH51_RAW_WOOL: add inject + boosts ──────────────────────────────────
    addInjectAndBoosts('AI_CH51_RAW_WOOL', [
      { prefix: '5107.10', syntheticRank: 9 }, // Yarn of combed wool, ≥85% by weight
      { prefix: '5106.10', syntheticRank: 8 }, // Yarn of carded wool, ≥85% by weight
      { prefix: '5108.10', syntheticRank: 7 }, // Carded yarn of fine animal hair
    ], [
      { delta: 0.5, chapterMatch: '51' },
      { delta: 0.4, prefixMatch: '5107' },
    ], 'add inject 5107.10 + boosts so wool yarn queries return ch.51 results');

    // ── 3. NEW MUSICAL_MOUTHPIECE_PART_INTENT ─────────────────────────────────────
    // "BG A11 L Mouthpiece Patch, Clear, Large 0.4mm" → 9209.91 (ch.92)
    // "BG" is Buffet Glotin brand; A11 is a pad/patch for mouthpiece protection
    patches.push({
      priority: 562,
      rule: {
        id: 'MUSICAL_MOUTHPIECE_PART_INTENT',
        description: 'Musical instrument accessories: mouthpieces, reeds, ligatures → ch.92 (9209.91). ' +
          '"Mouthpiece patch", "clarinet reed", "ligature", "valve oil" → 9209.91. ' +
          'Without rule, no ch.92 results for instrument accessory queries.',
        pattern: {
          anyOf: [
            'mouthpiece', 'mouthpiece patch', 'instrument mouthpiece', 'saxophone mouthpiece',
            'clarinet mouthpiece', 'trumpet mouthpiece', 'trombone mouthpiece', 'flute mouthpiece',
            'reed', 'reeds', 'clarinet reed', 'saxophone reed', 'oboe reed', 'bassoon reed',
            'ligature', 'valve oil', 'rosin', 'violin rosin', 'cello rosin',
            'instrument strap', 'instrument stand',
          ],
          noneOf: ['reed mat', 'reed furniture', 'wicker', 'rattan', 'basket', 'rush'],
        },
        whitelist: { allowChapters: ['92'] },
        inject: [
          { prefix: '9209.91', syntheticRank: 9 }, // Parts/accessories for instruments
          { prefix: '9209.99', syntheticRank: 8 }, // Other musical instrument accessories
          { prefix: '9206.00', syntheticRank: 7 }, // Percussion instruments
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '92' },
          { delta: 0.4, prefixMatch: '9209' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW CHORE_COAT_WORKWEAR_INTENT ─────────────────────────────────────────
    // "vintage gap chore" → ch.62 (6201.90 = men's outerwear)
    // "chore coat" or "chore jacket" is a heavy canvas work jacket
    patches.push({
      priority: 553,
      rule: {
        id: 'CHORE_COAT_WORKWEAR_INTENT',
        description: 'Chore coats, work jackets, shop coats → ch.62 (6201.90). ' +
          '"Chore coat", "chore jacket", "shop coat", "canvas work jacket" → 6201.90. ' +
          'Without rule, no ch.62 results for "vintage gap chore" (chore = type of jacket).',
        pattern: {
          anyOf: [
            'chore coat', 'chore jacket', 'shop coat', 'canvas jacket', 'canvas coat',
            'chore', 'worker jacket', 'work coat', 'barn coat', 'field coat',
          ],
          noneOf: ['homework', 'household chore', 'chores'],
        },
        whitelist: { allowChapters: ['62', '61'] },
        inject: [
          { prefix: '6201.90', syntheticRank: 9 }, // Men's overcoats, other
          { prefix: '6201.20', syntheticRank: 8 }, // Men's overcoats, of cotton
          { prefix: '6211.20', syntheticRank: 7 }, // Ski suits/other garments for men
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6201' },
          { delta: 0.4, chapterMatch: '62' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW SIKH_TURBAN_ACCESSORY_INTENT ───────────────────────────────────────
    // "Khanda Sikh Baaj/Salai and Pagg Pin for Turban/Patka/Dumala" → ch.74 (copper articles)
    patches.push({
      priority: 548,
      rule: {
        id: 'SIKH_TURBAN_ACCESSORY_INTENT',
        description: 'Sikh turban accessories, religious pins, copper jewelry → ch.74 (7419.99). ' +
          '"Pagg pin", "turban pin", "dastar pin", "sikh jewelry" → 7419.99. ' +
          'Without rule, no ch.74 results for Sikh religious metalware queries.',
        pattern: {
          anyOf: [
            'pagg pin', 'turban pin', 'dastar pin', 'sikh pin', 'khanda',
            'turban', 'patka', 'dumala', 'dastar', 'baaj', 'salai',
            'sikh jewelry', 'punjabi pin', 'gurpurab',
          ],
          noneOf: ['hat', 'baseball cap', 'helmet'],
        },
        whitelist: { allowChapters: ['74', '83'] },
        inject: [
          { prefix: '7419.99', syntheticRank: 9 }, // Other articles of copper
          { prefix: '7419.80', syntheticRank: 8 }, // Other articles of copper
          { prefix: '8306.29', syntheticRank: 7 }, // Other ornaments of base metal
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '74' },
          { delta: 0.4, prefixMatch: '7419' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW HAND_TOOL_CARBURETOR_INTENT ────────────────────────────────────────
    // "Edelbrock 4025 unisyn" → ch.82 (8205 = hand tools)
    // "Uni-Syn" = carburetor synchronizer, a mechanic's hand tool
    patches.push({
      priority: 546,
      rule: {
        id: 'HAND_TOOL_CARBURETOR_INTENT',
        description: 'Carburetor synchronizers and automotive hand tools → ch.82 (8205.90). ' +
          '"Unisyn", "carburetor synchronizer", "carb sync tool" → 8205.90. ' +
          'Without rule, no ch.82 results for automotive mechanic tool queries.',
        pattern: {
          anyOf: [
            'unisyn', 'uni-syn', 'carburetor sync', 'carb sync', 'synchronizer tool',
            'edelbrock', 'carb tool', 'carburetor tool', 'vacuum gauge', 'timing light',
            'compression gauge', 'throttle sync', 'fuel pressure gauge',
          ],
          noneOf: ['digital', 'software', 'app'],
        },
        whitelist: { allowChapters: ['82', '90'] },
        inject: [
          { prefix: '8205.90', syntheticRank: 9 }, // Other hand tools
          { prefix: '8205.51', syntheticRank: 8 }, // Household tools
          { prefix: '9026.20', syntheticRank: 7 }, // Pressure gauges
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '82' },
          { delta: 0.4, prefixMatch: '8205' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch QQQQ)...`);
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
    console.log(`\nPatch QQQQ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
