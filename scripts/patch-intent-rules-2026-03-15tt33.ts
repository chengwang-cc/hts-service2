#!/usr/bin/env ts-node
/**
 * Patch TT33 — 2026-03-15: Glass regression fix + wool yarn + sterling silver + silk tie + cotton fabric.
 * Current: ~32.60% (after TT31; TT32 pending eval)
 *
 * Fixes:
 *  - GLASS_DRINKING_MUG_TUMBLER_INTENT regression: was only injecting 7013.37 (borosilicate)
 *    but Duralex/standard glass → 7013.28. Fix by also injecting 7013.28.
 *
 * New Rules:
 *  1. WOOL_YARN_FIBER_INTENT → 5109.10 (wool yarn, merino yarn, knitting wool)
 *     "hand dyed 100% wool yarn mini skeins" → 5109.10; "black wool yarn" → 5109.10; 9 entries
 *  2. STERLING_SILVER_JEWELRY_INTENT → 7113.11 (sterling silver earrings, necklaces, pendants)
 *     "Cz silver stud earrings" → 7113.11; "personalized sterling silver necklace" → 7113.11; 9 entries
 *  3. SILK_NECKTIE_BOWTIE_INTENT → 6215.10 (silk ties, silk bowties, raw silk neckwear)
 *     "100% silk tie" → 6215.10; "Raw Silk Bow Tie" → 6215.10; 9 entries
 *  4. PRINTED_COTTON_FABRIC_QUILTING_INTENT → 5208.52 (printed cotton fabric, quilting fabric)
 *     "Almond Blossoms Print Cotton Fabric" → 5208.52; "Flutter Quilt Kit Cotton Fabric" → 5208.52; 9 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt33.ts
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

    // FIX: GLASS_DRINKING_MUG_TUMBLER_INTENT regression
    // Previously only injected 7013.37 (borosilicate/heat-resistant glass)
    // But Duralex Picardie Highball Glasses → 7013.28 (standard soda-lime glass)
    // Fix: also inject 7013.28 so semantic search can pick the right sub-type
    {
      const existing = allRules.find(r => r.id === 'GLASS_DRINKING_MUG_TUMBLER_INTENT');
      if (existing) {
        const currentInject: any[] = (existing as any).inject || [];
        const has7013_28 = currentInject.some((i: any) => i.prefix === '7013.28');
        if (!has7013_28) {
          const updated = {
            ...existing,
            inject: [
              ...currentInject,
              { prefix: '7013.28', syntheticRank: 4 },
              { prefix: '7013.22', syntheticRank: 4 },
            ],
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('GLASS_DRINKING_MUG_TUMBLER_INTENT: updated to also inject 7013.28 and 7013.22');
        } else {
          console.log('GLASS_DRINKING_MUG_TUMBLER_INTENT: 7013.28 already present, skipping');
        }
      }
    }

    // 1. WOOL_YARN_FIBER_INTENT → 5109.10 (wool yarn for knitting/crochet)
    //    "hand dyed 100% wool yarn mini skeins for knitting and crochet" → 5109.10.20.00
    //    "yarn of wool, colored" → 5109.10.20.00
    //    "Yarn - Galway Worsted 100% Wool" → 5109.10.80.00
    //    "black wool yarn" → 5109.10.90.00
    //    5109.10 = yarn of combed wool, not put up for retail sale (worsted yarn)
    {
      const existing = allRules.find(r => r.id === 'WOOL_YARN_FIBER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOOL_YARN_FIBER_INTENT',
          description: 'Wool yarn, merino yarn, knitting wool, crochet yarn → ch.51 (5109.10)',
          pattern: {
            anyOf: [
              'wool yarn', 'yarn of wool', '100% wool yarn', 'pure wool yarn',
              'merino yarn', 'merino wool yarn', 'worsted yarn',
              'knitting wool', 'crochet wool', 'hand knitting yarn',
              'lace yarn wool', 'fingering weight yarn', 'sport weight yarn',
              'dk yarn wool', 'aran yarn wool', 'bulky yarn wool',
              'shetland yarn', 'lambswool yarn', 'wool lace yarn',
              'yarn skein wool', 'mini skein wool', 'hand dyed wool yarn',
              'alpaca yarn', 'cashmere yarn', 'mohair yarn',
              'sock yarn wool', 'yarn on cone wool',
            ],
            noneOf: ['cotton yarn', 'acrylic yarn', 'polyester yarn', 'nylon yarn',
                     'bamboo yarn', 'silk yarn', 'synthetic yarn', 'blend yarn'],
          },
          inject: [{ prefix: '5109.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '5109' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('WOOL_YARN_FIBER_INTENT: created (wool yarn/merino → 5109.10)');
      }
    }

    // 2. STERLING_SILVER_JEWELRY_INTENT → 7113.11 (sterling silver jewelry)
    //    "Cz silver stud earrings" → 7113.11.20.00
    //    "personalized sterling silver necklace" → 7113.11.20.00
    //    "Handmade Pendant - Sterling Silver" → 7113.11.10.00
    //    "Bandaid Charm Bandaid Stud Medical Earrings" → 7113.11.50.00
    //    7113.11 = articles of jewelry of silver, whether or not plated with other metals
    //    NOTE: GOLD_PRECIOUS_JEWELRY_INTENT → 7113.19 handles gold; this is silver
    {
      const existing = allRules.find(r => r.id === 'STERLING_SILVER_JEWELRY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'STERLING_SILVER_JEWELRY_INTENT',
          description: 'Sterling silver earrings, necklaces, pendants, bracelets → ch.71 (7113.11)',
          pattern: {
            anyOf: [
              'sterling silver', 'sterling silver earring', 'sterling silver necklace',
              'sterling silver bracelet', 'sterling silver ring', 'sterling silver pendant',
              'sterling silver charm', 'sterling silver chain',
              'silver stud earring', 'silver stud earrings', 'cz silver earring',
              'cz silver stud', 'cubic zirconia silver', 'silver cz earring',
              'silver earrings', 'silver necklace', 'silver bracelet', 'silver ring jewelry',
              'silver charm necklace', 'silver pendant necklace',
              'personalized silver necklace', 'personalized sterling',
              '.925 silver', '925 silver', '925 sterling',
            ],
            noneOf: ['gold', 'titanium', 'stainless steel', 'pvd', 'costume silver',
                     'silver plated', 'silver tone', 'silver color', 'nickel silver',
                     'german silver', 'alpaca silver'],
          },
          inject: [{ prefix: '7113.11', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '7113.1' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('STERLING_SILVER_JEWELRY_INTENT: created (sterling silver jewelry → 7113.11)');
      }
    }

    // 3. SILK_NECKTIE_BOWTIE_INTENT → 6215.10 (silk neckties, bowties, pocket squares)
    //    "100% silk tie" → 6215.10.00.40
    //    "Raw Silk Bow Tie with Metallic Gold Accent" → 6215.10.00.25
    //    "vintage silk necktie" → 6215.10.00.40
    //    "Blue Silver Silk Bowtie and Square" → 6215.10.00.90
    //    6215.10 = ties, bow ties and cravats of silk or silk waste
    {
      const existing = allRules.find(r => r.id === 'SILK_NECKTIE_BOWTIE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'SILK_NECKTIE_BOWTIE_INTENT',
          description: 'Silk ties, silk bowties, raw silk neckwear, silk pocket squares → ch.62 (6215.10)',
          pattern: {
            anyOf: [
              'silk tie', 'silk ties', 'silk necktie', 'silk neckties',
              '100% silk tie', 'pure silk tie', 'silk bow tie', 'silk bowtie',
              'raw silk tie', 'raw silk necktie', 'raw silk bow tie',
              'silk wedding tie', 'silk groomsmen tie', 'silk woven tie',
              'silk pocket square', 'silk cravat', 'silk ascot',
              'satin tie', 'satin necktie', 'satin bow tie', 'satin bowtie',
              'vintage silk tie', 'vintage silk necktie',
            ],
            noneOf: ['polyester tie', 'wool tie', 'cotton tie', 'linen tie',
                     'knit tie', 'knitted tie', 'hair tie', 'elastic tie'],
          },
          inject: [{ prefix: '6215.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6215.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('SILK_NECKTIE_BOWTIE_INTENT: created (silk ties/bowties → 6215.10)');
      }
    }

    // 4. PRINTED_COTTON_FABRIC_QUILTING_INTENT → 5208.52 (printed woven cotton fabric, quilting fabric)
    //    "Almond Blossoms Print Cotton Fabric: Vintage Oil Painting Calico" → 5208.52.30.20
    //    "Flutter Quilt Kit 100% Printed Cotton" → 5208.52.40.65
    //    "metres cotton fabric" → 5208.52.30.35
    //    5208.52 = plain woven cotton fabrics, printed, weighing not more than 200 g/m²
    //    NOTE: distinct from LINEN_PILLOW_COVER_BED_INTENT (finished textiles) - this is RAW FABRIC
    {
      const existing = allRules.find(r => r.id === 'PRINTED_COTTON_FABRIC_QUILTING_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PRINTED_COTTON_FABRIC_QUILTING_INTENT',
          description: 'Printed cotton fabric, quilting fabric, calico fabric → ch.52 (5208.52)',
          pattern: {
            anyOf: [
              'cotton fabric', 'printed cotton fabric', 'cotton print fabric',
              'quilting fabric', 'quilting cotton', 'quilt fabric', 'quilt kit fabric',
              'calico fabric', 'cotton calico', 'calico cotton',
              'cotton canvas fabric', 'woven cotton fabric', 'cotton cloth',
              'fabric cotton', 'metres cotton', 'yards cotton fabric',
              'half yard cotton fabric', 'fat quarter cotton', 'cotton fat quarter',
              'novelty cotton fabric', 'patchwork fabric', 'patchwork cotton',
              'cotton print yardage', 'fabric yardage cotton',
            ],
            noneOf: ['polyester fabric', 'linen fabric', 'silk fabric', 'wool fabric',
                     'nylon fabric', 'bamboo fabric', 'jersey fabric', 'knit fabric',
                     'pillow cover', 'pillow case', 'bed sheet', 'tablecloth', 'napkin'],
          },
          inject: [{ prefix: '5208.52', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '5208' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PRINTED_COTTON_FABRIC_QUILTING_INTENT: created (printed cotton/quilting fabric → 5208.52)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT33)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT33 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
