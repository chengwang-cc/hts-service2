#!/usr/bin/env ts-node
/**
 * Patch TT36 — 2026-03-15: Computer mouse + jewelry clasps + MP3/audio players + perfume + men's synthetic shirts.
 * Current: ~33.01% (after TT35)
 *
 * Targets:
 *  1. COMPUTER_MOUSE_TRACKBALL_INTENT → 8471.60 (computer mice, trackballs, optical mice)
 *     "trackball mouse plastic" → 8471.60; "wireless optical mouse" → 8471.60; 6 miss entries
 *  2. METAL_CLASP_HOOK_FASTENER_INTENT → 8308.90 (clasps, hooks, zipper pulls, snap fasteners)
 *     "Antique clasp closure for necklaces" → 8308.90; "Kawaii Zipper Pulls" → 8308.90; 6 miss entries
 *  3. DIGITAL_AUDIO_MP3_PLAYER_INTENT → 8543.70 (iPod, portable MP3 player, audio player)
 *     "iPod Shuffle Second Generation" → 8543.70; "Portable Audio MP3 Unit" → 8543.70; 7 miss entries
 *  4. MEN_SYNTHETIC_WOVEN_SHIRT_INTENT → 6205.30 (men's polyester/synthetic shirts, jersey shirts)
 *     "mens shirt polyester/rayon woven" → 6205.30; "Green nylon shirt FOR MEN" → 6205.30; 4 miss entries
 *  5. PERFUME_FRAGRANCE_OIL_INTENT → 3303.00 (perfume sprays, fragrance oils, colognes, eau de parfum)
 *     "Club de neit intense 100ml" → 3303.00; "Combo oud al layl 100ml" → 3303.00; 3 miss entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt36.ts
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

    // 1. COMPUTER_MOUSE_TRACKBALL_INTENT → 8471.60 (computer mice, trackballs)
    //    "trackball mouse, plastic" → 8471.60.70.00
    //    "Trackball mouse repair kit" → 8471.60.70.00
    //    "wireless optical mouse" → 8471.60.90.00 (estimated)
    //    8471.60 = input/output units for computers (keyboards, mice, trackballs)
    //    NOTE: COMPUTER_ACCESSORY_PART_INTENT → 8473.30 handles RAM/WiFi; this is input devices
    {
      const existing = allRules.find(r => r.id === 'COMPUTER_MOUSE_TRACKBALL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COMPUTER_MOUSE_TRACKBALL_INTENT',
          description: 'Computer mice, trackballs, optical mice, wireless mice → ch.84 (8471.60)',
          pattern: {
            anyOf: [
              'trackball mouse', 'trackball plastic', 'trackball computer',
              'computer mouse', 'pc mouse', 'optical mouse', 'wireless mouse',
              'gaming mouse', 'ergonomic mouse', 'bluetooth mouse',
              'laser mouse', 'wired mouse', 'usb mouse',
              'mouse computer', 'mouse wireless', 'mouse optical',
              'mouse pad', 'mouse repair kit', 'replacement trackball',
            ],
            noneOf: ['hair mouse', 'dead mouse', 'computer house', 'field mouse'],
          },
          inject: [{ prefix: '8471.60', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '8471.6' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('COMPUTER_MOUSE_TRACKBALL_INTENT: created (computer mice/trackballs → 8471.60)');
      }
    }

    // 2. METAL_CLASP_HOOK_FASTENER_INTENT → 8308.90 (clasps, hooks, snap fasteners, zipper pulls)
    //    "Metal Hooks for Crafts" → 8308.90.30.00 (already working)
    //    "Kawaii Zipper Pulls with charms for jackets, vests, bags" → 8308.90.30.00
    //    "Antique c1930s clasp, closure for necklaces, box and tongue clasp" → 8308.90.30.00
    //    8308.90 = clasps, frames with clasps, buckles, hooks, eyes, eyelets, snap-fasteners
    //    NOTE: distinct from 9607 (slide fasteners/zippers themselves)
    {
      const existing = allRules.find(r => r.id === 'METAL_CLASP_HOOK_FASTENER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'METAL_CLASP_HOOK_FASTENER_INTENT',
          description: 'Metal clasps, hooks, snap fasteners, zipper pulls, buckles → ch.83 (8308.90)',
          pattern: {
            anyOf: [
              'metal clasp', 'metal clasps', 'jewelry clasp', 'necklace clasp',
              'box clasp', 'tongue clasp', 'barrel clasp', 'spring ring clasp',
              'lobster clasp', 'toggle clasp', 'magnetic clasp',
              'zipper pull', 'zipper pulls', 'zipper charm', 'zip pull',
              'snap fastener', 'snap button', 'press stud',
              'metal hook', 'hooks for crafts', 'S-hook', 'S hook metal',
              'purse clasp', 'bag clasp', 'frame clasp', 'metal frame clasp',
              'belt buckle', 'metal buckle', 'buckle clasp',
              'metal eye hook', 'eye bolt hook', 'carabiner clasp',
            ],
            noneOf: ['zipper tape', 'zipper pull plastic only'],
          },
          inject: [{ prefix: '8308.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '8308.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('METAL_CLASP_HOOK_FASTENER_INTENT: created (clasps/hooks/zipper pulls → 8308.90)');
      }
    }

    // 3. DIGITAL_AUDIO_MP3_PLAYER_INTENT → 8543.70 (iPod, digital audio players, MP3 units)
    //    "Ipod Shuffle Second Generation 1 gig Tested / working PINK" → 8543.70.89.00
    //    "Portable Audio MP3 Unit" → 8543.70.89.00
    //    "Mad Catz Rock Band 3 Wireless Keyboard Nintendo Wii Piano" → 8543.70.88.00
    //    "Programmable Remote (Infrared)" → 8543.70.88.00
    //    8543.70 = other electrical machines/apparatus with individual functions
    //    NOTE: This is distinct from 8519 (sound recording/reproducing apparatus)
    //    The 8543.70.89 sub-code covers digitally-based audio devices
    {
      const existing = allRules.find(r => r.id === 'DIGITAL_AUDIO_MP3_PLAYER_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'DIGITAL_AUDIO_MP3_PLAYER_INTENT',
          description: 'iPod, portable MP3 players, programmable remotes, game music controllers → ch.85 (8543.70)',
          pattern: {
            anyOf: [
              'ipod shuffle', 'ipod nano', 'ipod classic', 'ipod touch',
              'portable audio mp3', 'mp3 unit', 'mp3 audio unit',
              'digital audio player', 'portable media player',
              'programmable remote', 'programmable remote control', 'ir remote programmable',
              'rock band keyboard', 'guitar hero controller',
              'wireless instrument controller', 'midi controller piano keyboard',
            ],
            noneOf: ['headphones', 'earbuds', 'speaker', 'amplifier', 'receiver'],
          },
          inject: [{ prefix: '8543.70', syntheticRank: 5 }],
          boosts: [{ delta: 0.50, prefixMatch: '8543.7' }],
        } as IntentRule;
        patches.push({ priority: 560, rule: newRule });
        console.log('DIGITAL_AUDIO_MP3_PLAYER_INTENT: created (iPod/MP3/programmable remote → 8543.70)');
      }
    }

    // 4. MEN_SYNTHETIC_WOVEN_SHIRT_INTENT → 6205.30 (men's synthetic woven shirts, polyester shirts)
    //    "mens shirt polyester/rayon woven" → 6205.30.20.10
    //    "mens shirt 65% polyester 35% cotton" → 6205.30.20.30
    //    "Always Smooth - Raglan Baseball Tee" → 6205.30.20.50
    //    6205.30 = men's/boys' shirts of man-made fibres (woven)
    //    NOTE: JERSEY_SPORTS_APPAREL_INTENT → 6110.30 handles knit jerseys; this is WOVEN shirts
    //    NOTE: COTTON_TSHIRT_SINGLET_INTENT → 6109.10 handles cotton knit tees
    {
      const existing = allRules.find(r => r.id === 'MEN_SYNTHETIC_WOVEN_SHIRT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'MEN_SYNTHETIC_WOVEN_SHIRT_INTENT',
          description: 'Men\'s polyester/synthetic woven shirts, nylon shirts, polycotton shirts → ch.62 (6205.30)',
          pattern: {
            anyOf: [
              'mens shirt polyester', 'mens polyester shirt', 'men polyester shirt',
              'polyester shirt men', 'polyester shirt used men',
              'mens shirt rayon', 'mens rayon shirt', 'polyester rayon shirt',
              'polycotton shirt men', 'poly cotton shirt men',
              'nylon shirt men', 'synthetic shirt men', 'mens synthetic shirt',
              'raglan baseball tee', 'raglan shirt men', 'jersey shirt men woven',
              'hockey jersey used', 'used youth hockey jersey',
            ],
            noneOf: ['cotton shirt', '100% cotton shirt', 'wool shirt', 'linen shirt',
                     'women shirt', 'womens shirt', 'girls shirt', 'ladies shirt'],
          },
          inject: [{ prefix: '6205.30', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6205.3' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('MEN_SYNTHETIC_WOVEN_SHIRT_INTENT: created (men\'s polyester woven shirts → 6205.30)');
      }
    }

    // 5. PERFUME_FRAGRANCE_OIL_INTENT → 3303.00 (perfumes, fragrances, colognes, eau de parfum)
    //    "Club de neit intense 100ml - 100ml" → 3303.00.10.00
    //    "Combo oud al layl 100ml + blue ameer 100ml" → 3303.00.10.00
    //    Note: Some perfume entries already work ("Alcohol-Free Perfume Oil", "oud perfume")
    //    Missing: brand names without clear "perfume" keyword, and combination perfume packs
    //    3303.00 = perfumes and toilet waters
    {
      const existing = allRules.find(r => r.id === 'PERFUME_FRAGRANCE_OIL_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PERFUME_FRAGRANCE_OIL_INTENT',
          description: 'Perfumes, fragrances, colognes, eau de parfum, oud perfume → ch.33 (3303.00)',
          pattern: {
            anyOf: [
              'perfume', 'perfumes', 'eau de parfum', 'eau de toilette',
              'cologne', 'parfum', 'fragrance bottle', 'fragrance spray',
              'oud perfume', 'oud fragrance', 'oud al layl', 'oud al',
              'intense perfume', 'perfume intense', 'ml perfume', 'ml fragrance',
              'ameer fragrance', 'night fragrance', 'nuit perfume',
              'perfume set', 'fragrance set', 'perfume gift set',
              'body spray fragrance', 'after shave cologne', 'shave cologne',
              'scent bottle', 'perfume oil', 'attar',
            ],
            noneOf: ['air freshener', 'room spray', 'car freshener', 'laundry fragrance',
                     'essential oil', 'diffuser oil', 'aromatherapy oil'],
          },
          inject: [{ prefix: '3303.00', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '3303' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PERFUME_FRAGRANCE_OIL_INTENT: created (perfumes/fragrances → 3303.00)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT36)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT36 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
