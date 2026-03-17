#!/usr/bin/env ts-node
/**
 * Patch VVVV — 2026-03-14:
 *
 * noneOf fixes (1 rule):
 * 1. AI_CH93_GUN_PARTS_ACCESSORIES: add grip tape/sports grip context
 *    "Fusion Ultra Grip" → ch.39 (3902.10) blocked by 'grip' in anyOf → injects 9305 gun parts
 *
 * New rules (3):
 * 2. JEWELRY_RING_INTENT (ch.71): ring/claddagh/signet ring → 7113.19/7117.19/7111.00
 *    "Silver Claddagh Ring" → 7111.00; semantic gets 0305.54 (smoked fish!) — bizarre routing
 * 3. GOLD_PRECIOUS_METAL_JEWELRY_INTENT (ch.71): 14k gold/18k gold → 7113.19
 *    "14k gold jewelry" → 7113.19; semantic gets 7018.10 (glass beads)
 * 4. POLYPROPYLENE_TOUGH_COAT_INTENT (ch.39): tough coat poly / fusion polypropylene → 3902.10
 *    "Fusion Ultra Grip" and "Fusion Tough Coat Poly" → 3902.10; semantic gets wrong code
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14vvvv.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed VVVV: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH93_GUN_PARTS_ACCESSORIES: 'grip' fires for non-firearm grips ──
    // "Fusion Ultra Grip" → 3902.10 (polypropylene) expected
    // 'grip' in anyOf + inject 9305.10.20(rank40) → overrides semantic
    addNoneOf('AI_CH93_GUN_PARTS_ACCESSORIES', [
      'grip tape', 'athletic grip', 'sports grip', 'climbing grip', 'bat grip',
      'racket grip', 'tennis grip', 'handle grip', 'ultra grip', 'mineral paint',
      'paint', 'coating', 'tough coat', 'body grip', 'non slip grip',
    ], 'grip tape/sports/mineral paint context prevents gun parts rule from injecting 9305 for non-firearm grip products');

    // ── 2. NEW JEWELRY_RING_INTENT ────────────────────────────────────────────
    // "Silver Claddagh Ring" → 7111.00.00 (silver-plated base metal)
    // Bizarre: semantic gets 0305.54 (smoked mackerel) for "silver claddagh ring"
    // PLATED_JEWELRY_INTENT fires (boosts ch.71) but can't overcome semantic routing
    patches.push({
      priority: 570,
      rule: {
        id: 'JEWELRY_RING_INTENT',
        description: 'Rings and finger jewelry → ch.71 (7113.19/7117.19/7111.00). ' +
          '"Claddagh ring", "signet ring", "engagement ring", "silver ring" → 7113.19. ' +
          'Without rule, bizarre semantic results (fish, food) for ring queries.',
        pattern: {
          anyOf: [
            'ring', 'rings', 'claddagh', 'claddagh ring', 'signet ring', 'band ring',
            'engagement ring', 'wedding ring', 'promise ring', 'cocktail ring',
            'thumb ring', 'finger ring', 'fashion ring', 'statement ring',
          ],
          noneOf: [
            'o-ring', 'o ring', 'piston ring', 'key ring', 'keyring', 'key fob',
            'shower ring', 'curtain ring', 'ring binder', 'd-ring', 'split ring',
            'napkin ring', 'snap ring', 'retaining ring', 'rubber ring', 'steel ring',
            'circus ring', 'boxing ring', 'ring light', 'ring stand',
          ],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7113.19', syntheticRank: 9 }, // Articles of jewelry, other precious metal
          { prefix: '7117.19', syntheticRank: 8 }, // Imitation jewelry, other
          { prefix: '7111.00', syntheticRank: 7 }, // Silver-plated base metal
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '71' },
          { delta: 0.4, prefixMatch: '7113' },
        ],
      } as IntentRule,
    });

    // ── 3. NEW GOLD_PRECIOUS_METAL_JEWELRY_INTENT ─────────────────────────────
    // "14k gold jewelry" → 7113.19 expected; semantic gets 7018.10 (glass beads!)
    // Gold/karat signals are strong jewelry indicators but semantic routes to glass
    patches.push({
      priority: 571,
      rule: {
        id: 'GOLD_PRECIOUS_METAL_JEWELRY_INTENT',
        description: 'Gold and precious metal jewelry → ch.71 (7113.19). ' +
          '"14k gold jewelry", "18k gold necklace", "platinum ring" → 7113.19. ' +
          'Without rule, semantic returns glass beads (7018) for gold jewelry queries.',
        pattern: {
          anyOf: [
            '14k gold', '14k', '18k gold', '18k', '10k gold', '10k',
            '24k gold', 'karat gold', 'gold jewelry', 'gold jewellery',
            'platinum jewelry', 'platinum ring', 'gold ring', 'gold necklace',
            'gold bracelet', 'gold pendant', 'gold earring', 'solid gold',
          ],
          noneOf: [
            'gold paint', 'gold spray', 'gold leaf', 'gold foil', 'gold plating',
            'gold tone', 'gold colored', 'gold colour', 'gold coin', 'gold bar',
            'gold bullion', 'gold nugget', 'gold dust',
          ],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7113.19', syntheticRank: 9 }, // Articles of jewelry of other precious metal
          { prefix: '7113.11', syntheticRank: 8 }, // Articles of silver jewelry
          { prefix: '7117.19', syntheticRank: 7 }, // Imitation jewelry, other
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '7113' },
          { delta: 0.4, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW POLYPROPYLENE_TOUGH_COAT_INTENT ────────────────────────────────
    // "Fusion Ultra Grip" → 3902.10.00 (polypropylene, in primary forms)
    // "Fusion Mineral Paint - Gloss - Tough Coat Wipe on Poly" → 3902.10.00
    // These are Fusion brand polypropylene products; need injection to surface 3902.10
    patches.push({
      priority: 545,
      rule: {
        id: 'POLYPROPYLENE_TOUGH_COAT_INTENT',
        description: 'Polypropylene materials and tough coat products → ch.39 (3902.10). ' +
          '"Fusion Ultra Grip", "tough coat poly", "polypropylene material" → 3902.10. ' +
          'Without rule, no ch.39 injection for polypropylene grip/coating products.',
        pattern: {
          anyOf: [
            'tough coat', 'tough coat poly', 'polypropylene', 'polypropylene material',
            'wipe on poly', 'wipe-on poly', 'fusion grip', 'ultra grip coating',
            'grip coating', 'grip material', 'polyolefin',
          ],
          noneOf: ['resin', 'epoxy', 'foam', 'pipe', 'tube', 'film'],
        },
        whitelist: { allowChapters: ['39'] },
        inject: [
          { prefix: '3902.10', syntheticRank: 9 }, // Polypropylene
          { prefix: '3902.90', syntheticRank: 8 }, // Other polymers of propylene
          { prefix: '3209.10', syntheticRank: 7 }, // Paints/varnishes based on acrylic/vinyl
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3902.10' },
          { delta: 0.4, chapterMatch: '39' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch VVVV)...`);
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
    console.log(`\nPatch VVVV complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
