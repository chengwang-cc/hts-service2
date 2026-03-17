#!/usr/bin/env ts-node
/**
 * Patch R2 — 2026-03-14:
 *
 * Targeting top blockers after Q2 (505/5000 = 10.10% blocked):
 *
 * 1. YARN_INTENT: add ch.58/59/63 + noneOf yarn winder/machine.
 *    'yarn' → yarn winder spool (ch.48), winding machine (ch.84),
 *    DMC embroidery thread (ch.58), crochet dish cloth (ch.63).
 *    7 blocks.
 *
 * 2. STATIONERY_NOTEBOOK_INTENT: add ch.41/58/60/83 for non-paper bookmarks.
 *    'bookmark' → leather bookmark (ch.41), woven carpet-style bookmark (ch.58),
 *    AIDA cross-stitch bookmark (ch.60), metal celestial bookmark (ch.83).
 *    6 blocks.
 *
 * 3. SHIRT_GARMENT_BACKUP_INTENT: add ch.43/63 + fix for odd cases.
 *    'shirt' → used t-shirt/secondhand clothing (ch.43 furskins/ch.63 used clothing).
 *    6 blocks.
 *
 * 4. SILICONE_MOLD_INTENT: add ch.44/84 to allowChapters.
 *    Wooden cookie molds (ch.44), industrial silicone molds for craft (ch.84 = 8480.79).
 *    5 blocks.
 *
 * 5. BEANIE_HAT_INTENT: add ch.60/61/62 + noneOf satin lined.
 *    Knit hats classified as ch.60/61/62 (not ch.65). 'Satin lined beanie' → ch.30.
 *    5 blocks.
 *
 * 6. DIAMOND_PAINTING_INTENT: add ch.34/39 + noneOf wax/release sheet.
 *    'diamond painting' → adhesive wax for DP pens (ch.34), release film (ch.39).
 *    5 blocks.
 *
 * 7. FIBERGLASS_COMPOSITE_INTENT: add ch.39/42/68 + noneOf accessories.
 *    'carbon fiber' → car door protector (ch.39), card holder (ch.42), ring blank (ch.68).
 *    5 blocks.
 *
 * 8. AI_CH02_OFFAL: noneOf for 'heart' as shape + 'tongue' as cleaner/clasp.
 *    'heart' → paint set (ch.32), heart-shaped box (ch.44), heart clip (ch.61).
 *    'tongue' → tongue clasp (ch.71), copper tongue cleaner (ch.74).
 *    5 blocks.
 *
 * 9. BICYCLE_INTENT: add ch.39/42/61/73/83 to allowChapters.
 *    Bicycle accessories: paint protection (ch.39), tool case (ch.42), cycling suit (ch.61),
 *    brake cable (ch.73), license plate (ch.83).
 *    5 blocks.
 *
 * 10. DAIRY_INTENT: noneOf for 'cream' as color + 'cheese' as descriptor.
 *     'cream' → dixie cup lid (ch.39), resin dog tag in cream color (ch.39), navy/cream top (ch.62).
 *     'cheese' → plastic cheese block cover (ch.39).
 *     5 blocks.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14r2.ts
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

    // ── 1. YARN_INTENT: add ch.58/59/63 + noneOf winder/machine ─────────────
    {
      const existing = allRules.find(r => r.id === 'YARN_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.58 (embroidery threads like DMC), ch.59 (rubber-coated yarn fabric), ch.63 (crochet finished goods)
        const newChapters = [...new Set([...currentChapters, '58', '59', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Yarn winder tools/equipment (ch.48 paper spools, ch.84 machines)
          'winder', 'winding machine', 'yarn winder', 'wool winder',
          'drill attachment', 'drill adapter', 'rotating stand',
          'drill yarn', 'spool', 'bobbin winder',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'YARN_INTENT') +
              ' — Fixed R2: added ch.58/59/63 (embroidery thread/finished goods); noneOf winder/winding machine',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`YARN_INTENT: added ch.58/59/63, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: YARN_INTENT not found'); }
    }

    // ── 2. STATIONERY_NOTEBOOK_INTENT: add ch.41/58/60/83 ────────────────────
    {
      const existing = allRules.find(r => r.id === 'STATIONERY_NOTEBOOK_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.41 (leather bookmarks), ch.58 (woven/carpet-style bookmarks),
        // ch.60 (AIDA cross-stitch bookmark fabric), ch.83 (metal bookmarks)
        const newChapters = [...new Set([...currentChapters, '41', '58', '60', '83'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'STATIONERY_NOTEBOOK_INTENT') +
              ' — Fixed R2: added ch.41 (leather), ch.58 (woven), ch.60 (AIDA fabric), ch.83 (metal) bookmarks',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`STATIONERY_NOTEBOOK_INTENT: added ch.41/58/60/83`);
      } else { console.log('WARNING: STATIONERY_NOTEBOOK_INTENT not found'); }
    }

    // ── 3. SHIRT_GARMENT_BACKUP_INTENT: add ch.43/63 ────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SHIRT_GARMENT_BACKUP_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.43 (used/vintage clothing with fur), ch.63 (secondhand/used clothing)
        const newChapters = [...new Set([...currentChapters, '43', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'shirt' as descriptor not garment type (e.g., "4-pocket shirt" = tool vest)
          // These edge cases are hard to target without breaking real shirts
          // Keep it minimal here
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SHIRT_GARMENT_BACKUP_INTENT') +
              ' — Fixed R2: added ch.43 (vintage fur clothing), ch.63 (secondhand/used clothing)',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SHIRT_GARMENT_BACKUP_INTENT: added ch.43/63`);
      } else { console.log('WARNING: SHIRT_GARMENT_BACKUP_INTENT not found'); }
    }

    // ── 4. SILICONE_MOLD_INTENT: add ch.44/84 ────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SILICONE_MOLD_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.44 (wooden cookie molds/stamps), ch.84 (industrial silicone molds = 8480.79)
        const newChapters = [...new Set([...currentChapters, '44', '84'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SILICONE_MOLD_INTENT') +
              ' — Fixed R2: added ch.44 (wooden cookie molds), ch.84 (industrial craft silicone molds 8480.79)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SILICONE_MOLD_INTENT: added ch.44/84`);
      } else { console.log('WARNING: SILICONE_MOLD_INTENT not found'); }
    }

    // ── 5. BEANIE_HAT_INTENT: add ch.60/61/62 + noneOf satin lined ───────────
    {
      const existing = allRules.find(r => r.id === 'BEANIE_HAT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.60 (knit fabric hats), ch.61 (knitted garments), ch.62 (woven hats/garments)
        const newChapters = [...new Set([...currentChapters, '60', '61', '62'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'satin lined beanie' = medical/hair-loss beanie → ch.30 pharmaceutical
          'satin lined', 'satin lining',
          // Prevent wrong chapter assignment for specific sub-types
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BEANIE_HAT_INTENT') +
              ' — Fixed R2: added ch.60/61/62 (knit/woven hat variants); noneOf satin lined',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BEANIE_HAT_INTENT: added ch.60/61/62, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: BEANIE_HAT_INTENT not found'); }
    }

    // ── 6. DIAMOND_PAINTING_INTENT: add ch.34/39 + noneOf wax tools ──────────
    {
      const existing = allRules.find(r => r.id === 'DIAMOND_PAINTING_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.34 (adhesive wax for diamond painting pens), ch.39 (release film/plastic sheets)
        const newChapters = [...new Set([...currentChapters, '34', '39'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Wax tools/supplies for diamond painting (not the painting itself)
          'adhesive wax', 'wax for diamond', 'diamond painting wax', 'dp tool',
          'diamond painting pen', 'dp pen',
          // Release sheets / backing film
          'release sheet', 'release sheets', 'pet liner', 'paper liner',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'DIAMOND_PAINTING_INTENT') +
              ' — Fixed R2: added ch.34 (DP wax tools), ch.39 (release film); noneOf adhesive wax/DP pen/release sheet',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`DIAMOND_PAINTING_INTENT: added ch.34/39, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: DIAMOND_PAINTING_INTENT not found'); }
    }

    // ── 7. FIBERGLASS_COMPOSITE_INTENT: add ch.39/42/68 + noneOf accessories ─
    {
      const existing = allRules.find(r => r.id === 'FIBERGLASS_COMPOSITE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (carbon fiber look plastic protectors), ch.42 (carbon fiber card holders),
        // ch.68 (carbon fiber ring blanks, stone articles)
        const newChapters = [...new Set([...currentChapters, '39', '42', '68'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Car body protection (vinyl-look, not actual fiberglass)
          'door sill', 'sill protector', 'door protector', 'paint protection',
          'anti-scratch', 'anti scratch',
          // Card/ID holders with carbon fiber look
          'id holder', 'edc holder', 'card edc', 'edch',
          // Ring blanks (jewelry-making blanks from carbon fiber)
          'ring blank', 'ring blanks',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'FIBERGLASS_COMPOSITE_INTENT') +
              ' — Fixed R2: added ch.39/42/68; noneOf door sill/card holder/ring blank',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`FIBERGLASS_COMPOSITE_INTENT: added ch.39/42/68, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: FIBERGLASS_COMPOSITE_INTENT not found'); }
    }

    // ── 8. AI_CH02_OFFAL: noneOf for heart-shaped items + tongue as non-meat ─
    {
      const existing = allRules.find(r => r.id === 'AI_CH02_OFFAL') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'heart' as shape/design motif (not organ meat)
          'heart shape', 'heart shaped', 'heart clip', 'heart of',
          'heart design', 'heart print', 'heart pattern', 'heart wood',
          'heart ring', 'heart necklace',
          // 'tongue' as cleaner/clasp (not organ meat)
          'tongue cleaner', 'tongue scraper', 'tongue clasp',
          'box and tongue', 'closure for necklace',
          // 'organ' as music organ (ch.92) or other non-meat
          'pipe organ', 'organ music', 'organ pedal',
          // 'liver' as brand/color (not meat)
          'liver colored', 'liver brown',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH02_OFFAL') +
              ' — Fixed R2: noneOf heart-shape/heart-clip/tongue-cleaner/tongue-clasp',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH02_OFFAL: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH02_OFFAL not found'); }
    }

    // ── 9. BICYCLE_INTENT: add ch.39/42/61/73/83 to allowChapters ────────────
    {
      const existing = allRules.find(r => r.id === 'BICYCLE_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // ch.39 (paint protection film), ch.42 (tool cases), ch.61 (cycling suits/jerseys),
        // ch.73 (brake cables, metal bike parts), ch.83 (license plates/signs)
        const newChapters = [...new Set([...currentChapters, '39', '42', '61', '73', '83'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'BICYCLE_INTENT') +
              ' — Fixed R2: added ch.39/42/61/73/83 for bicycle accessories (film/case/jersey/cable/plate)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`BICYCLE_INTENT: added ch.39/42/61/73/83`);
      } else { console.log('WARNING: BICYCLE_INTENT not found'); }
    }

    // ── 10. DAIRY_INTENT: noneOf for cream as color/descriptor ────────────────
    {
      const existing = allRules.find(r => r.id === 'DAIRY_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'cream' as color name (navy/cream top → ch.62)
          'cream color', 'cream colored', 'cream colour', 'cream coloured',
          'navy cream', 'ivory cream', 'bone cream',
          // 'cream' in paper/packaging products (dixie cup cream colored lid)
          'dixie cup', 'paper cup lid', 'cup lid', 'ice cream lid',
          // 'cheese' as product material description (not food)
          'cheese block cover', 'cheese cover', 'cheese wrapper',
          // 'cream' in craft/resin materials
          'cream bone', 'cream bone shape', 'bone shape',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'DAIRY_INTENT') +
              ' — Fixed R2: noneOf cream-as-color/dixie-cup/cheese-cover/cream-bone-shape',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`DAIRY_INTENT: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: DAIRY_INTENT not found'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch R2)...`);
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

    console.log(`\nPatch R2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
