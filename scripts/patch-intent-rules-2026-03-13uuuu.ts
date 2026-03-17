#!/usr/bin/env ts-node
/**
 * Patch UUUU — 2026-03-13:
 *
 * Fix remaining EMPTY cases from 5025 entry eval after TTTT:
 *
 * 1. TSHIRT_INTENT: add inject for 6109 codes
 *    "bamboo t-shirt", "50% polyester 38% cotton 12% rayon t-shirt" → EMPTY
 *    TSHIRT_INTENT fires on 'tshirt' token but has no inject → score threshold causes EMPTY.
 *
 * 2. NEW WOOL_CASHMERE_SCARF_GARMENT_INTENT
 *    "cashmere scarf men used", "pashmina scarf", "wool scarf" → ch.62 (6214) or ch.61 (6117)
 *    No rule fires for scarf queries → semantic search finds no good match → EMPTY.
 *
 * 3. NEW PLASTIC_SHEET_ACRYLIC_INTENT
 *    "RAW ACRYLIC SHEETS PMMA", "acrylic panel", "plastic sheet" → 3920 (ch.39)
 *    Acrylic/PMMA/plastic sheets are in ch.39 (plates/sheets/film of plastics).
 *
 * 4. NEW CANVAS_TOTE_BAG_INTENT
 *    "Zippered Canvas Tote Bag", "canvas shopping tote" → 4202 (ch.42)
 *    Without chapter restriction, canvas tote bags return EMPTY or wrong chapter.
 *
 * 5. NEW GEMSTONE_CRYSTAL_MINERAL_INTENT
 *    "Raw Tigers Eye Rough Stone", "rock specimen" → 7103 (ch.71 precious/semi-precious stones)
 *    These are natural crystals/gemstones but no rule routes to ch.71.
 *    Semantic search returns ch.97 (antiques) or EMPTY.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13uuuu.ts
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

    // ── 1. TSHIRT_INTENT: add inject for 6109 codes ───────────────────────────
    // "bamboo t-shirt", "polyester cotton rayon t-shirt" → EMPTY
    // TSHIRT_INTENT fires on 'tshirt' but has no inject → semantic fails for complex queries.
    {
      const existing = allRules.find(r => r.id === 'TSHIRT_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: 6,
          rule: {
            ...existing,
            description: (existing.description ?? 'TSHIRT_INTENT') +
              ' — Fixed UUUU: added inject for 6109 codes to prevent EMPTY on complex queries.',
            inject: [
              { prefix: '6109.10.00', syntheticRank: 9 }, // Cotton knit t-shirts
              { prefix: '6109.90.10', syntheticRank: 8 }, // MMF knit t-shirts
              { prefix: '6109.90.90', syntheticRank: 7 }, // Other fiber t-shirts
            ],
          },
        });
        console.log('TSHIRT_INTENT: adding inject for 6109 codes');
      } else {
        console.log('WARNING: TSHIRT_INTENT not found');
      }
    }

    // ── 2. NEW WOOL_CASHMERE_SCARF_GARMENT_INTENT ─────────────────────────────
    // "cashmere scarf men used", "pashmina scarf", "wool scarf" → ch.62 (6214) or ch.61 (6117)
    // Scarves/shawls of fine animal hair → 6214 (woven) or 6117 (knit accessories)
    patches.push({
      priority: 572,
      rule: {
        id: 'WOOL_CASHMERE_SCARF_GARMENT_INTENT',
        description: 'Wool/cashmere/pashmina scarves and shawls → 6214/6117 (ch.62/61). ' +
          '"cashmere scarf", "pashmina scarf", "wool scarf", "merino wool scarf" → ch.62 (woven shawl). ' +
          'Without rule, semantic search returns EMPTY (no HTS entry matches "cashmere scarf" directly).',
        pattern: {
          anyOf: [
            'cashmere scarf', 'cashmere scarves', 'cashmere shawl',
            'pashmina scarf', 'pashmina shawl', 'pashmina wrap',
            'wool scarf', 'wool scarves', 'wool shawl',
            'merino scarf', 'merino scarves', 'merino wool scarf',
            'alpaca scarf', 'angora scarf',
            'knit scarf', 'crochet scarf', 'woven scarf',
            'infinity scarf', 'neck scarf',
            'shawl wrap', 'wrap shawl',
          ],
          noneOf: [
            'dog', 'cat', 'pet',
            'yoga mat', 'mat',
          ],
        },
        whitelist: { allowChapters: ['62', '61', '63'] },
        inject: [
          { prefix: '6214.20.00', syntheticRank: 9 }, // Shawls/scarves of wool or fine animal hair
          { prefix: '6214.30.00', syntheticRank: 8 }, // Shawls/scarves of synthetic fibers
          { prefix: '6117.10.00', syntheticRank: 7 }, // Knit shawls/scarves
          { prefix: '6214.10.10', syntheticRank: 6 }, // Shawls/scarves of silk
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '6214' },
          { delta: 0.3, prefixMatch: '6117' },
        ],
      } as IntentRule,
    });

    // ── 3. NEW PLASTIC_SHEET_ACRYLIC_INTENT ─────────────────────────────────
    // "RAW ACRYLIC SHEETS PMMA", "acrylic panel", "acrylic plastic sheet" → 3920 (ch.39)
    // 3920 = plates/sheets/film/foil/strip of plastics (non-cellular, not reinforced)
    patches.push({
      priority: 568,
      rule: {
        id: 'PLASTIC_SHEET_ACRYLIC_INTENT',
        description: 'Acrylic/PMMA and plastic sheets/panels → 3920 (ch.39). ' +
          '"Acrylic sheet", "PMMA sheet", "plastic panel", "plexiglass sheet" → 3920.51 ' +
          '(plates/sheets of acrylic polymers). ' +
          'These raw material queries return EMPTY without chapter restriction.',
        pattern: {
          anyOf: [
            'acrylic sheet', 'acrylic sheets', 'acrylic panel', 'acrylic panels',
            'pmma sheet', 'pmma', 'plexiglass sheet', 'plexiglass panel',
            'perspex sheet', 'perspex',
            'plastic sheet', 'plastic sheets', 'plastic panel', 'plastic panels',
            'polycarbonate sheet', 'polycarbonate panel',
            'abs sheet', 'hdpe sheet', 'pvc sheet', 'pvc panel',
            'foam board', 'foam sheet', 'eva foam sheet',
          ],
          noneOf: [
            'yoga mat', 'exercise mat', 'mattress',
            'wrap', 'film wrap', 'cling wrap',
            'bag', 'bags', 'packaging', 'bubble wrap',
          ],
        },
        whitelist: { allowChapters: ['39'] },
        inject: [
          { prefix: '3920.51.50', syntheticRank: 9 }, // Acrylic polymer sheets (PMMA)
          { prefix: '3920.10.00', syntheticRank: 8 }, // Polyethylene sheets
          { prefix: '3920.20.00', syntheticRank: 7 }, // Polypropylene sheets
          { prefix: '3920.61.00', syntheticRank: 6 }, // Polycarbonate sheets
          { prefix: '3920.71.00', syntheticRank: 5 }, // PVC sheets
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '3920' },
        ],
      } as IntentRule,
    });

    // ── 4. NEW CANVAS_TOTE_FABRIC_BAG_INTENT ────────────────────────────────
    // "Zippered Canvas Tote Bag", "canvas shopping tote", "canvas bag" → ch.42 (4202)
    // 4202 = trunks, cases, bags. Canvas tote bags → 4202.92 (bags of textile)
    patches.push({
      priority: 565,
      rule: {
        id: 'CANVAS_TOTE_FABRIC_BAG_INTENT',
        description: 'Canvas, cotton, and fabric tote bags → 4202 (ch.42). ' +
          '"Canvas tote bag", "zippered tote bag", "cotton shopping bag" → 4202.92. ' +
          'These fabric bags return EMPTY when no chapter restriction directs them to ch.42.',
        pattern: {
          anyOf: [
            'canvas tote', 'canvas tote bag', 'canvas bag',
            'tote bag', 'tote bags',
            'cotton tote', 'cotton bag', 'cotton shopping bag',
            'fabric tote', 'fabric bag',
            'jute bag', 'jute tote',
            'reusable bag', 'reusable shopping bag',
            'market bag', 'grocery bag', 'shopping tote',
            'zippered tote', 'zipper bag', 'zipper tote',
          ],
          noneOf: [
            // Exclude leather/faux leather bags (ch.42 different subcategory)
            'faux leather bag', 'leather bag', 'leather tote',
            // Exclude travel luggage
            'luggage', 'suitcase', 'duffel', 'duffle',
            // Exclude zip-lock bags (plastic)
            'ziploc', 'ziplock', 'freezer bag', 'sandwich bag',
            // Exclude plastic garbage bags
            'garbage bag', 'trash bag', 'bin bag',
          ],
        },
        whitelist: { allowChapters: ['42', '63'] },
        inject: [
          { prefix: '4202.92.15', syntheticRank: 9 }, // Bags with outer surface of textile
          { prefix: '4202.92.90', syntheticRank: 8 }, // Other bags of textile
          { prefix: '4202.99.90', syntheticRank: 7 }, // Other bags
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '4202' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW GEMSTONE_CRYSTAL_MINERAL_INTENT ───────────────────────────────
    // "Raw Tigers Eye Rough Stone", "rock specimen", "amethyst crystal" → 7103 (ch.71)
    // Natural precious/semi-precious stones → 7103.10 (unworked) or 7103.91 (worked)
    // Without rule, semantic search returns ch.97 (antiques) or EMPTY.
    patches.push({
      priority: 564,
      rule: {
        id: 'GEMSTONE_CRYSTAL_MINERAL_INTENT',
        description: 'Natural gemstones and crystals → 7103 (ch.71). ' +
          '"Tigers Eye rough stone", "amethyst crystal", "rock specimen", "raw gemstone" → 7103. ' +
          'Semi-precious stones unworked → 7103.10; worked/cut → 7103.91/99. ' +
          'Without rule, semantic search matches antiques (ch.97) or returns EMPTY.',
        pattern: {
          anyOf: [
            'tigers eye', 'tiger eye', 'amethyst', 'amethyst crystal',
            'rose quartz', 'quartz crystal', 'selenite', 'labradorite',
            'obsidian', 'black tourmaline', 'tourmaline',
            'citrine', 'carnelian', 'jasper', 'agate',
            'malachite', 'pyrite', 'lapis lazuli', 'moonstone',
            'raw crystal', 'rough crystal', 'raw gemstone', 'rough gemstone',
            'rough stone', 'raw stone', 'natural crystal',
            'crystal cluster', 'gemstone rough', 'mineral specimen',
            'rock specimen', 'crystal specimen',
          ],
          noneOf: [
            'lamp', 'chandelier', 'beads', 'bead',
            'jewelry', 'necklace', 'bracelet', 'ring', 'earring',
            'figurine', 'statue', 'carving',
          ],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7103.10.20', syntheticRank: 9 }, // Precious/semi-precious stones, unworked
          { prefix: '7103.10.40', syntheticRank: 8 }, // Other precious/semi-precious stones unworked
          { prefix: '7103.91.00', syntheticRank: 7 }, // Rubies, sapphires, emeralds (worked)
          { prefix: '7103.99.10', syntheticRank: 6 }, // Semi-precious stones (worked)
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '7103' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch UUUU)...`);
    let success = 0, failed = 0;

    for (const { rule, priority } of patches) {
      try {
        await (svc as any).upsertRule(rule, priority, true);
        console.log(`  ✅ ${(rule as any).id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${(rule as any).id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch UUUU complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
