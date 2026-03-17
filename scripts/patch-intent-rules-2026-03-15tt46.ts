#!/usr/bin/env ts-node
/**
 * Patch TT46 — 2026-03-15: Silk scarf + men's briefs + gold jewelry mug fix + book safe fix.
 * Current: ~34% (after TT43-TT45, eval pending)
 *
 * Fixes:
 *  - GOLD_PRECIOUS_JEWELRY_INTENT noneOf: add mug/cup/plate to exclude ceramic + gold
 *    "ABC mug: pink 22kt gold" → should be 6912.00 (ceramic) not 7113.19 (gold jewelry)
 *  - BOOK_NOVEL_PAPERBACK_INTENT noneOf: add 'book safe' to exclude book safes
 *    "Replacement Combination Book Safe" → should be 7326.90 (steel) not 4901.99 (book)
 *  - SILK_NECKTIE_BOWTIE_INTENT: add silk ribbon, silk scarf, silk handkerchief
 *    "Silk Hair Ribbon" → should be 6214.10 (silk scarf/ribbon) not 6117.80 (hair accessory)
 *
 * New Rules:
 *  1. MEN_UNDERWEAR_BRIEF_BOXERS_INTENT → 6207.11 (men's briefs, boxers, underpants)
 *     "Dark Red Ribbed Sport Brief" → 6207.11; "sport brief" → 6207.11; ~5 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt46.ts
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

    // FIX: GOLD_PRECIOUS_JEWELRY_INTENT — add mug/cup/plate/decor to noneOf
    // "ABC mug: pink 22kt gold" → 6912.00 (ceramic mug with gold decoration) not 7113.19 (gold jewelry)
    // "22kt gold" in query fires GOLD_PRECIOUS_JEWELRY_INTENT. Need to exclude mugs/cups.
    {
      const existing = allRules.find(r => r.id === 'GOLD_PRECIOUS_JEWELRY_INTENT');
      if (existing) {
        const currentNoneOf: string[] = ((existing.pattern as any)?.noneOf || []);
        const hasMug = currentNoneOf.some((t: string) => t.includes('mug') || t.includes('cup'));
        if (!hasMug) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              noneOf: [
                ...currentNoneOf,
                // Ceramic/pottery items with gold decoration should not be in gold jewelry
                'mug', 'cup', 'plate', 'bowl', 'dish', 'teacup',
                'vase', 'figurine', 'ornament', 'decor',
                'plated', 'gold plated', 'gold filled item',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 570, rule: updated });
          console.log('GOLD_PRECIOUS_JEWELRY_INTENT: fixed noneOf (added mug/cup/plate/decor exclusions)');
        } else {
          console.log('GOLD_PRECIOUS_JEWELRY_INTENT: already has mug in noneOf');
        }
      }
    }

    // FIX: BOOK_NOVEL_PAPERBACK_INTENT — add 'book safe' and 'safe' in book context to noneOf
    // "Replacement Combination Book Safe" → 7326.90 (steel/iron article) not 4901.99 (book)
    // "book safe" = hollow book used as a hiding safe = iron/steel article
    {
      const existing = allRules.find(r => r.id === 'BOOK_NOVEL_PAPERBACK_INTENT');
      if (existing) {
        const currentNoneOf: string[] = ((existing.pattern as any)?.noneOf || []);
        const hasBookSafe = currentNoneOf.some((t: string) => t.includes('book safe') || t.includes('safe'));
        if (!hasBookSafe) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              noneOf: [
                ...currentNoneOf,
                'book safe', 'safe book', 'combination safe', 'book end', 'bookend',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 554, rule: updated });
          console.log('BOOK_NOVEL_PAPERBACK_INTENT: added book safe/bookend to noneOf');
        } else {
          console.log('BOOK_NOVEL_PAPERBACK_INTENT: already has book safe in noneOf');
        }
      }
    }

    // UPDATE SILK_NECKTIE_BOWTIE_INTENT — add silk scarf, silk ribbon, silk handkerchief
    // "Silk Hair Ribbon" → 6214.10 (silk scarf/ribbon category, not hair accessory)
    // "vintage floral scarf" → 6214.10 (already getting 6214.10.10.00 - check sub-code)
    // 6214.10 = shawls, scarves, mufflers, of silk
    {
      const existing = allRules.find(r => r.id === 'SILK_NECKTIE_BOWTIE_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasSilkScarf = currentAnyOf.some((t: string) => t.includes('silk scarf') || t.includes('silk ribbon'));
        if (!hasSilkScarf) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Silk scarves and shawls (6214.10)
                'silk scarf', 'silk scarves', 'silk ribbon', 'silk hair ribbon',
                'silk shawl', 'silk wrap', 'silk muffler',
                'silk handkerchief', 'silk hanky', 'silk pocket square',
                'vintage silk scarf', 'vintage silk handkerchief',
                'pure silk scarf', '100% silk scarf',
              ],
              inject: [
                ...((existing as any).inject || []),
                { prefix: '6214.10', syntheticRank: 5 },
                { prefix: '6214.20', syntheticRank: 4 },
              ],
            },
            inject: [
              ...((existing as any).inject || []),
              { prefix: '6214.10', syntheticRank: 5 },
              { prefix: '6214.20', syntheticRank: 4 },
            ],
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('SILK_NECKTIE_BOWTIE_INTENT: updated with silk scarf/ribbon/shawl patterns');
        } else {
          console.log('SILK_NECKTIE_BOWTIE_INTENT: already has silk scarf pattern');
        }
      }
    }

    // 1. MEN_UNDERWEAR_BRIEF_BOXERS_INTENT → 6207.11 (men's underpants, briefs, boxer shorts)
    //    "Dark Red Ribbed Sport Brief - 3XL (38-40")" → 6207.11.00.10 (men's brief)
    //    "Avocado Green Pander Brief - Medium (30-32")" → 6207.11.00.10 (men's brief)
    //    6207.11 = men's underpants and briefs of cotton
    //    6207.19 = men's underpants and briefs of other textile materials
    {
      const existing = allRules.find(r => r.id === 'MEN_UNDERWEAR_BRIEF_BOXERS_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MEN_UNDERWEAR_BRIEF_BOXERS_INTENT',
          description: 'Men\'s briefs, boxer shorts, underpants → ch.62 (6207.11 + 6207.19)',
          pattern: {
            anyOf: [
              'sport brief', 'sports brief', 'sport briefs', 'ribbed sport brief',
              'men brief', 'men briefs', 'mens brief', 'mens briefs',
              'boxer brief', 'boxer briefs', 'mens boxer brief',
              'underpants mens', 'men underpants', 'men underwear bottom',
              'trunks underwear', 'swim brief',
              'pander brief', 'jockey brief', 'compression brief',
            ],
            noneOf: [
              'women', 'womens', 'ladies', 'girls', 'female',
              'bra', 'panty', 'thong',
            ],
          },
          inject: [
            { prefix: '6207.11', syntheticRank: 5 },
            { prefix: '6207.19', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '6207.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('MEN_UNDERWEAR_BRIEF_BOXERS_INTENT: created (men\'s briefs/boxers → 6207.11 + 6207.19)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT46)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT46 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
