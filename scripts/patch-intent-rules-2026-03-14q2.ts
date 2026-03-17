#!/usr/bin/env ts-node
/**
 * Patch Q2 — 2026-03-14:
 *
 * Targeting top blockers after P2 (552/5000 = 11.04% blocked):
 *
 * 1. CHRISTMAS_ORNAMENT_INTENT: add ch.39/44/69/70 to allowChapters + noneOf mold.
 *    Ornaments made of plastic (ch.39), wood (ch.44), ceramic (ch.69), glass (ch.70)
 *    are all legitimate Christmas ornaments. Silicone mold for ornament → ch.84.
 *    6 blocks.
 *
 * 2. AI_CH89_CABIN_CRUISER: noneOf for cabin slipper / cabin air filter / cabin decor.
 *    'cabin' → cabin slippers (ch.64), cabin air filter (ch.84), metal cabin decor (ch.73).
 *    6 blocks.
 *
 * 3. AI_CH24_ECIG_VAPE: noneOf for 'puff' as fabric/makeup and 'disposable' as non-vape.
 *    'puff' → puff jacket (ch.62), puff print HTV (ch.59), makeup puff organizer (ch.42).
 *    'disposable' → disposable razor (ch.82), disposable face masks (ch.63), tent ground sheet (ch.63).
 *    6 blocks.
 *
 * 4. SEAFOOD_FISH_INTENT: noneOf for lobster clasp, fish pattern items, oyster forks.
 *    'lobster' → lobster clasp keychain hardware (ch.39). 'fish' → sardines texture roller (ch.44),
 *    plush fish coin purse (ch.39), fish bottle opener (ch.82). 'oyster' → oyster fork (ch.82).
 *    6 blocks.
 *
 * 5. TEA_INTENT: noneOf for tea cozy, teacup, tea ceremony, tea table, greeting card.
 *    'tea' → tea cozy (ch.60), Japanese tea ceremony coaster (ch.44), matcha greeting card (ch.49),
 *    silver tea tray (ch.71), metal tea cup (ch.82).
 *    6 blocks.
 *
 * 6. TOWEL_INTENT: add ch.52/57/58 to allowChapters + noneOf for racks/hooks.
 *    Cotton facial towels (ch.52), cross-stitch kitchen towel (ch.52), hooded towel (ch.52),
 *    birdseye tea towel (ch.57), vintage bath towels (ch.58), towel hook/rack (ch.84).
 *    6 blocks.
 *
 * 7. BED_SHEET_INTENT: add ch.45/48/52/58 + noneOf for paper napkins/placemats.
 *    'napkins' → paper napkins (ch.48). 'sheet set' → cotton fabric sheet (ch.52).
 *    'placemats' → cork placemats (ch.45). 'table cover' → chenille fabric (ch.58).
 *    6 blocks.
 *
 * 8. AI_CH13_NATURAL_GUMS_RESINS: noneOf for balsam as cosmetic + resin as material.
 *    'balsam' → balsam fir face oil/skin stick (ch.34 cosmetics). 'resin' → resin dog tags (ch.39),
 *    resin-based trim plate (ch.85).
 *    6 blocks.
 *
 * 9. 3D_PRINT_PLASTIC_INTENT: add ch.42/73/85 to allowChapters + noneOf for 3D printer accessories.
 *    '3d printed case' → ch.42. '3d printed mounting brackets' → ch.73.
 *    Electronics parts described as '3D printed' → ch.85.
 *    'for 3D printers' (module FOR a printer) → should be excluded.
 *    6 blocks.
 *
 * 10. AI_CH54_ELASTOMERIC_YARN: add ch.39/52/61/62 to allowChapters.
 *     Spandex/elastane mentioned as content % in gloves (ch.39), fabric (ch.52), garments (ch.61/62).
 *     8 blocks.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14q2.ts
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

    // ── 1. CHRISTMAS_ORNAMENT_INTENT: add ch.39/44/69/70 + noneOf mold ────────
    {
      const existing = allRules.find(r => r.id === 'CHRISTMAS_ORNAMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Ornaments made of plastic (ch.39), wood (ch.44), ceramic (ch.69), glass (ch.70)
        const newChapters = [...new Set([...currentChapters, '39', '44', '69', '70'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Silicone/plastic molds for making ornaments (ch.84)
          'mold', 'mould', 'silicone mold', 'ornament mold', 'candy mold',
          'resin mold',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CHRISTMAS_ORNAMENT_INTENT') +
              ' — Fixed Q2: added ch.39/44/69/70 (plastic/wood/ceramic/glass ornaments); noneOf mold',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CHRISTMAS_ORNAMENT_INTENT: added ch.39/44/69/70, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: CHRISTMAS_ORNAMENT_INTENT not found'); }
    }

    // ── 2. AI_CH89_CABIN_CRUISER: noneOf cabin slipper / air filter / decor ──
    {
      const existing = allRules.find(r => r.id === 'AI_CH89_CABIN_CRUISER') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Cabin slippers (footwear, not boats)
          'cabin slipper', 'cabin slippers', 'slipper', 'slippers',
          // Cabin air filter (automotive air filter for car cabin)
          'cabin air filter', 'air filter', 'air filters',
          // Cabin-themed decor signs
          'cabin decor', 'cabin sign', 'name sign', 'deer family',
          'personalized sign', 'metal sign',
          // Log cabin / cabin-style furniture (not boats)
          'log cabin', 'cabin style',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH89_CABIN_CRUISER') +
              ' — Fixed Q2: noneOf cabin slipper/air filter/decor sign (non-marine cabin uses)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH89_CABIN_CRUISER: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH89_CABIN_CRUISER not found'); }
    }

    // ── 3. AI_CH24_ECIG_VAPE: noneOf for puff-as-fabric + disposable-as-non-vape
    {
      const existing = allRules.find(r => r.id === 'AI_CH24_ECIG_VAPE') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'puff' as fabric/fashion term (puff jacket, puff sleeve, puff print)
          'puff jacket', 'puff coat', 'puff sleeve', 'puffy jacket',
          'puff print', 'puff htv', '3d puff', 'puff design',
          'puff cotton', 'cotton puff', 'makeup puff', 'makeup organizer',
          'powder puff',
          // 'disposable' in non-vape context (razor, mask, tent ground sheet)
          'disposable razor', 'razor', 'shaving', 'schick',
          'face mask', 'disposable mask', 'face masks', 'disposable masks',
          'ground sheet', 'tent accessories', 'tent replacement',
          'disposable gloves', 'disposable cups', 'disposable plates',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH24_ECIG_VAPE') +
              ' — Fixed Q2: noneOf puff jacket/puff print/makeup puff/disposable razor/face mask/tent',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH24_ECIG_VAPE: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH24_ECIG_VAPE not found'); }
    }

    // ── 4. SEAFOOD_FISH_INTENT: noneOf for lobster clasp + fish pattern + fork
    {
      const existing = allRules.find(r => r.id === 'SEAFOOD_FISH_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Lobster clasp (jewelry/craft hardware)
          'lobster clasp', 'lobster claw clasp', 'clasp', 'snap hook clasp',
          // Fish pattern / fish texture on non-food items
          'fish pattern', 'fish texture', 'texture roller', 'pottery roller',
          'rolling pin', 'sardines texture', 'nautical pattern',
          // Plush fish toys/keychains
          'taiyaki', 'kawaii fish', 'plush fish', 'fish plush', 'fish toy',
          'fish keychain', 'fish coin purse',
          // Fish-shaped openers/tools
          'bottle opener', 'fish opener', 'pewter fish', 'barware',
          // Oyster forks / seafood cutlery (ch.82)
          'oyster fork', 'oyster forks', 'seafood fork',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SEAFOOD_FISH_INTENT') +
              ' — Fixed Q2: noneOf lobster clasp/fish texture roller/plush fish/bottle opener/oyster fork',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`SEAFOOD_FISH_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SEAFOOD_FISH_INTENT not found'); }
    }

    // ── 5. TEA_INTENT: noneOf for tea cozy, teacup, tea tray, greeting card ──
    {
      const existing = allRules.find(r => r.id === 'TEA_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Tea cozy / cosy (knit cover for teapot)
          'tea cozy', 'tea cosy', 'cozy', 'cosy',
          // Tea ceremony items (wooden coasters, ceremony tools)
          'tea ceremony', 'japanese tea ceremony', 'tea ceremony coaster',
          // Tea-themed greeting cards
          'greeting card', 'love tea', 'japanese love',
          // Silver tea tray / decorative serving trays
          'tea table', 'tea tray', 'serving tray', 'silverplate tray',
          'cottage tea', 'platter',
          // Tea cups / mugs as metalware
          'tea cup', 'teacup', 'metal tea cup', 'wood tea cup',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TEA_INTENT') +
              ' — Fixed Q2: noneOf tea cozy/tea ceremony/greeting card/tea tray/teacup',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`TEA_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: TEA_INTENT not found'); }
    }

    // ── 6. TOWEL_INTENT: add ch.52/57/58 to allowChapters + noneOf racks ─────
    {
      const existing = allRules.find(r => r.id === 'TOWEL_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.52 (cotton facial/hooded towels classified as cotton woven fabric),
        // ch.57 (woven tea towels classified as floor coverings/textiles),
        // ch.58 (terry cloth vintage bath towels)
        const newChapters = [...new Set([...currentChapters, '52', '57', '58'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Towel storage accessories (hooks, racks, holders)
          'towel holder', 'towel rack', 'towel rail', 'door hook',
          'over-the-door', 'bathroom organizer', 'towel hook',
          'bathroom hook',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TOWEL_INTENT') +
              ' — Fixed Q2: added ch.52/57/58 (cotton/woven/terry towel variants); noneOf towel rack/hook/holder',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`TOWEL_INTENT: added ch.52/57/58, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: TOWEL_INTENT not found'); }
    }

    // ── 7. BED_SHEET_INTENT: add ch.45/48/52/58 + noneOf paper napkins ───────
    {
      const existing = allRules.find(r => r.id === 'BED_SHEET_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.45 (cork placemats), ch.48 (paper napkins), ch.52 (cotton sheet fabric),
        // ch.58 (chenille table covers)
        const newChapters = [...new Set([...currentChapters, '45', '48', '52', '58'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Paper napkins (ch.48) - should not fire BED_SHEET rule
          'paper napkin', 'paper napkins', 'luncheon napkin', 'luncheon paper',
          // Cork/vinyl placemats (ch.45)
          'placemat', 'placemats', 'table mat', 'place mat', 'place mats',
          // Table covers / table toppers (not bed sheets)
          'table topper', 'table cover', 'tablecloth', 'table runner',
          // Cross stitch fabric labeled as 'kitchen towel' or 'aida'
          'aida', 'cross stitch fabric', '14ct', '18ct',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BED_SHEET_INTENT') +
              ' — Fixed Q2: added ch.45/48/52/58; noneOf paper napkin/placemat/table cover/aida',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BED_SHEET_INTENT: added ch.45/48/52/58, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: BED_SHEET_INTENT not found'); }
    }

    // ── 8. AI_CH13_NATURAL_GUMS_RESINS: noneOf balsam cosmetics + resin items ─
    {
      const existing = allRules.find(r => r.id === 'AI_CH13_NATURAL_GUMS_RESINS') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'balsam' as fir tree scent in cosmetics (ch.34)
          'balsam fir', 'fir oil', 'fir balsam', 'face oil', 'skin stick',
          'balsam face', 'balsam skin', 'balsam fragrance',
          // 'resin' as material in dog tags, plates, electronic enclosures (ch.39/85)
          'dog tag', 'dog tags', 'resin dog', 'bone shape',
          'trim plate', 'resin based', 'resin encapsulant',
          // 'gum' in non-natural-gum contexts
          'chewing gum', 'bubble gum', 'gum arabic food',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH13_NATURAL_GUMS_RESINS') +
              ' — Fixed Q2: noneOf balsam fir cosmetics/resin dog tag/resin trim plate',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH13_NATURAL_GUMS_RESINS: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH13_NATURAL_GUMS_RESINS not found'); }
    }

    // ── 9. 3D_PRINT_PLASTIC_INTENT: add ch.42/73/85 + noneOf accessories ─────
    {
      const existing = allRules.find(r => r.id === '3D_PRINT_PLASTIC_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.42 (3D printed cases), ch.73 (3D printed metal-equivalent brackets),
        // ch.85 (3D printed electronic parts/accessories)
        const newChapters = [...new Set([...currentChapters, '42', '73', '85'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Items FOR 3D printers (not themselves 3D printed)
          'for 3d printer', 'for 3d printers', '3d printer module',
          'buck converter', 'voltage regulator', 'power supply module',
          'arduino', 'cnc module',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? '3D_PRINT_PLASTIC_INTENT') +
              ' — Fixed Q2: added ch.42/73/85 (3D printed cases/brackets/parts); noneOf for 3D printer modules',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`3D_PRINT_PLASTIC_INTENT: added ch.42/73/85, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: 3D_PRINT_PLASTIC_INTENT not found'); }
    }

    // ── 10. AI_CH54_ELASTOMERIC_YARN: add ch.39/52/61/62 to allowChapters ────
    {
      const existing = allRules.find(r => r.id === 'AI_CH54_ELASTOMERIC_YARN') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (plastic/silicone gloves with spandex), ch.52 (cotton-spandex fabric),
        // ch.61 (knitted garments with elastane %), ch.62 (woven garments with lycra)
        const newChapters = [...new Set([...currentChapters, '39', '52', '61', '62'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Garments with spandex content %
          'babywear', 'baby wear', 'overalls', 'thong', 'lingerie',
          // Accessories with lycra/spandex
          'turban visor', 'visor hat', 'swim cap',
          // Gloves with spandex
          'spandex glove', 'spandex gloves', 'polyester spandex glove',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH54_ELASTOMERIC_YARN') +
              ' — Fixed Q2: added ch.39/52/61/62 (items containing elastomeric fibers); noneOf babywear/overalls/visor',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH54_ELASTOMERIC_YARN: added ch.39/52/61/62, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH54_ELASTOMERIC_YARN not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch Q2)...`);
    let applied = 0;
    let failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
        applied++;
      } catch (err: any) {
        console.error(`  ❌ ${rule.id}: ${err.message}`);
        failed++;
      }
    }

    console.log(`\nPatch Q2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
