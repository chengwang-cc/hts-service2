#!/usr/bin/env ts-node
/**
 * Patch TT67 — 2026-03-15: Fix buttons going to jewelry/ammunition/bags, vinyl stickers.
 *
 * Fixes:
 *  1. UPDATE AI_CH93_AMMUNITION — add noneOf for button/fastener context
 *     "Black Shell Buttons" → 9306.30 (ammunition!) WRONG
 *     "shell" in anyOf matches "shell" in "shell buttons" (natural shell, not cartridge)
 *     FIX: Add 'button', 'buttons', 'shell button' to noneOf
 *
 *  2. UPDATE RESIN_CRAFT_INTENT — add noneOf for button context
 *     "Handcrafted resin button" → 3907.30 (polyester resin raw material!) WRONG
 *     "resin" triggers RESIN_CRAFT_INTENT which injects 3907.30 (raw resin)
 *     FIX: Add 'button', 'buttons', 'fastener' to noneOf (resin buttons → 9606.21, not raw resin)
 *
 *  3. UPDATE BASE_METAL_IMITATION_JEWELRY_INTENT — add noneOf for button context
 *     "Pin Back Buttons" → 4202 (bags!) WRONG (expected 9606.22 metal buttons)
 *     "pin" in BASE_METAL_IMITATION_JEWELRY fires, and organic search gives bags result
 *     FIX: Add 'pin back button', 'pin back buttons', 'button pins' to noneOf
 *
 *  4. NEW BUTTON_SEWING_FASTENER_INTENT → 9606.21/9606.22/9606.29 (buttons/fasteners)
 *     "Black Shell Buttons" → 9306.30 (ammunition!) WRONG (after fix #1, needs routing)
 *     "Pin Back Buttons" → 4202 (bags) WRONG
 *     "fabric knot buttons" → 5911 (textile) WRONG
 *     "leather knotted buttons" → 4115 (leather) WRONG
 *     "Arms Button Antique-Brass Tone" → ? WRONG
 *     "Filipino Batik Button Pins" → ? WRONG
 *     9606.21 = buttons of plastics (resin/acrylic buttons)
 *     9606.22 = metal buttons (pin back, brass buttons)
 *     9606.29 = other buttons (shell, fabric, leather)
 *
 *  5. NEW VINYL_STICKER_DECAL_INTENT → 3919.XX (self-adhesive plastic sheets)
 *     "Custom sticker label set" → 4821 (paper labels) WRONG (expected 3919)
 *     "1.5x2.5 inch sticker" → 4821 WRONG
 *     "Jason Todd sticker" → 4821 WRONG
 *     BUG: "sticker" without "vinyl" goes to paper labels (ch.48)
 *     3919.10 = self-adhesive plates/sheets of plastic (roll/bulk)
 *     3919.90 = other self-adhesive plastic products (single stickers/decals)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt67.ts
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

    // 1. UPDATE AI_CH93_AMMUNITION — add noneOf for button context
    //    "Black Shell Buttons" → 9306.30 (ammunition!) — "shell" in anyOf + syntheticRank:40
    //    "shell" in ammunition anyOf = cartridge shell; "shell" in "shell buttons" = natural shell
    {
      const existing = allRules.find(r => r.id === 'AI_CH93_AMMUNITION');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const buttonNoneOf = ['button', 'buttons', 'shell button', 'shell buttons', 'shell bead', 'button pins'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...buttonNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('AI_CH93_AMMUNITION: added button noneOf terms (shell buttons → not ammunition)');
      }
    }

    // 2. UPDATE RESIN_CRAFT_INTENT — add noneOf for button context
    //    "Handcrafted resin button" → 3907.30 WRONG (resin buttons → 9606.21)
    {
      const existing = allRules.find(r => r.id === 'RESIN_CRAFT_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const buttonNoneOf = ['button', 'buttons', 'fastener', 'snap', 'toggle button'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...buttonNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('RESIN_CRAFT_INTENT: added button noneOf (resin buttons → 9606, not raw resin 3907)');
      }
    }

    // 3. UPDATE BASE_METAL_IMITATION_JEWELRY_INTENT — add noneOf for button context
    //    "Pin Back Buttons" → jewelry then bags WRONG (expected 9606.22)
    //    "pin" triggers jewelry, but "pin back buttons" = metal buttons, not jewelry pins
    {
      const existing = allRules.find(r => r.id === 'BASE_METAL_IMITATION_JEWELRY_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const buttonNoneOf = ['pin back button', 'pin back buttons', 'button pins', 'lapel pin button', 'pinback'];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...buttonNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('BASE_METAL_IMITATION_JEWELRY_INTENT: added pin back button noneOf');
      }
    }

    // 4. NEW BUTTON_SEWING_FASTENER_INTENT → 9606.21/9606.22/9606.29
    //    Covers: resin buttons, metal buttons, shell buttons, fabric buttons, leather buttons
    {
      const existing = allRules.find(r => r.id === 'BUTTON_SEWING_FASTENER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BUTTON_SEWING_FASTENER_INTENT',
          description: 'Sewing buttons (shell, resin, metal, fabric, leather) → ch.96 (9606.XX)',
          pattern: {
            anyOf: [
              // Generic button terms (fasteners, not computer buttons/camera buttons)
              'shell buttons', 'shell button', 'natural shell buttons', 'mother of pearl button',
              // Resin/acrylic buttons
              'resin button', 'resin buttons', 'acrylic button', 'acrylic buttons',
              'handcrafted button', 'handmade button', 'craft button',
              // Metal buttons
              'pin back button', 'pin back buttons', 'pinback button',
              'metal button', 'brass button', 'arms button',
              'shank button', 'sew on button',
              // Fabric/knotted buttons
              'fabric knot button', 'fabric knot buttons', 'knotted closure',
              'knotted button', 'toggle button closure', 'chinese button knot',
              // Leather/natural buttons
              'leather button', 'leather buttons', 'wooden button', 'wood button',
              'horn button', 'coconut button', 'cork button',
              // Filipino batik button pins (decorative buttons worn as pins)
              'batik button pin', 'batik button pins', 'button pins batik',
              // Snap buttons
              'snap button', 'snap buttons', 'sew on snap',
            ],
            noneOf: [
              // Exclude electronic buttons
              'power button', 'volume button', 'control button',
              'keyboard button', 'remote button',
              // Exclude clothes with buttons (not the buttons themselves)
              'button down shirt', 'button up shirt', 'button front',
              // Exclude photo button badge/campaigns - these are 9606.21 if acrylic but
              // "political button" etc. should still match
            ],
          },
          inject: [
            { prefix: '9606.21', syntheticRank: 5 }, // buttons of plastics (resin, acrylic)
            { prefix: '9606.22', syntheticRank: 5 }, // metal buttons (pin back, brass)
            { prefix: '9606.29', syntheticRank: 5 }, // other buttons (shell, leather, fabric)
            { prefix: '9606.10', syntheticRank: 4 }, // buttons of vegetable product/leather
          ],
          whitelist: {
            denyChapters: ['93', '71', '42', '59', '51', '52', '53', '50'],
          },
          boosts: [
            { delta: 0.60, prefixMatch: '9606.' },
          ],
        } as IntentRule;
        patches.push({ priority: 582, rule: newRule });
        console.log('BUTTON_SEWING_FASTENER_INTENT: created (buttons → 9606.XX, deny ammo/jewelry/bags)');
      }
    }

    // 5. NEW VINYL_STICKER_DECAL_INTENT → 3919.XX (self-adhesive plastic products)
    //    "Custom sticker label set" → 4821 (paper labels) WRONG
    //    "1.5x2.5 inch sticker" → 4821 WRONG
    //    "Jason Todd sticker" → 4821 WRONG
    //    3919.10 = self-adhesive plastic sheets/film/foil (rolls/sheets for commercial use)
    //    3919.90 = other self-adhesive products (individual stickers, die-cut stickers)
    {
      const existing = allRules.find(r => r.id === 'VINYL_STICKER_DECAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_STICKER_DECAL_INTENT',
          description: 'Vinyl stickers, decals, self-adhesive labels → ch.39 (3919.XX)',
          pattern: {
            anyOf: [
              // Generic sticker terms
              'sticker', 'stickers', 'sticker pack', 'sticker set',
              'die cut sticker', 'die-cut sticker', 'vinyl sticker', 'vinyl stickers',
              'vinyl decal', 'vinyl decals', 'custom sticker',
              'holographic sticker', 'glossy sticker', 'matte sticker',
              // Decal terms
              'decal sticker', 'car decal', 'bumper sticker',
              'window decal', 'laptop decal', 'wall decal',
              'waterproof sticker', 'weather resistant sticker',
              // Specific sticker types
              'kiss cut sticker', 'kiss-cut sticker',
              'foil sticker', 'bubble free sticker',
            ],
            noneOf: [
              // Exclude paper labels (different HTS)
              'paper sticker', 'paper label',
              // Exclude iron-on transfers (4908)
              'iron on', 'heat transfer', 'heat press',
              // Exclude nail stickers (different context)
              'nail sticker', 'nail art sticker',
              // Exclude food labels, price stickers (paper)
              'price sticker', 'food label',
              // Exclude wallpaper (even if "vinyl")
              'wallpaper',
            ],
          },
          inject: [
            { prefix: '3919.90', syntheticRank: 5 }, // other self-adhesive plastic products
            { prefix: '3919.10', syntheticRank: 5 }, // self-adhesive plates/sheets in rolls
            { prefix: '4821.10', syntheticRank: 4 }, // paper/paperboard labels (for top-10 coverage)
          ],
          whitelist: {
            allowChapters: ['39', '48', '49'],
          },
          boosts: [
            { delta: 0.60, prefixMatch: '3919.' },
          ],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('VINYL_STICKER_DECAL_INTENT: created (stickers → 3919.XX, allow ch.39/48/49)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT67)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT67 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
