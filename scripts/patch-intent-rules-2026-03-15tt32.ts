#!/usr/bin/env ts-node
/**
 * Patch TT32 — 2026-03-15: Toys + cotton skirts + toner cartridges + cutlery + comics/magazines.
 * Current: ~32.50% (after TT29; TT30/TT31 pending eval)
 *
 * Targets:
 *  1. PLASTIC_TOY_FIGURE_DOLL_INTENT → 9503.00 (toys: crochet toys, plastic figures, dolls, inflatables)
 *     "100% polyester crochet toy" → 9503.00; "toy plastic small tiger" → 9503.00; 14 entries
 *  2. COTTON_WOMEN_SKIRT_WOVEN_INTENT → 6204.52 (women's cotton woven skirts, denim skirts)
 *     "women cotton skirt" → 6204.52; "Vintage denim skirt" → 6204.52; 12 entries
 *  3. PRINTER_TONER_INK_CARTRIDGE_INTENT → 8443.99 (toner cartridges, ink cartridges, drum units)
 *     "Genuine Brother TN229M Magenta Toner Cartridge" → 8443.99; "HP 972X Ink Cartridge" → 8443.99; 12 entries
 *  4. FLATWARE_CUTLERY_SILVERWARE_INTENT → 8215.99 (flatware sets, cutlery, spoons, forks, kitchen tools)
 *     "Vintage cutlery set, 21 pc" → 8215.99; "stainless steel cutlery spoon set" → 8215.99; 13 entries
 *  5. COMIC_MAGAZINE_PERIODICAL_INTENT → 4902.90 (comic books, magazines, periodicals)
 *     "Barack the Barbarian #1 Comic" → 4902.90; "Threads Magazine" → 4902.90; 11 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt32.ts
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

    // 1. PLASTIC_TOY_FIGURE_DOLL_INTENT → 9503.00 (toys, dolls, figures, inflatables)
    //    "100% polyester crochet toy" → 9503.00.00.11
    //    "toy plastic small tiger" → 9503.00.00.13
    //    "Fisher Price Little People Toys" → 9503.00.00.71
    //    "1 pink stuffed animal toy tiger" → 9503.00.00.73
    //    "action figure" → 9503.00.00.73
    //    "inflatable beach ball" → 9503.00.00.11
    //    9503.00 = tricycles, scooters, dolls, other toys, puzzles, reduced-scale models
    //    NOTE: distinct from CHRISTMAS_HOLIDAY_ORNAMENT_INTENT (9505.10)
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_TOY_FIGURE_DOLL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_TOY_FIGURE_DOLL_INTENT',
          description: 'Plastic toys, crochet toys, dolls, action figures, toy animals → ch.95 (9503.00)',
          pattern: {
            anyOf: [
              'crochet toy', 'crochet animal toy', 'crocheted toy', 'amigurumi',
              'plastic toy', 'toy figure', 'toy plastic', 'toy animal',
              'action figure', 'collectible figure', 'figurine toy',
              'doll', 'dolls', 'fashion doll', 'baby doll', 'rag doll',
              'stuffed animal', 'stuffed toy', 'plush toy', 'plush animal',
              'toy tiger', 'stuffed tiger', 'stuffed bear', 'stuffed bunny',
              'inflatable toy', 'inflatable ball', 'beach ball inflatable',
              'toy set', 'playset', 'toy playset',
              'miniature figure', 'mini figure', 'collectible toy',
            ],
            noneOf: ['christmas ornament', 'holiday ornament', 'halloween decoration',
                     'game board', 'card game', 'puzzle', 'lego', 'building blocks toy'],
          },
          inject: [{ prefix: '9503.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9503' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PLASTIC_TOY_FIGURE_DOLL_INTENT: created (toys/figures/dolls → 9503.00)');
      }
    }

    // 2. COTTON_WOMEN_SKIRT_WOVEN_INTENT → 6204.52 (women's/girls' cotton woven skirts)
    //    "women cotton skirt" → 6204.52.xx
    //    "Vintage denim skirt" → 6204.52.xx
    //    "100% cotton skirt" → 6204.52.xx
    //    6204.52 = women's/girls' skirts and divided skirts of cotton (woven)
    //    NOTE: SYNTHETIC_KNIT_SKIRT_INTENT → 6204.53 handles bamboo/synthetic knit skirts
    {
      const existing = allRules.find(r => r.id === 'COTTON_WOMEN_SKIRT_WOVEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COTTON_WOMEN_SKIRT_WOVEN_INTENT',
          description: 'Women\'s cotton woven skirts, denim skirts, maxi skirts → ch.62 (6204.52)',
          pattern: {
            anyOf: [
              'cotton skirt', 'cotton skirts', 'women cotton skirt', 'womens cotton skirt',
              '100% cotton skirt', 'pure cotton skirt',
              'denim skirt', 'denim mini skirt', 'denim maxi skirt', 'denim midi skirt',
              'vintage denim skirt', 'vintage skirt denim',
              'maxi skirt cotton', 'cotton maxi skirt', 'cotton midi skirt',
              'cotton mini skirt', 'cotton a-line skirt', 'cotton wrap skirt',
              'cotton peasant skirt', 'cotton boho skirt', 'cotton tiered skirt',
              'cotton floral skirt', 'printed cotton skirt', 'embroidered cotton skirt',
            ],
            noneOf: ['polyester skirt', 'rayon skirt', 'viscose skirt', 'bamboo skirt',
                     'jersey skirt', 'knit skirt', 'tube skirt', 'stretch skirt',
                     'wool skirt', 'linen skirt', 'silk skirt'],
          },
          inject: [{ prefix: '6204.52', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6204.5' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COTTON_WOMEN_SKIRT_WOVEN_INTENT: created (women\'s cotton woven skirts → 6204.52)');
      }
    }

    // 3. PRINTER_TONER_INK_CARTRIDGE_INTENT → 8443.99 (toner cartridges, ink cartridges, drum units)
    //    "Genuine Brother TN229M Magenta Toner Cartridge" → 8443.99.20.10
    //    "GENUINE HP 148X W1480X Black Toner" → 8443.99.25.10
    //    "HP 972X Ink Cartridge" → 8443.99.50.11
    //    "Xerox 013R00603 Drum Cartridges" → 8443.99.50.11
    //    8443.99 = parts/accessories for printing machinery (includes cartridges)
    {
      const existing = allRules.find(r => r.id === 'PRINTER_TONER_INK_CARTRIDGE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PRINTER_TONER_INK_CARTRIDGE_INTENT',
          description: 'Printer toner cartridges, ink cartridges, drum units → ch.84 (8443.99)',
          pattern: {
            anyOf: [
              'toner cartridge', 'toner cartridges', 'printer toner', 'laser toner',
              'ink cartridge', 'ink cartridges', 'printer ink', 'inkjet cartridge',
              'drum cartridge', 'drum unit', 'imaging drum', 'drum kit printer',
              'toner reset chip', 'toner chip', 'printer drum',
              'hp toner', 'brother toner', 'canon toner', 'xerox toner', 'epson toner',
              'hp ink', 'epson ink', 'canon ink', 'brother ink',
              'compatible toner', 'genuine toner', 'oem toner',
              'high yield toner', 'high capacity toner',
            ],
            noneOf: ['pen', 'marker', 'highlighter', 'whiteboard marker'],
          },
          inject: [{ prefix: '8443.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '8443.9' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('PRINTER_TONER_INK_CARTRIDGE_INTENT: created (toner/ink cartridges → 8443.99)');
      }
    }

    // 4. FLATWARE_CUTLERY_SILVERWARE_INTENT → 8215.99 (flatware sets, spoons, forks, cutlery)
    //    "Vintage cutlery set, 21 pc" → 8215.99.45.00
    //    "stainless steel cutlery spoon set, 18/10 stainless steel" → 8215.99.35.00
    //    "oyster fork set" → 8215.99.15.00
    //    "Set of 6 tea spoons" → 8215.99.30.00
    //    "VINTAGE MONKEY BAR TOOL SET" → 8215.99.35.00
    //    8215.99 = other spoons, forks, ladles, skimmers, kitchen/tableware articles
    //    NOTE: separate from 7323.93 (stainless kitchen containers/pots)
    {
      const existing = allRules.find(r => r.id === 'FLATWARE_CUTLERY_SILVERWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'FLATWARE_CUTLERY_SILVERWARE_INTENT',
          description: 'Flatware sets, cutlery, spoons, forks, silverware sets → ch.82 (8215.99)',
          pattern: {
            anyOf: [
              'flatware', 'flatware set', 'cutlery', 'cutlery set', 'silverware',
              'silverware set', 'tableware cutlery',
              'spoon set', 'teaspoon set', 'dessert spoon', 'serving spoon',
              'fork set', 'dinner fork', 'salad fork', 'oyster fork',
              'knife set cutlery', 'butter knife set', 'steak knife set',
              'bar tool set', 'cocktail set', 'barware set',
              'serving tongs', 'kitchen tongs steel', 'ladle set',
              'vintage cutlery', 'vintage flatware', 'vintage silverware',
              'cutlery set pieces', 'piece cutlery set', 'pc cutlery',
            ],
            noneOf: ['plastic cutlery', 'plastic fork', 'plastic spoon', 'disposable cutlery',
                     'wooden spoon', 'wooden spatula', 'silicone spatula',
                     'kitchen knife', 'chef knife', 'bread knife', 'paring knife'],
          },
          inject: [{ prefix: '8215.99', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '8215.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('FLATWARE_CUTLERY_SILVERWARE_INTENT: created (flatware/cutlery/silverware → 8215.99)');
      }
    }

    // 5. COMIC_MAGAZINE_PERIODICAL_INTENT → 4902.90 (comic books, magazines, periodicals)
    //    "Barack the Barbarian #1 Comic" → 4902.90.10.00
    //    "Betty Page set 3 comic books" → 4902.90.10.00
    //    "Lexus Magazine" → 4902.90.20.20
    //    "Threads Magazine" → 4902.90.20.60
    //    4902.90 = other newspapers, journals, periodicals (includes comics, magazines)
    //    NOTE: BOOK_NOVEL_PAPERBACK_INTENT → 4901.99 handles novels/non-fiction books
    {
      const existing = allRules.find(r => r.id === 'COMIC_MAGAZINE_PERIODICAL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COMIC_MAGAZINE_PERIODICAL_INTENT',
          description: 'Comic books, magazines, periodicals, zines → ch.49 (4902.90)',
          pattern: {
            anyOf: [
              'comic book', 'comic books', 'comic', 'comics',
              'graphic novel', 'superhero comic', 'manga comic',
              'magazine', 'magazines', 'printed magazine', 'monthly magazine',
              'quarterly magazine', 'quarterly journal', 'periodical',
              'single issue', 'issues of', 'magazine issue',
              'zine', 'fanzine', 'art zine', 'music zine',
              'trade publication', 'hobby magazine', 'sewing magazine',
              'hard cover comic', 'softcover comic',
            ],
            noneOf: ['novel', 'textbook', 'cookbook', 'coloring book',
                     'art book', 'photo book', 'yearbook', 'notebook', 'journal blank'],
          },
          inject: [{ prefix: '4902.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4902.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COMIC_MAGAZINE_PERIODICAL_INTENT: created (comics/magazines → 4902.90)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT32)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT32 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
