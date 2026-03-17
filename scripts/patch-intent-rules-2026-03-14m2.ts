#!/usr/bin/env ts-node
/**
 * Patch M2 — 2026-03-14:
 *
 * Targeting remaining top blockers after L2 (663/5000 = 13.26% blocked):
 *
 * 1. CRYSTAL_GEMSTONE_INTENT: Add ch.25/68 + noneOf bead/clasp.
 *    'quartz' → natural quartz (ch.25), 'fluorite' → mineral (ch.25).
 *    'gemstone' → glass beads (ch.70 - already added), quartz sphere (ch.68).
 *    9 blocks.
 *
 * 2. MUSICAL_INSTRUMENT_INTENT: noneOf for guitar effects/strap/bridge pin/cello bag.
 *    'guitar' → strap (ch.42), bridge pins (ch.39), capacitor (ch.85), effects pedal (ch.85).
 *    'piano' → electronic keyboard (ch.85). 'cello' → cello bags (ch.39).
 *    10 blocks. Add ch.85 for guitar electronics.
 *
 * 3. AI_CH51_RAW_WOOL: noneOf for 'raw' as non-wool context.
 *    'raw' → "natural raw crystal" (ch.25), "raw Pokemon card" (ch.44).
 *    Add noneOf: crystal/mineral/pokemon/card/frame/display.
 *    11 blocks.
 *
 * 4. SKINCARE_INTENT: Add ch.30 to allowChapters + more noneOf.
 *    'serum' → pharmaceutical serum (ch.30). Need ch.30 in allowChapters.
 *    11 blocks.
 *
 * 5. AI_CH56_WADDING_BATTING: Add ch.58/59/60/63 to allowChapters.
 *    'felt' → felt ornament (ch.58), felt hat (ch.59), felt coasters (ch.58),
 *    felt decorative figures (ch.63), batting fabric (ch.60).
 *    10 blocks.
 *
 * 6. STATIONERY_NOTEBOOK_INTENT: Add ch.39/44 + noneOf for non-paper bookmarks.
 *    'bookmark' → faux leather (ch.39), wood (ch.44), woven (ch.58), ceramic sign (ch.69),
 *    engraved silver (ch.71/83). Non-paper bookmarks are common.
 *    11 blocks.
 *
 * 7. AI_CH17_MAPLE_SUGAR_SYRUP: noneOf for 'maple' as wood/design/brand context.
 *    'maple' → maple wristbands (ch.39), maple-design pouch (ch.42), maple wood boards (ch.44),
 *    "Maple Leafs" hockey card (ch.49), maple suede boots (ch.64), maple cola can (ch.76).
 *    9 blocks.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14m2.ts
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

    // ── 1. CRYSTAL_GEMSTONE_INTENT: add ch.25/68 + noneOf bead/clasp ──────────
    {
      const existing = allRules.find(r => r.id === 'CRYSTAL_GEMSTONE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.25 (raw minerals/quartz), ch.68 (stone articles like quartz spheres), ch.70 (glass beads)
        const newChapters = [...new Set([...currentChapters, '25', '68', '70'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'bead', 'beads', 'bead strand', 'glass bead', 'gemstone bead',
          'clasp', 'sew-on', 'cardigan clasp',
          // Add quartz/crystal in non-gemstone context
          'quartz countertop', 'quartz worktop', 'quartz watch',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CRYSTAL_GEMSTONE_INTENT') +
              ' — Fixed M2: added ch.25/68/70 for raw minerals/stone articles/glass beads; noneOf bead/clasp',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CRYSTAL_GEMSTONE_INTENT: added ch.25/68/70, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: CRYSTAL_GEMSTONE_INTENT not found'); }
    }

    // ── 2. MUSICAL_INSTRUMENT_INTENT: noneOf + add ch.85 ─────────────────────
    {
      const existing = allRules.find(r => r.id === 'MUSICAL_INSTRUMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.85 for guitar electronics (effects pedals, capacitors, keyboards)
        const newChapters = [...new Set([...currentChapters, '85'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Guitar accessories (not instruments)
          'guitar strap', 'guitar straps', 'leather strap',
          'bridge pin', 'bridge pins', 'guitar bridge pin',
          'guitar pick', 'guitar picks', 'picks',
          // Guitar electronics
          'guitar amp', 'amplifier', 'guitar capacitor', 'capacitor',
          'effects pedal', 'effect pedal', 'guitar effects', 'guitar effect',
          'floor processor', 'multieffects', 'stomp', 'hx stomp',
          'wireless keyboard',
          // Cello bags/cases (storage, not instruments)
          'cello bag', 'cello bags', 'violin bag', 'guitar bag',
          // Piano keyboard games
          'rock band', 'nintendo',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'MUSICAL_INSTRUMENT_INTENT') +
              ' — Fixed M2: added ch.85 (guitar electronics); noneOf guitar strap/pick/effects pedal/amp/bag',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`MUSICAL_INSTRUMENT_INTENT: added ch.85, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: MUSICAL_INSTRUMENT_INTENT not found'); }
    }

    // ── 3. AI_CH51_RAW_WOOL: noneOf for 'raw' as non-wool contexts ────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH51_RAW_WOOL') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Raw crystal/mineral specimens
          'raw crystal', 'natural raw', 'raw mineral', 'raw quartz',
          'raw fluorite', 'raw stone', 'raw amethyst', 'raw gemstone',
          'crystal', 'mineral', 'fluorite', 'quartz', 'gemstone',
          // Pokemon/collectible cards
          'pokemon', 'graded', 'psa', 'bgs', 'card frame', 'display frame',
          'trading card', 'sports card', 'card display',
          // Other non-wool raw items
          'raw material', 'raw ingredient', 'raw wood',
          'raw cocoa', 'raw cacao', 'raw coffee',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH51_RAW_WOOL') +
              ' — Fixed M2: noneOf raw crystal/mineral/pokemon card (non-wool raw items)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH51_RAW_WOOL: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH51_RAW_WOOL not found'); }
    }

    // ── 4. SKINCARE_INTENT: add ch.30 to allowChapters ───────────────────────
    {
      const existing = allRules.find(r => r.id === 'SKINCARE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.30 (pharmaceutical creams/serums that overlap with skincare)
        const newChapters = [...new Set([...currentChapters, '30'])];
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        // Exclude non-skin serums/primers (e.g., coating primers)
        const addNoneOf = ['primer coat', 'automotive primer', 'spray primer', 'wall primer'];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SKINCARE_INTENT') +
              ' — Fixed M2: added ch.30 (pharmaceutical skincare preparations)',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SKINCARE_INTENT: added ch.30 to allowChapters`);
      } else { console.log('WARNING: SKINCARE_INTENT not found'); }
    }

    // ── 5. AI_CH56_WADDING_BATTING: add ch.58/59/60/63 ────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH56_WADDING_BATTING') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add chapters for felt/batting products in other material forms
        const newChapters = [...new Set([...currentChapters, '58', '59', '60', '63'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH56_WADDING_BATTING') +
              ' — Fixed M2: added ch.58 (embroidered felt), ch.59 (felt hat), ch.60 (batting fabric), ch.63 (felt decor)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH56_WADDING_BATTING: added ch.58/59/60/63`);
      } else { console.log('WARNING: AI_CH56_WADDING_BATTING not found'); }
    }

    // ── 6. STATIONERY_NOTEBOOK_INTENT: add ch.39/44 + noneOf non-paper ────────
    {
      const existing = allRules.find(r => r.id === 'STATIONERY_NOTEBOOK_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.39 (faux leather/plastic bookmarks), ch.44 (wood bookmarks)
        const newChapters = [...new Set([...currentChapters, '39', '44'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Non-paper bookmark materials
          'leather bookmark', 'faux leather bookmark', 'leather bookmarks',
          'woven bookmark', 'textile bookmark', 'fabric bookmark',
          'metal bookmark', 'silver bookmark', 'engraved silver',
          'ceramic sign', 'garden sign',
          // Wedding stationery is usually printed (ch.48/49 but could be textile)
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STATIONERY_NOTEBOOK_INTENT') +
              ' — Fixed M2: added ch.39 (plastic bookmarks) ch.44 (wood bookmarks); noneOf leather/woven/metal/ceramic bookmark',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`STATIONERY_NOTEBOOK_INTENT: added ch.39/44, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: STATIONERY_NOTEBOOK_INTENT not found'); }
    }

    // ── 7. AI_CH17_MAPLE_SUGAR_SYRUP: noneOf for maple as wood/design/brand ──
    {
      const existing = allRules.find(r => r.id === 'AI_CH17_MAPLE_SUGAR_SYRUP') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Maple leaf as design motif
          'maple leaf design', 'maple leaf pattern', 'canadian maple', 'canada maple',
          'wristband', 'wristbands', 'bracelet',
          // Maple wood
          'maple wood', 'maple gnocchi', 'gnocchi board', 'pasta board',
          'drawer', 'tray', 'feeding station',
          // Toronto Maple Leafs (hockey team)
          'maple leafs', 'toronto maple', 'leafs',
          // Maple suede (color/finish)
          'maple suede', 'suede', 'shoe', 'shoes', 'boot', 'boots',
          // Maple soda/drink can
          'cola', 'soda', 'can', 'pepsi', 'empty can',
          // Other non-food maple contexts
          'pouch', 'bag', 'zippered',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH17_MAPLE_SUGAR_SYRUP') +
              ' — Fixed M2: noneOf maple-wood/maple-leaf-design/Toronto-Maple-Leafs/maple-suede/maple-cola',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH17_MAPLE_SUGAR_SYRUP: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH17_MAPLE_SUGAR_SYRUP not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch M2)...`);
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

    console.log(`\nPatch M2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
