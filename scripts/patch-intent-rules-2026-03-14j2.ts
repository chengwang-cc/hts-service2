#!/usr/bin/env ts-node
/**
 * Patch J2 — 2026-03-14:
 *
 * Major blocking fixes from v1.jsonl rule-block diagnostic:
 *
 * 1. AI_CH92_DRUM_STAND_ACCESSORY: Remove broad terms 'holder','mount','stand','stands',
 *    'stool','hardware' from anyOf — these match card holders, toilet paper holders,
 *    phone stands, yoga mats, etc. → 69 entries blocked. Keep only drum-specific terms.
 *
 * 2. AI_CH36_FIREWORKS: Remove 'bottle' and 'roman' from anyOf — 'bottle' matches
 *    seasoning bottles, plastic bottles, beauty oil bottles → 31+ blocks.
 *    Use 'bottle rocket'/'roman candle' as phrases instead.
 *
 * 3. AI_CH65_DISPOSABLE_CAP: Remove 'cap','caps','hat','hats' from anyOf — too broad.
 *    'cap' matches bottle caps, baseball caps, hub caps. Keep only specific terms.
 *
 * 4. COFFEE_BEAN_INTENT + COFFEE_SINGLE_ORIGIN_INTENT: Add '21' to allowChapters.
 *    Coffee pods, capsules, instant coffee → 2101.xx (ch.21 food preparations).
 *    Currently only allows ch.09, blocking all ch.21 coffee-based products.
 *
 * 5. WINE_INTENT: Add 'gummies','gummy','candy','jelly' to noneOf.
 *    "Wine Gummies" → ch.21 but WINE_INTENT allows only [22] → BLOCKED.
 *
 * 6. AI_CH09_VANILLA: Add 'meal','meals','protein','nutrition','supplement' to noneOf.
 *    "Mild Vanilla (10 meals)" → ch.21 meal replacement → vanilla fires → ch.21 BLOCKED.
 *
 * 7. CHOCOLATE_FOOD_INTENT: Add 'meal','meals','protein','nutrition','supplement' to noneOf.
 *    "Rich Chocolate (10 meals)" → ch.21 → chocolate fires → ch.21 BLOCKED.
 *
 * 8. DAIRY_INTENT: Add personal-care/cosmetic cream terms to noneOf.
 *    "Deluxe Butt Cream" → ch.21 → 'cream' fires DAIRY_INTENT → ch.21 BLOCKED.
 *    Also add '33' to allowChapters (cosmetic creams belong to ch.33).
 *
 * 9. JEWELRY_RING_INTENT: Add 'ring spun','ring-spun','ring spinning' to noneOf.
 *    "Ring spun" yarn (ch.52) fires via 'ring' → ch.52 BLOCKED.
 *
 * 10. QUARTZ_CRYSTAL_CARVED_INTENT: Add 'natural','raw','rough','uncut' to noneOf.
 *     "natural crystal quartz" → ch.25 mineral, not ch.71 jewelry.
 *
 * 11. INCENSE_AROMATHERAPY_INTENT: Add '25','69','44' to allowChapters.
 *     Stone/ceramic/wood incense holders are ch.25/69/44, not only ch.33/34.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14j2.ts
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

    // ── 1. Fix AI_CH92_DRUM_STAND_ACCESSORY: remove broad single-word terms ──
    // 'holder','mount','stand','stands','stool','hardware' match way too many
    // non-drum products (card holders, toilet paper holders, phone stands, etc.)
    {
      const existing = allRules.find(r => r.id === 'AI_CH92_DRUM_STAND_ACCESSORY') as IntentRule | undefined;
      if (existing) {
        const toRemove = new Set(['holder', 'mount', 'stand', 'stands', 'stool', 'hardware']);
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = [
          ...currentAnyOf.filter((t: string) => !toRemove.has(t)),
          // Add safe drum-specific compound phrases
          'drum stand', 'drum holder', 'drum mount', 'drum rack',
          'snare stand', 'snare wire', 'drum hardware set',
        ].filter((t, i, arr) => arr.indexOf(t) === i); // dedupe
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH92_DRUM_STAND_ACCESSORY') +
              ' — Fixed J2: removed broad holder/mount/stand (fired for 69 non-drum entries); added drum-specific phrases',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH92_DRUM_STAND_ACCESSORY: removed ${toRemove.size} broad terms, added drum-specific phrases`);
      } else {
        console.log('WARNING: AI_CH92_DRUM_STAND_ACCESSORY not found');
      }
    }

    // ── 2. Fix AI_CH36_FIREWORKS: remove 'bottle','roman','fountains','mortars' ─
    // 'bottle' matches seasoning bottles, plastic bottles, beauty oil bottles
    // 'roman' may match Roman Empire products, Roman numerals, etc.
    // Use compound phrases 'bottle rocket'/'roman candle' instead
    {
      const existing = allRules.find(r => r.id === 'AI_CH36_FIREWORKS') as IntentRule | undefined;
      if (existing) {
        const toRemove = new Set(['bottle', 'roman', 'fountains', 'mortars']);
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const newAnyOf = [
          ...currentAnyOf.filter((t: string) => !toRemove.has(t)),
          'bottle rocket', 'bottle rockets', 'roman candle', 'roman candles',
          'smoke fountain', 'mortar shell',
        ].filter((t, i, arr) => arr.indexOf(t) === i);
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH36_FIREWORKS') +
              ' — Fixed J2: removed broad bottle/roman (matched non-fireworks bottles); use compound phrases',
            pattern: { ...pat, anyOf: newAnyOf },
          },
        });
        console.log(`AI_CH36_FIREWORKS: removed bottle/roman, added bottle rocket/roman candle phrases`);
      } else {
        console.log('WARNING: AI_CH36_FIREWORKS not found');
      }
    }

    // ── 3. Fix AI_CH65_DISPOSABLE_CAP: remove broad 'cap','caps','hat','hats' ──
    // These single words match baseball caps (ch.61), bottle caps (ch.83),
    // hubcaps (ch.87), cap sleeves (ch.61), etc. Keep only headwear-specific terms.
    {
      const existing = allRules.find(r => r.id === 'AI_CH65_DISPOSABLE_CAP') as IntentRule | undefined;
      if (existing) {
        const toRemove = new Set(['cap', 'caps', 'hat', 'hats']);
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const newAnyOf = [
          ...currentAnyOf.filter((t: string) => !toRemove.has(t)),
          // Add specific headwear/cap terms
          'shower cap', 'shower caps', 'bouffant cap', 'bouffant caps',
          'hair net', 'hair nets', 'hairnet', 'hairnets',
          'disposable cap', 'disposable hat', 'disposable caps',
          'surgical cap', 'surgical caps', 'chef cap', 'chef hat',
          'swim cap', 'swim caps', 'swimming cap', 'swimming caps',
          'bump cap', 'hard hat', 'safety cap',
          'mob cap', 'dust cap', 'bandana cap',
        ].filter((t, i, arr) => arr.indexOf(t) === i);
        // Add noneOf for obvious non-headwear contexts
        const toAddNoneOf = [
          'bottle cap', 'bottle caps', 'bottle top', 'hubcap', 'hub cap',
          'baseball cap', 'snapback', 'beanie', 'knit cap', 'wool hat',
          'trucker hat', 'fedora', 'baseball hat',
          'market cap', 'market caps', 'capitalization',
          'knee cap', 'kneecap', 'cap screw', 'cap sleeve',
          'tooth cap', 'dental cap',
        ].filter((t: string) => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH65_DISPOSABLE_CAP') +
              ' — Fixed J2: removed broad cap/hat (matched 28 non-cap entries); kept only specific headwear compounds',
            pattern: { ...pat, anyOf: newAnyOf, noneOf: [...currentNoneOf, ...toAddNoneOf] },
          },
        });
        console.log(`AI_CH65_DISPOSABLE_CAP: removed cap/hat/caps/hats, added specific compounds + noneOf exclusions`);
      } else {
        console.log('WARNING: AI_CH65_DISPOSABLE_CAP not found');
      }
    }

    // ── 4. Fix COFFEE_BEAN_INTENT: add '21' to allowChapters ─────────────────
    // Coffee pods, capsules, instant coffee → ch.21 (2101.xx food preparations)
    // COFFEE_BEAN_INTENT fires via 'coffee' → only ch.09 allowed → ch.21 BLOCKED
    {
      const existing = allRules.find(r => r.id === 'COFFEE_BEAN_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentAllow: string[] = (existing as any).whitelist?.allowChapters ?? [];
        if (!currentAllow.includes('21')) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'COFFEE_BEAN_INTENT') +
                ' — Fixed J2: add ch.21 to allowChapters (coffee pods/capsules/instant coffee = 2101.xx)',
              whitelist: { ...(existing as any).whitelist, allowChapters: [...currentAllow, '21'] },
            },
          });
          console.log('COFFEE_BEAN_INTENT: added ch.21 to allowChapters');
        }
      } else {
        console.log('WARNING: COFFEE_BEAN_INTENT not found');
      }
    }

    // ── 5. Fix COFFEE_SINGLE_ORIGIN_INTENT: add '21' to allowChapters ────────
    {
      const existing = allRules.find(r => r.id === 'COFFEE_SINGLE_ORIGIN_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentAllow: string[] = (existing as any).whitelist?.allowChapters ?? [];
        if (!currentAllow.includes('21')) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'COFFEE_SINGLE_ORIGIN_INTENT') +
                ' — Fixed J2: add ch.21 to allowChapters (coffee capsules/instant = 2101.xx)',
              whitelist: { ...(existing as any).whitelist, allowChapters: [...currentAllow, '21'] },
            },
          });
          console.log('COFFEE_SINGLE_ORIGIN_INTENT: added ch.21 to allowChapters');
        }
      } else {
        console.log('WARNING: COFFEE_SINGLE_ORIGIN_INTENT not found');
      }
    }

    // ── 6. Fix WINE_INTENT: add gummy/candy terms to noneOf ──────────────────
    // "Wine Gummies" → ch.21 food preparations, not ch.22 beverages
    {
      const existing = allRules.find(r => r.id === 'WINE_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = ['gummies', 'gummy', 'candy', 'candies', 'jelly', 'jellies',
          'confection', 'confectionery', 'sweets', 'treats', 'snack',
          'vinegar', 'wine vinegar', 'balsamic',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'WINE_INTENT') +
              ' — Fixed J2: add gummies/candy/vinegar to noneOf ("Wine Gummies" → ch.21 blocked)',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`WINE_INTENT: adding ${toAdd.length} noneOf terms (gummies/candy/vinegar)`);
      } else {
        console.log('WARNING: WINE_INTENT not found');
      }
    }

    // ── 7. Fix AI_CH09_VANILLA: add meal/nutrition terms to noneOf ────────────
    // "Mild Vanilla (10 meals)" → ch.21 → vanilla fires → ch.21 blocked
    {
      const existing = allRules.find(r => r.id === 'AI_CH09_VANILLA') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = ['meal', 'meals', 'protein', 'nutrition', 'supplement', 'shake',
          'smoothie', 'bar', 'cereal', 'yogurt', 'ice cream', 'flavor', 'flavour',
          'fragrance', 'candle', 'wax', 'lotion', 'cream', 'soap', 'shampoo',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH09_VANILLA') +
              ' — Fixed J2: add meal/protein/nutrition/cosmetic to noneOf (vanilla meal prep → ch.21)',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`AI_CH09_VANILLA: adding ${toAdd.length} noneOf terms`);
      } else {
        console.log('WARNING: AI_CH09_VANILLA not found');
      }
    }

    // ── 8. Fix CHOCOLATE_FOOD_INTENT: add meal/nutrition to noneOf ───────────
    // "Rich Chocolate (10 meals)" → ch.21 food prep → BLOCKED (allows [18])
    {
      const existing = allRules.find(r => r.id === 'CHOCOLATE_FOOD_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = ['meal', 'meals', 'protein', 'nutrition', 'supplement', 'shake',
          'bar set', 'advent', 'fondue', 'mold', 'molds', 'tempering',
          'flavor', 'flavour', 'fragrance', 'candle', 'soap', 'lotion',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'CHOCOLATE_FOOD_INTENT') +
              ' — Fixed J2: add meal/protein/cosmetic to noneOf (chocolate meal prep → ch.21)',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`CHOCOLATE_FOOD_INTENT: adding ${toAdd.length} noneOf terms`);
      } else {
        console.log('WARNING: CHOCOLATE_FOOD_INTENT not found');
      }
    }

    // ── 9. Fix DAIRY_INTENT: add personal care noneOf + ch.33 allowChapters ──
    // "Deluxe Butt Cream" → ch.21 body lotion context → DAIRY_INTENT fires via 'cream'
    // Also allow ch.33 (cosmetics) since dairy-named beauty products are ch.33
    {
      const existing = allRules.find(r => r.id === 'DAIRY_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const currentAllow: string[] = (existing as any).whitelist?.allowChapters ?? [];
        const toAddNoneOf = [
          'butt cream', 'body cream', 'face cream', 'hand cream', 'skin cream',
          'night cream', 'day cream', 'eye cream', 'foot cream',
          'shea butter cream', 'moisturizer', 'moisturizing cream',
          'body butter', 'body lotion', 'body balm',
          'whipped cream dispenser', 'ice cream maker', 'ice cream machine',
          'cream charger', 'whipped cream charger',
          'cream pie', 'cream puff', 'cream cheese cake',
        ].filter(t => !currentNoneOf.includes(t));
        const toAddAllow = ['33', '21'].filter(c => !currentAllow.includes(c));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'DAIRY_INTENT') +
              ' — Fixed J2: add personal care cream noneOf; add ch.33/21 to allowChapters',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAddNoneOf] },
            whitelist: { ...(existing as any).whitelist, allowChapters: [...currentAllow, ...toAddAllow] },
          } as IntentRule,
        });
        console.log(`DAIRY_INTENT: adding ${toAddNoneOf.length} noneOf terms, adding ch.33/21 to allowChapters`);
      } else {
        console.log('WARNING: DAIRY_INTENT not found');
      }
    }

    // ── 10. Fix JEWELRY_RING_INTENT: add 'ring spun' to noneOf ──────────────
    // "Ring spun Measuring less than 83.33 decitex" → ch.52 yarn → BLOCKED
    {
      const existing = allRules.find(r => r.id === 'JEWELRY_RING_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'ring spun', 'ring-spun', 'ring spinning', 'ring spun cotton',
          'ring spun yarn', 'open end', 'open-end', 'air jet',
          'binder ring', 'curtain ring', 'napkin ring', 'lanyard ring',
          'shower curtain ring', 'drapery ring', 'tree ring', 'growth ring',
          'boxing ring', 'ring toss', 'ring road',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'JEWELRY_RING_INTENT') +
              ' — Fixed J2: add ring spun/textile/non-jewelry ring contexts to noneOf',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`JEWELRY_RING_INTENT: adding ${toAdd.length} noneOf terms (ring spun yarn/non-jewelry)`);
      } else {
        console.log('WARNING: JEWELRY_RING_INTENT not found');
      }
    }

    // ── 11. Fix QUARTZ_CRYSTAL_CARVED_INTENT: add 'natural','raw','rough' noneOf
    // "natural crystal quartz" → ch.25 raw mineral, not ch.71 worked quartz
    // "natural raw crystal" → ch.25 → QUARTZ_CRYSTAL_CARVED_INTENT fires → blocked
    {
      const existing = allRules.find(r => r.id === 'QUARTZ_CRYSTAL_CARVED_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'natural', 'raw', 'rough', 'uncut', 'unpolished', 'natural crystal',
          'raw crystal', 'rough crystal', 'natural quartz', 'raw quartz',
          'mineral specimen', 'rock specimen',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'QUARTZ_CRYSTAL_CARVED_INTENT') +
              ' — Fixed J2: add natural/raw/rough to noneOf (raw quartz = ch.25, not ch.71)',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`QUARTZ_CRYSTAL_CARVED_INTENT: adding ${toAdd.length} noneOf terms (natural/raw/rough minerals)`);
      } else {
        console.log('WARNING: QUARTZ_CRYSTAL_CARVED_INTENT not found');
      }
    }

    // ── 12. Fix INCENSE_AROMATHERAPY_INTENT: add ch.25/69/44 to allowChapters ─
    // Stone/ceramic/wood incense holders and burners are ch.25/69/44
    // Currently only allows ch.33/34 (perfumery/soap) → stone holder BLOCKED
    {
      const existing = allRules.find(r => r.id === 'INCENSE_AROMATHERAPY_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentAllow: string[] = (existing as any).whitelist?.allowChapters ?? [];
        const toAdd = ['25', '44', '69', '70'].filter(c => !currentAllow.includes(c));
        if (toAdd.length > 0) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'INCENSE_AROMATHERAPY_INTENT') +
                ' — Fixed J2: add ch.25/44/69/70 to allowChapters (stone/wood/ceramic incense holders)',
              whitelist: { ...(existing as any).whitelist, allowChapters: [...currentAllow, ...toAdd] },
            },
          });
          console.log(`INCENSE_AROMATHERAPY_INTENT: adding [${toAdd.join(',')}] to allowChapters`);
        }
      } else {
        console.log('WARNING: INCENSE_AROMATHERAPY_INTENT not found');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch J2)...`);
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
    console.log(`\nPatch J2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
