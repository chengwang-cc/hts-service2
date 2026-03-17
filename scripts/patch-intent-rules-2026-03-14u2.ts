#!/usr/bin/env ts-node
/**
 * Patch U2 — 2026-03-14:
 *
 * Targeting top blockers after T2 (363/5000 = 7.26% blocked):
 *
 * 1. AI_CH88_HANG_GLIDER: add ch.40/44 + noneOf party balloons.
 *    'balloon' → party latex balloons (ch.40), wooden hot-air balloon decor (ch.44).
 *
 * 2. FAUX_FUR_PILE_FABRIC_INTENT: add ch.43/61/65.
 *    Faux fur pompom (ch.43 artificial fur), knitted faux fur (ch.61), helmet cover with pom pom (ch.65).
 *
 * 3. WINE_INTENT: noneOf champagne/wine as color + wine stopper.
 *    'champagne' → photo album color, socks color. 'wine' → loafer color, wine stopper.
 *
 * 4. AI_CH54_RAYON_FABRIC: add ch.52/55/65.
 *    Cotton/viscose blend fabric (ch.52), rayon-cotton mixed fabric (ch.55), viscose cap (ch.65).
 *
 * 5. SYNTHETIC_MMF_YARN_INTENT: add ch.54/57.
 *    Polyester filament yarn (ch.54), acrylic yarn tufted rug (ch.57).
 *
 * 6. LEATHER_JACKET_INTENT: add ch.62/63.
 *    Used leather jackets (ch.62 woven garment), suede jacket (ch.62), wool moto jacket (ch.62).
 *
 * 7. AI_CH65_DISPOSABLE_CAP: add ch.62/63 + noneOf golf club headcover.
 *    Headcoverings (ch.62 garment), golf club headcover (ch.63, not head covering).
 *
 * 8. AI_CH67_WIGS_HAIRPIECES: noneOf CNC extension mount / switch plate / scrub cap.
 *    'extension' → CNC monitor extension mount (ch.84). 'switch' → outlet cover plate (ch.85).
 *    'ponytail' → ponytail scrub cap (ch.65, medical garment).
 *
 * 9. PRESS_ON_NAIL_BEAUTY_INTENT: add ch.67/73/82.
 *    Press-on nails in floral design (ch.67), press-on nail hardware (ch.73), nail prep kit (ch.82).
 *
 * 10. CANDLE_HOME_INTENT: add ch.70/71/73 + noneOf snuffer.
 *     Candle wedding favor in glass vessel (ch.70), silver candle snuffer (ch.71),
 *     base metal candle snuffer (ch.73). Snuffer is an accessory, not a candle.
 *
 * 11. STAINED_GLASS_FLAT_INTENT: add ch.83/84 + noneOf jig.
 *     Gold brass suncatcher (ch.83), stained glass making jig (ch.84 = 8466 machine tools).
 *
 * 12. AI_CH59_COATED_FABRIC_PVC_PU: noneOf cement-coated nails / palm-coated gloves / club headcover.
 *     Rule has empty anyOf (fires on everything), so noneOf needed for common false matches.
 *
 * 13. SEWING_SUPPLIES_INTENT: add ch.55/73 + noneOf staple fiber.
 *     Steel embroidery needles (ch.73), aluminum crochet hooks (ch.73), PVA staple fiber (ch.55).
 *
 * 14. SHIRT_GARMENT_BACKUP_INTENT: add ch.39.
 *     Hi-vis/protective polyester shirts classified as plastic protective clothing (ch.39).
 *
 * 15. STICKER_SHEET_PAPER_INTENT: add ch.58/73 + noneOf socks/poster.
 *     Embroidered QR sticker patch (ch.58), metal die-cut vinyl stickers (ch.73).
 *     Socks with sticker tattoo design (ch.61 - not actual stickers).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14u2.ts
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

    // ── 1. AI_CH88_HANG_GLIDER: add ch.40/44 + noneOf party balloons ─────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH88_HANG_GLIDER') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '40', '44'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'party balloon', 'party balloons', 'latex balloon', 'latex party',
          'balloon garland', 'balloon arch', 'birthday balloon', 'balloon decor',
          'balloon kit', 'balloon set', 'foil balloon',
          // Decorative wood puzzles with balloon shapes
          'growth chart', 'wall decor chart', 'hot air balloon puzzle',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH88_HANG_GLIDER') +
              ' — Fixed U2: added ch.40/44; noneOf party balloon/latex/garland/arch',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH88_HANG_GLIDER: added ch.40/44, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH88_HANG_GLIDER not found'); }
    }

    // ── 2. FAUX_FUR_PILE_FABRIC_INTENT: add ch.43/61/65 ──────────────────────
    {
      const existing = allRules.find(r => r.id === 'FAUX_FUR_PILE_FABRIC_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '43', '61', '65'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'helmet cover', 'riding helmet cover', 'equestrian helmet',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FAUX_FUR_PILE_FABRIC_INTENT') +
              ' — Fixed U2: added ch.43 (artificial fur), ch.61 (knitted faux fur garment), ch.65 (helmet cover with pom pom)',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`FAUX_FUR_PILE_FABRIC_INTENT: added ch.43/61/65, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: FAUX_FUR_PILE_FABRIC_INTENT not found'); }
    }

    // ── 3. WINE_INTENT: noneOf champagne/wine as color + accessories ──────────
    {
      const existing = allRules.find(r => r.id === 'WINE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'champagne' as color/fabric description (not the drink)
          'in champagne', 'champagne color', 'champagne colored', 'champagne coloured',
          'champagne fabric', 'champagne jacquard', 'jacquard',
          // 'champagne' as photo album style
          'photo album', 'wedding album', 'photo book',
          // 'wine' as color in shoes/clothing
          'in wine', 'wine color', 'wine colored', 'wine loafer',
          // Wine accessories (not wine itself)
          'wine stopper', 'beadable wine stopper',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'WINE_INTENT') +
              ' — Fixed U2: noneOf champagne/wine as color, photo album, wine stopper',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`WINE_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: WINE_INTENT not found'); }
    }

    // ── 4. AI_CH54_RAYON_FABRIC: add ch.52/55/65 ─────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH54_RAYON_FABRIC') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '52', '55', '65'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH54_RAYON_FABRIC') +
              ' — Fixed U2: added ch.52 (cotton/viscose blend), ch.55 (rayon/cotton mixed), ch.65 (viscose cap)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH54_RAYON_FABRIC: added ch.52/55/65`);
      } else { console.log('WARNING: AI_CH54_RAYON_FABRIC not found'); }
    }

    // ── 5. SYNTHETIC_MMF_YARN_INTENT: add ch.54/57 ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SYNTHETIC_MMF_YARN_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '54', '57'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SYNTHETIC_MMF_YARN_INTENT') +
              ' — Fixed U2: added ch.54 (polyester filament yarn), ch.57 (acrylic tufted rug)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SYNTHETIC_MMF_YARN_INTENT: added ch.54/57`);
      } else { console.log('WARNING: SYNTHETIC_MMF_YARN_INTENT not found'); }
    }

    // ── 6. LEATHER_JACKET_INTENT: add ch.62/63 ───────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'LEATHER_JACKET_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.62 (used leather/suede jackets, wool moto jackets classified as woven garments)
        const newChapters = [...new Set([...currentChapters, '62'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'LEATHER_JACKET_INTENT') +
              ' — Fixed U2: added ch.62 (used leather/suede/wool moto jackets as woven garments)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`LEATHER_JACKET_INTENT: added ch.62`);
      } else { console.log('WARNING: LEATHER_JACKET_INTENT not found'); }
    }

    // ── 7. AI_CH65_DISPOSABLE_CAP: add ch.62/63 + noneOf golf club headcover ─
    {
      const existing = allRules.find(r => r.id === 'AI_CH65_DISPOSABLE_CAP') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '62', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'golf club headcover', 'club headcover', 'golf club cover',
          'iron headcover', 'driver headcover',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH65_DISPOSABLE_CAP') +
              ' — Fixed U2: added ch.62/63 (headcovering garments); noneOf golf club headcover',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH65_DISPOSABLE_CAP: added ch.62/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH65_DISPOSABLE_CAP not found'); }
    }

    // ── 8. AI_CH67_WIGS_HAIRPIECES: noneOf CNC mount / switch plate / scrub cap
    {
      const existing = allRules.find(r => r.id === 'AI_CH67_WIGS_HAIRPIECES') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // CNC machine extension mount (matched 'extension' = hair extension)
          'extension mount', 'monitor extension', 'cnc extension', 'machine extension',
          'masso touch', 'onefinity', 'cnc machine',
          // Switch plate outlet covers (matched 'switch' = hair switch)
          'switch plate', 'outlet cover', 'outlet covers', 'plate outlet',
          // Ponytail scrub cap for medical workers (matched 'ponytail')
          'scrub cap', 'ponytail scrub',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH67_WIGS_HAIRPIECES') +
              ' — Fixed U2: noneOf CNC extension mount/switch plate/ponytail scrub cap',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH67_WIGS_HAIRPIECES: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH67_WIGS_HAIRPIECES not found'); }
    }

    // ── 9. PRESS_ON_NAIL_BEAUTY_INTENT: add ch.67/73/82 ──────────────────────
    {
      const existing = allRules.find(r => r.id === 'PRESS_ON_NAIL_BEAUTY_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.67 (press-on nails with floral designs), ch.73 (press-on nail hardware), ch.82 (nail prep kits)
        const newChapters = [...new Set([...currentChapters, '67', '73', '82'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PRESS_ON_NAIL_BEAUTY_INTENT') +
              ' — Fixed U2: added ch.67 (floral press-on nails), ch.73 (nail hardware), ch.82 (nail prep kit)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`PRESS_ON_NAIL_BEAUTY_INTENT: added ch.67/73/82`);
      } else { console.log('WARNING: PRESS_ON_NAIL_BEAUTY_INTENT not found'); }
    }

    // ── 10. CANDLE_HOME_INTENT: add ch.70/71/73 + noneOf snuffer ─────────────
    {
      const existing = allRules.find(r => r.id === 'CANDLE_HOME_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.70 (glass candle vessels as wedding favors), ch.71 (silver candle snuffers),
        // ch.73 (base metal candle snuffers)
        const newChapters = [...new Set([...currentChapters, '70', '71', '73'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Candle snuffer (tool to extinguish candles, not a candle)
          'candle snuffer', 'snuffer', 'wick snuffer', 'flame snuffer',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CANDLE_HOME_INTENT') +
              ' — Fixed U2: added ch.70/71/73 (glass vessel/silver snuffer/base metal snuffer); noneOf candle snuffer',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CANDLE_HOME_INTENT: added ch.70/71/73, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: CANDLE_HOME_INTENT not found'); }
    }

    // ── 11. STAINED_GLASS_FLAT_INTENT: add ch.83/84 + noneOf jig ────────────
    {
      const existing = allRules.find(r => r.id === 'STAINED_GLASS_FLAT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.83 (gold/brass suncatchers = metal ornamental articles), ch.84 (stained glass jig = machine tool 8466)
        const newChapters = [...new Set([...currentChapters, '83', '84'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Stained glass making jigs (tools for making SG patterns, not SG panels)
          'jig', 'jigs', 'stained glass jig', 'glass jig',
          'succulent jig', 'hexagon jig', 'octagon jig', 'dodecagon jig',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STAINED_GLASS_FLAT_INTENT') +
              ' — Fixed U2: added ch.83 (brass suncatcher), ch.84 (SG making jig); noneOf jig',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`STAINED_GLASS_FLAT_INTENT: added ch.83/84, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: STAINED_GLASS_FLAT_INTENT not found'); }
    }

    // ── 12. AI_CH59_COATED_FABRIC_PVC_PU: noneOf false positives ────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH59_COATED_FABRIC_PVC_PU') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Cement-coated nails (the product is nails, not coated fabric)
          'cement coated', 'vinyl resin or cement', 'coated wire nails', 'coated nails',
          // Palm-coated work gloves (gloves with coated grip, not PVC/PU fabric)
          'palm coated', 'crinkle latex', 'work glove coated', 'glove palm',
          // Golf club headcover with PU coating (not PVC/PU fabric roll)
          'golf club headcover', 'pu-coated textile', 'club headcover',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH59_COATED_FABRIC_PVC_PU') +
              ' — Fixed U2: noneOf cement coated nails/palm coated gloves/golf club headcover',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH59_COATED_FABRIC_PVC_PU: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH59_COATED_FABRIC_PVC_PU not found'); }
    }

    // ── 13. SEWING_SUPPLIES_INTENT: add ch.55/73 + noneOf staple fiber ───────
    {
      const existing = allRules.find(r => r.id === 'SEWING_SUPPLIES_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.55 (PVA synthetic fiber with 'sewing thread' in description), ch.73 (metal needles/hooks)
        const newChapters = [...new Set([...currentChapters, '55', '73'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // PVA staple fibers (not sewing thread - a fiber raw material)
          'staple fiber', 'staple fibers', 'pva fiber', 'pvà fiber', 'synthetic staple',
          'not put up for retail sale',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SEWING_SUPPLIES_INTENT') +
              ' — Fixed U2: added ch.55/73 (synthetic fiber/metal needles); noneOf staple fibers',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SEWING_SUPPLIES_INTENT: added ch.55/73, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SEWING_SUPPLIES_INTENT not found'); }
    }

    // ── 14. SHIRT_GARMENT_BACKUP_INTENT: add ch.39 ───────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SHIRT_GARMENT_BACKUP_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (hi-vis/protective polyester shirts classified as plastic protective clothing)
        const newChapters = [...new Set([...currentChapters, '39'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SHIRT_GARMENT_BACKUP_INTENT') +
              ' — Fixed U2: added ch.39 (protective/hi-vis shirts as plastic protective clothing)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SHIRT_GARMENT_BACKUP_INTENT: added ch.39`);
      } else { console.log('WARNING: SHIRT_GARMENT_BACKUP_INTENT not found'); }
    }

    // ── 15. STICKER_SHEET_PAPER_INTENT: add ch.58/73 + noneOf socks/poster ───
    {
      const existing = allRules.find(r => r.id === 'STICKER_SHEET_PAPER_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.58 (embroidered QR sticker patch/sheet), ch.73 (die-cut metal vinyl stickers)
        const newChapters = [...new Set([...currentChapters, '58', '73'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Socks with sticker tattoo design (knitted garment, not actual sticker sheet)
          'socks', 'sock', 'sticker tattoo sock', 'tattoo socks',
          // Book/poster set with bonus stickers (the product is the book, not sticker sheet)
          'poster and stickers', 'book tracker', 'book stickers',
          // 'stickers' as product in knit item description
          'warrior cats',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STICKER_SHEET_PAPER_INTENT') +
              ' — Fixed U2: added ch.58/73; noneOf socks/poster and stickers',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`STICKER_SHEET_PAPER_INTENT: added ch.58/73, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: STICKER_SHEET_PAPER_INTENT not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch U2)...`);
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

    console.log(`\nPatch U2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
