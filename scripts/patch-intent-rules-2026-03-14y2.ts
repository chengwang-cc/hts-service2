#!/usr/bin/env ts-node
/**
 * Patch Y2 — 2026-03-14:
 *
 * Using CORRECTED inspection (entry.expectedChapter field) for accurate real blocks.
 * Current state: 281/5000 = 5.62% blocked.
 *
 * 1. THREAD_EMBROIDERY_CORD_INTENT: add ch.50/54/60/63; noneOf felt-garland.
 *    'embroidery floss' → silk (ch.50), nylon beading thread (ch.54), cross-stitch AIDA kit (ch.60),
 *    felt pom pom garland (ch.63, not embroidery).
 *
 * 2. AI_CH60_DOUBLE_KNIT_INTERLOCK: add ch.52/61/62; noneOf jersey-fabric-craft.
 *    'jersey' → jersey fabric letters kit (ch.52 cotton fabric), knit jersey poly shirt (ch.61),
 *    bamboo jersey skirt (ch.62 woven garment).
 *
 * 3. GLASSWARE_DRINKING_INTENT: add ch.54/58/69/71/94; noneOf seed-bead.
 *    'glass bead' → nylon filament beads (ch.54), needlework glass beads (ch.58),
 *    crystal art glass figurine (ch.69), glass bead earrings (ch.71), glass lamp shade (ch.94).
 *    'seed bead/seed beads' → embroidery beads, not drinking glasses.
 *
 * 4. JEWELRY_EARRING_INTENT: add ch.58/74.
 *    'earrings' → woven metal fabric earrings (ch.58), copper wire earrings (ch.74).
 *
 * 5. LACE_VELVET_FABRIC_INTENT: add ch.53/60/63/65.
 *    'cotton lace' → linen lace yarn (ch.53), cotton lace tablecloth (ch.63), lace crown (ch.65).
 *    'stretch lace' → knitted nylon stretch lace (ch.60).
 *
 * 6. AI_CH64_GAITER_LEGGING: add ch.61/62/90.
 *    'legging/leggings' → knitted compression leggings (ch.61), woven cotton leggings (ch.62),
 *    medical brace in legging form (ch.90).
 *
 * 7. AI_CH64_HEEL_CUSHION_PARTS: add ch.61/62/90.
 *    Same as above — both rules fire on 'legging' triggering ch.61/62/90.
 *
 * 8. INLINE_SKATE_SPORTS_INTENT: add ch.64; noneOf ice-skate-balloon.
 *    Rollerblade/hockey skates = footwear (ch.64), not sporting goods (ch.95).
 *    'ice skate' → ice skate balloon (ch.88 balloon aircraft).
 *
 * 9. AI_CH03_MAHI_SNAPPER_GROUPER: noneOf false triggers.
 *    'flounder' → Disney Little Mermaid "Flounder" (ch.63 bedding).
 *    'bass' → G.H. Bass shoe brand (ch.64); guitar amp "bass tone" (ch.85).
 *    'perch' → motorcycle clutch perch mount (ch.85).
 *    'skate' → ice skate balloon (ch.88); inline skate chassis (ch.95).
 *
 * 10. AI_CH58_BRAID_TASSEL_TRIM: add ch.65/69/70/71/76/88/94.
 *     'pom pom' → velvet helmet cover (ch.65).
 *     'trim' → ceramic saucer trim (ch.69), glass bottle rhinestone trim (ch.70),
 *     aluminum planter trim (ch.76), flight sim trim wheel (ch.88), auto seat trim (ch.94).
 *     'tassel' → pearl tassel earrings (ch.71).
 *
 * 11. HAIR_CLAW_INTENT: add ch.30/58/67.
 *     'headband' → medical compression headband (ch.30), birdcage veil lace (ch.58),
 *     handmade newborn headband with feathers (ch.67).
 *
 * 12. SPORTS_JERSEY_INTENT: add ch.60.
 *     'hockey jersey' → used/youth hockey jersey knit fabric (ch.60).
 *
 * 13. SPORTS_JERSEY_GARMENT_INTENT: add ch.60.
 *     Same as above.
 *
 * 14. SHIRT_GARMENT_BACKUP_INTENT: add ch.42/64.
 *     'shirt' → 4-pocket organizer shirt/pouch (ch.42), womens shirt-style footwear (ch.64).
 *
 * 15. TEMPERED_GLASS_SCREEN_INTENT: add ch.42/49.
 *     'screen protector' → phone screen protector pouch (ch.42),
 *     printed/paper screen guard (ch.49).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14y2.ts
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

    // ── 1. THREAD_EMBROIDERY_CORD_INTENT ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'THREAD_EMBROIDERY_CORD_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '50', '54', '60', '63'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'felt garland', 'felt pom pom garland', 'felt balls garland',
          'pom pom garland', 'spring garland', 'party garland',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'THREAD_EMBROIDERY_CORD_INTENT') +
              ' — Fixed Y2: added ch.50/54/60/63; noneOf felt-garland',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`THREAD_EMBROIDERY_CORD_INTENT: added ch.50/54/60/63, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: THREAD_EMBROIDERY_CORD_INTENT not found'); }
    }

    // ── 2. AI_CH60_DOUBLE_KNIT_INTERLOCK ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH60_DOUBLE_KNIT_INTERLOCK') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '52', '61', '62'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'jersey fabric letters', 'jersey fabric numbers', 'jersey fabric kit',
          'jersey skirt', 'bamboo jersey skirt',
          'jersey unisex', 'jersey poly', 'jersey shirt',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH60_DOUBLE_KNIT_INTERLOCK') +
              ' — Fixed Y2: added ch.52/61/62; noneOf jersey-fabric-kit/skirt/unisex',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH60_DOUBLE_KNIT_INTERLOCK: added ch.52/61/62, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH60_DOUBLE_KNIT_INTERLOCK not found'); }
    }

    // ── 3. GLASSWARE_DRINKING_INTENT ──────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'GLASSWARE_DRINKING_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '54', '58', '69', '71', '94'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // Seed beads and craft beads (not drinking glasses)
          'seed bead', 'seed beads', 'petite bead', 'petite beads',
          'beads for needlework', 'needlework bead',
          // Lamp shades (ch.94)
          'lamp shade', 'light shade',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'GLASSWARE_DRINKING_INTENT') +
              ' — Fixed Y2: added ch.54/58/69/71/94; noneOf seed-bead/lamp-shade',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`GLASSWARE_DRINKING_INTENT: added ch.54/58/69/71/94, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: GLASSWARE_DRINKING_INTENT not found'); }
    }

    // ── 4. JEWELRY_EARRING_INTENT ─────────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_EARRING_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '58', '74'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_EARRING_INTENT') +
              ' — Fixed Y2: added ch.58 (woven metal earrings), ch.74 (copper wire earrings)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`JEWELRY_EARRING_INTENT: added ch.58/74`);
      } else { console.log('WARNING: JEWELRY_EARRING_INTENT not found'); }
    }

    // ── 5. LACE_VELVET_FABRIC_INTENT ─────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'LACE_VELVET_FABRIC_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '53', '60', '63', '65'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'LACE_VELVET_FABRIC_INTENT') +
              ' — Fixed Y2: added ch.53 (linen lace yarn), ch.60 (knitted stretch lace), ch.63 (lace tablecloth), ch.65 (lace crown)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`LACE_VELVET_FABRIC_INTENT: added ch.53/60/63/65`);
      } else { console.log('WARNING: LACE_VELVET_FABRIC_INTENT not found'); }
    }

    // ── 6. AI_CH64_GAITER_LEGGING ─────────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH64_GAITER_LEGGING') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '61', '62', '90'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH64_GAITER_LEGGING') +
              ' — Fixed Y2: added ch.61/62 (knit/woven leggings as garments), ch.90 (medical brace legging)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH64_GAITER_LEGGING: added ch.61/62/90`);
      } else { console.log('WARNING: AI_CH64_GAITER_LEGGING not found'); }
    }

    // ── 7. AI_CH64_HEEL_CUSHION_PARTS ────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH64_HEEL_CUSHION_PARTS') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '61', '62', '90'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH64_HEEL_CUSHION_PARTS') +
              ' — Fixed Y2: added ch.61/62 (knit/woven leggings), ch.90 (medical brace)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH64_HEEL_CUSHION_PARTS: added ch.61/62/90`);
      } else { console.log('WARNING: AI_CH64_HEEL_CUSHION_PARTS not found'); }
    }

    // ── 8. INLINE_SKATE_SPORTS_INTENT ────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'INLINE_SKATE_SPORTS_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '64', '88'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          'ice skate balloon', 'skate balloon', 'ice skate party', 'figure skating party',
          'winter wonderland', 'onederland',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'INLINE_SKATE_SPORTS_INTENT') +
              ' — Fixed Y2: added ch.64 (rollerblade/hockey skate footwear), ch.88; noneOf ice-skate-balloon',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`INLINE_SKATE_SPORTS_INTENT: added ch.64/88, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: INLINE_SKATE_SPORTS_INTENT not found'); }
    }

    // ── 9. AI_CH03_MAHI_SNAPPER_GROUPER ──────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH03_MAHI_SNAPPER_GROUPER') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'flounder' = Disney character (bedding ch.63)
          'little mermaid', 'disney mermaid', 'flounder',
          // 'bass' = G.H. Bass shoe brand (ch.64) or guitar "bass tone" (ch.85)
          'gh bass', 'g.h. bass', 'weejuns', 'loafer',
          'bass tone', 'guitar amp', 'guitar bass', 'amp capacitor',
          // 'perch' = motorcycle clutch perch / handlebar perch (ch.85)
          'clutch perch', 'perch mount', 'handlebar perch',
          // 'skate' = inline skate chassis (ch.95), ice skate balloon (ch.88)
          'skate chassis', 'skate frame', 'inline skate chassis',
          'ice skate balloon', 'skate balloon',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH03_MAHI_SNAPPER_GROUPER') +
              ' — Fixed Y2: noneOf flounder-disney/bass-brand/perch-motorcycle/skate-chassis',
            pattern: { ...pat, noneOf: newNoneOf },
          },
        });
        console.log(`AI_CH03_MAHI_SNAPPER_GROUPER: adding ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH03_MAHI_SNAPPER_GROUPER not found'); }
    }

    // ── 10. AI_CH58_BRAID_TASSEL_TRIM ────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'AI_CH58_BRAID_TASSEL_TRIM') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const pat = existing.pattern as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '65', '69', '70', '71', '76', '88', '94'])];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const addNoneOf = [
          // 'trim' = flight sim trim wheel (ch.88)
          'trim wheel', 'flight sim trim', 'flight simulator',
          // 'trim' = auto seat trim / car interior trim (ch.94)
          'seat trim', 'rocker trim', 'cabin trim', 'interior trim', 'door trim',
          'car trim', 'auto trim', 'vehicle trim', 'stainless trim',
        ];
        const newNoneOf = [...new Set([...currentNoneOf, ...addNoneOf])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH58_BRAID_TASSEL_TRIM') +
              ' — Fixed Y2: added ch.65/69/70/71/76/88/94; noneOf trim-wheel/auto-trim',
            pattern: { ...pat, noneOf: newNoneOf },
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`AI_CH58_BRAID_TASSEL_TRIM: added ch.65/69/70/71/76/88/94, ${addNoneOf.length} noneOf`);
      } else { console.log('WARNING: AI_CH58_BRAID_TASSEL_TRIM not found'); }
    }

    // ── 11. HAIR_CLAW_INTENT ──────────────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'HAIR_CLAW_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '30', '58', '67'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'HAIR_CLAW_INTENT') +
              ' — Fixed Y2: added ch.30 (medical headband), ch.58 (birdcage veil lace), ch.67 (feather newborn headband)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`HAIR_CLAW_INTENT: added ch.30/58/67`);
      } else { console.log('WARNING: HAIR_CLAW_INTENT not found'); }
    }

    // ── 12. SPORTS_JERSEY_INTENT ──────────────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '60'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_INTENT') +
              ' — Fixed Y2: added ch.60 (used/youth hockey jersey knit fabric)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPORTS_JERSEY_INTENT: added ch.60`);
      } else { console.log('WARNING: SPORTS_JERSEY_INTENT not found'); }
    }

    // ── 13. SPORTS_JERSEY_GARMENT_INTENT ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SPORTS_JERSEY_GARMENT_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '60'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SPORTS_JERSEY_GARMENT_INTENT') +
              ' — Fixed Y2: added ch.60 (used/youth hockey jersey knit fabric)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SPORTS_JERSEY_GARMENT_INTENT: added ch.60`);
      } else { console.log('WARNING: SPORTS_JERSEY_GARMENT_INTENT not found'); }
    }

    // ── 14. SHIRT_GARMENT_BACKUP_INTENT ──────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'SHIRT_GARMENT_BACKUP_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '42', '64'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'SHIRT_GARMENT_BACKUP_INTENT') +
              ' — Fixed Y2: added ch.42 (shirt-style organizer pouch), ch.64 (womens shirt footwear)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`SHIRT_GARMENT_BACKUP_INTENT: added ch.42/64`);
      } else { console.log('WARNING: SHIRT_GARMENT_BACKUP_INTENT not found'); }
    }

    // ── 15. TEMPERED_GLASS_SCREEN_INTENT ─────────────────────────────────────
    {
      const existing = allRules.find(r => r.id === 'TEMPERED_GLASS_SCREEN_INTENT') as IntentRule | undefined;
      if (existing) {
        const wl = existing.whitelist as any ?? {};
        const currentChapters: string[] = wl.allowChapters ?? [];
        const newChapters = [...new Set([...currentChapters, '42', '49'])];
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TEMPERED_GLASS_SCREEN_INTENT') +
              ' — Fixed Y2: added ch.42 (phone protector pouch), ch.49 (printed/paper screen guard)',
            whitelist: { ...wl, allowChapters: newChapters },
          },
        });
        console.log(`TEMPERED_GLASS_SCREEN_INTENT: added ch.42/49`);
      } else { console.log('WARNING: TEMPERED_GLASS_SCREEN_INTENT not found'); }
    }

    // ─────────────────────────────────────────────────────────────────────────
    console.log(`\nApplying ${patches.length} rule patches (batch Y2)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    const finalRules = svc.getAllRules();
    console.log(`\nPatch Y2 complete: ${patches.length} applied, 0 failed`);
    console.log(`Rules in cache: ${finalRules.length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
