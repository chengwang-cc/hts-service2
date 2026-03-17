#!/usr/bin/env ts-node
/**
 * Patch FF2 — 2026-03-14: Current: 103/5000 = 2.06%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14ff2.ts
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

    // 1. AI_CH58_RIBBON_TRIM: add ch.42/48/70/84; noneOf ribbon-torch/vow-book
    {
      const e = allRules.find(r => r.id === 'AI_CH58_RIBBON_TRIM');
      if (e) {
        const wl = addCh(e, '42', '48', '70', '84');
        const pat = addNo(e,
          'ribbon torch', 'torch tip', 'nortel ribbon',
          'vow book', 'vow books',
          'ribbon decor', 'ribbon pattern', 'ribbon design',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH58_RIBBON_TRIM: added ch.42/48/70/84, noneOf ribbon-torch/vow-book');
      }
    }

    // 2. FRESH_VEGETABLE_INTENT: add ch.20/22/35/42; noneOf vegetable-tanned/juice/starch
    {
      const e = allRules.find(r => r.id === 'FRESH_VEGETABLE_INTENT');
      if (e) {
        const wl = addCh(e, '20', '22', '35', '42');
        const pat = addNo(e,
          'vegetable tanned', 'vegetable tan', 'veg tanned', 'full grain leather',
          'vegetable juice', 'vegetable juices',
          'potato starch', 'modified starch', 'derived from potato',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('FRESH_VEGETABLE_INTENT: added ch.20/22/35/42, noneOf veg-tanned/juice/starch');
      }
    }

    // 3. STUFFED_ANIMAL_INTENT: add ch.43/61/63
    {
      const e = allRules.find(r => r.id === 'STUFFED_ANIMAL_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '43', '61', '63') } });
        console.log('STUFFED_ANIMAL_INTENT: added ch.43/61/63 (fur/knit/textile teddy bear)');
      }
    }

    // 4. HOCKEY_STICK_INTENT: add ch.44 (wooden mini/engraved hockey stick keepsake)
    {
      const e = allRules.find(r => r.id === 'HOCKEY_STICK_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '44') } });
        console.log('HOCKEY_STICK_INTENT: added ch.44 (personalized wooden mini hockey stick)');
      }
    }

    // 5. AI_CH19_STUFFED_PASTA: add ch.44; noneOf gnocchi-board/pasta-board
    {
      const e = allRules.find(r => r.id === 'AI_CH19_STUFFED_PASTA');
      if (e) {
        const wl = addCh(e, '44');
        const pat = addNo(e, 'gnocchi board', 'pasta board', 'gnocchi paddle', 'pasta tool');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH19_STUFFED_PASTA: added ch.44, noneOf gnocchi-board/pasta-board');
      }
    }

    // 6. CERAMIC_TILE_INTENT: add ch.44; noneOf wooden-wall-tile/mdf-tile/scrabble-tile
    {
      const e = allRules.find(r => r.id === 'CERAMIC_TILE_INTENT');
      if (e) {
        const wl = addCh(e, '44');
        const pat = addNo(e,
          'wooden wall tile', 'wood wall tile', 'wooden tile', 'wood tile',
          'mdf tile', 'scrabble tile', 'scrabble wall', 'letter tile',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CERAMIC_TILE_INTENT: added ch.44, noneOf wooden-tile/scrabble-tile');
      }
    }

    // 7. SPORTS_JERSEY_GARMENT_INTENT: add ch.39 (plastic protective jersey)
    {
      const e = allRules.find(r => r.id === 'SPORTS_JERSEY_GARMENT_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '39') } });
        console.log('SPORTS_JERSEY_GARMENT_INTENT: added ch.39 (plastic wearable jersey)');
      }
    }

    // 8. SPORTS_JERSEY_INTENT: add ch.39
    {
      const e = allRules.find(r => r.id === 'SPORTS_JERSEY_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '39') } });
        console.log('SPORTS_JERSEY_INTENT: added ch.39 (plastic wearable jersey)');
      }
    }

    // 9. FANNY_PACK_INTENT: add ch.39 (plastic fanny pack)
    {
      const e = allRules.find(r => r.id === 'FANNY_PACK_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '39') } });
        console.log('FANNY_PACK_INTENT: added ch.39 (plastic fanny pack)');
      }
    }

    // 10. AI_CH59_TIRE_CORD_FABRIC: add ch.40 (tire = rubber ch.40, not tire cord fabric ch.59)
    {
      const e = allRules.find(r => r.id === 'AI_CH59_TIRE_CORD_FABRIC');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '40') } });
        console.log('AI_CH59_TIRE_CORD_FABRIC: added ch.40 (rubber tires = ch.40)');
      }
    }

    // 11. AI_CH64_MOLDED_PLASTIC_SANDALS: add ch.40; noneOf croc-top/croc-print
    {
      const e = allRules.find(r => r.id === 'AI_CH64_MOLDED_PLASTIC_SANDALS');
      if (e) {
        const wl = addCh(e, '40');
        const pat = addNo(e,
          'croc top', 'croc crop', 'croc print', 'croc skin', 'croc leather',
          'cropped croc',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH64_MOLDED_PLASTIC_SANDALS: added ch.40, noneOf croc-top/croc-print');
      }
    }

    // 12. DENTAL_ORAL_INSTRUMENT_INTENT: add ch.42 (silicone oral accessories = ch.42 plastic goods)
    {
      const e = allRules.find(r => r.id === 'DENTAL_ORAL_INSTRUMENT_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '42') } });
        console.log('DENTAL_ORAL_INSTRUMENT_INTENT: added ch.42 (silicone cheek retractors = ch.42)');
      }
    }

    // 13. AI_CH91_WATCH_PARTS_DIAL: add ch.42/85; noneOf jewel-case/clock-spring
    {
      const e = allRules.find(r => r.id === 'AI_CH91_WATCH_PARTS_DIAL');
      if (e) {
        const wl = addCh(e, '42', '85');
        const pat = addNo(e,
          'jewel case', 'cd jewel', 'jewel box', 'cd case',
          'clock spring', 'clockspring', 'combination switch',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH91_WATCH_PARTS_DIAL: added ch.42/85, noneOf jewel-case/clock-spring');
      }
    }

    // 14. KNEE_BRACE_SUPPORT_INTENT: add ch.42; noneOf leather-brace/wrist-leather
    {
      const e = allRules.find(r => r.id === 'KNEE_BRACE_SUPPORT_INTENT');
      if (e) {
        const wl = addCh(e, '42');
        const pat = addNo(e, 'leather brace', 'leather wrist brace', 'leather wrist braces');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('KNEE_BRACE_SUPPORT_INTENT: added ch.42, noneOf leather-brace');
      }
    }

    // 15. SASHIKO_STENCIL_DRAWING_INTENT: add ch.42; noneOf sashiko-thimble/leather-thimble
    {
      const e = allRules.find(r => r.id === 'SASHIKO_STENCIL_DRAWING_INTENT');
      if (e) {
        const wl = addCh(e, '42');
        const pat = addNo(e, 'sashiko thimble', 'leather thimble', 'sashiko leather');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('SASHIKO_STENCIL_DRAWING_INTENT: added ch.42, noneOf sashiko-thimble');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch FF2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch FF2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
