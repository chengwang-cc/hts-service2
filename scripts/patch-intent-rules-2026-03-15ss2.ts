#!/usr/bin/env ts-node
/**
 * Patch SS2 — 2026-03-15: Fix specific issues found in SS1 spot checks.
 *
 * Fixes:
 *  1. INFLATABLE_TOY_BALL_INTENT: inject '9503.00' (more specific), stronger boost
 *     "inflatable beach ball" was ranking 9506 (sports balls) above 9503 (toys)
 *  2. New BEACH_BALL_TOY_INTENT: beach ball specific → 9503.00 with high boost
 *  3. SPORTS_BALL_INTENT: add noneOf "beach ball", "toy ball" (beach/toy balls = ch.95 9503)
 *  4. MOTORCYCLE_ENGINE_PARTS_INTENT: "motorcycle engine parts" → ch.84 (8409)
 *     (also fixes "bearing set" within ch.84)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15ss2.ts
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

    const addNo = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. Update INFLATABLE_TOY_BALL_INTENT: inject '9503.00' + stronger boost
    {
      const e = allRules.find(r => r.id === 'INFLATABLE_TOY_BALL_INTENT');
      if (e) {
        const existingInject = (e as any).inject ?? [];
        const newInject = [
          ...existingInject.filter((s: any) => s.prefix !== '9503'),
          { prefix: '9503.00', syntheticRank: 12 },  // stronger rank
        ];
        const newBoosts = [
          { delta: 0.7, prefixMatch: '9503.00' },  // strong boost for 9503
          { delta: 0.1, chapterMatch: '95' },
        ];
        patches.push({ priority: (e as any).priority ?? 550, rule: { ...e, inject: newInject, boosts: newBoosts } });
        console.log('INFLATABLE_TOY_BALL_INTENT: updated inject to 9503.00 rank=12, stronger boost');
      }
    }

    // 2. New: BEACH_BALL_SAND_TOY_INTENT — specifically "beach ball" → 9503.00
    {
      const existing = allRules.find(r => r.id === 'BEACH_BALL_SAND_TOY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BEACH_BALL_SAND_TOY_INTENT',
          description: 'Beach balls and sand toys → ch.95 (9503.00)',
          pattern: {
            anyOf: [
              'beach ball', 'sand toy', 'sandbox toy', 'sand bucket toy',
              'beach toy', 'pool toy inflatable', 'water toy inflatable',
            ],
          },
          inject: [{ prefix: '9503.00', syntheticRank: 10 }],
          whitelist: { allowChapters: ['95', '39'] },
          boosts: [{ delta: 0.75, prefixMatch: '9503.00' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('BEACH_BALL_SAND_TOY_INTENT: created (beach ball → 9503.00)');
      }
    }

    // 3. SPORTS_BALL_INTENT: noneOf "beach ball", "toy ball" (those are 9503, not 9506)
    {
      for (const ruleId of ['SPORTS_BALL_INTENT', 'AI_CH95_SPORTS_BALL', 'BALL_SPORTS_INTENT']) {
        const e = allRules.find(r => r.id === ruleId);
        if (e) {
          const pat = addNo(e, 'beach ball', 'toy ball', 'foam ball toy', 'squeeze ball');
          patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
          console.log(`${ruleId}: noneOf beach-ball/toy-ball`);
        }
      }
    }

    // 4. New: MOTORCYCLE_ENGINE_PARTS_INTENT — motorcycle engine parts → ch.84 (8409)
    {
      const existing = allRules.find(r => r.id === 'MOTORCYCLE_ENGINE_PARTS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MOTORCYCLE_ENGINE_PARTS_INTENT',
          description: 'Motorcycle/small engine parts → ch.84 (8409)',
          pattern: {
            anyOf: [
              'motorcycle engine parts', 'engine parts motorcycle', 'small engine parts',
              'motorcycle parts engine', 'motorcycle manual', 'engine manual motorcycle',
              'spark plug motorcycle', 'carburetor motorcycle', 'piston ring engine',
              'connecting rod engine', 'cylinder head engine',
            ],
          },
          inject: [{ prefix: '8409.91', syntheticRank: 20 }, { prefix: '8409.99', syntheticRank: 22 }],
          whitelist: { allowChapters: ['84', '85'] },
          boosts: [{ delta: 0.4, prefixMatch: '8409.' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('MOTORCYCLE_ENGINE_PARTS_INTENT: created (motorcycle engine parts → ch.84 8409)');
      }
    }

    // 5. New: GARMENT_MMF_FIBER_INTENT — nylon/polyester/acrylic jacket → ch.61 or ch.62
    //    Fixes: "Nylon jacket" → expected 6101.30.15 (knitted MMF men's coat, ch.61)
    //    The problem: 6201 (woven ch.62) ranks above 6101 (knitted ch.61) for "nylon jacket"
    //    Add boost for 6101 when "nylon" or "polyester" + "jacket" without "woven"/"shell"
    {
      const existing = allRules.find(r => r.id === 'GARMENT_KNIT_MMF_JACKET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GARMENT_KNIT_MMF_JACKET_INTENT',
          description: 'Nylon/polyester jackets/coats → prefer ch.61 (knitted) when no woven signal',
          pattern: {
            anyOf: ['nylon jacket', 'polyester jacket', 'nylon coat', 'acrylic jacket',
                    'nylon fleece jacket', 'polyester fleece jacket', 'nylon wind jacket',
                    'nylon bomber', 'polyester bomber'],
            noneOf: ['woven', 'shell jacket', 'windshell', 'rain jacket', 'gore tex'],
          },
          whitelist: { allowChapters: ['61', '62'] },
          boosts: [{ delta: 0.3, chapterMatch: '61' }],
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('GARMENT_KNIT_MMF_JACKET_INTENT: created (nylon jacket → prefer ch.61)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch SS2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch SS2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
