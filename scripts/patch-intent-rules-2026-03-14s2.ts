#!/usr/bin/env ts-node
/**
 * Patch S2 — 2026-03-14:
 *
 * Targeting top blockers after R2 (461/5000 = 9.22% blocked):
 *
 * 1. AI_CH36_FUSES_DETONATORS: noneOf for electrical circuit fuses (ch.85).
 *    Bare 'fuse'/'fuses' matches electrical fuses (oven, glass, automotive, panel mount).
 *    5 blocks.
 *
 * 2. AI_CH36_METALDEHYDE: noneOf for 'tablet' as electronic device.
 *    'tablet' → Amazon Fire tablet (ch.84), tablet battery (ch.85), microfiber for tablets (ch.56).
 *    5 blocks.
 *
 * 3. CLOCK_TIMEPIECE_INTENT: add ch.44/69/85 to allowChapters.
 *    Engraved wooden clock (ch.44), ceramic decorative clock (ch.69), LED/radio alarm clock (ch.85).
 *    5 blocks.
 *
 * 4. JEWELRY_BRACELET_INTENT: add ch.42/44/52 to allowChapters.
 *    Leather bracelets (ch.42), wood bead bracelets (ch.44), thread/textile bracelets (ch.52).
 *    5 blocks.
 *
 * 5. CAMERAS_CINEMATOGRAPHIC_INTENT: add ch.42/85 to allowChapters.
 *    Camera carrying cases (ch.42), camera electronic parts and units (ch.85).
 *    5 blocks.
 *
 * 6. CEMENT_CONCRETE_INTENT: add ch.68 + noneOf 'cement coated'.
 *    Concrete coasters/trays/holders (ch.68 = concrete articles). 'Cement coated' nails are nails, not cement.
 *    4 blocks.
 *
 * 7. OUTERWEAR_JACKET_GARMENT_INTENT: add ch.39/65 to allowChapters.
 *    Hi-vis safety rain jacket/fleece classified as plastic protective clothing (ch.39).
 *    Hairdressing salon capes classified as headgear (ch.65).
 *    6 blocks.
 *
 * 8. SPORTS_BALL_INTENT: noneOf raglan/tee/jacket + keychain.
 *    'baseball' → baseball-style raglan tee (ch.62). 'football' → football team jacket (ch.62).
 *    Sports-themed keychain (ch.71).
 *    5 blocks.
 *
 * 9. COFFEE_BEAN_INTENT: noneOf for coffee serving items.
 *    'coffee' → coffee pot (ch.69/76), coffee spoon (ch.82), coffee grounds lid (ch.85), coffee pillow (ch.63).
 *    5 blocks.
 *
 * 10. SHOELACE_LEATHER_STRAP_INTENT: add ch.44/56/60/63 + noneOf bag handles.
 *     Dress shoelace classified as made-up textile (ch.63), leather cord necklace (ch.56),
 *     macrame belt strap (ch.60), bamboo bag handles (ch.44).
 *     5 blocks.
 *
 * 11. AI_CH58_EMBROIDERY_FABRIC: add ch.53/63 + noneOf socks/not embroidered.
 *     Linen cross-stitch fabric (ch.53), linen embroidery cloth (ch.63), embroidered socks (ch.64).
 *     5 blocks.
 *
 * 12. AI_CH91_TIME_SWITCH_TIMER: noneOf countdown blocks/outlet cover + add ch.44/85.
 *     'countdown' → wooden countdown blocks (ch.44). 'outlet' → outlet cover plates (ch.85).
 *     5 blocks.
 *
 * 13. POLYPROPYLENE_TOUGH_COAT_INTENT: noneOf fusion mineral + polypropylene sacks.
 *     'fusion mineral' → Fusion Mineral Paint brand (ch.32 coatings).
 *     'polypropylene' → polypropylene sacks/bags (ch.63).
 *     4 blocks.
 *
 * 14. SCREW_BOLT_INTENT: add ch.82/83 + noneOf washer-as-machine-part.
 *     Tool screws (ch.82 hand tools), door bolt latch (ch.83). 'washer' → pressure switch washer/seal (ch.84).
 *     5 blocks.
 *
 * 15. WOOD_LASER_DECOR_INTENT: noneOf wood stand/coaster + add more chapters.
 *     'wood coaster' in ceramic mug set (ch.69), 'wood stand' in glass/electronics item (ch.70/85).
 *     5 blocks.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14s2.ts
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

    // ── 1. AI_CH36_FUSES_DETONATORS: noneOf for electrical fuses ────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH36_FUSES_DETONATORS') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Electrical circuit protection fuses (ch.85 = 8535/8536)
          'thermal fuse', 'oven fuse', 'glass fuse', 'glass fuse holder',
          'fuse holder', 'fuse relay', 'automotive fuse', 'blade fuse',
          'inline fuse', 'in-line fuse', 'fuse block', 'fuse box',
          'circuit fuse', '3ag fuse', 'panel mount fuse',
          'fuse 10a', 'fuse 15a', 'fuse 20a', 'fuse 30a', 'amp fuse',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH36_FUSES_DETONATORS') +
              ' — Fixed S2: noneOf thermal/glass/automotive/fuse holder (electrical circuit fuses ≠ detonators)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH36_FUSES_DETONATORS: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH36_FUSES_DETONATORS not found'); }
    }

    // ── 2. AI_CH36_METALDEHYDE: noneOf for tablet as electronic device ───────
    {
      const existing = allRules.find(r => r.id === 'AI_CH36_METALDEHYDE') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Electronic tablets (ch.84)
          'tablet computer', 'fire tablet', 'fire hd', 'ipad', 'android tablet',
          'amazon fire', 'kindle fire', 'tablet rental', 'business tablet',
          'tablet replacement', 'tablet battery', 'replacement battery',
          // Microfiber cleaning cloths for tablets (ch.56)
          'microfiber cloth', 'cleaning cloth', 'screen wipe', 'glasses wipe',
          // Commemorative tablets (ch.71)
          'son tablet', 'masonic tablet', 'memorial tablet',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH36_METALDEHYDE') +
              ' — Fixed S2: noneOf tablet computer/fire tablet/microfiber cloth (electronic devices ≠ slug bait)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH36_METALDEHYDE: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH36_METALDEHYDE not found'); }
    }

    // ── 3. CLOCK_TIMEPIECE_INTENT: add ch.44/69/85 ────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'CLOCK_TIMEPIECE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.44 (engraved wooden clocks), ch.69 (ceramic decorative clocks), ch.85 (LED/radio clocks)
        const newChapters = [...new Set([...currentChapters, '44', '69', '85'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CLOCK_TIMEPIECE_INTENT') +
              ' — Fixed S2: added ch.44 (wood engraved clock), ch.69 (ceramic clock), ch.85 (LED/radio alarm clock)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CLOCK_TIMEPIECE_INTENT: added ch.44/69/85`);
      } else { console.log('WARNING: CLOCK_TIMEPIECE_INTENT not found'); }
    }

    // ── 4. JEWELRY_BRACELET_INTENT: add ch.42/44/52 ─────────────────────────
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_BRACELET_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.42 (leather bracelets), ch.44 (wood bead bracelets), ch.52 (thread/textile bracelets)
        const newChapters = [...new Set([...currentChapters, '42', '44', '52'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_BRACELET_INTENT') +
              ' — Fixed S2: added ch.42 (leather bracelet), ch.44 (wood bead bracelet), ch.52 (thread bracelet)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`JEWELRY_BRACELET_INTENT: added ch.42/44/52`);
      } else { console.log('WARNING: JEWELRY_BRACELET_INTENT not found'); }
    }

    // ── 5. CAMERAS_CINEMATOGRAPHIC_INTENT: add ch.42/85 ──────────────────────
    {
      const existing = allRules.find(r => r.id === 'CAMERAS_CINEMATOGRAPHIC_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.42 (camera carrying cases), ch.85 (camera electronic parts, old video cameras)
        const newChapters = [...new Set([...currentChapters, '42', '85'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CAMERAS_CINEMATOGRAPHIC_INTENT') +
              ' — Fixed S2: added ch.42 (camera cases), ch.85 (camera electronic parts/units)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CAMERAS_CINEMATOGRAPHIC_INTENT: added ch.42/85`);
      } else { console.log('WARNING: CAMERAS_CINEMATOGRAPHIC_INTENT not found'); }
    }

    // ── 6. CEMENT_CONCRETE_INTENT: add ch.68 + noneOf cement coated ──────────
    {
      const existing = allRules.find(r => r.id === 'CEMENT_CONCRETE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.68 = articles of stone, plaster, concrete (6810.xx = articles of concrete)
        const newChapters = [...new Set([...currentChapters, '68'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'cement coated' nails - the product is the nail, not cement
          'cement coated', 'vinyl resin or cement', 'resin or cement coated',
          'cement coated nails', 'cement coated wire',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CEMENT_CONCRETE_INTENT') +
              ' — Fixed S2: added ch.68 (concrete coasters/trays); noneOf cement-coated-nails',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CEMENT_CONCRETE_INTENT: added ch.68, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: CEMENT_CONCRETE_INTENT not found'); }
    }

    // ── 7. OUTERWEAR_JACKET_GARMENT_INTENT: add ch.39/65 ─────────────────────
    {
      const existing = allRules.find(r => r.id === 'OUTERWEAR_JACKET_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (hi-vis safety/protective jackets in plastic protective clothing),
        // ch.65 (hairdressing salon capes classified as headgear/capes)
        const newChapters = [...new Set([...currentChapters, '39', '65'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'OUTERWEAR_JACKET_GARMENT_INTENT') +
              ' — Fixed S2: added ch.39 (hi-vis/protective plastic jackets), ch.65 (salon hairdressing capes)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`OUTERWEAR_JACKET_GARMENT_INTENT: added ch.39/65`);
      } else { console.log('WARNING: OUTERWEAR_JACKET_GARMENT_INTENT not found'); }
    }

    // ── 8. SPORTS_BALL_INTENT: noneOf raglan tee/jacket + keychain ───────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_BALL_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Sports-themed clothing (not the ball itself)
          'raglan', 'raglan tee', 'baseball tee', 'sports tee', 'tee shirt',
          'team jacket', 'soft shell jacket', 'team jersey', 'reebok',
          // Sports-themed keychains (ch.71)
          'sports keychain', 'custom name with soccer', 'custom name with',
          // Football/leather ball encasing (ch.41 - leather)
          'grey cup', 'cfl', 'mini football',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_BALL_INTENT') +
              ' — Fixed S2: noneOf raglan/baseball tee/team jacket/sports keychain/mini football CFL',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`SPORTS_BALL_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SPORTS_BALL_INTENT not found'); }
    }

    // ── 9. COFFEE_BEAN_INTENT: noneOf for coffee serving items ───────────────
    {
      const existing = allRules.find(r => r.id === 'COFFEE_BEAN_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Coffee serving vessels (not coffee itself)
          'coffee pot', 'coffee spoon', 'coffee spoons',
          'coffee grounds', 'grounds lid', 'lid part',
          // Coffee-themed decorative items
          'knot pillow', 'coffee pillow', 'sphere ball pillow', 'decorative cushion',
          // Already handles maker/machine/mug/cup but may need more
          'stainless steel coffee', 'bone china coffee',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'COFFEE_BEAN_INTENT') +
              ' — Fixed S2: noneOf coffee pot/spoon/grounds/pillow (coffee-themed non-food items)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`COFFEE_BEAN_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: COFFEE_BEAN_INTENT not found'); }
    }

    // ── 10. SHOELACE_LEATHER_STRAP_INTENT: add ch.44/56/60/63 + noneOf ───────
    {
      const existing = allRules.find(r => r.id === 'SHOELACE_LEATHER_STRAP_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.44 (bamboo bag handles), ch.56 (leather cord necklaces),
        // ch.60 (macrame belt strap), ch.63 (dress shoelaces in textile)
        const newChapters = [...new Set([...currentChapters, '44', '56', '60', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Bag handles (not shoelaces/straps)
          'bag handle', 'bag handles', 'bamboo handle', 'bamboo bag',
          'purse handle', 'purse replacement',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SHOELACE_LEATHER_STRAP_INTENT') +
              ' — Fixed S2: added ch.44/56/60/63; noneOf bag handles',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SHOELACE_LEATHER_STRAP_INTENT: added ch.44/56/60/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SHOELACE_LEATHER_STRAP_INTENT not found'); }
    }

    // ── 11. AI_CH58_EMBROIDERY_FABRIC: add ch.53/63 + noneOf socks ───────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH58_EMBROIDERY_FABRIC') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.53 (linen cross-stitch embroidery fabric), ch.63 (linen embroidery cloth made-up)
        const newChapters = [...new Set([...currentChapters, '53', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Embroidered socks (ch.64 - finished hosiery)
          'socks', 'sock', 'hosiery',
          // Items described as 'not embroidered' (negative match)
          'not embroidered',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH58_EMBROIDERY_FABRIC') +
              ' — Fixed S2: added ch.53/63 (linen embroidery fabrics); noneOf socks/not embroidered',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH58_EMBROIDERY_FABRIC: added ch.53/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH58_EMBROIDERY_FABRIC not found'); }
    }

    // ── 12. AI_CH91_TIME_SWITCH_TIMER: noneOf countdown blocks + add ch.44/85 ─
    {
      const existing = allRules.find(r => r.id === 'AI_CH91_TIME_SWITCH_TIMER') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.44 (wooden countdown blocks), ch.85 (Marktime heavy-duty timer = electrical switch)
        const newChapters = [...new Set([...currentChapters, '44', '85'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Wooden countdown blocks (decorative, not timers)
          'countdown blocks', 'countdown block', 'wooden countdown',
          'engagement countdown', 'pregnancy countdown', 'wedding countdown',
          // Outlet cover plates (not timers)
          'outlet cover', 'outlet covers', 'switch plate', 'switch plates',
          'plate outlet', 'cover plate',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH91_TIME_SWITCH_TIMER') +
              ' — Fixed S2: added ch.44/85; noneOf countdown blocks/outlet cover plates',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH91_TIME_SWITCH_TIMER: added ch.44/85, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH91_TIME_SWITCH_TIMER not found'); }
    }

    // ── 13. POLYPROPYLENE_TOUGH_COAT_INTENT: noneOf fusion mineral + sacks ────
    {
      const existing = allRules.find(r => r.id === 'POLYPROPYLENE_TOUGH_COAT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'fusion mineral' / 'fusion grip' as brand name for paint/coatings (ch.32)
          'fusion mineral', 'mineral paint', 'mineral paint brand',
          'beeswax finish', 'gel stain', 'topcoat',
          // 'polypropylene' in textile sacks (ch.63 - woven PP sacks)
          'polypropylene sack', 'polypropylene bag', 'polypropylene strip',
          'packing sack', 'packing bag', 'woven sack',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'POLYPROPYLENE_TOUGH_COAT_INTENT') +
              ' — Fixed S2: noneOf fusion mineral paint brand + polypropylene sacks/bags',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`POLYPROPYLENE_TOUGH_COAT_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: POLYPROPYLENE_TOUGH_COAT_INTENT not found'); }
    }

    // ── 14. SCREW_BOLT_INTENT: add ch.82/83 + noneOf washer-as-seal ──────────
    {
      const existing = allRules.find(r => r.id === 'SCREW_BOLT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.82 (tool screws, pocket screw jigs), ch.83 (door bolt latches)
        const newChapters = [...new Set([...currentChapters, '82', '83'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'washer' as machine part/seal (pressure switch washer, thrust washer)
          'thrust washer', 'pressure washer', 'washer plate', 'water level',
          'pressure switch', 'thrust washer plate',
          // Already has some washer exclusions, add more specific
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SCREW_BOLT_INTENT') +
              ' — Fixed S2: added ch.82 (tool screws/pocket screw), ch.83 (door bolt latch); noneOf thrust washer/pressure switch',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SCREW_BOLT_INTENT: added ch.82/83, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SCREW_BOLT_INTENT not found'); }
    }

    // ── 15. WOOD_LASER_DECOR_INTENT: noneOf wood stand/coaster + more chapters ─
    {
      const existing = allRules.find(r => r.id === 'WOOD_LASER_DECOR_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add chapters for items with wooden component but not primarily wood
        const newChapters = [...new Set([...currentChapters, '34', '39', '69', '70', '85'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'wood coaster' in a ceramic mug + wood coaster set
          'wood coaster', 'wood coasters', 'wooden coaster', 'wooden coasters',
          // 'wood stand' as secondary component in glass/electronics product
          'wood stand', 'wooden stand', 'with wood stand', 'with wooden stand',
          'wood base', 'wooden base',
          // Fortune cookie place card holder (ch.34 modeling material?)
          'fortune cookie',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'WOOD_LASER_DECOR_INTENT') +
              ' — Fixed S2: added ch.34/39/69/70/85; noneOf wood stand/wood coaster/fortune cookie',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`WOOD_LASER_DECOR_INTENT: added ch.34/39/69/70/85, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: WOOD_LASER_DECOR_INTENT not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch S2)...`);
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

    console.log(`\nPatch S2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
