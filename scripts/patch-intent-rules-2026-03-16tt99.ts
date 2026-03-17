#!/usr/bin/env ts-node
/**
 * Patch TT99 — 2026-03-16: Abrasive materials, fabric kits, metal tableware, sewing patterns.
 *
 * Fixes:
 *  1. NEW ABRASIVE_SANDING_MATERIAL_INTENT → 6805 (abrasive materials, ch.68), deny ch.84
 *     "Inside ring polisher/sander" → 8467.11 WRONG (expected 6805.30 abrasive backed)
 *     "Abrasive Materials Sanding and Polishing" → 8465.93 WRONG (expected 6805.20)
 *     "Sanding Sponges - Fine / Angled" → 8465.93 WRONG (expected 6805.30)
 *     ROOT CAUSE: Sanding/polishing materials classified as power tools (ch.84).
 *     6805.30 = abrasive powder/grain on backed material (cloth/paper/fiber)
 *     FIX: New intent → 6805.20/6805.30, denyChapters:['84','82']
 *
 *  2. NEW FABRIC_SAMPLE_KIT_INTENT → 5208 (cotton woven fabric, ch.52), deny ch.59
 *     "Jersey Fabric Letters Kit" → 5911.10 WRONG (expected 5208.59 cotton printed fabric)
 *     "Jersey Fabric Numbers kit" → 5911.10 WRONG (expected 5208.59)
 *     "kasha lining fabric" → 5911.10 WRONG (expected 5211.11 cotton denim-type fabric)
 *     "Fabric samples" → 5911.10 WRONG (expected 5211.49)
 *     ROOT CAUSE: 'fabric' without more context routes to technical textiles (5911 = filter cloth, ch.59).
 *     FIX: New intent → 5208.59/5211.11, denyChapters:['59']
 *
 *  3. NEW STAINLESS_STEEL_TABLEWARE_INTENT → 7323 (iron/steel household articles, ch.73), deny ch.69
 *     "100% stainless steel decorative plate" → 6912.00 WRONG (expected 7323.99 iron household articles)
 *     "MUG - 12oz" → 6912.00 WRONG (expected 7323.93 iron/steel household articles)
 *     "Kids cup" → 6911.10 WRONG (expected 7310.29 iron/steel containers)
 *     ROOT CAUSE: 'cup'/'mug'/'plate' strongly routes to ceramic tableware (ch.69) even for metal items.
 *     FIX: New intent → 7323.93/7310.29, denyChapters:['69']
 *
 *  4. NEW SEWING_PATTERN_INTENT → 6307.90 (other made-up textile articles, ch.63), deny ch.49
 *     "Sewing Pattern (Butterick 3255)" → 4906 WRONG (expected 6307.90 dress patterns)
 *     "Sewing Pattern (Simplicity 1715)" → 4906 WRONG (expected 6307.90)
 *     "Sewing Pattern (Simplicity 5993)" → 4906 WRONG (expected 6307.90)
 *     ROOT CAUSE: Sewing/dress patterns classified as printed plans/drawings (4906, ch.49).
 *                 HTS 6307.90 explicitly includes "dress patterns" as made-up textile articles.
 *     FIX: New intent → 6307.90, denyChapters:['49']
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt99.ts
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

    // 1. NEW ABRASIVE_SANDING_MATERIAL_INTENT → 6805 (abrasive backed materials, ch.68)
    //    "Inside ring polisher/sander" → 8467.11 (pneumatic tool), expected 6805.30 (abrasive backed)
    //    "Abrasive Materials Sanding and Polishing" → 8465.93 (woodworking machines), expected 6805.20
    //    "Sanding Sponges - Fine / Angled" → 8465.93, expected 6805.30
    //    Root cause: sanding/polishing terms route to power tools (ch.84).
    //    6805.20 = abrasive powder/grain on base of paper/paperboard
    //    6805.30 = abrasive powder/grain on base of other materials (cloth, sponge)
    {
      const existing = allRules.find(r => r.id === 'ABRASIVE_SANDING_MATERIAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ABRASIVE_SANDING_MATERIAL_INTENT',
          description: 'Sanding/abrasive materials, sponges, polishing sheets → 6805 (ch.68), deny ch.84',
          pattern: {
            anyOf: [
              // Sanding/polishing sponges and pads
              'sanding sponge', 'sanding sponges', 'abrasive sponge',
              'polishing sponge', 'finishing sponge',
              // Ring/jewelry polishing tools
              'inside ring polisher', 'ring polisher sander', 'ring sander',
              'inside ring sander',
              // Abrasive cloth/sheet materials
              'abrasive cloth', 'abrasive sheet', 'abrasive material',
              'abrasive paper sheet', 'abrasive backed',
              'sanding cloth', 'sanding sheet',
              // Polish/abrasive media
              'abrasive materials sanding', 'sanding polishing material',
            ],
            noneOf: [
              // Exclude power sanding tools
              'electric sander', 'orbital sander', 'belt sander',
              'drum sander', 'sanding machine',
            ],
          },
          inject: [
            { prefix: '6805.30', syntheticRank: 2 },  // abrasive on base of other materials (cloth/sponge)
            { prefix: '6805.20', syntheticRank: 4 },  // abrasive on base of paper/paperboard
            { prefix: '6805.10', syntheticRank: 6 },  // abrasive on base of woven textile
          ],
          whitelist: {
            allowChapters: ['68'],                     // stone/glass/cement products chapter
            denyChapters: ['84', '82'],                // deny machinery and hand tools
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6805.' },    // boost abrasive materials
            { delta: 0.50, chapterMatch: '68' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '84' },       // strong penalty for machinery
            { delta: 0.60, chapterMatch: '82' },       // penalty for hand tools
          ],
        } as IntentRule;
        patches.push({ priority: 546, rule: newRule });
        console.log('ABRASIVE_SANDING_MATERIAL_INTENT: created (sanding materials → 6805, deny ch.84)');
      } else {
        console.log('ABRASIVE_SANDING_MATERIAL_INTENT: already exists, skipping');
      }
    }

    // 2. NEW FABRIC_SAMPLE_KIT_INTENT → 5208/5211 (cotton woven fabric, ch.52)
    //    "Jersey Fabric Letters Kit" → 5911.10 (textile filter cloth!), expected 5208.59
    //    "kasha lining fabric" → 5911.10, expected 5211.11 (cotton denim-type)
    //    "Fabric samples" → 5911.10, expected 5211.49
    //    Root cause: generic 'fabric' + 'kit'/'sample' routes to technical textiles (ch.59 = 5911).
    //    5208 = woven fabrics of cotton (the main cotton fabric chapter)
    {
      const existing = allRules.find(r => r.id === 'FABRIC_SAMPLE_KIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FABRIC_SAMPLE_KIT_INTENT',
          description: 'Fabric samples, fabric kits, lining fabrics → 5208/5211 (cotton woven, ch.52), deny ch.59',
          pattern: {
            anyOf: [
              // Generic fabric samples
              'fabric sample', 'fabric samples', 'fabric swatch', 'fabric swatches',
              // Fabric kits with material names
              'fabric letters kit', 'fabric numbers kit', 'fabric kit',
              // Lining fabrics
              'lining fabric', 'lining fabrics', 'kasha lining fabric',
              'kasha lining', 'cotton lining fabric',
              // Jersey fabrics
              'jersey fabric', 'jersey cotton', 'jersey knit fabric',
              // Other specific cotton fabric types
              'cotton poplin fabric', 'shirting fabric', 'muslin fabric',
            ],
            noneOf: [
              // Exclude technical/industrial textiles
              'filter fabric', 'filter cloth', 'technical fabric',
              // Exclude specialty fabrics
              'velvet fabric', 'silk fabric', 'wool fabric',
            ],
          },
          inject: [
            { prefix: '5208.59', syntheticRank: 2 },  // other printed cotton fabric, under 200g
            { prefix: '5211.11', syntheticRank: 4 },  // plain weave, denim-type, unbleached
            { prefix: '5208.32', syntheticRank: 6 },  // plain weave cotton, bleached
            { prefix: '5211.49', syntheticRank: 8 },  // other printed cotton fabric
          ],
          whitelist: {
            allowChapters: ['52', '55', '60'],         // cotton, man-made fibers, knitted fabrics
            denyChapters: ['59'],                      // deny technical textiles
          },
          boosts: [
            { delta: 0.85, prefixMatch: '5208.' },    // boost cotton woven
            { delta: 0.75, prefixMatch: '5211.' },    // boost other cotton woven
            { delta: 0.50, chapterMatch: '52' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '59' },       // strong penalty for technical textiles
            { delta: 0.70, prefixMatch: '5911.' },    // strong penalty for filter cloth
          ],
        } as IntentRule;
        patches.push({ priority: 545, rule: newRule });
        console.log('FABRIC_SAMPLE_KIT_INTENT: created (fabric samples/kits → 5208, deny ch.59)');
      } else {
        console.log('FABRIC_SAMPLE_KIT_INTENT: already exists, skipping');
      }
    }

    // 3. NEW STAINLESS_STEEL_TABLEWARE_INTENT → 7323 (iron/steel household articles, ch.73)
    //    "100% stainless steel decorative plate" → 6912.00 WRONG (expected 7323.99)
    //    "MUG - 12oz" → 6912.00 WRONG (expected 7323.93 iron/steel household utensils)
    //    "Kids cup" → 6911.10 WRONG (expected 7310.29 iron/steel containers)
    //    Root cause: 'mug'/'cup'/'plate' strongly routes to ceramic/porcelain tableware (ch.69).
    //    7323.93 = iron/steel household utensils (mugs, cups, plates of metal)
    //    7310.29 = tanks, casks, cans of iron/steel (containers)
    {
      const existing = allRules.find(r => r.id === 'STAINLESS_STEEL_TABLEWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STAINLESS_STEEL_TABLEWARE_INTENT',
          description: 'Stainless steel mugs, cups, plates, metal tableware → 7323 (iron/steel, ch.73), deny ch.69',
          pattern: {
            anyOf: [
              // Stainless steel cups/mugs
              'stainless steel mug', 'stainless steel cup',
              'stainless mug', 'stainless cup',
              // Stainless steel plates/bowls
              'stainless steel plate', 'stainless steel bowl',
              'stainless steel dish', 'stainless steel tray',
              // Stainless steel decorative items
              'stainless steel decorative', 'stainless decorative plate',
              // Generic metal tableware
              'metal mug', 'metal cup', 'metal kids cup',
              'enamel mug', 'enamel cup', 'enamel plate',
              // Iron/steel specific
              'iron mug', 'steel mug',
            ],
            noneOf: [
              // Exclude ceramic
              'ceramic mug', 'porcelain mug', 'clay mug',
              // Exclude glass
              'glass mug', 'glass cup',
              // Exclude insulated/thermos types
              'insulated mug', 'travel mug', 'thermos mug',
            ],
          },
          inject: [
            { prefix: '7323.93', syntheticRank: 2 },  // table/kitchen/household articles of iron/steel
            { prefix: '7323.99', syntheticRank: 4 },  // other iron/steel household utensils
            { prefix: '7310.29', syntheticRank: 6 },  // other containers of iron/steel (under 50L)
          ],
          whitelist: {
            allowChapters: ['73', '74'],               // iron/steel or copper articles
            denyChapters: ['69', '70'],                // deny ceramic and glass
          },
          boosts: [
            { delta: 0.85, prefixMatch: '7323.' },    // boost iron/steel household articles
            { delta: 0.75, prefixMatch: '7310.' },    // boost iron/steel containers
            { delta: 0.50, chapterMatch: '73' },
          ],
          penalties: [
            { delta: 0.85, chapterMatch: '69' },       // very strong penalty for ceramics
            { delta: 0.70, chapterMatch: '70' },       // penalty for glass
          ],
        } as IntentRule;
        patches.push({ priority: 544, rule: newRule });
        console.log('STAINLESS_STEEL_TABLEWARE_INTENT: created (metal mugs/cups → 7323, deny ch.69)');
      } else {
        console.log('STAINLESS_STEEL_TABLEWARE_INTENT: already exists, skipping');
      }
    }

    // 4. NEW SEWING_PATTERN_INTENT → 6307.90 (other made-up textile articles, ch.63)
    //    "Sewing Pattern (Butterick 3255)" → 4906 (plans/drawings), expected 6307.90
    //    "Sewing Pattern (Simplicity 1715)" → 4906, expected 6307.90
    //    Root cause: Sewing/dress patterns classified as printed plans (ch.49). HTS 6307.90 explicitly
    //    includes dress patterns as "other made-up articles" of textile articles.
    {
      const existing = allRules.find(r => r.id === 'SEWING_PATTERN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SEWING_PATTERN_INTENT',
          description: 'Sewing patterns, dress patterns, garment patterns → 6307.90 (ch.63), deny ch.49',
          pattern: {
            anyOf: [
              // Sewing patterns (brand names)
              'sewing pattern', 'sewing patterns',
              'butterick pattern', 'simplicity pattern', 'mccall pattern',
              'vogue pattern', 'burda pattern', 'kwik sew pattern',
              'new look pattern', 'mccalls pattern',
              // Dress/garment patterns
              'dress pattern', 'dress patterns', 'garment pattern',
              'clothing pattern', 'knitting pattern booklet',
            ],
            noneOf: [
              // Exclude digital patterns
              'digital pattern', 'pdf pattern', 'printable pattern',
              // Exclude yarn/fiber patterns (those are books)
              'crochet pattern book', 'knitting pattern book',
            ],
          },
          inject: [
            { prefix: '6307.90', syntheticRank: 2 },  // other made-up articles (incl. dress patterns)
            { prefix: '6307.20', syntheticRank: 4 },  // life jackets and life belts (not applicable but fallback)
          ],
          whitelist: {
            allowChapters: ['63'],                     // made-up textile articles
            denyChapters: ['49', '48'],                // deny printed matter and paper
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6307.90' },  // boost dress patterns subheading
            { delta: 0.50, chapterMatch: '63' },
          ],
          penalties: [
            { delta: 0.80, chapterMatch: '49' },       // strong penalty for printed matter
            { delta: 0.70, chapterMatch: '48' },       // penalty for paper
          ],
        } as IntentRule;
        patches.push({ priority: 547, rule: newRule });
        console.log('SEWING_PATTERN_INTENT: created (sewing patterns → 6307.90, deny ch.49)');
      } else {
        console.log('SEWING_PATTERN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT99)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT99 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
