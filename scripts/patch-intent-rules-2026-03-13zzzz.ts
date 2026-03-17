#!/usr/bin/env ts-node
/**
 * Patch ZZZZ — 2026-03-13:
 *
 * Fix remaining EMPTY cases across ch.85/84/69/42/39/82/44/68:
 *
 * 1. ch.85: expand LOUDSPEAKER_AUDIO_ACCESSORY_INTENT
 *    "plantronics starset h31 headset" → headset standalone not in anyOf
 *
 * 2. ch.84: NEW FAN_VENTILATION_COOLING_INTENT
 *    "IRIS USA WOOZOO Air Circulator Fan", "Nortel airmover", "Automotive Dash Vent" → 8414
 *
 * 3. ch.69: expand BONE_CHINA_CERAMIC_DISHWARE_INTENT
 *    "porcelain tea cup", "Creamer and Sugar bowl", "Ceramic Deer Vase", "cookie jar" → 6911/6912/6913
 *
 * 4. ch.42: NEW LEATHER_FOLIO_CROSSBODY_BAG_INTENT
 *    "Bellroy Travel Folio", "Ribbed A6 Leather Cash Stuffing Binder", "faux leather shoulder bag" → 4202
 *
 * 5. ch.39: NEW RESIN_EPOXY_LIQUID_POLYMER_INTENT
 *    "Fusion Mineral Paint Pouring Resin", "UV Resin", "epoxy resin kit" → 3906/3907
 *
 * 6. ch.82: NEW RAZOR_BLADE_CUTTING_TOOL_INTENT
 *    "Gillette Venus razor blades", "carbide inserts", "blade refill" → 8212/8207
 *
 * 7. ch.44: NEW WOODEN_DECORATIVE_ARTICLE_INTENT
 *    "cherry wood decorative box", "whiskey barrel oak ring blank", "wooden cake topper" → 4420
 *
 * 8. ch.68: NEW STONE_PLASTER_CARVED_ARTICLE_INTENT
 *    "Hand Carved Soapstone Figurines", "Decorative plaster memorial stone" → 6802/6809
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13zzzz.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed ZZZZ: ${note}`,
          pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    // ── 1. Expand LOUDSPEAKER_AUDIO_ACCESSORY_INTENT ──────────────────────────
    // "plantronics starset h31 headset" → 'headset' standalone not in anyOf
    // "record player rotor" → turntable/record player terms needed
    addToAnyOf('LOUDSPEAKER_AUDIO_ACCESSORY_INTENT', [
      'headset', 'headsets', 'headphone', 'headphones', 'earphone', 'earphones',
      'record player', 'turntable', 'phonograph', 'vinyl player',
      'stereo receiver', 'av receiver', 'home theater receiver',
      'speaker grille', 'speaker grill', 'speaker cover',
      'speaker wire', 'speaker cable',
    ], 'added headset/headphone/turntable terms → ch.85 8518/8519');

    // ── 2. NEW FAN_VENTILATION_COOLING_INTENT ─────────────────────────────────
    // "IRIS USA WOOZOO Air Circulator Fan" → 8414.51 (table/floor/desk fans)
    // "Nortel Airmover 3/4" → 8414.59 (blowers/fans)
    // "Automotive Dash Vent" → 8414.59 (ventilation) or 8708 (auto parts)
    patches.push({
      priority: 578,
      rule: {
        id: 'FAN_VENTILATION_COOLING_INTENT',
        description: 'Fans, blowers, air circulators → 8414 (ch.84). ' +
          '"Air circulator fan", "table fan", "airmover", "blower" → 8414.51/8414.59. ' +
          '"Dash vent", "air vent" → automotive ventilation 8414.59. ' +
          'Without rule, brand-model fan queries return EMPTY.',
        pattern: {
          anyOf: [
            // Electric fans
            'air circulator', 'air circulator fan', 'circulation fan',
            'table fan', 'desk fan', 'floor fan', 'tower fan', 'box fan',
            'ceiling fan', 'window fan', 'wall fan', 'pedestal fan',
            'oscillating fan', 'oscillating tower fan',
            'airmover', 'air mover', 'blower fan',
            // Ventilation
            'dash vent', 'air vent', 'vent cover', 'register cover',
            'hvac vent', 'floor vent', 'ceiling vent',
          ],
          noneOf: [
            'fan blade', 'ceiling fan blade',  // Parts only
            'fan fiction', 'stan', 'superfan',  // Non-product
            'spray', 'spray fan', 'paint sprayer',  // Spray equipment
          ],
        },
        whitelist: { allowChapters: ['84', '87'] },
        inject: [
          { prefix: '8414.51.30', syntheticRank: 9 }, // Table/floor/desk fans >125W
          { prefix: '8414.51.60', syntheticRank: 8 }, // Table/floor/desk fans ≤125W
          { prefix: '8414.59.15', syntheticRank: 7 }, // Other centrifugal fans
          { prefix: '8414.59.65', syntheticRank: 6 }, // Other fans/blowers
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '8414' },
        ],
      } as IntentRule,
    });

    // ── 3. Expand BONE_CHINA_CERAMIC_DISHWARE_INTENT ──────────────────────────
    // "porcelain tea cup", "Creamer and Sugar bowl", "Ceramic Deer Vase", "cookie jar" → 6911/6912/6913
    addToAnyOf('BONE_CHINA_CERAMIC_DISHWARE_INTENT', [
      // Tea service
      'tea cup', 'tea cups', 'teacup', 'teacups', 'tea saucer', 'saucer', 'saucers',
      'porcelain tea cup', 'porcelain cup', 'porcelain mug',
      // Serving ware
      'creamer', 'sugar bowl', 'gravy boat', 'soup tureen', 'serving bowl',
      // Storage
      'cookie jar', 'ceramic jar', 'ceramic canister', 'ceramic crock',
      // Vases and decor
      'ceramic vase', 'porcelain vase', 'ceramic deer', 'ceramic figurine', 'ceramic statue',
      'ceramic decor', 'ceramic decoration', 'porcelain figurine', 'pottery vase',
      // Disney/collectible ceramics
      'ceramic cookie jar', 'character cookie jar',
    ], 'added tea cup/creamer/vase/cookie jar terms → ch.69');

    // ── 4. NEW LEATHER_FOLIO_CROSSBODY_BAG_INTENT ─────────────────────────────
    // "Bellroy Travel Folio", "Ribbed A6 Leather Cash Stuffing Binder", "faux leather shoulder bag" → 4202
    // 4202 = trunks, cases, wallets, bags, travel goods
    patches.push({
      priority: 562,
      rule: {
        id: 'LEATHER_FOLIO_CROSSBODY_BAG_INTENT',
        description: 'Leather/faux leather bags, folios, binders → 4202 (ch.42). ' +
          '"Travel folio", "leather binder", "crossbody bag", "shoulder bag", "faux leather bag" → 4202. ' +
          'Without rule, leather bags route to ch.41 (raw leather) → wrong chapter.',
        pattern: {
          anyOf: [
            // Folios and binders
            'travel folio', 'travel wallet', 'document folio', 'leather folio',
            'cash binder', 'budget binder', 'stuffing binder', 'cash stuffing',
            'leather binder', 'faux leather binder',
            // Crossbody and shoulder bags
            'crossbody bag', 'cross body bag', 'shoulder bag',
            'faux leather bag', 'faux leather purse', 'faux leather shoulder bag',
            // Mini bags and pouches
            'mini bag', 'mini purse', 'wristlet', 'clutch bag', 'evening bag',
            // Passport and travel
            'passport holder', 'passport wallet', 'passport cover',
            'travel organizer', 'travel document',
          ],
          noneOf: [
            'luggage', 'suitcase', 'duffel', 'backpack',
            'canvas tote', 'cotton tote',  // Handled by CANVAS_TOTE intent
            'saddle', 'horse', 'equestrian',
          ],
        },
        whitelist: { allowChapters: ['42'] },
        inject: [
          { prefix: '4202.31.60', syntheticRank: 9 }, // Wallets, purses with outer leather surface
          { prefix: '4202.32.40', syntheticRank: 8 }, // Other articles with leather outer surface
          { prefix: '4202.92.15', syntheticRank: 7 }, // Bags with textile outer surface
          { prefix: '4202.22.40', syntheticRank: 6 }, // Handbags of leather
          { prefix: '4202.92.90', syntheticRank: 5 }, // Other bags
        ],
        boosts: [
          { delta: 0.45, prefixMatch: '4202' },
        ],
      } as IntentRule,
    });

    // ── 5. NEW RESIN_EPOXY_LIQUID_POLYMER_INTENT ──────────────────────────────
    // "Fusion Mineral Paint Pouring Resin", "UV Resin", "epoxy resin kit" → 3906/3907 (ch.39)
    // 3906 = acrylic polymers; 3909 = amino resins; 3907 = polyesters
    patches.push({
      priority: 555,
      rule: {
        id: 'RESIN_EPOXY_LIQUID_POLYMER_INTENT',
        description: 'Resin, epoxy, and liquid polymer art supplies → 3906/3907 (ch.39). ' +
          '"Pouring resin", "UV resin", "epoxy resin", "casting resin" → 3906.90/3907.91. ' +
          'Without rule, resin product queries route to ch.13 (natural resins) → wrong chapter.',
        pattern: {
          anyOf: [
            // Resin types
            'pouring resin', 'pour resin', 'casting resin', 'uv resin', 'epoxy resin',
            'resin kit', 'resin mold kit', 'resin casting kit', 'resin art',
            'two part resin', '2 part resin', 'ab resin',
            // Specific brands/types
            'envirotex', 'famowood', 'alumilite',
            // Coatings
            'wipe-on poly', 'wipe on poly', 'polycrylic', 'polyurethane finish',
            'matte finish coating', 'resin coating', 'top coat resin',
            // Mineral paint sealers
            'tough coat', 'topcoat sealer',
          ],
          noneOf: [
            '3d printer', 'resin printer', 'dlp printer', 'lcd printer',
            'fiberglass', 'fibre glass',
            'tree resin', 'pine resin', 'natural resin',  // Ch.13 natural resins
          ],
        },
        whitelist: { allowChapters: ['39', '32'] },
        inject: [
          { prefix: '3906.90.50', syntheticRank: 9 }, // Acrylic polymers in primary forms
          { prefix: '3907.91.00', syntheticRank: 8 }, // Unsaturated polyesters
          { prefix: '3909.50.50', syntheticRank: 7 }, // Polyurethanes in primary forms
          { prefix: '3907.30.00', syntheticRank: 6 }, // Epoxide resins
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '3906' },
          { delta: 0.35, prefixMatch: '3907' },
          { delta: 0.3, prefixMatch: '3909' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW RAZOR_BLADE_CUTTING_TOOL_INTENT ────────────────────────────────
    // "Gillette Venus Extra Smooth Women's Razor Blades" → 8212.20 (razor blades)
    // "Premium replacement carbide inserts - Negative Rake - Square cutter" → 8209 (carbide cutting tools)
    patches.push({
      priority: 545,
      rule: {
        id: 'RAZOR_BLADE_CUTTING_TOOL_INTENT',
        description: 'Razor blades and replacement cutting tools → 8212/8209 (ch.82). ' +
          '"Razor blades", "blade refill", "carbide insert" → 8212.20/8209.00. ' +
          'Without rule, grooming/cutting tool queries return EMPTY.',
        pattern: {
          anyOf: [
            // Razor/shaving blades
            'razor blade', 'razor blades', 'razor refill', 'razor cartridge',
            'blade refill', 'blade cartridges', 'shaving blade',
            'gillette blade', 'schick blade', 'venus blade', 'mach blade',
            // Cutting inserts for machining
            'carbide insert', 'carbide inserts', 'turning insert', 'milling insert',
            'cutting insert', 'indexable insert', 'lathe insert', 'cnc insert',
            'negative rake', 'positive rake', 'square cutter insert',
            // Utility blades
            'utility blade', 'box cutter blade', 'exacto blade', 'xacto blade',
          ],
          noneOf: [
            'knife blade', 'sword blade', 'sword', 'machete',  // Handled by ch.82 knife rules
            'turbine blade', 'fan blade',  // Industrial blades
            'grass blade',  // Not relevant
          ],
        },
        whitelist: { allowChapters: ['82'] },
        inject: [
          { prefix: '8212.20.00', syntheticRank: 9 }, // Safety razor blades
          { prefix: '8209.00.00', syntheticRank: 8 }, // Plates, sticks, tips of cermets for tools
          { prefix: '8212.10.00', syntheticRank: 7 }, // Safety razors
          { prefix: '8207.90.60', syntheticRank: 6 }, // Interchangeable tools for machining
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8212' },
          { delta: 0.4, prefixMatch: '8209' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW WOODEN_DECORATIVE_ARTICLE_INTENT ───────────────────────────────
    // "cherry wood decorative box", "whiskey barrel oak ring blank", "wooden cake topper" → 4420/4421 (ch.44)
    // "Personalized Princess Castle Cake Topper" → 4421.99 (other wooden articles)
    patches.push({
      priority: 553,
      rule: {
        id: 'WOODEN_DECORATIVE_ARTICLE_INTENT',
        description: 'Decorative wooden articles and objects → 4420/4421 (ch.44). ' +
          '"Wood box", "oak ring blank", "cake topper", "wooden rack", "wood carving" → 4420. ' +
          'Without rule, wood craft items return EMPTY or route to wrong chapter.',
        pattern: {
          anyOf: [
            // Wood boxes and containers
            'wood box', 'wooden box', 'cherry wood box', 'wooden storage box',
            'wood trinket box', 'wood keepsake box', 'wood chest',
            // Wood crafts / blanks
            'wood blank', 'ring blank', 'barrel blank', 'oak ring blank',
            'whiskey barrel', 'wine barrel', 'barrel stave',
            // Wood decorations
            'wood cake topper', 'wooden cake topper', 'wood topper', 'wooden topper',
            'wood sign', 'wooden sign', 'wood plaque', 'wood slice',
            'wood ornament', 'wooden ornament', 'wood cutout',
            'wood carving', 'carved wood', 'wooden figurine', 'wood figure',
            // Wood racks/holders
            'wooden rack', 'wood rack', 'wood holder', 'cd rack wood',
            'wine rack wood', 'wooden wine rack',
          ],
          noneOf: [
            'table', 'desk', 'chair', 'shelf', 'bookshelf', 'cabinet',  // Furniture ch.94
            'door', 'window frame', 'flooring', 'hardwood floor',  // Construction wood
            'lumber', 'plywood', 'mdf', 'particle board',  // Raw wood ch.44 but different HTS
          ],
        },
        whitelist: { allowChapters: ['44'] },
        inject: [
          { prefix: '4420.90.80', syntheticRank: 9 }, // Other wooden ornaments/decorative articles
          { prefix: '4420.10.00', syntheticRank: 8 }, // Statuettes and other ornaments of wood
          { prefix: '4421.99.97', syntheticRank: 7 }, // Other wooden articles
          { prefix: '4420.90.40', syntheticRank: 6 }, // Wooden articles of tropical wood
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '4420' },
          { delta: 0.3, prefixMatch: '4421' },
        ],
      } as IntentRule,
    });

    // ── 8. NEW STONE_PLASTER_CARVED_ARTICLE_INTENT ────────────────────────────
    // "Hand Carved Soapstone Figurines Book Ends", "Decorative plaster memorial stone" → 6802/6809 (ch.68)
    // 6802 = worked monumental/building stone; 6809 = articles of plaster/cement
    patches.push({
      priority: 548,
      rule: {
        id: 'STONE_PLASTER_CARVED_ARTICLE_INTENT',
        description: 'Carved stone figurines, soapstone articles, and plaster decoratives → 6802/6809 (ch.68). ' +
          '"Soapstone figurine", "carved stone bookend", "decorative plaster", "plaster statue" → ch.68. ' +
          'Without rule, stone carving queries return EMPTY.',
        pattern: {
          anyOf: [
            // Soapstone
            'soapstone', 'soapstone figurine', 'soapstone carving', 'carved soapstone',
            'hand carved soapstone', 'soapstone bookend', 'soapstone sculpture',
            // Carved stone
            'carved stone', 'stone carving', 'stone figurine', 'stone statue',
            'stone sculpture', 'stone bookend', 'stone owl',
            // Plaster/cement decoratives
            'plaster statue', 'plaster figurine', 'plaster decor', 'plaster decoration',
            'plaster memorial', 'plaster pet', 'plaster mold',
            'concrete statue', 'concrete figurine', 'concrete decor',
            // Alabaster
            'alabaster', 'alabaster figurine', 'alabaster carving',
            // Slate/marble articles
            'slate coaster', 'slate plaque', 'marble bookend',
          ],
          noneOf: [
            'gemstone', 'crystal', 'mineral',  // Ch.71
            'granite countertop', 'marble tile', 'stone tile',  // Construction ch.68 different
          ],
        },
        whitelist: { allowChapters: ['68', '69'] },
        inject: [
          { prefix: '6802.99.00', syntheticRank: 9 }, // Other worked ornamental stone
          { prefix: '6809.90.00', syntheticRank: 8 }, // Other articles of plaster
          { prefix: '6802.91.05', syntheticRank: 7 }, // Marble articles
          { prefix: '6809.11.00', syntheticRank: 6 }, // Plaster boards/panels
        ],
        boosts: [
          { delta: 0.45, prefixMatch: '6802' },
          { delta: 0.4, prefixMatch: '6809' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch ZZZZ)...`);
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
    console.log(`\nPatch ZZZZ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
