#!/usr/bin/env ts-node
/**
 * Patch IIII — 2026-03-14:
 *
 * Fix remaining EMPTY cases by noneOf additions and new rules:
 *
 * 1. AI_CH89_FERRY_CARGO_VESSEL: Add pants/workwear noneOf
 *    'cargo' fires → blocks ch.62 for "Forcefield Flame-Resistant Cargo Work Pant"
 *
 * 2. ACCORDION_HARMONICA_INTENT: Add card/accordion-fold noneOf
 *    'accordion' fires → blocks ch.49 for "40 Weeks Baby Bump Accordion Card"
 *
 * 3. AI_CH03_MOLLUSCS: Add poster/art noneOf
 *    'snail' fires → blocks ch.49 for "Silver Snail Anniversary Newsprint Poster"
 *
 * 4. AI_CH36_METALDEHYDE/AI_CH36_SLUG_PELLET: Add poster/art noneOf
 *    'snail' fires metaldehyde rule → blocks ch.49
 *
 * 5. AI_CH03_SMOKED_DRIED_SALTED_FISH: Add stamp/craft/kit noneOf
 *    'salt' fires → blocks ch.82 for "Rubber Stamp Carving Kit - Salt & Paper"
 *
 * 6. AI_CH02_SALTED_CURED_MEAT: Add stamp/craft noneOf
 *    'salt' fires → blocks ch.82 for "Rubber Stamp Carving Kit"
 *
 * 7. AI_CH58_RIBBON_TRIM: Add cable/electronic noneOf
 *    'ribbon' fires → blocks ch.85 for "FPC Ribbon Cable Kit for Panasonic DVD Player"
 *
 * 8. FRESH_FRUIT_INTENT: Add cleanser/skincare noneOf
 *    'plum'/'peach' fires → blocks ch.33 for "Beauty of Joseon Green Plum Cleanser"
 *
 * 9. FRESH_VEGETABLE_INTENT: Add clay/jewelry noneOf
 *    'mushroom' fires → blocks ch.34 for "Mushroom Frog Clay Jewelry Dish"
 *
 * 10. AI_CH11_SEMOLINA_GROATS: Add polisher/abrasive noneOf
 *    'grit' or other token fires → blocks ch.82 for "Inside Ring Polisher/Sander"
 *
 * 11. AI_CH31_PHOSPHATIC_FERTILIZER: Add map/paper/poster noneOf
 *    Token fires → blocks ch.49 for "Printed Paper Map"
 *
 * 12. NEW BABY_CHILDREN_GARMENT_INTENT: Toddler/baby garments → ch.62 (6209)
 *    "DMC Toddler Bib", "doll outfit" → EMPTY
 *
 * 13. NEW SPORTS_JERSEY_INTENT: Sports jerseys → ch.62 (6211)
 *    "Signed Nike Swingman Jersey", "basketball jersey" → EMPTY
 *
 * 14. NEW PRINTED_MAP_INTENT: Paper maps → ch.49 (4905)
 *    "Printed paper map geographical features" → EMPTY (AI_CH31 was blocking)
 *
 * 15. NEW PERSONAL_CARE_DEVICE_INTENT: Dermaplane/facial tools → ch.82 (8214)
 *    "Finishing Touch Flawless Dermaplane Glo" → EMPTY
 *
 * 16. NEW AV_CONNECTOR_ADAPTER_INTENT: AV adapters/cables → ch.85 (8529)
 *    "RGB 34P to SCART adapter" → EMPTY
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14iiii.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed IIII: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH89_FERRY_CARGO_VESSEL: Add pants/workwear noneOf ─────────────
    // 'cargo' fires → blocks ch.62 for "Forcefield Flame-Resistant Cargo Work Pant"
    addNoneOf('AI_CH89_FERRY_CARGO_VESSEL', [
      'pants', 'pant', 'trousers', 'trouser', 'jeans',
      'cargo pants', 'cargo pant', 'cargo trousers', 'work pants', 'work pant',
      'work trousers', 'coverall', 'overalls', 'shorts', 'joggers',
      'maternity', 'flame resistant', 'hi vis', 'high visibility',
    ], 'workwear/pants context prevents cargo vessel rule from blocking ch.62 garments');

    // ── 2. ACCORDION_HARMONICA_INTENT: Add card/fold noneOf ──────────────────
    // 'accordion' fires → blocks ch.49 for "40 Weeks Baby Bump Accordion Card"
    addNoneOf('ACCORDION_HARMONICA_INTENT', [
      'card', 'cards', 'greeting card', 'accordion card', 'accordion fold',
      'accordion book', 'accordion album', 'accordion style', 'folded card',
      'baby shower', 'pregnancy card',
    ], 'card/fold context prevents accordion rule from blocking ch.49 greeting cards');

    // ── 3. AI_CH03_MOLLUSCS: Add poster/art noneOf ───────────────────────────
    // 'snail' fires → blocks ch.49 for "Silver Snail Anniversary Newsprint Poster"
    addNoneOf('AI_CH03_MOLLUSCS', [
      'poster', 'posters', 'print', 'prints', 'signed', 'anniversary',
      'newsprint', 'art print', 'limited edition', 'collectible print',
    ], 'poster/art context prevents mollusc rule from blocking ch.49 prints');

    // ── 4. AI_CH36_METALDEHYDE: Add poster/art noneOf ────────────────────────
    // Metaldehyde (snail bait) rule fires for 'snail' → blocks ch.49 for posters
    addNoneOf('AI_CH36_METALDEHYDE', [
      'poster', 'posters', 'print', 'prints', 'signed', 'anniversary',
      'newsprint', 'art', 'collectible',
    ], 'poster/art context prevents metaldehyde rule from blocking ch.49 posters');

    // ── 5. AI_CH03_SMOKED_DRIED_SALTED_FISH: Add stamp/craft noneOf ──────────
    // 'salt' fires → blocks ch.82 for "Rubber Stamp Carving Kit - Salt & Paper"
    addNoneOf('AI_CH03_SMOKED_DRIED_SALTED_FISH', [
      'stamp', 'stamps', 'rubber stamp', 'craft stamp', 'carving',
      'paper', 'card', 'kit', 'craft',
      'salt and pepper', 'salt lamp',  // not fish
    ], 'stamp/craft context prevents fish rule from blocking ch.82 carving tools');

    // ── 6. AI_CH02_SALTED_CURED_MEAT: Add stamp/craft noneOf ─────────────────
    // 'salt' fires → blocks ch.82 for "Rubber Stamp Carving Kit"
    addNoneOf('AI_CH02_SALTED_CURED_MEAT', [
      'stamp', 'stamps', 'rubber stamp', 'carving', 'kit',
      'paper', 'craft', 'art', 'tool', 'tools',
      'salt lamp', 'salt and pepper',  // not meat
    ], 'stamp/craft context prevents meat rule from blocking ch.82 carving tools');

    // ── 7. AI_CH58_RIBBON_TRIM: Add cable/electronic noneOf ──────────────────
    // 'ribbon' fires → blocks ch.85 for "FPC Ribbon Cable Kit for Panasonic DVD Player"
    addNoneOf('AI_CH58_RIBBON_TRIM', [
      'cable', 'cables', 'fpc', 'ffc', 'ribbon cable', 'flexible cable',
      'dvd', 'player', 'electronic', 'electronics', 'pcb', 'circuit',
      'connector', 'wire', 'harness',
    ], 'cable/electronic context prevents ribbon rule from blocking ch.85 electronic cables');

    // ── 8. FRESH_FRUIT_INTENT: Add cleanser/skincare noneOf ──────────────────
    // 'plum'/'peach'/'cherry' fires → blocks ch.33 for "Beauty of Joseon Cleanser"
    addNoneOf('FRESH_FRUIT_INTENT', [
      'cleanser', 'cleansing', 'cleansing gel', 'facial cleanser', 'face wash',
      'toner', 'serum', 'moisturizer', 'lotion', 'cream', 'essence',
      'skincare', 'skin care', 'beauty product', 'cosmetic',
      'refresh', 'refreshing',
    ], 'skincare/cleanser context prevents fresh fruit rule from blocking ch.33/34 cosmetics');

    // ── 9. FRESH_VEGETABLE_INTENT: Add clay/jewelry noneOf ───────────────────
    // 'mushroom' fires → blocks ch.34 for "Mushroom Frog Clay Jewelry Dish"
    addNoneOf('FRESH_VEGETABLE_INTENT', [
      'clay', 'polymer clay', 'air dry clay', 'resin',
      'jewelry dish', 'jewelry', 'ring dish', 'trinket dish',
      'handmade', 'hand made', 'art', 'craft',
      'figurine', 'sculpture', 'decor',
      'mushroom design', 'mushroom shaped', 'mushroom print',  // decorative use
    ], 'clay/jewelry/art context prevents vegetable rule from blocking ch.34 clay items');

    // ── 10. AI_CH11_SEMOLINA_GROATS: Add polisher/abrasive noneOf ────────────
    // Some token fires → blocks ch.82 for "Inside Ring Polisher/Sander Grit Set"
    addNoneOf('AI_CH11_SEMOLINA_GROATS', [
      'polisher', 'sander', 'sandpaper', 'abrasive', 'grit', 'grinder',
      'grinding wheel', 'burnisher', 'buffing',
      'ring polisher', 'finger polisher', 'rotary',
    ], 'abrasive/polisher context prevents semolina rule from blocking ch.82 polishing tools');

    // ── 11. AI_CH31_PHOSPHATIC_FERTILIZER: Add map/paper/poster noneOf ───────
    addNoneOf('AI_CH31_PHOSPHATIC_FERTILIZER', [
      'map', 'maps', 'printed map', 'paper map', 'geographic', 'geographical',
      'poster', 'posters', 'art print', 'print', 'chart',
      'card', 'cards', 'paper', 'printed',
    ], 'map/print/paper context prevents phosphate fertilizer rule from blocking ch.49');

    // ── 12. NEW BABY_CHILDREN_GARMENT_INTENT (ch.62) ─────────────────────────
    // "DMC Toddler Bib", "hand knitted wool outfit for a doll" → 6209 (children's garments)
    patches.push({
      priority: 556,
      rule: {
        id: 'BABY_CHILDREN_GARMENT_INTENT',
        description: 'Baby and children garments, bibs, doll clothes → ch.62 (6209). ' +
          '"Toddler bib", "baby bib", "doll outfit" → 6209. ' +
          'Without rule, baby/toddler garment queries return EMPTY.',
        pattern: {
          anyOf: [
            'toddler bib', 'baby bib', 'infant bib', 'bib', 'bibs',
            'baby bodysuit', 'baby onesie', 'onesie', 'infant bodysuit',
            'baby dress', 'toddler dress', 'baby jumpsuit', 'toddler jumpsuit',
            'baby outfit', 'infant outfit', 'doll outfit', 'doll clothes',
            'doll clothing', 'knitted doll outfit', 'doll dress',
            'baby romper', 'infant romper', 'toddler romper',
            'baby garment', 'infant garment', 'baby clothing',
            'toddler top', 'toddler shirt', 'toddler pants',
          ],
          noneOf: ['pattern', 'sewing pattern', 'crochet pattern', 'pdf'],
        },
        whitelist: { allowChapters: ['61', '62', '63'] },
        inject: [
          { prefix: '6209.20', syntheticRank: 9 },  // Children's garments of cotton
          { prefix: '6209.30', syntheticRank: 8 },  // Children's garments of MMF
          { prefix: '6209.90', syntheticRank: 7 },  // Children's garments of other fiber
          { prefix: '6111.20', syntheticRank: 6 },  // Knitted baby garments
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6209' },
          { delta: 0.3, chapterMatch: '62' },
        ],
      } as IntentRule,
    });

    // ── 13. NEW SPORTS_JERSEY_INTENT (ch.62) ─────────────────────────────────
    // "TYRESE MAXEY SIGNED 76ERS NIKE SWINGMAN JERSEY FANATICS COA" → 6211.32
    patches.push({
      priority: 555,
      rule: {
        id: 'SPORTS_JERSEY_INTENT',
        description: 'Sports jerseys, game uniforms → ch.62 (6211). ' +
          '"Signed NBA jersey", "swingman jersey", "football jersey" → 6211.32. ' +
          'Without rule, signed sports jersey queries return EMPTY.',
        pattern: {
          anyOf: [
            'swingman jersey', 'swingman', 'authentic jersey',
            'nba jersey', 'nfl jersey', 'nhl jersey', 'mlb jersey',
            'basketball jersey', 'football jersey', 'baseball jersey', 'hockey jersey',
            'soccer jersey', 'sport jersey', 'game jersey', 'game shirt',
            'replica jersey', 'signed jersey', 'autographed jersey',
            '76ers jersey', 'lakers jersey', 'bulls jersey', 'celtics jersey',
            'team uniform', 'sports uniform', 'athletic uniform',
          ],
        },
        whitelist: { allowChapters: ['62', '61'] },
        inject: [
          { prefix: '6211.32', syntheticRank: 9 },  // Men's/boys' woven sport garments
          { prefix: '6211.39', syntheticRank: 8 },  // Other sport/other garments woven
          { prefix: '6211.43', syntheticRank: 7 },  // Women's woven sport garments
          { prefix: '6109.10', syntheticRank: 6 },  // Knit t-shirts/jerseys
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '6211' },
          { delta: 0.3, chapterMatch: '62' },
        ],
      } as IntentRule,
    });

    // ── 14. NEW PRINTED_MAP_INTENT (ch.49) ────────────────────────────────────
    // "Printed paper map depicting geographical features, published 1800-1985" → 4905.20
    patches.push({
      priority: 559,
      rule: {
        id: 'PRINTED_MAP_INTENT',
        description: 'Printed paper maps, geographical charts → ch.49 (4905). ' +
          '"Printed paper map", "geographic map", "nautical chart" → 4905. ' +
          'Without rule, paper map queries return EMPTY due to fertilizer rule blocking.',
        pattern: {
          anyOf: [
            'printed map', 'printed paper map', 'paper map', 'paper maps',
            'geographic map', 'geographical map', 'topographic map',
            'road map', 'nautical chart', 'navigational chart',
            'antique map', 'vintage map', 'historical map',
            'wall map', 'folded map',
          ],
          noneOf: ['digital', 'interactive', 'app', 'website'],
        },
        whitelist: { allowChapters: ['49'] },
        inject: [
          { prefix: '4905.20', syntheticRank: 9 },  // Printed maps/charts, in book/pamphlet form
          { prefix: '4905.91', syntheticRank: 8 },  // Printed globes, maps (other)
          { prefix: '4911.99', syntheticRank: 7 },  // Other printed matter
          { prefix: '4901.99', syntheticRank: 6 },  // Other books, printed matter
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4905' },
          { delta: 0.3, chapterMatch: '49' },
        ],
      } as IntentRule,
    });

    // ── 15. NEW PERSONAL_CARE_DEVICE_INTENT (ch.82) ──────────────────────────
    // "Finishing Touch Flawless Dermaplane Glo Facial Exfoliator" → 8214.20
    patches.push({
      priority: 570,
      rule: {
        id: 'PERSONAL_CARE_DEVICE_INTENT',
        description: 'Personal care tools, dermaplaning, facial devices → ch.82 (8214). ' +
          '"Dermaplane", "facial exfoliator", "hair remover", "tweezers" → 8214. ' +
          'Without rule, grooming device queries return EMPTY.',
        pattern: {
          anyOf: [
            // Dermaplaning
            'dermaplane', 'dermaplaning', 'dermaplane glo', 'facial exfoliator',
            'face exfoliator', 'facial razor', 'face razor', 'dermablade',
            // Personal grooming tools
            'tweezers', 'eyebrow tweezers', 'nail file', 'cuticle tool',
            'pedicure tool', 'callus remover', 'corn remover',
            'ear pick', 'blackhead remover', 'pore cleaner',
            'facial hair remover', 'upper lip hair remover', 'threading device',
            'epilating device', 'epilator head',
          ],
          noneOf: ['electric', 'battery', 'powered'],  // powered = different chapter
        },
        whitelist: { allowChapters: ['82'] },
        inject: [
          { prefix: '8214.20', syntheticRank: 9 },  // Manicure/pedicure sets/instruments
          { prefix: '8214.90', syntheticRank: 8 },  // Other articles of cutlery (tweezers)
          { prefix: '8215.20', syntheticRank: 7 },  // Other spoons, ladles (personal care)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8214' },
          { delta: 0.3, chapterMatch: '82' },
        ],
      } as IntentRule,
    });

    // ── 16. NEW AV_CONNECTOR_ADAPTER_INTENT (ch.85) ──────────────────────────
    // "RGB 34P to SCART adapter (Sony Profeel, XBR, NEC)" → 8529.90.06
    // "FPC Ribbon Cable Kit for Panasonic DVD Player" → 8534 (flexible PCB)
    patches.push({
      priority: 573,
      rule: {
        id: 'AV_CONNECTOR_ADAPTER_INTENT',
        description: 'AV connectors, adapters, cable kits for video/audio devices → ch.85 (8529). ' +
          '"SCART adapter", "HDMI adapter", "AV connector" → 8529.90. ' +
          'Without rule, AV adapter queries return EMPTY.',
        pattern: {
          anyOf: [
            // AV Adapters
            'scart adapter', 'scart adaptor', 'scart cable', 'scart connector',
            'rgb adapter', 'rgb cable', 'component adapter',
            'hdmi adapter', 'hdmi splitter', 'hdmi switcher',
            'av adapter', 'av cable', 'composite adapter',
            'vga adapter', 'dvi adapter', 's-video adapter',
            // Flexible circuits/ribbon cables
            'fpc cable', 'ffc cable', 'ribbon cable', 'flat cable', 'flexible cable',
            'fpc ribbon', 'ffc ribbon',
            // Electronic adapters
            'usb adapter', 'usb splitter', 'usb hub',
            'rca adapter', 'rca cable',
          ],
          noneOf: ['shoelace', 'ribbon trim'],  // not textile ribbon
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8529.90', syntheticRank: 9 },  // Parts for TV reception apparatus
          { prefix: '8544.42', syntheticRank: 8 },  // Electric conductors, voltage ≤80V
          { prefix: '8534.00', syntheticRank: 7 },  // Printed circuits (for FPC)
          { prefix: '8536.90', syntheticRank: 6 },  // Other electrical apparatus
        ],
        boosts: [
          { delta: 0.4, chapterMatch: '85' },
          { delta: 0.5, prefixMatch: '8529' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch IIII)...`);
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
    console.log(`\nPatch IIII complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
