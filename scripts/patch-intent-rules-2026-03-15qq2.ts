#!/usr/bin/env ts-node
/**
 * Patch QQ2 — 2026-03-15: Further chit-chats accuracy improvements.
 *
 * Fixes:
 *  1. New SPONGE_HOLDER_KITCHEN_INTENT: sponge/soap holder → ch.69/73/39/94
 *     (Checkers-brand sponge holder routing to ch.95 board games)
 *  2. New PILLOW_COVER_BED_LINEN_INTENT: pillow case/cover + "cotton" → ch.63
 *  3. STUFFED_CUSHION_PILLOW_INTENT (or similar): noneOf "pillow case", "pillowcase", "pillow cover"
 *  4. New MOTOR_ROTISSERIE_SMALL_INTENT: BBQ/rotisserie motor → ch.85 (8501.20 small motors)
 *  5. AI_CH48_PAPERBOARD: noneOf "diorama" (paper diorama might be ceramic art)
 *  6. New BEARING_ENGINE_PARTS_INTENT: "bearing set" + engine context → ch.84
 *  7. New VALVE_ENGINE_PART_INTENT: "PCV valve", "rotary valve" + engine → ch.84 (not 8481 valves)
 *  8. BOOK_BINDING_MACHINE_INTENT: noneOf "hand tool", "clamp", "binding clamp" (manual binding parts = ch.82)
 *  9. WINE_GLASS_INTENT: add ch.33 (perfume bottle = decorative glass)
 * 10. AI_CH85_ELECTRIC_MOTOR: add noneOf if overly broad
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15qq2.ts
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

    // 1. New: SPONGE_HOLDER_KITCHEN_INTENT — sponge/soap dish/holder → ch.69/39/73/94
    //    Fixes: "Mustard Checkers Sponge Holder" → 9504 (board games) instead of ceramic/plastic
    {
      const existing = allRules.find(r => r.id === 'SPONGE_HOLDER_KITCHEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SPONGE_HOLDER_KITCHEN_INTENT',
          description: 'Kitchen sponge/soap holders → ch.69 (ceramic), ch.39 (plastic), ch.73 (metal)',
          pattern: {
            anyOf: [
              'sponge holder', 'sponge caddy', 'sponge dispenser', 'sponge sink',
              'soap holder', 'soap dish', 'soap dispenser holder', 'dish scrubber holder',
              'sink sponge', 'kitchen sponge', 'scrubber holder', 'sponge rack',
            ],
          },
          whitelist: { allowChapters: ['69', '39', '73', '94', '83'] },
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('SPONGE_HOLDER_KITCHEN_INTENT: created (sponge/soap holder → ch.69,39,73,94,83)');
      }
    }

    // 2. New: PILLOW_COVER_BED_LINEN_INTENT — pillow case/cover → ch.63 (bed linen, not cushion)
    //    Fixes: "pillow case" still routing to 9404.90 cushions for some queries
    {
      const existing = allRules.find(r => r.id === 'PILLOW_COVER_BED_LINEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PILLOW_COVER_BED_LINEN_INTENT',
          description: 'Pillow cases/covers as bed linen → ch.63',
          pattern: {
            anyOf: ['pillow case', 'pillowcase', 'pillow cover', 'pillow sham', 'bolster case'],
            noneOf: ['throw pillow insert', 'pillow stuffing', 'pillow filler', 'pillow form'],
          },
          whitelist: { allowChapters: ['63', '94', '52', '58'] },
        } as IntentRule;
        patches.push({ priority: 550, rule: newRule });
        console.log('PILLOW_COVER_BED_LINEN_INTENT: created (pillow case → ch.63,94,52,58)');
      }
    }

    // 3. Cushion/pillow fill rules: noneOf "pillow case", "pillowcase" (covers ≠ stuffed cushions)
    {
      for (const ruleId of ['CUSHION_PILLOW_FILL_INTENT', 'PILLOW_CUSHION_INSERT_INTENT', 'STUFFED_PILLOW_INTENT']) {
        const e = allRules.find(r => r.id === ruleId);
        if (e) {
          const pat = addNo(e, 'pillow case', 'pillowcase', 'pillow cover', 'pillow sham');
          patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
          console.log(`${ruleId}: noneOf pillow-case/cover`);
        }
      }
    }

    // 4. New: MOTOR_SMALL_BBQ_ROTISSERIE_INTENT — BBQ/rotisserie/grill motor → ch.85 (8501.20)
    {
      const existing = allRules.find(r => r.id === 'MOTOR_SMALL_BBQ_ROTISSERIE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MOTOR_SMALL_BBQ_ROTISSERIE_INTENT',
          description: 'Rotisserie/BBQ/grill motors → ch.85 (small electric motors)',
          pattern: {
            anyOf: ['rotisserie motor', 'bbq motor', 'grill motor', 'rotisserie drive', 'spit motor'],
          },
          whitelist: { allowChapters: ['85'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('MOTOR_SMALL_BBQ_ROTISSERIE_INTENT: created (rotisserie motor → ch.85)');
      }
    }

    // 5. New: ENGINE_PCV_VALVE_INTENT — PCV valve / positive crankcase ventilation → ch.84 (engine parts)
    //    Fixes: "PCV Valve", "Rotary valve" routing to 8481 (valves ch.84) vs expected 8409 (engine parts)
    {
      const existing = allRules.find(r => r.id === 'ENGINE_PCV_VALVE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENGINE_PCV_VALVE_INTENT',
          description: 'Engine-specific valves (PCV, intake, rotary) → ch.84 (8409 engine parts)',
          pattern: {
            anyOf: [
              'pcv valve', 'positive crankcase', 'intake valve', 'exhaust valve',
              'rotary valve engine', 'engine valve', 'cylinder head valve',
            ],
          },
          whitelist: { allowChapters: ['84'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('ENGINE_PCV_VALVE_INTENT: created (PCV/engine valve → ch.84)');
      }
    }

    // 6. New: ENGINE_BEARING_SET_INTENT — bearing set for engine → ch.84 (8409 engine parts)
    {
      const existing = allRules.find(r => r.id === 'ENGINE_BEARING_SET_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENGINE_BEARING_SET_INTENT',
          description: 'Engine bearing sets → ch.84 (engine parts 8409)',
          pattern: {
            anyOf: ['bearing set', 'engine bearing', 'crankshaft bearing', 'rod bearing', 'main bearing'],
            noneOf: ['wheel bearing', 'hub bearing', 'trailer bearing'],
          },
          whitelist: { allowChapters: ['84'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('ENGINE_BEARING_SET_INTENT: created (engine bearing → ch.84)');
      }
    }

    // 7. Book binding machine rule: noneOf "hand tool", "book binding clamp", "binding clamp"
    //    Fixes: "binding parts" routing to 8440.90 (binding machine) vs expected 8203.20 (hand tool parts)
    {
      const bindingRules = allRules.filter(r => r.id && r.id.includes('BOOKBINDING') || r.id?.includes('BOOK_BIND'));
      for (const e of bindingRules) {
        const pat = addNo(e, 'binding clamp', 'hand binding', 'book clamp');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log(`${e.id}: noneOf hand-binding/clamp`);
      }
    }

    // 8. WINE_GLASS_INTENT: add ch.33 (perfume/glass bottles = decorative glass ch.70 already included)
    {
      const e = allRules.find(r => r.id === 'WINE_GLASS_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '33') } });
        console.log('WINE_GLASS_INTENT: added ch.33 (decorative glass perfume)');
      }
    }

    // 9. New: CERAMIC_PET_BOWL_INTENT — pet bowls → ch.69 (ceramic) or ch.73 (metal)
    //    Fixes: "Ceramic Pet Bowl" routing correctly (already works, but add steer for other pet bowl queries)
    {
      const existing = allRules.find(r => r.id === 'CERAMIC_PET_BOWL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CERAMIC_PET_BOWL_INTENT',
          description: 'Pet bowls/feeders → ch.69 (ceramic), ch.73 (metal), ch.39 (plastic)',
          pattern: {
            anyOf: [
              'pet bowl', 'dog bowl', 'cat bowl', 'pet feeder bowl', 'pet dish',
              'dog dish', 'cat dish', 'pet food bowl', 'water bowl pet',
            ],
          },
          whitelist: { allowChapters: ['69', '73', '39', '94'] },
        } as IntentRule;
        patches.push({ priority: 500, rule: newRule });
        console.log('CERAMIC_PET_BOWL_INTENT: created (pet bowl → ch.69,73,39,94)');
      }
    }

    // 10. Garment rules: ensure woven/knitted routing handles "denim" keyword better
    //     Add noneOf "denim" to rules that route to wool codes (6201.20 = wool)
    {
      const woolRules = allRules.filter(r => {
        const wl = (r.whitelist as any) ?? {};
        const chs: string[] = wl.allowChapters ?? [];
        // Rules that force wool overcoat codes but shouldn't apply to denim
        return r.id && r.id.includes('WOOL') && chs.some(c => c === '61' || c === '62');
      });
      for (const e of woolRules.slice(0, 3)) {
        const pat = addNo(e, 'denim', 'jeans', 'denim jacket');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, pattern: pat } });
        console.log(`${e.id}: noneOf denim/jeans`);
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch QQ2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch QQ2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
