#!/usr/bin/env ts-node
/**
 * Patch HH2 — 2026-03-14: Current: 75/5000 = 1.50%.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14hh2.ts
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

    // 1. ART_PAINT_INTENT: add ch.52; noneOf oil-painting-print/calico-print
    {
      const e = allRules.find(r => r.id === 'ART_PAINT_INTENT');
      if (e) {
        const wl = addCh(e, '52');
        const pat = addNo(e,
          'oil painting print', 'vintage oil painting', 'print cotton fabric',
          'calico print', 'calico fabric', 'cotton fabric print',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('ART_PAINT_INTENT: added ch.52, noneOf oil-painting-print/calico');
      }
    }

    // 2. STORAGE_BIN_INTENT: add ch.54; noneOf thread-storage/sewing-thread-box
    {
      const e = allRules.find(r => r.id === 'STORAGE_BIN_INTENT');
      if (e) {
        const wl = addCh(e, '54');
        const pat = addNo(e, 'thread storage', 'thread box', 'sewing thread storage', 'thread organizer');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('STORAGE_BIN_INTENT: added ch.54, noneOf thread-storage');
      }
    }

    // 3. AI_CH40_RUBBER_GASKET: add ch.55; noneOf grommet-tape/clothing-grommet
    {
      const e = allRules.find(r => r.id === 'AI_CH40_RUBBER_GASKET');
      if (e) {
        const wl = addCh(e, '55');
        const pat = addNo(e, 'grommet tape', 'clothing grommet', 'grommet alternative', 'punk grommet');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_RUBBER_GASKET: added ch.55, noneOf grommet-tape');
      }
    }

    // 4. AI_CH03_FISH_MEAL_FLOUR: add ch.56; noneOf wool-pellet/sheep-pellet
    {
      const e = allRules.find(r => r.id === 'AI_CH03_FISH_MEAL_FLOUR');
      if (e) {
        const wl = addCh(e, '56');
        const pat = addNo(e, 'wool pellet', 'sheep wool pellet', 'wool pellet material');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH03_FISH_MEAL_FLOUR: added ch.56, noneOf wool-pellet');
      }
    }

    // 5. AI_CH51_WOOL_FABRIC_GENERIC: add ch.56; noneOf wool-pellet
    {
      const e = allRules.find(r => r.id === 'AI_CH51_WOOL_FABRIC_GENERIC');
      if (e) {
        const wl = addCh(e, '56');
        const pat = addNo(e, 'wool pellet', 'sheep wool pellet', 'wool pellet material');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH51_WOOL_FABRIC_GENERIC: added ch.56, noneOf wool-pellet');
      }
    }

    // 6. AI_CH02_LAMB_MUTTON: add ch.56; noneOf wool-pellet
    {
      const e = allRules.find(r => r.id === 'AI_CH02_LAMB_MUTTON');
      if (e) {
        const wl = addCh(e, '56');
        const pat = addNo(e, 'wool pellet', 'sheep wool pellet', 'wool pellet material');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH02_LAMB_MUTTON: added ch.56, noneOf wool-pellet');
      }
    }

    // 7. CAMERA_LENS_INTENT: add ch.56; noneOf microfiber-cloth (lens cloth = nonwoven textile)
    {
      const e = allRules.find(r => r.id === 'CAMERA_LENS_INTENT');
      if (e) {
        const wl = addCh(e, '56');
        const pat = addNo(e,
          'microfiber cloth', 'cleaning cloth', 'glasses wipe', 'lens cloth',
          'microfiber cleaning',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CAMERA_LENS_INTENT: added ch.56, noneOf microfiber-cloth');
      }
    }

    // 8. MICROFIBER_CLOTH_INTENT: add ch.56 (nonwoven microfiber cloth = ch.56)
    {
      const e = allRules.find(r => r.id === 'MICROFIBER_CLOTH_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '56') } });
        console.log('MICROFIBER_CLOTH_INTENT: added ch.56 (nonwoven microfiber = ch.56)');
      }
    }

    // 9. BEANIE_HAT_INTENT: add ch.57; noneOf toque (knit toque may be classified under textiles)
    {
      const e = allRules.find(r => r.id === 'BEANIE_HAT_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '57') } });
        console.log('BEANIE_HAT_INTENT: added ch.57');
      }
    }

    // 10. AUTOMOTIVE_FLOOR_MAT_INTENT: add ch.57 (decorative rug/soft mat = carpet ch.57)
    {
      const e = allRules.find(r => r.id === 'AUTOMOTIVE_FLOOR_MAT_INTENT');
      if (e) {
        const wl = addCh(e, '57');
        const pat = addNo(e,
          'heart shaped mat', 'heart-shaped mat', 'soft rug', 'decorative mat',
          'valentine mat', 'korean style mat',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AUTOMOTIVE_FLOOR_MAT_INTENT: added ch.57, noneOf heart-mat/soft-rug');
      }
    }

    // 11. AI_CH40_RUBBER_FLOOR_MAT: add ch.57; noneOf soft-rug/heart-mat
    {
      const e = allRules.find(r => r.id === 'AI_CH40_RUBBER_FLOOR_MAT');
      if (e) {
        const wl = addCh(e, '57');
        const pat = addNo(e,
          'heart shaped mat', 'heart-shaped mat', 'soft rug', 'decorative mat',
          'valentine mat', 'korean style mat',
        );
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH40_RUBBER_FLOOR_MAT: added ch.57, noneOf soft-rug/heart-mat');
      }
    }

    // 12. TABLECLOTH_INTENT: add ch.58 (chenille/textured fabric table cover = ch.58)
    {
      const e = allRules.find(r => r.id === 'TABLECLOTH_INTENT');
      if (e) {
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: addCh(e, '58') } });
        console.log('TABLECLOTH_INTENT: added ch.58 (chenille fabric table cover)');
      }
    }

    // 13. AI_CH57_KILIM_FLATWEAVE_RUG: add ch.58; noneOf tapestry-tote/tapestry-bag
    {
      const e = allRules.find(r => r.id === 'AI_CH57_KILIM_FLATWEAVE_RUG');
      if (e) {
        const wl = addCh(e, '58');
        const pat = addNo(e, 'tapestry tote', 'tapestry bag', 'tapestry tote bag');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('AI_CH57_KILIM_FLATWEAVE_RUG: added ch.58, noneOf tapestry-tote');
      }
    }

    // 14. CANVAS_TOTE_FABRIC_BAG_INTENT: add ch.58; noneOf tapestry-tote
    {
      const e = allRules.find(r => r.id === 'CANVAS_TOTE_FABRIC_BAG_INTENT');
      if (e) {
        const wl = addCh(e, '58');
        const pat = addNo(e, 'tapestry tote', 'tapestry bag', 'tapestry tote bag');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('CANVAS_TOTE_FABRIC_BAG_INTENT: added ch.58, noneOf tapestry-tote');
      }
    }

    // 15. PHOTOGRAPHY_PORTRAIT_INTENT: add ch.58; noneOf embroidered-portrait
    {
      const e = allRules.find(r => r.id === 'PHOTOGRAPHY_PORTRAIT_INTENT');
      if (e) {
        const wl = addCh(e, '58');
        const pat = addNo(e, 'embroidered portrait', 'embroidered pet', 'pet portrait embroidery');
        patches.push({ priority: (e as any).priority ?? 500, rule: { ...e, whitelist: wl, pattern: pat } });
        console.log('PHOTOGRAPHY_PORTRAIT_INTENT: added ch.58, noneOf embroidered-portrait');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch HH2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch HH2 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
