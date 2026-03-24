#!/usr/bin/env ts-node
/**
 * Patch TT128 — 2026-03-16: Vinyl stickers/posters, hockey/ice skates, imitation jewelry,
 *   pen cases, buttons, toiletry kits.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt128.ts
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

    // 1. VINYL_STICKER_DECAL_PRINT_INTENT → 4911.91.40.40 (vinyl stickers as printed matter)
    //    "dog Vinyl Sticker" → 4821.90 WRONG (adhesive label, expected 4911.91.40.40)
    //    "Camp Sticker Pack" → 4821.10 WRONG (adhesive labels, expected 4911.91.40.40)
    //    "100 Johto Mini Stickers" → 4821.10 WRONG (expected 4911.99.20.00)
    //    "Blazblue Anime Vinyl Stickers" → 4821.10 WRONG (expected 4911.91.20.40)
    //    Root cause: "sticker" → adhesive labels (4821); vinyl stickers are printed matter (4911).
    {
      const existing = allRules.find(r => r.id === 'VINYL_STICKER_DECAL_PRINT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'VINYL_STICKER_DECAL_PRINT_INTENT',
          description: 'Vinyl stickers/decals/sticker packs → 4911.91.40.40 (printed matter)',
          pattern: {
            anyOf: [
              'vinyl sticker', 'vinyl stickers', 'sticker pack', 'sticker sheet',
              'die cut sticker', 'die-cut sticker', 'holographic sticker',
              'holographic vinyl sticker', 'glossy vinyl sticker',
              'anime sticker', 'gaming sticker', 'fandom sticker',
              'chibi sticker', 'manga sticker', 'kawaii sticker',
              'mini stickers', 'sticker set vinyl', 'stickers pack vinyl',
              'water bottle sticker', 'laptop sticker', 'car sticker decal',
              'bumper sticker', 'window sticker', 'decal sticker',
              'pokemon sticker', 'anime decal', 'fandom decal',
            ],
            noneOf: [
              // Actual adhesive paper labels (different from decorative stickers)
              'shipping label', 'return label', 'address label', 'mailing label',
              'barcode label', 'price label', 'product label', 'clothing label',
              // Transfers
              'iron-on transfer', 'heat transfer vinyl',
              // Ceramic decals
              'ceramic decal', 'waterslide decal',
            ],
          },
          inject: [
            { prefix: '4911.91.40', syntheticRank: 1 },  // printed pictures/stickers (vinyl, >0.51mm²)
            { prefix: '4911.91.20', syntheticRank: 3 },  // other printed pictures (anime/game art)
            { prefix: '4911.99', syntheticRank: 6 },      // other printed matter
          ],
          whitelist: {
            allowChapters: ['49'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4911.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4821.' },  // strong penalty for adhesive labels
            { delta: 0.80, prefixMatch: '3919.' },  // penalize self-adhesive plastic (rolls)
          ],
        } as IntentRule;
        patches.push({ priority: 682, rule: newRule });
        console.log('VINYL_STICKER_DECAL_PRINT_INTENT: created (→4911.91.40, allowChapters:[49])');
      } else {
        console.log('VINYL_STICKER_DECAL_PRINT_INTENT: already exists, skipping');
      }
    }

    // 2. POSTER_WALL_ART_PRINT_INTENT → 4911.10.00.60 (commercial posters/prints)
    //    "Movie Poster" → 4911.91.40.20 WRONG (expected 4911.10.00.60 trade advertisements)
    //    "Custom Vinyl Lyrics Print" → 8523.29 WRONG (expected 4911.10.00.60)
    //    "Custom Quote Poster Print" → 4911.91.40.20 WRONG (expected 4911.10.00.60)
    //    Root cause: 4911.91 (other prints) wins over 4911.10 (commercial prints/trade ads/posters).
    {
      const existing = allRules.find(r => r.id === 'POSTER_WALL_ART_PRINT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'POSTER_WALL_ART_PRINT_INTENT',
          description: 'Movie/music/art posters and prints → 4911.10 (trade advertising/commercial prints)',
          pattern: {
            anyOf: [
              'movie poster', 'film poster', 'cinema poster', 'vintage movie poster',
              'music poster', 'band poster', 'concert poster',
              'lyric print', 'lyrics print', 'custom lyrics print',
              'quote poster', 'quote print', 'custom quote poster',
              'motivational poster', 'inspirational print',
              'typography print', 'typography poster', 'word art print',
              'personalized poster', 'custom poster', 'print poster',
              'wall art poster', 'wall art print', 'art poster',
            ],
            noneOf: [
              // Fine art (different heading)
              'original painting', 'original artwork', 'hand painted',
              'oil painting', 'watercolor original',
              // Photographs
              'photo print', 'photograph print', 'photo poster',
            ],
          },
          inject: [
            { prefix: '4911.10', syntheticRank: 1 },  // commercial prints, posters
          ],
          whitelist: {
            allowChapters: ['49'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4911.10' },
          ],
          penalties: [
            { delta: 0.80, prefixMatch: '4911.91' },  // penalize other printed pictures
            { delta: 0.90, prefixMatch: '8523.' },    // penalize recorded media (vinyl/digital)
          ],
        } as IntentRule;
        patches.push({ priority: 683, rule: newRule });
        console.log('POSTER_WALL_ART_PRINT_INTENT: created (→4911.10, allowChapters:[49])');
      } else {
        console.log('POSTER_WALL_ART_PRINT_INTENT: already exists, skipping');
      }
    }

    // 3. HOCKEY_ICE_SKATE_FOOTWEAR_INTENT → 6403/6404 (ice/hockey skates as footwear, not sports eq.)
    //    "pair of youth hockey skates" → 9506.70 WRONG (expected 6403.19.40.90)
    //    "pair of used youth hockey skates" → 9506.70 WRONG (expected 6404.11.90.70)
    //    Root cause: hockey/ice skates → roller skates (9506.70); they are footwear (ch64).
    {
      const existing = allRules.find(r => r.id === 'HOCKEY_ICE_SKATE_FOOTWEAR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HOCKEY_ICE_SKATE_FOOTWEAR_INTENT',
          description: 'Hockey/ice/figure skates → 6403/6404 (footwear, not sports equipment)',
          pattern: {
            anyOf: [
              'hockey skate', 'hockey skates', 'ice skate', 'ice skates',
              'figure skate', 'figure skates', 'youth hockey skate',
              'youth hockey skates', 'kids hockey skates', 'adult hockey skates',
              'ice hockey skate', 'goalie skate', 'speed skate ice',
              'ice skating boot', 'figure skating boot',
            ],
            noneOf: [
              // Inline/roller skates (ch95 sports equipment)
              'roller skate', 'inline skate', 'rollerblades', 'quad skate',
            ],
          },
          inject: [
            { prefix: '6403.19', syntheticRank: 1 },  // other footwear with upper of leather
            { prefix: '6404.11', syntheticRank: 3 },  // footwear with rubber/plastic outsoles
          ],
          whitelist: {
            allowChapters: ['64'],
          },
          boosts: [
            { delta: 0.85, prefixMatch: '6403.' },
            { delta: 0.85, prefixMatch: '6404.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9506.70' },  // strong penalty for roller skates
            { delta: 0.80, prefixMatch: '9506.' },    // penalize sports equipment
          ],
        } as IntentRule;
        patches.push({ priority: 684, rule: newRule });
        console.log('HOCKEY_ICE_SKATE_FOOTWEAR_INTENT: created (→6403/6404, allowChapters:[64])');
      } else {
        console.log('HOCKEY_ICE_SKATE_FOOTWEAR_INTENT: already exists, skipping');
      }
    }

    // 4. IMITATION_JEWELRY_RESIN_PLASTIC_INTENT → 7117.90 (resin/plastic/3D-printed imitation jewelry)
    //    "Earings- resin and stainless steel" → 7323.93 WRONG (expected 7117.90.45.00)
    //    "3D Printed Necklace" → 3926.90 WRONG (expected 7117.90.75.00)
    //    "Handmade plastic keychain accessory" → 3926.90 WRONG (expected 7117.90.75.00)
    //    "Hazbin Hotel CATBOY Pin" → 8546.20 WRONG (expected 7117.90.45.00)
    //    "Imitation Acrylic Jewelry Brooche" → 7117.90.60 WRONG (expected 7117.90.30.00)
    //    Root cause: resin/plastic jewelry → plastic articles (3926) or kitchen steel (7323)
    {
      const existing = allRules.find(r => r.id === 'IMITATION_JEWELRY_RESIN_PLASTIC_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'IMITATION_JEWELRY_RESIN_PLASTIC_INTENT',
          description: 'Resin/plastic/3D-printed imitation jewelry → 7117.90',
          pattern: {
            anyOf: [
              // Resin jewelry
              'resin earring', 'resin earrings', 'resin necklace', 'resin ring',
              'resin jewelry', 'resin jewellery', 'resin and stainless steel earring',
              'resin pendant', 'resin brooch', 'resin bracelet',
              // 3D printed / plastic jewelry
              '3d printed necklace', '3d printed jewelry', '3d printed earring',
              '3d printed ring', 'pla jewelry', 'pla necklace',
              // Fandom/character pins and charms
              'catboy pin', 'anime pin earring', 'character jewelry',
              // Keychain as jewelry/charm
              'handmade plastic keychain accessory', 'charm keychain accessory',
              'acrylic jewelry brooch', 'acrylic brooch', 'plastic brooch',
              'imitation jewelry', 'imitation jewellery', 'costume jewelry',
              'costume jewellery', 'fashion jewelry', 'fashion jewellery',
            ],
            noneOf: [
              // Real precious metal jewelry
              'gold jewelry', 'silver jewelry', '14k gold', '18k gold', 'sterling silver',
              // Enamel pins (different 7326 classification)
              'enamel pin', 'lapel pin', 'soft enamel', 'hard enamel',
              // Beaded keychains (already covered)
            ],
          },
          inject: [
            { prefix: '7117.90', syntheticRank: 1 },  // other imitation jewelry
          ],
          whitelist: {
            allowChapters: ['71'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '7117.90' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '3926.90' },  // penalize plastic articles
            { delta: 0.85, prefixMatch: '7323.' },    // penalize iron/steel household
            { delta: 0.80, prefixMatch: '8546.' },    // penalize insulators
            { delta: 0.75, prefixMatch: '7113.' },    // penalize precious metal jewelry
          ],
        } as IntentRule;
        patches.push({ priority: 685, rule: newRule });
        console.log('IMITATION_JEWELRY_RESIN_PLASTIC_INTENT: created (→7117.90, allowChapters:[71])');
      } else {
        console.log('IMITATION_JEWELRY_RESIN_PLASTIC_INTENT: already exists, skipping');
      }
    }

    // 5. PEN_PENCIL_CASE_POUCH_INTENT → 9608.99 (pen/pencil pouches and cases)
    //    "3 pen pouch" → 4202.32 WRONG (expected 9608.99.40.00)
    //    "single pen pouch" → 5402.31 WRONG (expected 9608.99.40.00)
    //    Root cause: "pouch" → handbag/travel pouch (4202) or synthetic yarn (5402).
    {
      const existing = allRules.find(r => r.id === 'PEN_PENCIL_CASE_POUCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PEN_PENCIL_CASE_POUCH_INTENT',
          description: 'Pen/pencil pouches and cases → 9608.99 (other pens and pen accessories)',
          pattern: {
            anyOf: [
              'pen pouch', 'pen pouches', 'single pen pouch', 'pen case',
              'pencil case', 'pencil pouch', 'pencil bag', 'pencil holder bag',
              'pen holder pouch', 'pen roll', 'pen wrap',
              'artists pen case', 'marker case', 'marker pouch',
              'calligraphy pen case', 'brush pen case', 'fountain pen case',
              'pen carrying case', 'pen travel case',
            ],
            noneOf: [
              'wallet', 'coin purse', 'cosmetic pouch', 'makeup bag',
            ],
          },
          inject: [
            { prefix: '9608.99', syntheticRank: 1 },  // other articles for writing instruments
          ],
          whitelist: {
            allowChapters: ['96'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9608.99' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '4202.32' },  // penalize handbags (wallets/purses)
            { delta: 0.85, prefixMatch: '5402.' },    // penalize synthetic yarn
          ],
        } as IntentRule;
        patches.push({ priority: 686, rule: newRule });
        console.log('PEN_PENCIL_CASE_POUCH_INTENT: created (→9608.99, allowChapters:[96])');
      } else {
        console.log('PEN_PENCIL_CASE_POUCH_INTENT: already exists, skipping');
      }
    }

    // 6. RESIN_CRAFT_BUTTON_INTENT → 9606.21 (resin/plastic buttons for sewing/crafts)
    //    "Handcrafted resin button#3/4/5" → 9606.29.20.00 WRONG (expected 9606.21.60.00)
    //    Root cause: 9606.29 = buttons of other material vs 9606.21 = plastic buttons.
    //    Resin IS a plastic, so resin buttons → 9606.21.
    {
      const existing = allRules.find(r => r.id === 'RESIN_CRAFT_BUTTON_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'RESIN_CRAFT_BUTTON_INTENT',
          description: 'Resin/plastic craft buttons → 9606.21 (plastic buttons)',
          pattern: {
            anyOf: [
              'resin button', 'resin buttons', 'handcrafted resin button',
              'acrylic button', 'acrylic buttons', 'plastic button craft',
              'epoxy button', 'polymer clay button', 'uv resin button',
              'custom resin button', 'novelty resin button',
            ],
            noneOf: [
              'leather button', 'wood button', 'metal button', 'ceramic button',
              'shell button', 'bone button',
            ],
          },
          inject: [
            { prefix: '9606.21', syntheticRank: 1 },  // plastic buttons
          ],
          whitelist: {
            allowChapters: ['96'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9606.21' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '9606.29' },  // penalize other material buttons
          ],
        } as IntentRule;
        patches.push({ priority: 687, rule: newRule });
        console.log('RESIN_CRAFT_BUTTON_INTENT: created (→9606.21, allowChapters:[96])');
      } else {
        console.log('RESIN_CRAFT_BUTTON_INTENT: already exists, skipping');
      }
    }

    // 7. GROOMING_TOILETRY_TRAVEL_KIT_INTENT → 9605 (travel sets for toilet/grooming)
    //    "Jason Markk Essential Kit" → 3301.19 WRONG (essential oils, expected 9605.00.00.00)
    //    Root cause: "kit" without context → essential oils (3301); Jason Markk makes shoe cleaning kits.
    //    9605 = travel sets for personal toilet/grooming/hygiene.
    {
      const existing = allRules.find(r => r.id === 'GROOMING_TOILETRY_TRAVEL_KIT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GROOMING_TOILETRY_TRAVEL_KIT_INTENT',
          description: 'Grooming/toiletry/cleaning kits → 9605 (travel sets for personal toilet)',
          pattern: {
            anyOf: [
              'essential kit grooming', 'essential cleaning kit', 'shoe cleaning kit',
              'sneaker cleaning kit', 'jason markk kit', 'leather cleaning kit',
              'grooming kit', 'shaving kit', 'beard grooming kit',
              'hair care kit', 'skincare kit travel', 'travel grooming kit',
              'manicure set', 'nail care kit', 'toiletry kit', 'toiletry set',
              'travel set personal care', 'personal care travel set',
            ],
            noneOf: [
              'diy kit', 'sewing kit', 'tool kit', 'first aid kit',
              'art kit', 'craft kit', 'knitting kit', 'embroidery kit',
              'chemistry kit', 'science kit',
            ],
          },
          inject: [
            { prefix: '9605.00', syntheticRank: 1 },  // travel sets for personal toilet
          ],
          whitelist: {
            allowChapters: ['96'],
          },
          boosts: [
            { delta: 0.90, prefixMatch: '9605.00' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '3301.' },  // strong penalty for essential oils
            { delta: 0.80, prefixMatch: '3304.' },  // penalize beauty preparations
          ],
        } as IntentRule;
        patches.push({ priority: 688, rule: newRule });
        console.log('GROOMING_TOILETRY_TRAVEL_KIT_INTENT: created (→9605, allowChapters:[96])');
      } else {
        console.log('GROOMING_TOILETRY_TRAVEL_KIT_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT128)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT128 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
