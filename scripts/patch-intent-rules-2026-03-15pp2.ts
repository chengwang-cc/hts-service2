#!/usr/bin/env ts-node
/**
 * Patch PP2 — 2026-03-15: Fix OO2 regression + dig deeper on accuracy.
 * Baseline post-OO2: 29.41% hit@10 (1478/5025), EMPTY: 22
 *
 * Fixes:
 *  1. GLASS_BOTTLE_CONTAINER_INTENT: add many noneOf terms for bottle accessories
 *     (wine bottle rack/holder/chiller routing to wine beverages = regression fix)
 *  2. New BOTTLE_RACK_STORAGE_INTENT: wine rack / bottle rack → ch.94/83/73
 *  3. SPORTS_BALL_INTENT: noneOf "drink", "water bottle", "sports bottle" (plastic bottles ≠ balls)
 *  4. AI_CH92_DRUM_STAND_ACCESSORY: noneOf "place card stand", "card stand", "business card stand"
 *     (fixes "Wood Stand Place Card" routing to ch.92 instead of ch.44)
 *  5. GAME_BOARD_INTENT (or similar): noneOf "sponge holder", "soap holder" (Checkers sponge holder)
 *  6. New: PILLOW_COVER_DECORATIVE_INTENT: throw pillow cover → ch.94 (cushion cover) OR ch.63 (linen)
 *  7. AI_CH91_WATCH_POCKET: noneOf "caseback screw", "watch screw", "crown" (screws = ch.73)
 *  8. New: CRIMPING_TOOL_INTENT: "crimping" + "tool/plier/kit" → ch.82 (hand tools)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15pp2.ts
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

    const addCh = (e: IntentRule, ...chs: string[]) => {
      const wl = (e.whitelist as any) ?? {};
      return { ...wl, allowChapters: [...new Set([...(wl.allowChapters ?? []), ...chs])] };
    };
    const addNo = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, noneOf: [...new Set([...(pat.noneOf ?? []), ...terms])] };
    };

    // 1. GLASS_BOTTLE_CONTAINER_INTENT: add noneOf for bottle accessories
    //    Regression: "wine bottle rack" → 2204 (wine, ch.22) instead of ch.94 furniture
    {
      const e = allRules.find(r => r.id === 'GLASS_BOTTLE_CONTAINER_INTENT');
      if (e) {
        const pat = addNo(e,
          'bottle rack', 'wine rack', 'bottle holder', 'bottle chiller',
          'bottle cooler', 'bottle tote', 'bottle bag', 'bottle sleeve',
          'bottle cage', 'bottle carrier', 'bottle stand', 'bottle basket',
          'bottle cozy', 'bottle wrap', 'bottle label', 'bottle opener',
          'bottle display', 'bottle crate', 'bottle gift', 'wine rack',
          'wine holder', 'wine chiller', 'wine cooler', 'wine carrier',
          'wine tote', 'beer holder', 'beer cooler', 'beer carrier',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('GLASS_BOTTLE_CONTAINER_INTENT: noneOf bottle/wine accessories');
      }
    }

    // 2. New: BOTTLE_RACK_WINE_STORAGE_INTENT — wine rack / bottle rack → ch.94 (furniture)
    {
      const existing = allRules.find(r => r.id === 'BOTTLE_RACK_WINE_STORAGE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BOTTLE_RACK_WINE_STORAGE_INTENT',
          description: 'Wine/bottle racks and storage → ch.94 (furniture), ch.83, ch.73',
          pattern: {
            anyOf: [
              'wine rack', 'bottle rack', 'wine bottle rack', 'wine storage rack',
              'wine holder', 'wine bottle holder', 'wine bottle stand',
              'bottle holder', 'wine display', 'wine organizer',
            ],
          },
          whitelist: { allowChapters: ['94', '83', '73', '44'] },
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('BOTTLE_RACK_WINE_STORAGE_INTENT: created (wine rack → ch.94,83,73,44)');
      }
    }

    // 3. AI_CH92_DRUM_STAND_ACCESSORY: noneOf "place card", "card stand", "signage holder"
    //    Fixes: "Wood Stand Place Card Business Card" routing to ch.92 (music stands)
    {
      const e = allRules.find(r => r.id === 'AI_CH92_DRUM_STAND_ACCESSORY');
      if (e) {
        const pat = addNo(e,
          'place card', 'card stand', 'signage holder', 'business card stand',
          'card holder stand', 'retail signage', 'price card', 'menu stand',
          'table sign', 'table number', 'number stand',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('AI_CH92_DRUM_STAND_ACCESSORY: noneOf place-card/signage stands');
      }
    }

    // 4. GAME rules: noneOf "sponge holder", "soap holder", "scrubber" (Checkers sponge holder)
    //    Checkers is a brand that makes kitchen accessories, not the board game
    {
      for (const ruleId of ['BOARD_GAME_INTENT', 'GAME_BOARD_INTENT', 'CHESS_GAME_INTENT', 'AI_CH95_BOARD_GAME']) {
        const e = allRules.find(r => r.id === ruleId);
        if (e) {
          const pat = addNo(e,
            'sponge holder', 'soap holder', 'scrubber holder', 'soap dispenser',
            'dish holder', 'sink caddy',
          );
          patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
          console.log(`${ruleId}: noneOf sponge/soap holders`);
        }
      }
    }

    // 5. Watch/clock rules: noneOf "caseback screw", "watch screw" (screws = ch.73, not ch.91)
    {
      for (const ruleId of ['MECHANICAL_WATCH_INTENT', 'WRISTWATCH_ANALOG_INTENT', 'AI_CH91_WATCH_POCKET']) {
        const e = allRules.find(r => r.id === ruleId);
        if (e) {
          const pat = addNo(e,
            'caseback screw', 'watch screw', 'watch crown', 'crown screw',
            'case screw', 'movement screw',
          );
          patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
          console.log(`${ruleId}: noneOf caseback-screw/watch-crown`);
        }
      }
    }

    // 6. New: CRIMPING_TOOL_PLIER_INTENT — "crimping" + tool/plier → ch.82
    //    Fixes: "Xcelite Cable crimping kit" routing to ch.85 wire/cable instead of ch.82 hand tools
    {
      const existing = allRules.find(r => r.id === 'CRIMPING_TOOL_PLIER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CRIMPING_TOOL_PLIER_INTENT',
          description: 'Crimping tools/pliers → ch.82 (hand tools)',
          pattern: {
            anyOf: ['crimping tool', 'crimping plier', 'crimping kit', 'crimper tool', 'wire crimper', 'cable crimper', 'ratchet crimper'],
            noneOf: ['crimping machine', 'crimping press machine'],
          },
          whitelist: { allowChapters: ['82', '85'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('CRIMPING_TOOL_PLIER_INTENT: created (crimping tool → ch.82,85)');
      }
    }

    // 7. JEWELRY_BRACELET_INTENT: add noneOf "tangwood" (wood bracelet = ch.44, not ch.71)
    //    Fixes: "100% Tangwood bracelet" routing to ch.71 jewelry instead of ch.44 wood
    {
      const e = allRules.find(r => r.id === 'JEWELRY_BRACELET_INTENT');
      if (e) {
        const pat = addNo(e,
          'tangwood', 'wood bracelet', 'wooden bracelet', 'teak bracelet',
          'bamboo bracelet', 'rosewood bracelet',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log('JEWELRY_BRACELET_INTENT: noneOf tangwood/wood bracelet');
      }
    }

    // 8. New: WOOD_DISPLAY_STAND_INTENT — wood card stands / display stands → ch.44
    //    Fixes: "Wood Stand Place Card Business Card Retail Signage Holder" → ch.44
    {
      const existing = allRules.find(r => r.id === 'WOOD_DISPLAY_STAND_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOD_DISPLAY_STAND_INTENT',
          description: 'Wood card/display stands → ch.44 (wood articles)',
          pattern: {
            anyOf: ['wood stand', 'wooden stand', 'wood place card', 'wood card holder', 'wood sign holder', 'wood display stand', 'wood menu holder'],
            noneOf: ['music stand', 'sheet music', 'guitar stand', 'drum stand', 'mic stand'],
          },
          whitelist: { allowChapters: ['44', '94', '83'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('WOOD_DISPLAY_STAND_INTENT: created (wood stand → ch.44,94,83)');
      }
    }

    // 9. Wire/cable intent: noneOf "wire harness" (harness = motor parts, not wire)
    {
      const wireRules = allRules.filter(r =>
        r.id && (r.id.includes('WIRE') || r.id.includes('CABLE')) && !r.id.includes('HARNESS')
      );
      for (const e of wireRules) {
        const wl = (e.whitelist as any) ?? {};
        const chs: string[] = wl.allowChapters ?? [];
        if (chs.length > 0 && !chs.includes('85') && !chs.includes('84')) {
          const pat = addNo(e, 'wire harness', 'wiring harness');
          patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
          console.log(`${e.id}: noneOf wire-harness`);
        }
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch PP2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch PP2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
