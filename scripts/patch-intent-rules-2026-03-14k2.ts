#!/usr/bin/env ts-node
/**
 * Patch K2 — 2026-03-14:
 *
 * Targeting remaining top blockers after J2 (793/5000 = 15.86% blocked):
 *
 * 1. STICKER_SHEET_PAPER_INTENT: Add ch.39 to allowChapters.
 *    Vinyl/plastic stickers (3919.xx) are a major product category — 22 blocked.
 *    Also add 'antique','vintage','stereoview' to noneOf for photo card context.
 *
 * 2. SPORTS_BALL_INTENT: Add noneOf for non-ball sport contexts.
 *    'baseball' matches baseball gloves/hats, 'football' matches coasters/leather balls.
 *    Add noneOf: glove/hat/cap/jersey/coaster/logo/emblem/vintage/leather/fishing.
 *
 * 3. AI_CH58_BRAID_TASSEL_TRIM: Add noneOf for automotive plastic trim.
 *    'trim' matches car dash trim, console trim, panel trim (ch.85/87) — 12 blocks.
 *    Add noneOf: automotive/car/vehicle/panel/dash/vent/console/housing.
 *
 * 4. YARN_INTENT: Add ch.50 and ch.53 to allowChapters.
 *    Silk yarn → ch.50, Linen yarn → ch.53. Currently only allows [54,55,51,52].
 *    5 blocks from silk/linen yarn queries.
 *
 * 5. DAIRY_INTENT: More noneOf for non-dairy 'cream'/'butter'/'cheese' contexts.
 *    'cream' matches cream-colored clothing, cosmetic creams, ceramic cream sets.
 *    'butter' matches antique butter dishes, glass butter dishes.
 *    'cheese' matches plastic cheese shakers/covers.
 *    Add noneOf: dish/dishes/shaker/mold/stamp/color/coloured/antique/vintage/glass/ceramic.
 *
 * 6. FRESH_FRUIT_INTENT: Add noneOf for non-food fruit word contexts.
 *    'orange'/'lemon' matches colors/electronic components. 'banana' matches toys.
 *    'coconut' matches fiber products. 'fruit' matches shaped art/magnets.
 *    Add noneOf: cleaner/cleaning/toy/magnet/vase/sculpture/whistle/capacitor/electronic.
 *
 * 7. FRESH_FLOWER_INTENT: Add noneOf for wine/crochet/flask contexts.
 *    'rose' matches "Rose Wine" (wine gummies, ch.21). 'bouquet' matches crochet flowers.
 *    Add noneOf: wine/gummies/gummy/stainless/flask/crochet/knit/macrame.
 *
 * 8. HALLOWEEN_COSTUME_INTENT: Add ch.42,61,62 to allowChapters.
 *    'costume' appears on leather costume accessories (ch.42), textile costumes (ch.61/62).
 *    Costumes legitimately span multiple chapters.
 *
 * 9. OUTERWEAR_JACKET_GARMENT_INTENT: Add noneOf for paint/shoelace/clasp contexts.
 *    'topcoat' matches gel stain & topcoat (paint product). 'dress' matches shoelaces.
 *    'cardigan clasp' matches metal fasteners. Add noneOf: paint/stain/shoelace/clasp.
 *    Also add ch.40,41,50 to allowChapters (rubber/leather/silk garments are legitimate).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14k2.ts
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

    // ── 1. STICKER_SHEET_PAPER_INTENT: add ch.39 + noneOf antique/vintage ──────
    {
      const existing = allRules.find(r => r.id === 'STICKER_SHEET_PAPER_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '39'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = ['antique', 'vintage', 'stereoview', 'historical'];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STICKER_SHEET_PAPER_INTENT') +
              ' — Fixed K2: added ch.39 for vinyl stickers; noneOf antique/vintage',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`STICKER_SHEET_PAPER_INTENT: added ch.39 to allowChapters, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: STICKER_SHEET_PAPER_INTENT not found'); }
    }

    // ── 2. SPORTS_BALL_INTENT: noneOf for non-ball sport contexts ─────────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_BALL_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'glove', 'gloves', 'mitt', 'mitts', 'hat', 'cap', 'jersey',
          'coaster', 'coasters', 'logo', 'emblem', 'patch', 'felties',
          'card', 'cards', 'trading card', 'vintage', 'antique',
          'leather', 'leather ball', 'fishing', 'shock leader',
          'whistle', 'capacitor', 'component', 'tackle', 'uniform',
          'shoe', 'shoes', 'cleat', 'cleats', 'boot', 'boots',
          'helmet', 'helmets', 'shoulder pad', 'shin guard',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_BALL_INTENT') +
              ' — Fixed K2: noneOf for gloves/hats/jerseys/coasters/leather (non-ball contexts)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`SPORTS_BALL_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: SPORTS_BALL_INTENT not found'); }
    }

    // ── 3. AI_CH58_BRAID_TASSEL_TRIM: noneOf for automotive plastic trim ──────
    {
      const existing = allRules.find(r => r.id === 'AI_CH58_BRAID_TASSEL_TRIM') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'automotive', 'automobile', 'car', 'vehicle', 'auto',
          'panel', 'dash', 'dashboard', 'vent', 'console',
          'housing', 'switch', 'plastic trim', 'plastic panel',
          'car trim', 'car panel', 'dash trim', 'door trim',
          'window trim', 'body trim', 'scart', 'resin based',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        // Also add ch.43 (fur pom poms) and ch.60 (knitted lace trim) to allowChapters
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '43', '60', '62'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH58_BRAID_TASSEL_TRIM') +
              ' — Fixed K2: noneOf automotive trim; added ch.43/60/62 for fur pom poms/lace trim/garment trim',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH58_BRAID_TASSEL_TRIM: adding ${addNoneOf.length} noneOf terms, added ch.43/60/62`);
      } else { console.log('WARNING: AI_CH58_BRAID_TASSEL_TRIM not found'); }
    }

    // ── 4. YARN_INTENT: add ch.50 (silk) and ch.53 (linen) to allowChapters ──
    {
      const existing = allRules.find(r => r.id === 'YARN_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '50', '53'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'YARN_INTENT') +
              ' — Fixed K2: added ch.50 (silk yarn) and ch.53 (linen yarn) to allowChapters',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`YARN_INTENT: added ch.50, ch.53 to allowChapters`);
      } else { console.log('WARNING: YARN_INTENT not found'); }
    }

    // ── 5. DAIRY_INTENT: more noneOf for non-dairy contexts ───────────────────
    {
      const existing = allRules.find(r => r.id === 'DAIRY_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Butter/cheese dishes and tools
          'dish', 'dishes', 'shaker', 'mold', 'stamp', 'mould',
          'pitcher', 'jug', 'dish set', 'butter dish', 'cheese board',
          // Cream as color
          'cream coloured', 'cream colored', 'cream color', 'cream colour',
          // Cosmetic/topical cream (single words not caught by phrases)
          'facial', 'moisturizing', 'moisturiser', 'moisturizer',
          'hydrating', 'hydration',
          // Antique/vintage dairy items
          'antique', 'vintage', 'primitive', 'carved', 'glass dish',
          // Other non-dairy uses
          'pillow', 'pillows', 'cushion', 'plush', 'toy', 'magnet',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'DAIRY_INTENT') +
              ' — Fixed K2: noneOf for butter dishes/antique/cream-colored/facial/moisturizing',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`DAIRY_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: DAIRY_INTENT not found'); }
    }

    // ── 6. FRESH_FRUIT_INTENT: noneOf for non-food fruit word contexts ─────────
    {
      const existing = allRules.find(r => r.id === 'FRESH_FRUIT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Orange/lemon as color
          'cleaner', 'cleaning', 'floor cleaner', 'detergent',
          // Non-food uses of fruit words
          'toy', 'silicone toy', 'magnet', 'magnets',
          'vase', 'glass vase', 'lamp', 'light',
          'whistle', 'emergency whistle',
          'capacitor', 'resistor', 'component', 'electronic', 'electronics',
          'sculpture', 'art', 'decor', 'decoration',
          'grip', 'rubber grip', 'rubber', 'silicone',
          'fiber', 'fibre', 'natural fiber',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FRESH_FRUIT_INTENT') +
              ' — Fixed K2: noneOf for fruit-word-as-color/material contexts (cleaner/toy/vase/capacitor/sculpture)',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`FRESH_FRUIT_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: FRESH_FRUIT_INTENT not found'); }
    }

    // ── 7. FRESH_FLOWER_INTENT: noneOf for wine/flask/crochet contexts ────────
    {
      const existing = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Rose wine / wine gummies
          'wine', 'gummies', 'gummy', 'candy', 'candies', 'confection',
          // Rose gold color / thermoses
          'stainless', 'flask', 'thermos', 'vacuum bottle', 'water bottle',
          'steel', 'aluminum', 'aluminium',
          // Crochet/knit flower bouquets (textile items, not fresh flowers)
          'crochet', 'knit', 'knitted', 'macrame', 'handmade crochet',
          // Butterfly wall decor with "rose pink" color
          'butterfly', 'wall butterfly', 'wall decal',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        // Also add ch.61 for crochet flower bouquets (textile accessories)
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '61'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FRESH_FLOWER_INTENT') +
              ' — Fixed K2: noneOf wine/gummies/crochet/flask; added ch.61 for textile flower bouquets',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`FRESH_FLOWER_INTENT: adding ${addNoneOf.length} noneOf terms, added ch.61`);
      } else { console.log('WARNING: FRESH_FLOWER_INTENT not found'); }
    }

    // ── 8. HALLOWEEN_COSTUME_INTENT: add ch.42,61,62 to allowChapters ─────────
    {
      const existing = allRules.find(r => r.id === 'HALLOWEEN_COSTUME_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Costumes legitimately span ch.42 (leather), ch.61 (knitted), ch.62 (woven), ch.65 (headwear)
        const newChapters = [...new Set([...currentChapters, '42', '61', '62', '65'])];
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        // But exclude dance/performance costumes (ch.59) and used goods (ch.63)
        const addNoneOf = ['dance costume', 'used', 'metal'];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'HALLOWEEN_COSTUME_INTENT') +
              ' — Fixed K2: added ch.42/61/62/65 (costumes span multiple materials); noneOf dance/used/metal',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`HALLOWEEN_COSTUME_INTENT: added ch.42/61/62/65 to allowChapters`);
      } else { console.log('WARNING: HALLOWEEN_COSTUME_INTENT not found'); }
    }

    // ── 9. OUTERWEAR_JACKET_GARMENT_INTENT: noneOf + allowChapters ────────────
    {
      const existing = allRules.find(r => r.id === 'OUTERWEAR_JACKET_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Paint/stain topcoat
          'paint', 'gel stain', 'floor paint', 'wall paint', 'topcoat paint',
          // Shoelaces
          'shoelace', 'shoelaces', 'shoe lace', 'shoe laces', 'laces',
          // Metal clasp/fastener
          'clasp', 'clasp with', 'fastener', 'button fastener', 'closure fastener',
          // Hairdressing capes
          'hairdressing', 'barber', 'hair cutting', 'haircutting',
          // Fishing
          'fishing', 'fishing gear',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        // Add rubber (ch.40), leather (ch.41), silk (ch.50) garments to allowChapters
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '40', '41', '50'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'OUTERWEAR_JACKET_GARMENT_INTENT') +
              ' — Fixed K2: noneOf paint/shoelace/clasp/hairdressing; added ch.40/41/50 for rubber/leather/silk garments',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`OUTERWEAR_JACKET_GARMENT_INTENT: adding ${addNoneOf.length} noneOf terms, added ch.40/41/50`);
      } else { console.log('WARNING: OUTERWEAR_JACKET_GARMENT_INTENT not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch K2)...`);
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

    console.log(`\nPatch K2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
