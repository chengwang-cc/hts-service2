#!/usr/bin/env ts-node
/**
 * Patch P2 — 2026-03-14:
 *
 * Targeting top blockers after O2 (588/5000 = 11.76% blocked):
 *
 * 1. SKINCARE_INTENT: noneOf for printer toner cartridges.
 *    'toner' → 9 printer toner cartridge blocks (ch.84). All 9 are toner cartridges.
 *    Add noneOf: cartridge, laserjet, laser printer, printer toner.
 *
 * 2. FRESH_FRUIT_INTENT: noneOf for fruit-as-color/context.
 *    'orange' → mineral (stilbite), CGM device, rubber coating, ceramic set.
 *    'pear' → Acadia Pear paint color (ch.32).
 *    'apple' → apple cinnamon wax melt air freshener (ch.33).
 *    'avocado' → avocado green underwear color (ch.62).
 *    'coconut' → decorated coconut (ch.53). Add ch.53 to allowChapters.
 *    11 blocks.
 *
 * 3. STICKER_SHEET_PAPER_INTENT: noneOf for vinyl/nail/foil stickers.
 *    'sticker'/'decal' → vinyl car decals (ch.29), gel nail stickers (ch.32),
 *    copper foil stickers (ch.74), iron-on patches (ch.58), metal pin+sticker (ch.73).
 *    10 blocks.
 *
 * 4. AI_CH51_RAW_WOOL: noneOf for finished wool goods.
 *    'wool' → tea cozy (ch.60), wool slippers (ch.64), wool leg warmers (ch.64),
 *    wool stole/wrap (ch.62), wool pellets (ch.56), needlepoint art (ch.58).
 *    8 blocks.
 *
 * 5. TRADING_CARD_COLLECTIBLE_INTENT: add ch.44/76 to allowChapters.
 *    Trading card display frames (ch.44), AuraSlab aluminum holders (ch.76).
 *    'artwork case for trading cards' (ch.39) — add noneOf 'artwork case'.
 *    6 blocks.
 *
 * 6. MIRROR_INTENT: noneOf for mirror-as-component + add ch.74 to allowChapters.
 *    'mirror' → rearview mirror (ch.39), car visor mirror (ch.39),
 *    wall dragonfly decals with "mirror" (ch.48), Persian Haftseen copper items (ch.74).
 *    6 blocks. Add ch.39/48/74 to allowChapters, noneOf for car mirror contexts.
 *
 * 7. COFFEE_SINGLE_ORIGIN_INTENT: noneOf for non-coffee 'coffee' uses.
 *    'washed' → washed pebble for landscaping (ch.25). 'coffee' → coffee pot (ch.76/69),
 *    coffee spoon (ch.82), coffee grounds lid (ch.85), coffee pillow (ch.63).
 *    6 blocks.
 *
 * 8. JEWELRY_RING_INTENT: add ch.70/73 to allowChapters.
 *    Glass charms/pendants (ch.70), base metal charms/pendants (ch.73).
 *    noneOf: toy basket, leather keychain.
 *    9 blocks.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14p2.ts
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

    // ── 1. SKINCARE_INTENT: noneOf for printer toner ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SKINCARE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Printer toner cartridges — 'toner' fires this rule
          'cartridge', 'cartridges', 'toner cartridge', 'toner cartridges',
          'laserjet', 'laser jet', 'laser printer', 'printer toner',
          'inkjet', 'ink cartridge', 'reset chip', 'drum unit',
          'hp toner', 'brother toner', 'canon toner', 'xerox toner',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SKINCARE_INTENT') +
              ' — Fixed P2: noneOf cartridge/laserjet/laser printer (printer toner ≠ skincare toner)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`SKINCARE_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SKINCARE_INTENT not found'); }
    }

    // ── 2. FRESH_FRUIT_INTENT: noneOf for fruit-as-color/context ────────────
    {
      const existing = allRules.find(r => r.id === 'FRESH_FRUIT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'orange' as mineral color (ORANGE STILBITE CLUSTER → ch.25)
          'stilbite', 'cluster', 'mineral specimen',
          // 'orange' as product color (CGM medical device → ch.30)
          'cgm', 'glucose monitor', 'dexcom', 'freestyle libre', 'omnipod',
          'continuous glucose',
          // 'orange' as rubber/grip product color (GripGuard Orange → ch.40)
          'gripguard', 'grip guard',
          // 'orange' as ceramic set color (Blue and Orange set → ch.69)
          // 'pear' as paint color (Acadia Pear paint → ch.32)
          'acadia', 'mineral paint', 'fusion mineral',
          // 'apple' as flavor (apple cinnamon wax melt → ch.33)
          'wax melt', 'wax melts', 'air freshener', 'scented melt', 'candle melt',
          // 'avocado' as color (avocado green underwear → ch.62)
          'avocado green', 'avocado colored',
          // 'coconut' as decorative item (decorated coconut → ch.53)
          // Handle via allowChapters[53] addition below
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        // Add ch.53 (bast fibres like decorated coconut shells)
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '53'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FRESH_FRUIT_INTENT') +
              ' — Fixed P2: noneOf stilbite/cgm/gripguard/wax melt/acadia paint/avocado green; added ch.53',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`FRESH_FRUIT_INTENT: adding ${addNoneOf.length} noneOf terms, added ch.53`);
      } else { console.log('WARNING: FRESH_FRUIT_INTENT not found'); }
    }

    // ── 3. STICKER_SHEET_PAPER_INTENT: noneOf for vinyl/nail/foil ────────────
    {
      const existing = allRules.find(r => r.id === 'STICKER_SHEET_PAPER_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Vinyl car decals (ch.29 - vinyl chloride material)
          'vinyl decal', 'car decal', 'bumper sticker', 'car sticker',
          'vinyl car', 'bumper decal', 'window decal', 'window sticker',
          'vehicle sticker', 'vehicle decal',
          // Nail decals/gel nail stickers (ch.32 - coatings)
          'nail decal', 'gel nail', 'nail sticker', 'nail design', 'nail art sticker',
          'nail art decal',
          // Copper/metallic foil stickers (ch.74)
          'copper foil', 'copperfoil', 'metallic foil sticker', 'foil sticker',
          // Fabric iron-on / embroidered patches (ch.58)
          'iron on', 'iron-on', 'embroidered patch', 'woven patch',
          // Metal pin combos (ch.73)
          'acrylic pin', 'enamel pin',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STICKER_SHEET_PAPER_INTENT') +
              ' — Fixed P2: noneOf vinyl decal/nail sticker/copper foil/iron-on (non-paper sticker formats)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`STICKER_SHEET_PAPER_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: STICKER_SHEET_PAPER_INTENT not found'); }
    }

    // ── 4. AI_CH51_RAW_WOOL: noneOf for finished wool goods ──────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH51_RAW_WOOL') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Tea cozy / cosy (ch.60 knit) — 'wool tea cozy'
          'tea cozy', 'tea cosy', 'cozy', 'cosy',
          // Slippers with wool (ch.64 footwear)
          'slipper', 'slippers', 'cabin slipper', 'cabin slippers',
          'highland wool slipper', 'sheepskin',
          // Leg warmers (ch.64)
          'leg warmer', 'leg warmers',
          // Wool stole/wrap (ch.62 garment)
          'stole', 'wrap', 'shawl',
          // Wool pellets for gardening (ch.56)
          'pellet', 'pellets', 'wool pellet',
          // Needlepoint art with wool threads (ch.58)
          'needlepoint', 'needlework', 'cross stitch',
          // Finished garments with wool content
          'designed cut sewn', 'cut and sewn',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH51_RAW_WOOL') +
              ' — Fixed P2: noneOf tea cozy/slipper/leg warmer/stole/pellet/needlepoint (finished wool goods)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH51_RAW_WOOL: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH51_RAW_WOOL not found'); }
    }

    // ── 5. TRADING_CARD_COLLECTIBLE_INTENT: add ch.44/76 + noneOf ────────────
    {
      const existing = allRules.find(r => r.id === 'TRADING_CARD_COLLECTIBLE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.44 = wooden display frames, ch.76 = aluminum AuraSlab holders
        const newChapters = [...new Set([...currentChapters, '44', '76', '39'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Artwork cases (ch.39) that happen to contain trading cards
          'artwork case', 'card case', 'storage case', 'storage box',
          'card storage', 'card holder case',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TRADING_CARD_COLLECTIBLE_INTENT') +
              ' — Fixed P2: added ch.44 (display frames), ch.76 (AuraSlab aluminum); noneOf artwork case',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`TRADING_CARD_COLLECTIBLE_INTENT: added ch.44/76/39, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: TRADING_CARD_COLLECTIBLE_INTENT not found'); }
    }

    // ── 6. MIRROR_INTENT: noneOf for car/decorative contexts + allowChapters ─
    {
      const existing = allRules.find(r => r.id === 'MIRROR_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Car rearview/side mirrors (ch.39)
          'rearview', 'rearview mirror', 'rear view', 'rear-view',
          'car door', 'anti-collision', 'scratch guard',
          // Car visor (ch.39)
          'sun visor', 'sunvisor', 'visor mirror',
          // Wall decals / decorative dragonflies labeled "mirror dragonflies" (ch.48)
          'dragonfly', 'dragonflies', 'butterflies', 'butterfly decal',
          // Persian Haftseen/Haftsin new year items (ch.74 copper)
          'haftseen', 'haftsin', 'noroz', 'nowruz', 'nowruz',
          'persian new year', 'persian new years',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        // Add ch.39 (plastic mirror guards), ch.48 (wallpaper/decor with mirror), ch.74 (copper Haftseen)
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39', '48', '74'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'MIRROR_INTENT') +
              ' — Fixed P2: noneOf rearview/car door/dragonfly/haftseen; added ch.39/48/74',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`MIRROR_INTENT: adding ${addNoneOf.length} noneOf terms, added ch.39/48/74`);
      } else { console.log('WARNING: MIRROR_INTENT not found'); }
    }

    // ── 7. COFFEE_SINGLE_ORIGIN_INTENT: noneOf for non-coffee uses ────────────
    {
      const existing = allRules.find(r => r.id === 'COFFEE_SINGLE_ORIGIN_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Coffee serving/storage items (not the coffee itself)
          'coffee pot', 'coffee spoon', 'coffee spoons', 'coffee grounds',
          'grounds lid', 'lid part', 'pot', 'spoon', 'spoons',
          'tray', 'grinder', 'coffee grinder',
          // 'washed' matching 'washed and unpolished' pebbles (ch.25)
          'pebble', 'pebbles', 'washed sand', 'washed stone', 'washed gravel',
          'landscaping', 'gravel',
          // Decorative coffee-themed items (knot pillow → ch.63)
          'knot pillow', 'sphere ball pillow', 'decorative cushion',
          'scandinavian', 'pillow',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'COFFEE_SINGLE_ORIGIN_INTENT') +
              ' — Fixed P2: noneOf coffee pot/spoon/grounds/pebble/pillow (non-coffee uses of coffee terms)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`COFFEE_SINGLE_ORIGIN_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: COFFEE_SINGLE_ORIGIN_INTENT not found'); }
    }

    // ── 8. JEWELRY_RING_INTENT: add ch.70/73 to allowChapters ────────────────
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_RING_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.70 (glass jewelry/charms/pendants), ch.73 (base metal jewelry/charms)
        const newChapters = [...new Set([...currentChapters, '70', '73'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Toy basket (basket-shaped item with "ring" in description)
          'toy basket', 'basket ring', 'storage basket',
          // Leather keychain with rings (already has 'keychain' but add more)
          'leather keychain', 'engraved leather',
          // Craft supply hooks (ch.73) labeled as "charm hooks"
          'charm hook', 'hooks for crafts', 'craft hook',
          // Acrylic/plastic charms that aren't jewelry
          'acrylic charm', 'acrylic charms', 'acrylic pendant',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_RING_INTENT') +
              ' — Fixed P2: added ch.70 (glass charms), ch.73 (base metal charms); noneOf toy basket/charm hook/acrylic charm',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`JEWELRY_RING_INTENT: added ch.70/73, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: JEWELRY_RING_INTENT not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch P2)...`);
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

    console.log(`\nPatch P2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
