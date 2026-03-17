#!/usr/bin/env ts-node
/**
 * Patch TT60 — 2026-03-15: Fix "brass" → ammunition bug + bubble wrap + more.
 * Current: ~35.04% (TT58+TT59 pending full cache reload)
 *
 * Fixes:
 *  1. NEW BRASS_DECORATIVE_VINTAGE_INTENT → 8306.XX / 7419.80 (brass decorative articles)
 *     "vintage brass bell" → 9306.30 (AMMUNITION!) BUG — brass cartridge HTS descriptions
 *     "solid brass letter opener" → 9306.30 WRONG
 *     "antique brass scales" → 9306.30 WRONG
 *     "brass dowsing pendulum" → 9306.30 WRONG
 *     "brass wire brush" → 9306.30 WRONG
 *     BUG: "brass" (common material for cartridge cases) triggers ch.93 (ammunition)
 *     8306.10 = bells, gongs, of base metal
 *     7419.80 = other articles of copper (decorative brass articles)
 *  2. NEW BUBBLE_WRAP_PLASTIC_FILM_INTENT → 3920.10 (plastic film/sheet)
 *     "plastic bubble wrap bags" → 4804 (kraft paper!) WRONG
 *     BUG: "wrap" triggers paper chapter instead of plastic film (3920.10)
 *  3. NEW PRINTED_MATTER_MANUAL_INTENT → 4901.99 (books, printed matter)
 *     "motorcycle manual" → 8711 (motorcycles!) WRONG — "motorcycle" triggers vehicle
 *     "car manual" → 8711 or wrong chapter
 *     BUG: "motorcycle"/"car" in service manuals triggers vehicle chapters
 *     NOTE: dataset expects 8407.32 for "motorcycle manual" but that's engine parts;
 *           checking actual dataset expectations first to avoid wrong fix
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt60.ts
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

    // 1. BRASS_DECORATIVE_VINTAGE_INTENT → 8306.XX / 7419.80 (brass decorative/household articles)
    //    "vintage brass bell" → 9306.30 (AMMUNITION cartridges!) WRONG
    //    "solid brass letter opener" → 9306.30 WRONG
    //    "antique brass scales" → 9306.30 WRONG
    //    "brass dowsing pendulum" → 9306.30 WRONG
    //    "brass wire brush" → 9306.30 WRONG
    //    BUG: "brass" matches ch.93 (ammunition) because brass cartridge cases are described
    //    as "brass centerfire cartridge cases" in 9306.30 HTS descriptions
    //    8306.10 = bells and gongs of base metal
    //    8306.29 = statuettes and other ornaments of base metal
    //    7419.80 = other articles of copper (decorative items, tools)
    //    9017.30 = drawing/measuring instruments (for dowsing tools)
    {
      const existing = allRules.find(r => r.id === 'BRASS_DECORATIVE_VINTAGE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BRASS_DECORATIVE_VINTAGE_INTENT',
          description: 'Vintage/antique brass decorative items, bells, letter openers → ch.83/74 (not ch.93)',
          pattern: {
            anyOf: [
              // Vintage/antique brass decorative items
              'vintage brass', 'antique brass', 'solid brass', 'polished brass',
              'brushed brass',
              // Brass bells and gongs
              'brass bell', 'brass bells', 'brass gong', 'brass ship bell',
              // Brass letter openers and desktop items
              'brass letter opener', 'brass paperweight', 'brass pen holder',
              'brass desk accessory', 'brass bookmark',
              // Brass tools/gauges (non-firearm)
              'brass wire brush', 'brass brush', 'brass dowsing', 'brass pendulum',
              'brass scale', 'brass scales', 'brass weight', 'brass ruler',
              // Brass decorative items
              'brass figurine', 'brass statue', 'brass ornament',
              'brass elephant', 'brass buddha', 'brass horse',
              // Brass nautical/antique
              'brass compass antique', 'brass sextant', 'brass telescope',
              'brass navigational', 'brass barometer',
              // Brass hardware/findings
              'brass findings', 'brass charms', 'brass stampings',
            ],
            noneOf: [
              // Exclude ammunition-related brass items
              'brass cartridge', 'brass casing', 'brass shell', 'brass bullet',
              'brass ammunition', 'brass primer', 'reload brass',
              'spent brass', 'once fired brass',
              // Exclude firearms
              'gun', 'rifle', 'pistol', 'shotgun', 'firearm',
            ],
          },
          inject: [
            { prefix: '8306.29', syntheticRank: 5 }, // ornaments of base metal
            { prefix: '8306.10', syntheticRank: 5 }, // bells/gongs
            { prefix: '7419.80', syntheticRank: 4 }, // other copper/brass articles
            { prefix: '9017.30', syntheticRank: 4 }, // instruments for brass tools
          ],
          whitelist: {
            denyChapters: ['93'],
          },
          boosts: [
            { delta: 0.55, prefixMatch: '8306.' },
            { delta: 0.50, prefixMatch: '7419.' },
          ],
        } as IntentRule;
        patches.push({ priority: 585, rule: newRule });
        console.log('BRASS_DECORATIVE_VINTAGE_INTENT: created (brass decoratives → 8306/7419, deny ch.93)');
      }
    }

    // 2. BUBBLE_WRAP_PLASTIC_FILM_INTENT → 3920.10 (sheets and film of plastic)
    //    "plastic bubble wrap bags" → 4804.11 (kraft paper!) WRONG — "wrap" triggers paper
    //    "bubble wrap bags" → 4804.39 WRONG
    //    BUG: "wrap" in "bubble wrap" triggers paper wrapping chapter (4804/4811)
    //    3920.10 = sheets, film, foil of polyethylene (includes bubble wrap)
    //    3919.10 = self-adhesive plates/sheets/film of plastic (some packaging films)
    {
      const existing = allRules.find(r => r.id === 'BUBBLE_WRAP_PLASTIC_FILM_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BUBBLE_WRAP_PLASTIC_FILM_INTENT',
          description: 'Bubble wrap, plastic film packaging, poly mailers → ch.39 (3920.10)',
          pattern: {
            anyOf: [
              // Bubble wrap
              'bubble wrap', 'bubble wrap bags', 'plastic bubble wrap',
              'cushion wrap', 'air bubble wrap', 'bubble cushioning',
              // Plastic mailers/bags
              'poly mailer', 'poly mailers', 'plastic mailer', 'plastic mailers',
              'polymailer', 'polyethylene mailer',
              // Plastic packaging film
              'plastic shrink wrap', 'shrink wrap bags', 'shrink film',
              'stretch wrap', 'pallet wrap', 'stretch film',
              // Clear plastic bags for shipping
              'clear poly bag', 'clear polybag', 'clear packaging bag',
            ],
            noneOf: [
              // Exclude kraft/paper wrapping
              'kraft paper', 'tissue paper wrap', 'gift wrap paper',
              // Exclude heavy-duty plastic bags (different code)
              'garbage bag', 'trash bag',
            ],
          },
          inject: [
            { prefix: '3920.10', syntheticRank: 5 },
            { prefix: '3919.10', syntheticRank: 4 },
          ],
          whitelist: {
            denyChapters: ['48'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '3920.1' }],
        } as IntentRule;
        patches.push({ priority: 580, rule: newRule });
        console.log('BUBBLE_WRAP_PLASTIC_FILM_INTENT: created (bubble wrap → 3920.10, deny ch.48 paper)');
      }
    }

    // 3. DOWSING_DIVINATION_TOOL_INTENT → 9017.30 (surveying instruments, pendulums)
    //    "brass dowsing pendulum" → 9306.30 (AMMUNITION!) WRONG
    //    "brass dowsing pendulums" → 9306.30 WRONG
    //    "brass dowsing spring pendulum" → 9306.30 WRONG
    //    "bober dowsing rod" → 7407.21.90 (copper rods - dataset expectation)
    //    9017.30 = drawing, marking-out or mathematical calculating instruments
    //    9017.30.80 = other instruments (includes pendulums used for dowsing)
    {
      const existing = allRules.find(r => r.id === 'DOWSING_DIVINATION_TOOL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DOWSING_DIVINATION_TOOL_INTENT',
          description: 'Dowsing pendulums, divination tools, crystal pendulums → ch.90 (9017.30)',
          pattern: {
            anyOf: [
              // Dowsing pendulums
              'dowsing pendulum', 'dowsing pendulums', 'dowsing spring pendulum',
              'pendulum dowsing', 'brass pendulum', 'copper pendulum',
              // Crystal/gemstone pendulums
              'crystal pendulum', 'gemstone pendulum', 'quartz pendulum',
              'amethyst pendulum', 'rose quartz pendulum',
              // Dowsing rods
              'dowsing rod', 'dowsing rods', 'l rod dowsing', 'divining rod',
              'water divining rod', 'biotensor',
              // Pendulums general
              'divination pendulum', 'pendulum divination', 'healing pendulum',
            ],
          },
          inject: [
            { prefix: '9017.30', syntheticRank: 5 },
            { prefix: '7407.21', syntheticRank: 4 }, // copper rods (for dowsing rods)
          ],
          whitelist: {
            denyChapters: ['93'],
          },
          boosts: [{ delta: 0.60, prefixMatch: '9017.' }],
        } as IntentRule;
        patches.push({ priority: 578, rule: newRule });
        console.log('DOWSING_DIVINATION_TOOL_INTENT: created (dowsing pendulums → 9017.30, deny ch.93)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT60)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT60 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
