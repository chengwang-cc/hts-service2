#!/usr/bin/env ts-node
/**
 * Patch FFFF — 2026-03-14:
 *
 * Fix EMPTY cases by removing false-positive allow rules and adding missing inject/anyOf:
 *
 * 1. AI_CH03_SHARK_FIN: Add coin/numismatic noneOf
 *    'head' fires this rule → blocks ch.97 for "1903 Indian Head Cent"
 *
 * 2. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: Add jewelry/china/ceramic noneOf
 *    'feather' fires → blocks ch.71 for "Feather Lapel Pin"
 *    'bone' fires → blocks ch.69 for "Vintage Wedgwood...Bone China"
 *
 * 3. AI_CH89_FERRY_CARGO_VESSEL: Add storage/kitchenware noneOf
 *    'container' fires → blocks ch.73 for "stainless steel storage container"
 *
 * 4. AI_CH91_POCKET_WATCH: Add billiards/pool noneOf (additional)
 *    'pocket' fires → blocks ch.95 for "Billiards Pocket Maker"
 *
 * 5. REFRACTORY_CLAY_CEMENT_INTENT: Add vase/pottery noneOf
 *    'clay' fires → blocks ch.69 for "handmade clay decorative mini vase"
 *
 * 6. AI_CH58_RIBBON_TRIM: Add shoelace noneOf
 *    'grosgrain' fires → blocks ch.42 for "Brown Grosgrain Shoelaces"
 *
 * 7. AI_CH02_GAME_EXOTIC: Add vase/ceramic noneOf
 *    'deer' fires → blocks ch.69 for "Ceramic Deer Vase"
 *    'rabbit' fires → blocks ch.69 for "Vintage Wedgwood Peter Rabbit Plate"
 *
 * 8. SUGAR_INTENT: Add skull/ceramic noneOf
 *    'sugar' fires → blocks ch.97/69 for "Hand-Painted Ceramic Sugar Skull"
 *
 * 9. SKI_SNOWBOARD_INTENT: Add inject for ski codes
 *    Fires with allowChapters=['95'] but no inject → EMPTY when no ch.95 in fused
 *
 * 10. TABLE_LAMP_INTENT: Add lampshade terms + more inject
 *    "Woven Texture Pendant Lampshade" → EMPTY (lampshade not in anyOf)
 *
 * 11. OUTERWEAR_JACKET_GARMENT_INTENT: Add dolman terms
 *    "ladies bamboo rayon spandex dolman top" → ch.44 (bamboo wins without garment rule)
 *
 * 12. NEW NUMISMATIC_COIN_INTENT: Coin collectors items → ch.97 (9705)
 *    "1903 Indian Head Cent", "Morgan Silver Dollar" → 9705.31
 *
 * 13. NEW SHOELACE_LEATHER_STRAP_INTENT: Shoelaces, leather straps → ch.42 (4205)
 *    "Brown Grosgrain Shoelaces" → 4205.00.20
 *
 * 14. NEW ARTWORK_CERTIFICATE_INTENT: Marriage certificates, original art → ch.97 (9701)
 *    "A3 Marriage Certificate", "Hand Made Wicker Decoration" → 9701
 *
 * 15. NEW PERMANENT_MAGNET_INTENT: Fridge magnets, neodymium magnets → ch.85 (8505)
 *    "fridge magnet", "neodymium magnet" → 8505.11
 *
 * 16. NEW STAINLESS_STEEL_KITCHENWARE_INTENT: SS containers/organizers → ch.73 (7323)
 *    "stainless steel storage container", "accordion pot lid organizer" → 7323
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14ffff.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed FFFF: ${note}`,
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
          description: (existing.description ?? ruleId) + ` — Fixed FFFF: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function addInject(ruleId: string, injectSpecs: { prefix: string; syntheticRank: number }[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const currentInject: any[] = (existing as any).inject ?? [];
      const newInject = injectSpecs.filter(s => !currentInject.some((c: any) => c.prefix === s.prefix));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed FFFF: ${note}`,
          inject: [...currentInject, ...newInject],
        },
      });
      console.log(`${ruleId}: adding ${newInject.length} inject specs`);
    }

    // ── 1. AI_CH03_SHARK_FIN: Add coin/numismatic noneOf ─────────────────────
    // 'head' in anyOf fires for "1903 Indian Head Cent" → blocks ch.97
    // Head, tail, fin are body parts used in shark fin soup but also in coins/anatomy
    addNoneOf('AI_CH03_SHARK_FIN', [
      'coin', 'coins', 'cent', 'penny', 'pennies', 'dime', 'nickel', 'quarter',
      'numismatic', 'numismatics', 'bullion', 'medal', 'medallion', 'token',
      'silver dollar', 'half dollar', 'proof coin', 'uncirculated',
      'round', 'graded', 'pcgs', 'ngc',  // coin grading services
      'indian head', 'wheat cent', 'lincoln cent', 'morgan',
    ], 'coin/numismatic context prevents shark fin rule blocking ch.97');

    // ── 2. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: Add jewelry/china noneOf ────────
    // 'feather' fires → blocks ch.71 for "Feather Lapel Pin"
    // 'bone' fires → blocks ch.69 for "Vintage Wedgwood Peter Rabbit Plate Bone"
    addNoneOf('AI_CH31_ORGANIC_ANIMAL_FERTILIZER', [
      // Jewelry/accessory context
      'pin', 'pins', 'lapel pin', 'brooch', 'brooches',
      'earring', 'earrings', 'necklace', 'bracelet', 'jewelry',
      'charm', 'pendant', 'clip',
      // China/ceramic context (bone china)
      'china', 'bone china', 'porcelain', 'ceramic', 'ceramics',
      'plate', 'plates', 'mug', 'mugs', 'cup', 'cups', 'dish', 'dishes',
      'vase', 'figurine', 'ornament', 'dishware', 'tableware',
      'wedgwood', 'spode', 'lenox',  // china brands
      // Fabric/textile context (feather fill for fashion)
      'fabric', 'trim', 'boa', 'bow',  // fashion feathers, not fertilizer
    ], 'jewelry/china/fabric context prevents fertilizer rule from blocking ch.71/69');

    // ── 3. AI_CH89_FERRY_CARGO_VESSEL: Add kitchenware noneOf ─────────────────
    // 'container' fires → blocks ch.73 for "stainless steel storage container"
    addNoneOf('AI_CH89_FERRY_CARGO_VESSEL', [
      'storage', 'storage container', 'stainless', 'stainless steel',
      'kitchen', 'kitchenware', 'cookware', 'organizer', 'rack', 'holder',
      'food', 'food container', 'food storage',
      'pot', 'pan', 'bowl', 'lid', 'canister',
      'plastic', 'acrylic', 'glass',  // these are not vessels
    ], 'storage/kitchen context prevents cargo vessel rule blocking ch.73');

    // ── 4. AI_CH91_POCKET_WATCH: Add billiards/pool noneOf (additional) ──────
    // 'pocket' fires → blocks ch.95 for "Billiards Pocket Maker" (pocket = pool pocket)
    addNoneOf('AI_CH91_POCKET_WATCH', [
      'billiards', 'billiard', 'pool table', 'pool ball', 'pool cue',
      'snooker', 'eight ball', '8 ball', 'cue ball',
      'pocket maker', 'pocket liner',
    ], 'billiards context prevents pocket watch rule from blocking ch.95 pool accessories');

    // ── 5. REFRACTORY_CLAY_CEMENT_INTENT: Add vase/pottery noneOf ────────────
    // 'clay' fires → blocks ch.69 for "handmade clay decorative mini vase"
    addNoneOf('REFRACTORY_CLAY_CEMENT_INTENT', [
      'vase', 'vases', 'pottery', 'pot', 'pots',
      'figurine', 'figurines', 'statuette', 'statuettes',
      'ceramic', 'ceramics', 'porcelain',
      'decorative', 'decoration', 'ornament', 'ornaments',
      'sculpture', 'sculpted', 'handmade', 'hand made',
      'art', 'arts', 'craft', 'crafts', 'artisan',
      'dish', 'bowl', 'mug', 'cup', 'plate',
    ], 'pottery/art context prevents refractory clay rule blocking ch.69 ceramics');

    // ── 6. AI_CH58_RIBBON_TRIM: Add shoelace noneOf ───────────────────────────
    // 'grosgrain' fires → blocks ch.42 for "Brown Grosgrain Shoelaces"
    addNoneOf('AI_CH58_RIBBON_TRIM', [
      'shoelace', 'shoelaces', 'shoe lace', 'shoe laces',
      'lace', 'laces',  // when used as shoelace context
    ], 'shoelace context prevents ribbon rule from blocking ch.42 shoelaces');

    // ── 7. AI_CH02_GAME_EXOTIC: Add vase/ceramic noneOf ──────────────────────
    // 'deer' fires → blocks ch.69 for "Ceramic Deer Vase"
    // 'rabbit' fires → blocks ch.69 for "Vintage Wedgwood Peter Rabbit Plate"
    addNoneOf('AI_CH02_GAME_EXOTIC', [
      // Ceramic/decorative context
      'vase', 'vases', 'figurine', 'figurines', 'ornament', 'ornaments',
      'ceramic', 'porcelain', 'pottery', 'china',
      'plate', 'plates', 'mug', 'cup', 'dish',
      'decorative', 'decoration', 'sculpture',
      // Brand names that are animals
      'peter rabbit', 'wedgwood',  // not game meat!
    ], 'ceramic/decorative context prevents game exotic rule from blocking ch.69');

    // ── 8. SUGAR_INTENT: Add skull/ceramic noneOf ─────────────────────────────
    // 'sugar' fires → blocks ch.97 for "Hand-Painted Ceramic Sugar Skull, Mexican Day of the Dead"
    addNoneOf('SUGAR_INTENT', [
      'skull', 'skulls', 'sugar skull', 'calavera', 'calaveras',
      'day of the dead', 'dia de los muertos',
      'painted', 'hand painted', 'handpainted',
      'ceramic', 'pottery', 'clay', 'resin',
      'figurine', 'statuette', 'sculpture', 'art', 'decor',
    ], 'skull/painted/ceramic context prevents sugar rule from blocking ch.97/69 decor');

    // ── 9. SKI_SNOWBOARD_INTENT: Add inject for ski codes ─────────────────────
    // Fires with allowChapters=['95'] but no inject → EMPTY when fused lacks ch.95 ski entries
    addInject('SKI_SNOWBOARD_INTENT', [
      { prefix: '9506.11', syntheticRank: 9 },  // Alpine/downhill skis
      { prefix: '9506.12', syntheticRank: 8 },  // Cross-country skis
      { prefix: '9506.19', syntheticRank: 7 },  // Other ski equipment
      { prefix: '9506.70', syntheticRank: 6 },  // Ice skates, roller skates
    ], 'added inject for 9506.11/12/19/70 so ski queries find ch.95 entries');

    // ── 10. TABLE_LAMP_INTENT: Add lampshade + more inject ────────────────────
    // "Woven Texture Pendant Lampshade" → lampshade not in anyOf, inject limited to 9405.20
    addToAnyOf('TABLE_LAMP_INTENT', [
      'lampshade', 'lamp shade', 'lampshades', 'lamp shades',
      'pendant lampshade', 'woven lampshade', 'hanging lampshade',
      'ceiling light shade', 'light shade',
      'chandelier', 'chandeliers',  // also ch.94 lamps
    ], 'lampshade/chandelier terms for ch.94 lighting fixtures');
    addInject('TABLE_LAMP_INTENT', [
      { prefix: '9405.21', syntheticRank: 22 },  // Electric pendant lamps
      { prefix: '9405.29', syntheticRank: 21 },  // Other pendant/ceiling lamps
      { prefix: '9405.91', syntheticRank: 10 },  // Lamp parts/shades
    ], 'added 9405.21/29/91 inject for pendant lamps and shades');

    // ── 11. OUTERWEAR_JACKET_GARMENT_INTENT: Add dolman terms ─────────────────
    // "ladies bamboo rayon spandex dolman top" → ch.44 (bamboo wins, no garment rule fires)
    addToAnyOf('OUTERWEAR_JACKET_GARMENT_INTENT', [
      'dolman', 'dolman top', 'dolman sleeve',
      'dolman blouse', 'batwing sleeve', 'batwing top',
    ], 'dolman/batwing terms trigger garment intent → ch.61/62 path');

    // ── 12. NEW NUMISMATIC_COIN_INTENT (ch.97) ────────────────────────────────
    // "1903 Indian Head Cent", "Morgan Silver Dollar" → 9705.31 (numismatic coins)
    patches.push({
      priority: 560,
      rule: {
        id: 'NUMISMATIC_COIN_INTENT',
        description: 'Numismatic collectible coins, medals → ch.97 (9705). ' +
          '"Indian head cent", "Morgan dollar", "proof coin", "wheat penny" → 9705.31. ' +
          'Without rule, antique/collectible coin queries return EMPTY or wrong chapter.',
        pattern: {
          anyOf: [
            // US coins
            'indian head cent', 'indian head penny', 'wheat cent', 'wheat penny',
            'lincoln cent', 'morgan dollar', 'morgan silver dollar',
            'buffalo nickel', 'mercury dime', 'barber dime', 'standing liberty',
            'walking liberty', 'kennedy half dollar', 'peace dollar',
            'seated liberty', 'draped bust', 'capped bust',
            // Generic numismatic terms
            'numismatic', 'numismatics', 'proof coin', 'proof set',
            'uncirculated coin', 'graded coin', 'slabbed coin',
            'pcgs', 'ngc', 'anacs',  // grading services
            'bullion coin', 'gold eagle', 'silver eagle', 'silver maple',
            // Collector grades
            'xf45', 'ef45', 'ms63', 'ms64', 'ms65', 'au50', 'au58',
          ],
          noneOf: ['slot machine', 'token machine', 'vending'],
        },
        whitelist: { allowChapters: ['97', '71'] },
        inject: [
          { prefix: '9705.31', syntheticRank: 9 },  // Coins of numismatic interest
          { prefix: '9705.21', syntheticRank: 8 },  // Collector pieces of archaeological interest
          { prefix: '9705.00', syntheticRank: 7 },  // Other collector items
          { prefix: '7118.10', syntheticRank: 6 },  // Coin (current)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9705' },
          { delta: 0.4, chapterMatch: '97' },
        ],
      } as IntentRule,
    });

    // ── 13. NEW SHOELACE_LEATHER_STRAP_INTENT (ch.42) ────────────────────────
    // "Brown Grosgrain Shoelaces" → 4205.00.20 (leather/other shoelaces)
    // "Black Full Grain Leather Strap" → 4205.00.40
    patches.push({
      priority: 562,
      rule: {
        id: 'SHOELACE_LEATHER_STRAP_INTENT',
        description: 'Shoelaces, leather straps, bag handles → ch.42 (4205). ' +
          '"Shoelaces", "leather strap", "bag handle", "leather cord" → 4205. ' +
          'Without rule, these leather accessories route to wrong chapters or EMPTY.',
        pattern: {
          anyOf: [
            'shoelace', 'shoelaces', 'shoe lace', 'shoe laces',
            'boot lace', 'boot laces', 'sneaker lace', 'sneaker laces',
            'leather strap', 'leather straps', 'leather cord', 'leather cords',
            'leather lace', 'leather laces', 'leather thong', 'leather thongs',
            'bag handle', 'bag handles', 'purse handle', 'purse handles',
            'belt strap', 'belt blanks', 'leather belt strip',
            'vegetable tanned', 'veg tan', 'full grain leather strap',
          ],
          noneOf: ['watch strap', 'watch band', 'fitbit strap'],  // those are ch.91
        },
        whitelist: { allowChapters: ['42'] },
        inject: [
          { prefix: '4205.00.20', syntheticRank: 9 },  // Shoelaces of leather
          { prefix: '4205.00.40', syntheticRank: 8 },  // Other leather articles
          { prefix: '4205.00.80', syntheticRank: 7 },  // Other leather articles nec
          { prefix: '4203.20', syntheticRank: 6 },  // Belts and bandoliers
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4205' },
          { delta: 0.3, chapterMatch: '42' },
        ],
      } as IntentRule,
    });

    // ── 14. NEW ARTWORK_CERTIFICATE_INTENT (ch.97) ───────────────────────────
    // "A3/A4 Marriage Certificate" → 9701.99.00 (original works of art)
    // "Hand Made Wicker Decoration" → 9701.92.00
    patches.push({
      priority: 558,
      rule: {
        id: 'ARTWORK_CERTIFICATE_INTENT',
        description: 'Original artwork, certificates, handmade decorations → ch.97 (9701). ' +
          '"Marriage certificate", "original artwork", "handmade decoration" → 9701. ' +
          'Without rule, these unique handcrafted items return EMPTY.',
        pattern: {
          anyOf: [
            // Certificates as artwork
            'marriage certificate', 'wedding certificate', 'birth certificate',
            'baptism certificate', 'certificate of authenticity',
            'custom certificate', 'personalized certificate',
            // Original art
            'original oil painting', 'original acrylic painting', 'original watercolor',
            'hand painted original', 'hand drawn original',
            'original artwork', 'original art', 'one of a kind',
            // Handmade decorative items
            'hand made wicker', 'handmade wicker', 'wicker decoration', 'wicker decor',
            'hand woven decoration', 'handmade folk art', 'folk art',
          ],
          noneOf: ['digital', 'printable', 'pdf', 'download', 'pattern'],
        },
        whitelist: { allowChapters: ['97', '49'] },
        inject: [
          { prefix: '9701.99', syntheticRank: 9 },  // Other original works of art
          { prefix: '9701.92', syntheticRank: 8 },  // Original engravings/prints
          { prefix: '9701.91', syntheticRank: 7 },  // Original paintings
          { prefix: '4911.99', syntheticRank: 6 },  // Other printed matter
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '97' },
          { delta: 0.4, prefixMatch: '9701' },
        ],
      } as IntentRule,
    });

    // ── 15. NEW PERMANENT_MAGNET_INTENT (ch.85) ──────────────────────────────
    // "man resin fridge magn (used)" → 8505.11.00 (permanent magnets of metal)
    // "neodymium magnet" → 8505.11
    patches.push({
      priority: 581,
      rule: {
        id: 'PERMANENT_MAGNET_INTENT',
        description: 'Permanent magnets, fridge magnets, neodymium magnets → ch.85 (8505). ' +
          '"Fridge magnet", "neodymium magnet", "ferrite magnet" → 8505.11/19. ' +
          'Without rule, magnet queries return wrong chapter.',
        pattern: {
          anyOf: [
            // Fridge magnets
            'fridge magnet', 'fridge magnets', 'refrigerator magnet', 'refrigerator magnets',
            'photo magnet', 'picture magnet', 'souvenir magnet',
            // Permanent magnets
            'neodymium magnet', 'neodymium magnets', 'neo magnet', 'ndfeb',
            'rare earth magnet', 'rare earth magnets', 'ferrite magnet', 'ceramic magnet',
            'alnico magnet', 'samarium cobalt',
            'permanent magnet', 'permanent magnets',
            'bar magnet', 'disc magnet', 'ring magnet', 'block magnet',
            'magnetic name badge', 'magnetic badge holder',
          ],
          noneOf: ['magnetic toy', 'magnetic game', 'magnetic dart'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8505.11', syntheticRank: 9 },  // Permanent magnets of metal
          { prefix: '8505.19', syntheticRank: 8 },  // Other permanent magnets
          { prefix: '8505.20', syntheticRank: 7 },  // Electromagnetic couplings
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8505' },
          { delta: 0.3, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 16. NEW STAINLESS_STEEL_KITCHENWARE_INTENT (ch.73) ───────────────────
    // "50% Stainless Steel 50% Plastic Storage Container" → 7323.93
    // "Vintage accordion pot lid organizer, stainless steel kitchen" → 7323.93
    patches.push({
      priority: 546,
      rule: {
        id: 'STAINLESS_STEEL_KITCHENWARE_INTENT',
        description: 'Stainless steel kitchen/household articles → ch.73 (7323). ' +
          '"Stainless steel container", "pot lid organizer", "kitchen rack" → 7323.93. ' +
          'Without rule, stainless kitchen items return wrong chapter or EMPTY.',
        pattern: {
          anyOf: [
            'pot lid organizer', 'pot lid rack', 'lid rack', 'lid holder',
            'pan organizer', 'pan rack', 'pot rack',
            'stainless steel container', 'stainless container', 'stainless storage',
            'steel storage container', 'metal storage container',
            'stainless steel organizer', 'stainless organizer',
            'stainless steel bowl', 'stainless bowl', 'steel bowl',
            'stainless steel rack', 'cooling rack', 'wire rack', 'dish rack',
            'stainless steel shelf', 'steel shelf',
            'shift knob', 'weighted shift knob',  // 7326 steel articles
          ],
          noneOf: ['plastic', 'acrylic', 'glass', 'ceramic', 'wood'],
        },
        whitelist: { allowChapters: ['73'] },
        inject: [
          { prefix: '7323.93', syntheticRank: 9 },  // SS household articles
          { prefix: '7323.99', syntheticRank: 8 },  // Other table/kitchen articles
          { prefix: '7326.90', syntheticRank: 7 },  // Other articles of iron/steel
          { prefix: '7326.20', syntheticRank: 6 },  // Articles of iron/steel wire
        ],
        boosts: [
          { delta: 0.4, chapterMatch: '73' },
          { delta: 0.5, prefixMatch: '7323' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch FFFF)...`);
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
    console.log(`\nPatch FFFF complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
