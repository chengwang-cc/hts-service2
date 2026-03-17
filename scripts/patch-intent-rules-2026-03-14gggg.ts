#!/usr/bin/env ts-node
/**
 * Patch GGGG — 2026-03-14:
 *
 * Fix remaining EMPTY cases:
 *
 * 1. AI_CH92_WHISTLE_DECOY: Add vase/ceramic noneOf
 *    'deer' fires → allowChapters=['92'] blocks ch.69 for "Ceramic Deer Vase"
 *
 * 2. AI_CH47_RECOVERED_PAPER: Add fabric/rags noneOf
 *    'rags' fires → blocks ch.63 for "scrap fabric/rags"
 *
 * 3. AI_CH66_TELESCOPIC_UMBRELLA: Add basket/clothes noneOf
 *    'folding' fires → blocks ch.63 for "Folding Clothes Basket"
 *
 * 4. LAUNDRY_PODS_INTENT: Add dryer ball noneOf
 *    'dryer' fires → blocks ch.51 for "Dryer balls wool"
 *
 * 5. AI_CH13_VEGETABLE_EXTRACTS: Add herbal oil/ayurvedic noneOf
 *    'herbal' fires → blocks ch.33 for "Ayurvedic Herbal Oil"
 *
 * 6. AI_CH36_EXPLOSIVES: Add cosmetic/powder compact noneOf
 *    'powder' fires → blocks ch.33 for "cosmetic metal powder compact"
 *
 * 7. AI_CH66_TELESCOPIC_UMBRELLA: Add compact/cosmetic noneOf
 *    'compact' fires → blocks ch.33 for "cosmetic compact"
 *
 * 8. FRESH_FRUIT_INTENT: Add phone/case noneOf
 *    'apple' fires → blocks ch.42 for "Apple iPhone silicone case"
 *
 * 9. AI_CH91_DASHBOARD_CLOCK: Add plastic molding noneOf
 *    'dash'/'dashboard' fires → blocks ch.94 for "automotive dash plastic molding"
 *
 * 10. NEW LAPEL_PIN_BROOCH_INTENT: Lapel pin, brooch, enamel pin → ch.71 (7117)
 *     "Feather Lapel Pin", "enamel pin" → ch.71 without this
 *
 * 11. NEW PLUSH_STUFFED_TOY_INTENT: Plushies, stuffed animals → ch.95 (9503)
 *     "Luca Plushie", "Pokemon plush" → 9503 without this rule
 *
 * 12. NEW NURSERY_MOBILE_DECOR_INTENT: Nursery mobiles → ch.94 (9403)
 *     "Butterfly mobile nursery decor" → EMPTY
 *
 * 13. NEW DAKIMAKURA_PILLOW_COVER_INTENT: Japanese body pillow covers → ch.63 (6302)
 *     "Durge Dakimakura" → 6302 without this rule
 *
 * 14. addToAnyOf BED_SHEET_INTENT: Add dc comics, animated, character sheet terms
 *     "Vintage DC Comics Batman Twin Flat Sheet" → still EMPTY (BED_SHEET_INTENT fires
 *     but no inject for 6302 with character/licensed print context)
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14gggg.ts
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

    function addToAnyOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentAnyOf: string[] = pat.anyOf ?? [];
      const newTerms = toAdd.filter(t => !currentAnyOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed GGGG: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed GGGG: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH92_WHISTLE_DECOY: Add vase/ceramic noneOf ────────────────────
    // 'deer' fires for "Ceramic Deer Vase" → allowChapters=['92'] blocks ch.69
    addNoneOf('AI_CH92_WHISTLE_DECOY', [
      'vase', 'vases', 'figurine', 'figurines', 'ornament', 'ornaments',
      'ceramic', 'porcelain', 'pottery', 'clay',
      'plate', 'plates', 'mug', 'mugs', 'decorative', 'decor',
      'sculpture', 'statue', 'statuette',
    ], 'ceramic/decorative context prevents whistle/decoy rule from blocking ch.69');

    // ── 2. AI_CH47_RECOVERED_PAPER: Add fabric/rags noneOf ───────────────────
    // 'rags' fires → blocks ch.63 for "scrap fabric/rags"
    addNoneOf('AI_CH47_RECOVERED_PAPER', [
      'fabric', 'fabrics', 'cloth', 'textile', 'textiles',
      'rags', 'rag', 'scrap fabric', 'scrap cloth',
    ], 'fabric/textile context prevents recovered paper rule from blocking ch.63 rags');

    // ── 3. AI_CH66_TELESCOPIC_UMBRELLA: Add basket/clothes noneOf ─────────────
    // 'folding' fires → blocks ch.63 for "Folding Clothes Basket"
    addNoneOf('AI_CH66_TELESCOPIC_UMBRELLA', [
      'basket', 'baskets', 'clothes basket', 'laundry basket', 'storage basket',
      'wicker basket', 'clothes', 'laundry',
      'compact', 'cosmetic compact', 'powder compact', 'makeup',  // cosmetic compact
      'wallet', 'travel wallet', 'travel organizer',
    ], 'basket/clothes/compact context prevents umbrella rule from blocking ch.63/33');

    // ── 4. LAUNDRY_PODS_INTENT: Add dryer ball noneOf ────────────────────────
    // 'dryer' fires → blocks ch.51 for "Dryer balls wool"
    addNoneOf('LAUNDRY_PODS_INTENT', [
      'dryer ball', 'dryer balls', 'wool dryer ball', 'wool balls',
      'felted ball', 'felt ball',
    ], 'dryer ball context prevents laundry pod rule from blocking ch.51 wool balls');

    // ── 5. AI_CH13_VEGETABLE_EXTRACTS: Add herbal oil noneOf ─────────────────
    // 'herbal' or 'plant' fires → blocks ch.33 for "Ayurvedic Herbal Oil"
    addNoneOf('AI_CH13_VEGETABLE_EXTRACTS', [
      'ayurvedic', 'ayurveda',
      'herbal oil', 'massage oil', 'hair oil', 'body oil', 'essential oil',
      'external use', 'topical', 'for skin', 'for hair',
    ], 'herbal oil/ayurvedic context prevents vegetable extract rule from blocking ch.33');

    // ── 6. AI_CH36_EXPLOSIVES: Add cosmetic/compact noneOf ───────────────────
    // 'powder' fires → blocks ch.33 for "cosmetic metal powder compact"
    addNoneOf('AI_CH36_EXPLOSIVES', [
      'cosmetic', 'cosmetics', 'makeup', 'make up',
      'powder compact', 'compact powder', 'face powder', 'pressed powder',
      'bronzer', 'blush', 'eyeshadow', 'foundation', 'setting powder',
      'metallic powder', 'mica', 'pigment powder', 'craft powder',
    ], 'cosmetic/makeup powder context prevents explosives rule from blocking ch.33');

    // ── 7. FRESH_FRUIT_INTENT: Add phone/iphone/case noneOf ──────────────────
    // 'apple' fires → blocks ch.42 for "Apple iPhone silicone case MagSafe"
    addNoneOf('FRESH_FRUIT_INTENT', [
      'iphone', 'ipad', 'macbook', 'magsafe', 'airpods',
      'phone', 'phone case', 'device', 'case', 'cover',
      'silicone case', 'phone cover',
    ], 'Apple device/phone context prevents fresh fruit rule from blocking ch.42 cases');

    // ── 8. AI_CH91_DASHBOARD_CLOCK: Add plastic/molding noneOf ───────────────
    // 'dash'/'dashboard' fires → blocks ch.94 for "automotive dash plastic molding"
    addNoneOf('AI_CH91_DASHBOARD_CLOCK', [
      'plastic', 'plastic molding', 'plastic trim', 'molding', 'trim',
      'panel', 'interior panel', 'door panel', 'dash panel',
      'cover', 'bezel', 'fascia',
    ], 'plastic/molding context prevents dashboard clock rule from blocking ch.94 auto parts');

    // ── 9. NEW LAPEL_PIN_BROOCH_INTENT (ch.71) ────────────────────────────────
    // "Feather Lapel Pin", "enamel pin", "brooch" → 7117 (costume jewelry)
    patches.push({
      priority: 569,
      rule: {
        id: 'LAPEL_PIN_BROOCH_INTENT',
        description: 'Lapel pins, brooches, enamel pins → ch.71 (7117). ' +
          '"Lapel pin", "enamel pin", "brooch", "feather pin" → 7117 (imitation jewelry). ' +
          'Without rule, pin/brooch queries route to wrong chapter or EMPTY.',
        pattern: {
          anyOf: [
            'lapel pin', 'lapel pins', 'enamel pin', 'enamel pins',
            'brooch', 'brooches', 'hatpin', 'hat pin', 'hat pins',
            'collar pin', 'tie pin', 'tie clip', 'tie bar',
            'feather pin', 'flower pin', 'button pin', 'badge pin',
            'safety pin badge', 'decorative pin',
            'kilt pin', 'stick pin', 'stickpin',
          ],
          noneOf: [
            'sewing pin', 'straight pin', 'safety pin',  // functional pins
            'rolling pin', 'linchpin', 'axle pin',  // mechanical pins
          ],
        },
        whitelist: { allowChapters: ['71'] },
        inject: [
          { prefix: '7117.11', syntheticRank: 9 },  // Cuff-links, studs (base metal)
          { prefix: '7117.19', syntheticRank: 8 },  // Other imitation jewelry of base metal
          { prefix: '7117.90', syntheticRank: 7 },  // Other imitation jewelry
          { prefix: '7114.11', syntheticRank: 6 },  // Silverware/goldware
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '7117' },
          { delta: 0.3, chapterMatch: '71' },
        ],
      } as IntentRule,
    });

    // ── 10. NEW PLUSH_STUFFED_TOY_INTENT (ch.95) ─────────────────────────────
    // "Luca Plushie", "Pikachu plush", "stuffed animal" → 9503.00 (dolls/toys)
    patches.push({
      priority: 567,
      rule: {
        id: 'PLUSH_STUFFED_TOY_INTENT',
        description: 'Plush toys, stuffed animals → ch.95 (9503). ' +
          '"Plushie", "plush toy", "stuffed animal", "dakimakura" → 9503/6307. ' +
          'Without rule, plush/stuffed toy queries return EMPTY.',
        pattern: {
          anyOf: [
            'plushie', 'plushies', 'plush toy', 'plush toys', 'plush doll',
            'stuffed animal', 'stuffed animals', 'stuffed toy', 'stuffed toys',
            'plush', 'cuddly toy', 'soft toy',
            'pokemon plush', 'anime plush', 'character plush',
            'squishmallow', 'squishmallows',
          ],
          noneOf: ['pattern', 'pdf', 'sewing pattern', 'crochet pattern'],
        },
        whitelist: { allowChapters: ['95', '63'] },
        inject: [
          { prefix: '9503.00.00', syntheticRank: 9 },  // Tricycles, dolls, toys
          { prefix: '6307.90.89', syntheticRank: 8 },  // Other made-up textile articles
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9503' },
          { delta: 0.3, chapterMatch: '95' },
        ],
      } as IntentRule,
    });

    // ── 11. NEW DAKIMAKURA_PILLOW_COVER_INTENT (ch.63) ───────────────────────
    // "Durge Dakimakura", "anime body pillow cover" → 6302.21 (bed/bath linen)
    patches.push({
      priority: 553,
      rule: {
        id: 'DAKIMAKURA_PILLOW_COVER_INTENT',
        description: 'Body pillow covers, dakimakura → ch.63 (6302). ' +
          '"Dakimakura", "body pillow cover", "anime pillow case" → 6302.21. ' +
          'Without rule, dakimakura/body pillow queries return EMPTY.',
        pattern: {
          anyOf: [
            'dakimakura', 'daki', 'hugging pillow', 'body pillow cover',
            'body pillow case', 'anime pillow', 'manga pillow',
            'waifu pillow', 'character pillow case',
          ],
        },
        whitelist: { allowChapters: ['63'] },
        inject: [
          { prefix: '6302.21', syntheticRank: 9 },  // Bed linen of cotton
          { prefix: '6302.22', syntheticRank: 8 },  // Bed linen of other materials
          { prefix: '6302.91', syntheticRank: 7 },  // Other bed linen of cotton
          { prefix: '6307.90', syntheticRank: 6 },  // Other made-up textile articles
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6302' },
          { delta: 0.3, chapterMatch: '63' },
        ],
      } as IntentRule,
    });

    // ── 12. NEW NURSERY_MOBILE_DECOR_INTENT (ch.94) ──────────────────────────
    // "Butterfly mobile/bright and cheerful/Multicolour butterfly mobile" → 9403.91
    patches.push({
      priority: 554,
      rule: {
        id: 'NURSERY_MOBILE_DECOR_INTENT',
        description: 'Nursery mobiles, crib mobiles → ch.94 (9403.91). ' +
          '"Butterfly mobile", "baby mobile", "nursery mobile" → 9403.91 (parts for nursery). ' +
          'Without rule, nursery mobile queries return EMPTY.',
        pattern: {
          anyOf: [
            'nursery mobile', 'crib mobile', 'baby mobile', 'mobile nursery',
            'butterfly mobile', 'rainbow mobile', 'floral mobile',
            'hanging mobile', 'ceiling mobile',
          ],
          noneOf: ['phone', 'cellular', 'wifi', 'sim card'],  // not mobile phone!
        },
        whitelist: { allowChapters: ['94', '95'] },
        inject: [
          { prefix: '9403.91', syntheticRank: 9 },  // Parts of furniture (nursery)
          { prefix: '9403.70', syntheticRank: 8 },  // Furniture of plastics
          { prefix: '9503.00', syntheticRank: 7 },  // Toys (if considered a toy)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9403.91' },
          { delta: 0.3, chapterMatch: '94' },
        ],
      } as IntentRule,
    });

    // ── 13. addToAnyOf BED_SHEET_INTENT: licensed/character bedding ───────────
    // "Vintage DC Comics 1996 Batman Twin Flat Sheet" → BED_SHEET_INTENT fires (ch.63)
    // but result still EMPTY — the inject likely doesn't include 6302.22.20 polyester sheets
    addToAnyOf('BED_SHEET_INTENT', [
      'flat sheet', 'flat sheets', 'fitted sheet', 'fitted sheets',
      'twin sheet', 'queen sheet', 'king sheet', 'full sheet',
      'character sheet', 'licensed sheet', 'character bedding',
      'twin flat sheet', 'twin fitted sheet',
      'bed linen set', 'sheet set',
    ], 'flat sheet/twin sheet terms → ch.63 bed linen');

    console.log(`Applying ${patches.length} rule patches (batch GGGG)...`);
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
    console.log(`\nPatch GGGG complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
