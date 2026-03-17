#!/usr/bin/env ts-node
/**
 * Patch H2 — 2026-03-14:
 *
 * Fixes from G2 (rule-caused EMPTY results and artificial flower blocking):
 * 1. AI_CH22_SPIRITS_WHISKEY noneOf: add 'glasses', 'glassware', 'drinkware', 'barware', 'stemware'
 *    "Whiskey Glasses" (exp 7013.28.60, ch.70) → AI_CH22_SPIRITS_WHISKEY fires via 'whiskey',
 *    noneOf has 'glass' (singular) but NOT 'glasses' (plural) → ch.70 blocked → EMPTY!
 *
 * 2. AI_CH13_VEGETABLE_EXTRACTS noneOf: add 'hip hop', 'streetwear', 'fashion'
 *    "Sheer Black Ankle Socks with Chain Hip Hop Fashion" (exp ch.64) →
 *    'hop' in anyOf fires AI_CH13_VEGETABLE_EXTRACTS → allowChapters=['13'] blocks ch.64 → EMPTY!
 *
 * 3. FRESH_FLOWER_INTENT allowChapters: add '67' (artificial flowers)
 *    "Blush Pink Rose Stem", "Vanilla Cream Rose Stem" (exp 6702.xx, ch.67) →
 *    FRESH_FLOWER_INTENT fires via 'rose' → allowChapters=['06'] blocks ch.67 → EMPTY!
 *    Fix: allow ch.67 (artificial flowers) alongside ch.06 (fresh cut flowers).
 *
 * 4. FRESH_FRUIT_INTENT allowChapters: add '67', '48'
 *    "Peach & Pink Paper Flower Nursery Wall Decor" (exp ch.67) →
 *    FRESH_FRUIT_INTENT fires via 'peach' → allowChapters=['08'] blocks ch.67 → EMPTY!
 *    Also 'peach' color is common in paper/textile/decor products (ch.48, ch.67).
 *
 * 5. NEW DRINKING_GLASS_TABLEWARE_INTENT (ch.70): push 7013.xx for glass tableware queries
 *    "Whiskey Glasses", "Wine Glasses", "Champagne Flutes" → 7013.xx
 *    Without rule, semantic returns various 7010 glass containers instead of 7013 glassware.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14h2.ts
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

    // ── 1. AI_CH22_SPIRITS_WHISKEY: add 'glasses' (plural) to noneOf ──────────
    // noneOf already has 'glass' (singular) but "Whiskey Glasses" tokenizes to {whiskey, glasses}
    // 'glasses' != 'glass' → noneOf doesn't match → rule fires → allowChapters=['22'] blocks ch.70
    {
      const existing = allRules.find(r => r.id === 'AI_CH22_SPIRITS_WHISKEY') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'glasses', 'glassware', 'drinkware', 'barware', 'stemware',
          'tumblers', 'flutes', 'snifter', 'snifters', 'chalice', 'chalices',
          'cups', 'mugs', 'stein', 'steins', 'tankard', 'tankards',
          'glass set', 'glasses set',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH22_SPIRITS_WHISKEY') +
              ' — Fixed H2: add glasses/glassware/drinkware to noneOf ("Whiskey Glasses" was blocked from ch.70)',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`AI_CH22_SPIRITS_WHISKEY: adding ${toAdd.length} noneOf terms (glasses/glassware/drinkware)`);
      } else {
        console.log('WARNING: AI_CH22_SPIRITS_WHISKEY not found');
      }
    }

    // ── 2. AI_CH13_VEGETABLE_EXTRACTS: add 'hip hop' etc. to noneOf ──────────
    // 'hop' in anyOf fires for "hip hop" fashion queries → allowChapters=['13'] blocks ch.61/62/64
    // Fix: add common fashion contexts to noneOf to prevent false positives
    {
      const existing = allRules.find(r => r.id === 'AI_CH13_VEGETABLE_EXTRACTS') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentNoneOf: string[] = pat.noneOf ?? [];
        const toAdd = [
          'hip hop', 'hip-hop', 'streetwear', 'sneaker', 'sneakers',
          'sock', 'socks', 'ankle socks', 'knee socks',
          'fashion', 'clothing', 'apparel', 'wear',
          'shirt', 'pants', 'shorts', 'dress', 'hoodie',
        ].filter(t => !currentNoneOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'AI_CH13_VEGETABLE_EXTRACTS') +
              ' — Fixed H2: add hip hop/fashion/socks to noneOf (\'hop\' was blocking ch.64 socks)',
            pattern: { ...pat, noneOf: [...currentNoneOf, ...toAdd] },
          },
        });
        console.log(`AI_CH13_VEGETABLE_EXTRACTS: adding ${toAdd.length} noneOf terms (hip hop/fashion/socks)`);
      } else {
        console.log('WARNING: AI_CH13_VEGETABLE_EXTRACTS not found');
      }
    }

    // ── 3. FRESH_FLOWER_INTENT allowChapters: add '67' ───────────────────────
    // "Blush Pink Rose Stem", "Vanilla Cream Rose Stem" (exp 6702.xx, ch.67 artificial flowers)
    // FRESH_FLOWER_INTENT fires via 'rose' → allowChapters=['06'] blocks ch.67 → EMPTY
    // Adding '67' allows artificial flower products (ch.67) to surface alongside fresh flowers (ch.06)
    {
      const existing = allRules.find(r => r.id === 'FRESH_FLOWER_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentAllow: string[] = (existing as any).whitelist?.allowChapters ?? [];
        if (!currentAllow.includes('67')) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'FRESH_FLOWER_INTENT') +
                ' — Fixed H2: add ch.67 to allowChapters (artificial flower/decor items use rose names)',
              whitelist: { ...(existing as any).whitelist, allowChapters: [...currentAllow, '67'] },
            },
          });
          console.log('FRESH_FLOWER_INTENT: added ch.67 to allowChapters');
        } else {
          console.log('FRESH_FLOWER_INTENT: ch.67 already in allowChapters');
        }
      } else {
        console.log('WARNING: FRESH_FLOWER_INTENT not found');
      }
    }

    // ── 4. FRESH_FRUIT_INTENT allowChapters: add '67', '48' ─────────────────
    // "Peach & Pink Paper Flower Nursery Wall Decor" (exp 6702.xx, ch.67) →
    // FRESH_FRUIT_INTENT fires via 'peach' → allowChapters=['08'] blocks ch.67 → EMPTY
    // 'peach' is frequently used as a color name in decorative products.
    // Also add '48' for paper/craft products with fruit color names.
    {
      const existing = allRules.find(r => r.id === 'FRESH_FRUIT_INTENT') as IntentRule | undefined;
      if (existing) {
        const currentAllow: string[] = (existing as any).whitelist?.allowChapters ?? [];
        const toAdd = ['67', '48'].filter(ch => !currentAllow.includes(ch));
        if (toAdd.length > 0) {
          patches.push({
            priority: (existing as any).priority ?? 500,
            rule: {
              ...existing,
              description: (existing.description ?? 'FRESH_FRUIT_INTENT') +
                ' — Fixed H2: add ch.67/48 to allowChapters (peach/rose color in decor/paper products)',
              whitelist: { ...(existing as any).whitelist, allowChapters: [...currentAllow, ...toAdd] },
            },
          });
          console.log(`FRESH_FRUIT_INTENT: added [${toAdd.join(',')}] to allowChapters`);
        } else {
          console.log('FRESH_FRUIT_INTENT: ch.67/48 already in allowChapters');
        }
      } else {
        console.log('WARNING: FRESH_FRUIT_INTENT not found');
      }
    }

    // ── 5. NEW DRINKING_GLASS_TABLEWARE_INTENT ────────────────────────────────
    // "Whiskey Glasses" → 7013.28.60 (crystal drinking glasses)
    // "Wine Glasses" → 7013.28.20 (crystal wine glasses)
    // "Shot Glasses", "Champagne Flutes" → 7013.xx
    // Without rule, semantic returns various 7010 containers rather than 7013 glassware.
    patches.push({
      priority: 574,
      rule: {
        id: 'DRINKING_GLASS_TABLEWARE_INTENT',
        description: 'Glass tableware — drinking glasses, wine glasses, champagne flutes → ch.70 (7013). ' +
          '"Whiskey glasses", "wine glasses", "champagne flutes" → 7013.28/7013.37. ' +
          'Without rule, semantic conflates with 7010 glass containers instead of 7013 glassware.',
        pattern: {
          anyOf: [
            'whiskey glasses', 'whisky glasses', 'bourbon glasses',
            'wine glasses', 'red wine glasses', 'white wine glasses',
            'champagne flutes', 'champagne glasses', 'prosecco glasses',
            'beer glasses', 'pint glasses', 'pilsner glasses',
            'shot glasses', 'shot glass set', 'shots glasses',
            'cocktail glasses', 'martini glasses', 'margarita glasses',
            'highball glasses', 'rocks glasses', 'old fashioned glasses',
            'drinking glasses', 'drinking glass set', 'glass tumblers',
            'glass drinkware', 'barware set', 'stemware set',
            'snifter glasses', 'brandy glasses', 'cognac glasses',
          ],
          noneOf: [
            'plastic glasses', 'acrylic glasses', 'metal glasses',
            'reading glasses', 'eyeglasses', 'sunglasses', 'safety glasses', 'goggles',
          ],
        },
        // No allowChapters — let semantic work freely, we just inject/boost ch.70
        inject: [
          { prefix: '7013.28', syntheticRank: 9 }, // Crystal drinking glasses (other)
          { prefix: '7013.37', syntheticRank: 8 }, // Other glassware for table
          { prefix: '7013.22', syntheticRank: 7 }, // Crystal stemware
          { prefix: '7013.33', syntheticRank: 6 }, // Other stemware
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '7013.28' },
          { delta: 0.5, prefixMatch: '7013.37' },
          { delta: 0.4, prefixMatch: '7013' },
          { delta: 0.3, chapterMatch: '70' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW ARTIFICIAL_FLOWER_DECOR_INTENT ────────────────────────────────
    // Artificial flowers, silk flowers, faux flowers for home decor → ch.67 (6702.xx)
    // "Blush Pink Rose Stem", "Dusty Rose Paper Flower", "Peach Paper Flower Wall Decor"
    // → 6702.90 (of other materials: silk, paper) or 6702.10 (of plastics)
    patches.push({
      priority: 573,
      rule: {
        id: 'ARTIFICIAL_FLOWER_DECOR_INTENT',
        description: 'Artificial flowers, silk flowers, and faux floral decor → ch.67 (6702). ' +
          '"Artificial rose stem", "silk flower bouquet", "faux peony", "paper flower decor" → 6702.90. ' +
          'Without rule: FRESH_FLOWER_INTENT blocks ch.67 via rose/lily in query.',
        pattern: {
          anyOf: [
            // Explicit artificial flower terms
            'artificial flower', 'artificial flowers', 'artificial rose', 'artificial roses',
            'artificial bouquet', 'artificial floral', 'artificial peony', 'artificial lily',
            'silk flower', 'silk flowers', 'silk rose', 'silk roses', 'silk bouquet',
            'faux flower', 'faux flowers', 'faux rose', 'faux floral',
            'fake flower', 'fake flowers', 'fake rose',
            'paper flower', 'paper flowers', 'paper rose', 'paper roses',
            'dried flower', 'dried flowers', 'preserved flower', 'preserved flowers',
            // Stem products (artificial rose stems etc.)
            'rose stem', 'flower stem', 'floral stem',
            // Wall decor with flower context
            'flower nursery', 'floral nursery', 'nursery wall decor',
            'flower wall decor', 'floral wall decor',
          ],
          noneOf: [
            // Real flower growing/fresh cut contexts
            'fresh flowers', 'fresh cut', 'live flowers', 'potted',
            'seeds', 'bulbs', 'garden', 'growing',
            // Non-flower items
            'wallpaper', 'fabric pattern', 'textile print',
          ],
        },
        whitelist: { allowChapters: ['67', '70', '48', '44'] },
        inject: [
          { prefix: '6702.90', syntheticRank: 9 },  // Artificial flowers of other materials
          { prefix: '6702.10', syntheticRank: 8 },  // Artificial flowers of plastics
          { prefix: '6702.90.35', syntheticRank: 7 }, // Of man-made fibers
          { prefix: '6702.90.65', syntheticRank: 6 }, // Other (of other materials)
        ],
        boosts: [
          { delta: 0.6, prefixMatch: '6702' },
          { delta: 0.4, chapterMatch: '67' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch H2)...`);
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
    console.log(`\nPatch H2 complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
