#!/usr/bin/env ts-node
/**
 * Patch TT43 — 2026-03-15: Books/manuals + cast iron cookware + moka pot + pacifier clips.
 * Current: ~33.95% (after TT42)
 *
 * Updates:
 *  - BOOK_NOVEL_PAPERBACK_INTENT: add manga, comic book, encyclopedia, magazine, car/repair manuals
 *  - STAINLESS_STEEL_KITCHEN_INTENT: add moka pot, frying pan, yeti
 *
 * New Rules:
 *  1. CAST_IRON_COOKWARE_INTENT → 7323.92 + 7323.91 (Le Creuset, cast iron pots, dutch ovens)
 *     "Le Creuset Enameled Cast Iron Braiser" → 7323.92; "Cast iron pot" → 7323.92; 10+ miss entries
 *  2. BABY_PACIFIER_CLIP_INTENT → 3926.90.16 (pacifier clips, silicone teethers)
 *     "Silicone baby pacifier clip" → 3926.90.16; "Pacifier clip" → 3926.90.16; 3+ miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt43.ts
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

    // UPDATE BOOK_NOVEL_PAPERBACK_INTENT — add manga, comic book, encyclopedia, magazine, manuals
    // "BGS 9.2 One Piece #11 First Print Japanese Graded Manga" → 4901.99 (manga)
    // "comic book" → 4901.99 (comic book)
    // "Set Printed Lego Encyclopedia w/ figure" → 4901.99 (encyclopedia)
    // "Entertainment Weekly 313 (Feb 9, 1996)" → 4901.99 (vintage magazine)
    // "Printed magazine, 60 pages" → 4901.99
    // "Car Owners Manual" → 4901.99 (auto service manual)
    // "Haynes Automotive Manual Used" → 4901.99
    {
      const existing = allRules.find(r => r.id === 'BOOK_NOVEL_PAPERBACK_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasManga = currentAnyOf.some((t: string) => t.includes('manga'));
        if (!hasManga) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Japanese/graphic books
                'manga', 'comic book', 'graphic novel', 'graphic novel book',
                'japanese manga', 'first edition manga', 'graded manga',
                // Reference books
                'encyclopedia', 'encyclopaedia', 'almanac', 'dictionary',
                // Periodicals
                'magazine', 'vintage magazine', 'magazine issue', 'magazine usa',
                // Service/repair manuals
                'owners manual', "owner's manual", 'car manual', 'auto manual',
                'repair manual', 'service manual', 'workshop manual',
                'haynes', 'chilton manual', 'haynes manual',
                'user manual', 'instruction manual book',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 554, rule: updated });
          console.log('BOOK_NOVEL_PAPERBACK_INTENT: updated with manga/comic book/encyclopedia/magazine/manual patterns');
        } else {
          console.log('BOOK_NOVEL_PAPERBACK_INTENT: already has manga pattern');
        }
      }
    }

    // UPDATE STAINLESS_STEEL_KITCHEN_INTENT — add moka pot, frying pan, yeti
    // "90% Stainless Steel Moka Pot" → 7323.93.00.15 (stainless moka pot)
    // "Vintage Stella 4-Cup Stainless Steel Espresso Maker Moka Pot" → 7323.93.00.60
    // "2 Vintage Frying Pans" → 7323.93.00.35 (steel frying pan)
    // "Yeti Rambler 26oz Water Bottle" → 7323.93.00.45 (insulated steel drinkware)
    // "MUG - 12oz" → 7323.93.00.45 (steel mug)
    {
      const existing = allRules.find(r => r.id === 'STAINLESS_STEEL_KITCHEN_INTENT');
      if (existing) {
        const currentAnyOf: string[] = ((existing.pattern as any)?.anyOf || []);
        const hasMoka = currentAnyOf.some((t: string) => t.includes('moka'));
        if (!hasMoka) {
          const updated = {
            ...existing,
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...currentAnyOf,
                // Moka pots / espresso makers
                'moka pot', 'moka pots', 'stovetop espresso', 'espresso maker stainless',
                'stainless moka', 'stainless espresso maker', 'mocha pot',
                'percolator stainless', 'steel coffee maker',
                // Frying pans / skillets
                'frying pan', 'frying pans', 'vintage frying pan',
                'skillet stainless', 'stainless skillet', 'steel skillet',
                // Insulated drinkware brands
                'yeti', 'yeti rambler', 'yeti tumbler', 'yeti bottle',
                'stanley tumbler', 'stanley cup', 'klean kanteen',
                // Generic steel mugs
                'metal mug', 'camping mug metal', 'steel mug',
              ],
            },
          } as IntentRule;
          patches.push({ priority: 565, rule: updated });
          console.log('STAINLESS_STEEL_KITCHEN_INTENT: updated with moka pot/frying pan/yeti patterns');
        } else {
          console.log('STAINLESS_STEEL_KITCHEN_INTENT: already has moka pot pattern');
        }
      }
    }

    // 1. CAST_IRON_COOKWARE_INTENT → 7323.92 (enameled cast iron) + 7323.91 (non-enameled)
    //    "Le Creuset Enameled Cast Iron Signature Braiser, Provence" → 7323.92.00.20
    //    "Le Creuset Oval Trivet" → 7323.92.00.20
    //    "Cast iron cookware cleaning kit" → 7323.91.10.00
    //    "Cast iron pot" → 7323.92.00.40
    //    "vintage pot" → 7323.92.00.40 (vintage cast iron pot)
    //    7323.92 = table/kitchen/household articles of cast iron, enameled
    //    7323.91 = table/kitchen/household articles of cast iron, not enameled
    {
      const existing = allRules.find(r => r.id === 'CAST_IRON_COOKWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CAST_IRON_COOKWARE_INTENT',
          description: 'Cast iron cookware, Le Creuset, enameled cast iron pots → ch.73 (7323.92 + 7323.91)',
          pattern: {
            anyOf: [
              'cast iron', 'cast iron pot', 'cast iron pots', 'cast iron pan', 'cast iron skillet',
              'cast iron dutch oven', 'cast iron braiser', 'cast iron trivet',
              'enameled cast iron', 'enamel cast iron',
              'le creuset', 'le creuset pot', 'le creuset pan', 'le creuset braiser',
              'lodge cast iron', 'lodge skillet', 'lodge pan',
              'dutch oven cast iron', 'braiser cast iron',
              'cast iron wok', 'cast iron griddle', 'cast iron grill pan',
              'cast iron cookware', 'cast iron cooking', 'cast iron cleaning',
            ],
            noneOf: [
              'stainless steel', 'aluminum', 'non-stick', 'teflon',
              'copper', 'ceramic', 'clay pot', 'clay pan',
            ],
          },
          inject: [
            { prefix: '7323.92', syntheticRank: 5 },
            { prefix: '7323.91', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.55, prefixMatch: '7323.9' }],
        } as IntentRule;
        patches.push({ priority: 570, rule: newRule });
        console.log('CAST_IRON_COOKWARE_INTENT: created (cast iron / Le Creuset → 7323.92 + 7323.91)');
      }
    }

    // 2. BABY_PACIFIER_CLIP_INTENT → 3926.90.16 (plastic/silicone pacifier clips, soother holders)
    //    "Silicone baby pacifier clip" → 3926.90.16.00
    //    "Pacifier clip" → 3926.90.16.00
    //    "baby pacifier" → 3926.90.16.00
    //    3926.90.16 = plastic nipples and pacifiers (for babies)
    //    NOTE: 3926.90 = other articles of plastics; .16 specifically covers pacifier/nipple articles
    {
      const existing = allRules.find(r => r.id === 'BABY_PACIFIER_CLIP_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'BABY_PACIFIER_CLIP_INTENT',
          description: 'Pacifier clips, silicone pacifiers, baby soothers → ch.39 (3926.90.16)',
          pattern: {
            anyOf: [
              'pacifier clip', 'pacifier clips', 'silicone pacifier clip',
              'baby pacifier', 'infant pacifier', 'newborn pacifier',
              'soother clip', 'soother holder', 'dummy clip', 'dummy holder',
              'pacifier holder', 'pacifier chain', 'pacifier leash',
              'teether clip', 'silicone teether', 'baby teether silicone',
              'pacifier', 'silicone pacifier',
            ],
            noneOf: [
              'orthodontic', 'nipple shield', 'breast pump',
            ],
          },
          inject: [
            { prefix: '3926.90', syntheticRank: 5 },
          ],
          boosts: [{ delta: 0.50, prefixMatch: '3926.9' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('BABY_PACIFIER_CLIP_INTENT: created (pacifier clips → 3926.90.16)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT43)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT43 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
