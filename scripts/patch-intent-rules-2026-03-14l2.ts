#!/usr/bin/env ts-node
/**
 * Patch L2 — 2026-03-14:
 *
 * Targeting remaining top blockers after K2 (715/5000 = 14.30% blocked):
 *
 * 1. JEWELRY_RING_INTENT: Add ch.39 + noneOf for non-jewelry contexts.
 *    'charm'/'charms' blocks acrylic phone charms, car charms, zipper pulls (ch.39).
 *    'ring' blocks car emblem rings, ring boxes, ring makers tape.
 *    'pendant' blocks plastic/acrylic pendants (keychains).
 *    'lapel pin' blocks wood/flag lapel pins (ch.44/73).
 *    35 blocks total.
 *
 * 2. GEMSTONE_CABOCHON_INTENT: Add ch.25 + noneOf for color-name matches.
 *    'emerald' → "Emerald Green" pigment (ch.32), journal (ch.48), shoes (ch.64).
 *    'ruby' → "Ruby Red" velvet cloth (ch.55). 'jade' → stone inlay (ch.68).
 *    'agate' → natural agate slice (ch.25). 'gemstone' → glass beads (ch.70).
 *    'turquoise' → orthopedic fastener (ch.90).
 *    Add ch.25 for mineral specimens. Add noneOf for color/pigment/cloth/shoe.
 *    16 blocks.
 *
 * 3. PEN_PENCIL_INTENT: Add ch.32 + noneOf for non-pen pen contexts.
 *    'pen' → pen company ink (ch.32), wooden pen rest/stand (ch.83/84).
 *    'pencil' → pencil sharpener parts (ch.84).
 *    'pens' → diamond painting wax pens (ch.34).
 *    'marker' → paint art marker (ch.32), woven bookmark (ch.58).
 *    Add ch.32 (pen ink). noneOf: sharpener/rest/stand/wax/ink sample.
 *    14 blocks.
 *
 * 4. CANDLE_HOME_INTENT: Add ch.33 + noneOf for holder.
 *    'candle' → Block Buster ritual candle (ch.33), stone candle holder (ch.68).
 *    Add ch.33. noneOf: holder/holders/candleholder.
 *    10 blocks.
 *
 * 5. AI_CH92_HARP: noneOf for automotive/perfume/celtic-decal contexts.
 *    'celtic' → vinyl decals, cardigan clasp, earrings.
 *    'oud' → oud perfume/incense sticks (ch.33).
 *    'pedal' → guitar effects pedal (ch.85), automotive brake pedal (ch.87).
 *    'lever' → shift lever module (ch.85), parking brake lever (ch.87).
 *    10 blocks.
 *
 * 6. AI_CH69_CERAMIC_MISC_HOUSEHOLD: Add ch.44/70/73 to allowChapters.
 *    'trinket dish','butter dish','candle holder','utensil holder' appear in
 *    glass (ch.70), metal (ch.73), wood (ch.44) versions — all legitimate.
 *    12 blocks.
 *
 * 7. LAPEL_PIN_BROOCH_INTENT: noneOf for flag/wood lapel pins.
 *    Check if separate from JEWELRY_RING_INTENT.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14l2.ts
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

    // ── 1. JEWELRY_RING_INTENT: add ch.39 + noneOf for non-jewelry contexts ───
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_RING_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.39 (acrylic/plastic charms, phone charms, keychains) and ch.83 (zipper pulls)
        const newChapters = [...new Set([...currentChapters, '39', '83'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Non-jewelry charms
          'phone charm', 'car charm', 'keychain charm', 'phone strap', 'wristlet',
          'zipper pull', 'zipper pulls', 'zipper charm',
          // Car rings/emblems
          'car ring', 'auto ring', 'car emblem', 'auto emblem', 'vehicle emblem',
          'badge ring', 'audi', 'car badge', 'car logo',
          // Ring containers/tools
          'ring box', 'ring stand', 'ring tool', 'ring makers', 'making tape',
          'ring holder box', 'velvet pouch',
          // Non-jewelry lapel pins (flag, wood)
          'flag lapel', 'flag pin', 'olympic lapel', 'wood lapel',
          // Non-jewelry brooches
          'baby pin', 'diaper pin', 'newborn gift', 'baby shower gift',
          // Telephone ring (dial)
          'telephone', 'phone ring part', 'dial card',
          // Tape/tool rings
          'protective tape', 'sanding tape', 'anodizing',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_RING_INTENT') +
              ' — Fixed L2: added ch.39/83 for acrylic charms/keychains; noneOf car emblems/ring boxes/zip pulls/flag pins',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`JEWELRY_RING_INTENT: added ch.39/83, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: JEWELRY_RING_INTENT not found'); }
    }

    // ── 2. GEMSTONE_CABOCHON_INTENT: add ch.25 + noneOf for color-name matches
    {
      const existing = allRules.find(r => r.id === 'GEMSTONE_CABOCHON_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.25 (mineral specimens, crushed stone), ch.70 (glass gemstone beads)
        const newChapters = [...new Set([...currentChapters, '25', '70'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Color-name uses of gemstone words
          'dry pigment', 'pigment', 'art pigment', 'color pigment',
          'velvet', 'cloth', 'fabric',
          'shoe', 'shoes', 'sneaker', 'footwear', 'boot', 'boots',
          'journal', 'notebook', 'book', 'planner',
          // Medical/orthopedic
          'orthopedic', 'medical', 'fastener',
          // Metal hardware with gemstone accent
          'clasp with', 'cardigan clasp', 'sew-on',
          // Glass beads are ch.70 (not gemstones)
          'bead', 'beads', 'bead strand', 'glass bead',
          // Stone inlay/crushing
          'stone inlay crush', 'inlay crush', 'inlay crush made',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'GEMSTONE_CABOCHON_INTENT') +
              ' — Fixed L2: added ch.25 (minerals) ch.70 (glass beads); noneOf pigment/velvet/shoe/bead/clasp',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`GEMSTONE_CABOCHON_INTENT: added ch.25/70, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: GEMSTONE_CABOCHON_INTENT not found'); }
    }

    // ── 3. PEN_PENCIL_INTENT: add ch.32 + noneOf for non-pen contexts ─────────
    {
      const existing = allRules.find(r => r.id === 'PEN_PENCIL_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.32 (pen inks, art markers)
        const newChapters = [...new Set([...currentChapters, '32'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Pencil sharpeners (machines, ch.84)
          'sharpener', 'sharpeners', 'pencil sharpener', 'replacement gear', 'gear',
          // Pen rests/stands (desk accessories)
          'rest', 'pen rest', 'pen stand', 'stand',
          // Pen ink (ch.32)
          'ink', 'inks', 'ink sample', 'fountain pen ink', 'pen ink',
          // Wax for diamond painting 'pens'
          'wax', 'adhesive wax', 'diamond painting', 'diamond paint',
          // Paint markers
          'paint marker', 'paint art', 'art marker',
          // Bookmarks (textile, ch.58)
          'woven', 'carpet-style', 'turkish bookmark', 'book marker',
          // Pen cases already in noneOf but reinforcing
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PEN_PENCIL_INTENT') +
              ' — Fixed L2: added ch.32 (pen ink/markers); noneOf sharpener/rest/stand/ink/wax/diamond painting',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`PEN_PENCIL_INTENT: added ch.32, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: PEN_PENCIL_INTENT not found'); }
    }

    // ── 4. CANDLE_HOME_INTENT: add ch.33 + noneOf for holders ─────────────────
    {
      const existing = allRules.find(r => r.id === 'CANDLE_HOME_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Add ch.33 (ritual/spiritual candles = cosmetic/preparation category)
        const newChapters = [...new Set([...currentChapters, '33'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Candle holders (belong to ch.69/70/73/94)
          'holder', 'holders', 'candleholder', 'candleholders', 'candle holder',
          'candle stick', 'candlestick', 'candlesticks', 'lantern', 'lanterns',
          // Scented/ritual context already ch.33/34
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CANDLE_HOME_INTENT') +
              ' — Fixed L2: added ch.33 (ritual candles); noneOf holder/candlestick (accessories not candles)',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`CANDLE_HOME_INTENT: added ch.33, ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: CANDLE_HOME_INTENT not found'); }
    }

    // ── 5. AI_CH92_HARP: noneOf for automotive/perfume/celtic-decal ──────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_HARP') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Celtic as design motif (not celtic harp)
          'celtic knot', 'celtic design', 'celtic cross', 'celtic pattern',
          'decal', 'vinyl decal', 'vinyl decals',
          'clasp', 'earring', 'earrings', 'wire',
          // Oud as perfume/incense (not oud instrument)
          'oud perfume', 'oud sticks', 'oud fragrance', 'oud incense',
          'perfume', 'fragrance', 'cologne', 'attar', 'ml',
          // Guitar pedal (effects pedal, not harp pedal)
          'guitar effects pedal', 'guitar effect pedal', 'effects pedal', 'effect pedal',
          'guitar effects', 'guitar effect',
          // Automotive pedal
          'automotive', 'brake pedal', 'accelerator pedal', 'clutch',
          'brake lever', 'parking brake', 'shift lever',
          'monostable', 'electronic module',
          // Honda/car parts
          'cbr', 'honda', 'oem', 'perch mount',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH92_HARP') +
              ' — Fixed L2: noneOf celtic-decal/oud-perfume/guitar-effects-pedal/automotive-pedal-lever',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH92_HARP: adding ${addNoneOf.length} noneOf terms`);
      } else { console.log('WARNING: AI_CH92_HARP not found'); }
    }

    // ── 6. AI_CH69_CERAMIC_MISC_HOUSEHOLD: add ch.44/70/73 to allowChapters ──
    {
      const existing = allRules.find(r => r.id === 'AI_CH69_CERAMIC_MISC_HOUSEHOLD') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        // Trinket dishes, butter dishes, candle holders in glass (70), metal (73), wood (44)
        const newChapters = [...new Set([...currentChapters, '44', '70', '73'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH69_CERAMIC_MISC_HOUSEHOLD') +
              ' — Fixed L2: added ch.44 (wood), ch.70 (glass), ch.73 (metal) for same household items in other materials',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH69_CERAMIC_MISC_HOUSEHOLD: added ch.44/70/73`);
      } else { console.log('WARNING: AI_CH69_CERAMIC_MISC_HOUSEHOLD not found'); }
    }

    // ── 7. LAPEL_PIN_BROOCH_INTENT: check and add noneOf if exists ─────────────
    {
      const existing = allRules.find(r => r.id === 'LAPEL_PIN_BROOCH_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const wl = existing.whitelist as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Flag/national lapel pins (ch.73 metal)
          'flag pin', 'flag lapel', 'olympic pin', 'national flag',
          // Wood lapel pins
          'wooden', 'wood pin',
          // Baby safety pins
          'baby pin', 'diaper pin', 'safety pin', 'baby shower',
          // Non-jewelry brooches
          'magnetic brooch', 'magnetic fastener',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        // Add ch.73 for metal lapel pins that aren't precious metal
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '73', '44'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'LAPEL_PIN_BROOCH_INTENT') +
              ' — Fixed L2: added ch.73/44 for metal/wood lapel pins; noneOf flag pin/safety pin/baby pin',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`LAPEL_PIN_BROOCH_INTENT: added ch.73/44, ${addNoneOf.length} noneOf terms`);
      } else { console.log('LAPEL_PIN_BROOCH_INTENT not found — skipping'); }
    }

    // ── Apply all patches ─────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch L2)...`);
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

    console.log(`\nPatch L2 complete: ${applied} applied, ${failed} failed`);
    console.log(`Rules in cache: ${(svc.getAllRules() as any[]).length}`);

  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
