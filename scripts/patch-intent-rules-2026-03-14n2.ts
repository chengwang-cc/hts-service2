#!/usr/bin/env ts-node
/**
 * Patch N2 — 2026-03-14:
 *
 * Targeting remaining top blockers after M2 (633/5000 = 12.66% blocked):
 *
 * 1. FAUX_LEATHER_GARMENT_INTENT: Add ch.42/48 + noneOf for non-garment faux leather items.
 *    'faux leather' → PU leather tote/coin pouch (ch.42), PU leather journal (ch.48),
 *    phone stand-faux leather (ch.55), key fob cover (ch.59), bookmark (ch.39).
 *    Add ch.42 (leather goods) and ch.48 (paper/leather journals) to allowChapters.
 *    9 blocks.
 *
 * 2. WOODEN_DECORATIVE_ARTICLE_INTENT: Add ch.94/95 + noneOf for cardstock/carbon fiber.
 *    'cake topper' → glitter cardstock toppers (ch.95 festive), 'ring blank' → micarta/carbon fiber,
 *    'embroidery hoop' → plastic/needlework hoops (ch.96), wooden spice rack (ch.94).
 *    'wooden signs' as antiques (ch.97), carved wood antiques (ch.97).
 *    Add ch.94 (wooden furniture), ch.95 (festive articles), ch.96 (needlework accessories).
 *    noneOf: cardstock/glitter/carbon fiber/antique/vintage/lock.
 *
 * 3. OUTERWEAR_JACKET_GARMENT_INTENT: Add ch.42/56/63 to allowChapters.
 *    ch.39 plastic/vinyl work jackets, ch.42 leather gloves, ch.56 cycling jersey (technical fabric),
 *    ch.63 used/secondhand clothing (hoodie/polo), ch.65 hairdressing capes.
 *
 * 4. BONE_CHINA_CERAMIC_DISHWARE_INTENT: Add ch.70/73 to allowChapters.
 *    Glass dishware (ch.70) and metal serving ware (ch.73) are close to ceramic dishware.
 *    8 blocks.
 *
 * 5. BLANKET_INTENT: Check and add allowChapters or noneOf.
 *    8 blocks from 'blanket' or related terms matching non-textile items.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14n2.ts
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

    // ── 1. FAUX_LEATHER_GARMENT_INTENT: add ch.42/48 + noneOf ─────────────────
    {
      const existing = allRules.find(r => r.id === 'FAUX_LEATHER_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.42 (PU leather bags/accessories), ch.48 (PU leather-covered journals)
        const newChapters = [...new Set([...currentChapters, '42', '48'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Bookmarks
          'bookmark', 'bookmarks',
          // Key fob covers (not garments)
          'key fob', 'keyfob', 'key fob holder',
          // Phone accessories
          'phone stand', 'phone holder', 'phone case',
          // Totes and pouches already covered by ch.42 addition
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FAUX_LEATHER_GARMENT_INTENT') +
              ' — Fixed N2: added ch.42 (PU leather bags), ch.48 (leather journals); noneOf bookmark/key fob/phone stand',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`FAUX_LEATHER_GARMENT_INTENT: added ch.42/48, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: FAUX_LEATHER_GARMENT_INTENT not found'); }
    }

    // ── 2. WOODEN_DECORATIVE_ARTICLE_INTENT: add ch.94/95/96 + noneOf ─────────
    {
      const existing = allRules.find(r => r.id === 'WOODEN_DECORATIVE_ARTICLE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.94 (wooden furniture like spice rack), ch.95 (festive cake toppers),
        // ch.96 (needlework hoops classified as sewing accessories)
        const newChapters = [...new Set([...currentChapters, '94', '95', '96'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Cardstock/glitter toppers (ch.95 festive, not wood)
          'glitter', 'cardstock', 'glitter cardstock', 'card stock',
          // Carbon fiber / micarta (not wood)
          'carbon fiber', 'carbon fibre', 'micarta', 'fire hose micarta',
          // Metal hardware for wooden boxes
          'lock', 'locks', 'padlock',
          // Antique wooden items (ch.97)
          'antique', 'vintage', 'primitive', 'chinese antique',
          // Plastic embroidery hoops (ch.96 sewing accessories)
          'plastic embroidery hoop', 'plastic hoop', 'plastic embroidery',
          // Non-slip embroidery hoops (textile product)
          'no-slip hoop', 'no slip hoop', 'nonslip hoop',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'WOODEN_DECORATIVE_ARTICLE_INTENT') +
              ' — Fixed N2: added ch.94/95/96; noneOf cardstock/glitter/carbon fiber/antique/vintage/lock',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`WOODEN_DECORATIVE_ARTICLE_INTENT: added ch.94/95/96, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: WOODEN_DECORATIVE_ARTICLE_INTENT not found'); }
    }

    // ── 3. OUTERWEAR_JACKET_GARMENT_INTENT: add ch.42/56/63 ──────────────────
    {
      const existing = allRules.find(r => r.id === 'OUTERWEAR_JACKET_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.42 (leather garment accessories like gloves), ch.56 (cycling jersey fabric),
        // ch.63 (used/secondhand clothing)
        const newChapters = [...new Set([...currentChapters, '42', '56', '63'])];
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Wedding dress shoulder straps (raw material, not garment)
          'shoulder strap', 'shoulder straps', 'straps for dress', 'strap for',
          // Macrame (already in FRESH_FLOWER_INTENT noneOf but not here)
          'macrame', 'macrame wrap', 'macrame bouquet',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'OUTERWEAR_JACKET_GARMENT_INTENT') +
              ' — Fixed N2: added ch.42 (leather gloves), ch.56 (cycling jersey fabric), ch.63 (used clothing); noneOf shoulder straps/macrame',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`OUTERWEAR_JACKET_GARMENT_INTENT: added ch.42/56/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: OUTERWEAR_JACKET_GARMENT_INTENT not found'); }
    }

    // ── 4. BONE_CHINA_CERAMIC_DISHWARE_INTENT: add ch.70/73 ───────────────────
    {
      const existing = allRules.find(r => r.id === 'BONE_CHINA_CERAMIC_DISHWARE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.70 (glass dishware) and ch.73 (metal serving items like silverware)
        const newChapters = [...new Set([...currentChapters, '70', '73'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BONE_CHINA_CERAMIC_DISHWARE_INTENT') +
              ' — Fixed N2: added ch.70 (glass dishware), ch.73 (metal serving ware)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BONE_CHINA_CERAMIC_DISHWARE_INTENT: added ch.70/73`);
      } else { console.log('WARNING: BONE_CHINA_CERAMIC_DISHWARE_INTENT not found'); }
    }

    // ── 5. BLANKET_INTENT: check and fix ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'BLANKET_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        console.log(`BLANKET_INTENT: allowChapters=${JSON.stringify(wl.allowChapters)}, anyOf count=${(pat.anyOf ?? []).length}`);
        // Add ch.57 (carpets/floor coverings - 'blanket stitch'), ch.94 (heated blankets)
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '57', '94'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Insurance/security "blanket coverage"
          'coverage', 'insurance', 'policy',
          // Blanket stitch (sewing technique)
          'blanket stitch', 'stitch',
          // Blank (as in ring blank or pen blank)
          'blank', 'ring blank', 'pen blank',
          // Technical/industrial blankets
          'printing blanket', 'offset blanket', 'rubber blanket',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BLANKET_INTENT') +
              ' — Fixed N2: added ch.57/94; noneOf coverage/stitch/blank/printing blanket',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BLANKET_INTENT: added ch.57/94, ${addNoneOf.length} noneOf terms`);
      } else { console.log('BLANKET_INTENT not found — skipping'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch N2)...`);
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

    console.log(`\nPatch N2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
