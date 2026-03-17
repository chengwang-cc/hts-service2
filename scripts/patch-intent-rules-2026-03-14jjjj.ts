#!/usr/bin/env ts-node
/**
 * Patch JJJJ — 2026-03-14:
 *
 * Fix EMPTY cases by adding noneOf to blocking rules and adding new intent rules:
 *
 * noneOf fixes:
 * 1. AI_CH13_NATURAL_GUMS_RESINS: add magnet/fridge/3d-printer/duct/adapter
 *    'resin' fires → blocks ch.85/39 for "man resin fridge magnet", "exhaust duct adapter elegoo resin 3d printer"
 *
 * 2. AI_CH67_WIGS_HAIRPIECES: add electrical/switch context + rotary/laser/plate/extension
 *    'switch' fires → blocks ch.85 for "heated seat switch"
 *    'extension' fires → blocks ch.84 for "laser rotary extension plate"
 *
 * 3. AI_CH40_CONDOM: add knife/dagger/sword/blade/damascus context
 *    'sheath' fires → blocks ch.85 for "damascus steel camping tool leather sheath"
 *
 * 4. SCREW_BOLT_INTENT: add guard/cnc/router context
 *    'screw' fires → blocks ch.84 for "ball screw guards onefinity elite foreman"
 *
 * 5. AI_CH19_WAFFLE_WAFER: add speaker/audio context
 *    'cone' fires → blocks ch.90 for "custom made ccb 617c cone" (speaker replacement cone)
 *
 * 6. PHOTO_ALBUM_INTENT: add leatherette context
 *    'photo album' fires → blocks ch.39 for "14x11 photo album leatherette cover"
 *
 * 7. AI_CH17_INVERT_SUGAR: add comics/card context
 *    'golden' fires → blocks ch.49 for "golden age of comics insert card"
 *
 * 8. FRESH_FRUIT_INTENT: add card/baby-shower context
 *    'fruit' fires → blocks ch.49 for "40 weeks baby bump accordion card fruit"
 *
 * 9. FRESH_VEGETABLE_INTENT: add card context
 *    'vegetable' fires → blocks ch.49 for same accordion card query
 *
 * 10. AI_CH47_RECOVERED_PAPER: add poster/print/signed context
 *    'newsprint' fires → blocks ch.49 for "silver snail anniversary newsprint poster signed"
 *
 * 11. AI_CH51_RAW_WOOL: add knitted/outfit/doll context
 *    'wool' fires → blocks ch.62 for "hand knitted wool outfit for a doll"
 *
 * 12. DOLL_TOY_INTENT: add outfit/needlepoint context
 *    'doll' fires → blocks ch.62/39 for "hand knitted wool outfit for a doll" and "handmade needlepoint doll"
 *
 * 13. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: add tarot/teeth/altar context
 *    'bone' fires → blocks ch.55 for "tarot cloth teeth and bone"
 *
 * 14. AI_CH75_NICKEL_MESH_CLOTH: add tarot/altar context
 *    'cloth' fires → blocks ch.55 for "tarot cloth"
 *
 * 15. AI_CH03_FISH_MEAL_FLOUR: add limited-edition/cup/collectible context
 *    'meal' fires → blocks ch.48 for "OVO Cup McDonalds drake meal"
 *
 * 16. AI_CH11_SEMOLINA_GROATS: add limited-edition/cup context
 *    'meal' fires → blocks ch.48 for same query
 *
 * 17. AI_CH75_NICKEL_POWDER_FLAKE: add coating/sanding/anodizing context
 *    'powder' fires → blocks ch.39 for "powder coating protective tape"
 *
 * 18. AI_CH45_CORK_RAW: add coating/sanding/tape context
 *    'powder'/'raw' fires → blocks ch.39 for "powder coating protective tape"
 *
 * 19. AI_CH36_EXPLOSIVES: add coating/tape context
 *    'powder' fires → blocks ch.39 for "sanding anodizing powder coating tape"
 *
 * 20. AI_CH75_NICKEL_SHEET_PLATE_FOIL: add laser/rotary/fixture context
 *    'plate' fires → blocks ch.84 for "laser rotary extension plate"
 *
 * New intent rules:
 * 21. NEW SYNTHETIC_BRAIDING_HAIR_INTENT (ch.55): freetress/kanekalon/braiding hair → 5503.20
 * 22. NEW AUTOMOTIVE_MEDIA_PRESS_KIT_INTENT (ch.85): press kit → 8523.49
 * 23. NEW CAMERA_PARTS_ACCESSORIES_INTENT (ch.90): graflex/dslr pcb/camera adapter → 9006.91/9007.91
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14jjjj.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed JJJJ: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH13_NATURAL_GUMS_RESINS: resin fires for 3D-printer/magnet queries ──
    // 'resin' as in "resin 3D printer" (SLA printing) or "resin fridge magnet" is NOT natural gum
    addNoneOf('AI_CH13_NATURAL_GUMS_RESINS', [
      'magnet', 'magnets', 'fridge magnet', 'fridge magnets', 'refrigerator magnet',
      '3d', '3d printer', '3d printers', 'printer', 'sla printer', 'dlp printer',
      'duct', 'adapter', 'filament', 'uv resin', 'photopolymer',
      'mold', 'mould', 'casting resin', 'epoxy resin',
    ], 'magnet/3d-printer/duct context prevents natural-gum rule blocking ch.85/39');

    // ── 2. AI_CH67_WIGS_HAIRPIECES: switch/extension fire for non-wig items ────────
    // 'switch' (in anyOf) fires for "heated seat switch" → ch.67 blocks ch.85
    // 'extension' fires for "laser rotary extension plate" → ch.67 blocks ch.84
    addNoneOf('AI_CH67_WIGS_HAIRPIECES', [
      'electrical', 'light switch', 'light switches', 'heated seat', 'seat switch',
      'toggle switch', 'rocker switch', 'dimmer switch', 'dimmer',
      'rotary', 'laser', 'fixture', 'fixture plate', 'extension plate', 'extension cord',
      'cord', 'cable', 'wiring', 'wire',
      'seat', 'automotive', 'vehicle', 'car',
    ], 'electrical/rotary/laser context prevents wig rule blocking ch.85/84');

    // ── 3. AI_CH40_CONDOM: sheath fires for knife/sword sheaths ─────────────────────
    // 'sheath' fires for "damascus steel camping tool leather sheath" → ch.40 blocks ch.85
    addNoneOf('AI_CH40_CONDOM', [
      'knife', 'knives', 'dagger', 'daggers', 'sword', 'swords',
      'blade', 'blades', 'damascus', 'steel', 'tool',
      'camping', 'hunting', 'tactical', 'leather sheath', 'knife sheath',
      'scabbard', 'belt sheath',
    ], 'knife/sword/damascus context prevents condom rule blocking leather knife sheaths');

    // ── 4. SCREW_BOLT_INTENT: screw fires for machine guard queries ──────────────────
    // 'screw' fires for "ball screw guards onefinity elite foreman" → ch.73 blocks ch.84
    addNoneOf('SCREW_BOLT_INTENT', [
      'guard', 'guards', 'ball screw guard', 'cnc guard', 'way cover',
      'bellows', 'way cover', 'machine guard', 'way guards',
    ], 'guard/cnc context prevents screw-bolt rule blocking machine parts in ch.84');

    // ── 5. AI_CH19_WAFFLE_WAFER: cone fires for speaker cone queries ─────────────────
    // 'cone' fires for "custom made ccb 617c cone" (speaker replacement cone) → ch.19 blocks ch.90
    addNoneOf('AI_CH19_WAFFLE_WAFER', [
      'speaker', 'loudspeaker', 'speaker cone', 'woofer', 'tweeter', 'subwoofer',
      'audio driver', 'driver', 'driver cone', 'voice coil', 'surround',
    ], 'speaker/audio context prevents waffle-wafer rule blocking speaker cones in ch.90');

    // ── 6. PHOTO_ALBUM_INTENT: photo album fires for plastic cover products ──────────
    // 'photo album' fires for "14x11 photo album leatherette cover" → ch.49 blocks ch.39
    // The leatherette cover is a plastic product (3926), not the complete printed album
    addNoneOf('PHOTO_ALBUM_INTENT', [
      'leatherette', 'leatherette cover', 'faux leather', 'pu leather',
      'vinyl cover', 'plastic cover', 'cover only', 'replacement cover',
    ], 'leatherette cover prevents photo-album ch.49 rule blocking plastic album covers in ch.39');

    // ── 7. AI_CH17_INVERT_SUGAR: golden fires for "golden age of comics" ────────────
    // 'golden' is in anyOf → fires for "1995 golden age of comics magnachrome insert card"
    addNoneOf('AI_CH17_INVERT_SUGAR', [
      'comics', 'comic', 'trading card', 'insert card', 'baseball card', 'sports card',
      'age of comics', 'chromium card', 'magnachrome', 'card set',
    ], 'comics/trading-card context prevents golden-syrup rule blocking printed cards in ch.49');

    // ── 8. FRESH_FRUIT_INTENT: fruit fires for accordion/baby-shower cards ──────────
    // 'fruit' fires for "40 weeks baby bump accordion card fruit and vegetable pregnancy..."
    addNoneOf('FRESH_FRUIT_INTENT', [
      'card', 'greeting card', 'accordion card', 'baby shower card', 'pregnancy card',
      'baby bump card', 'shower card', 'gift card', 'milestone card',
    ], 'card/baby-shower context prevents fresh-fruit rule blocking printed cards in ch.49');

    // ── 9. FRESH_VEGETABLE_INTENT: vegetable fires for same card query ───────────────
    addNoneOf('FRESH_VEGETABLE_INTENT', [
      'card', 'greeting card', 'accordion card', 'baby shower card', 'pregnancy card',
      'baby bump card', 'shower card', 'gift card', 'milestone card',
    ], 'card/baby-shower context prevents fresh-vegetable rule blocking printed cards in ch.49');

    // ── 10. AI_CH47_RECOVERED_PAPER: newsprint fires for vintage posters ────────────
    // 'newsprint' fires for "2007 silver snail 31st anniversary newsprint poster signed adam hughes"
    addNoneOf('AI_CH47_RECOVERED_PAPER', [
      'poster', 'posters', 'art print', 'art poster', 'print', 'prints',
      'signed', 'artist signed', 'vintage poster', 'lithograph', 'anniversary poster',
      'limited edition poster', 'movie poster', 'comic poster',
    ], 'poster/signed/art-print context prevents recovered-paper rule blocking printed art in ch.49');

    // ── 11. AI_CH51_RAW_WOOL: wool fires for knitted garments/doll outfits ──────────
    // 'wool' fires for "hand knitted wool outfit for a doll" → ch.51 blocks ch.62
    // noneOf already has 'knit' but NOT 'knitted' (token mismatch)
    addNoneOf('AI_CH51_RAW_WOOL', [
      'knitted', 'crocheted', 'outfit', 'outfits', 'doll outfit', 'doll clothes',
      'garment', 'clothing', 'apparel', 'jumper', 'pullover',
    ], 'knitted/outfit/garment context prevents raw-wool rule blocking knitted garments in ch.62');

    // ── 12. DOLL_TOY_INTENT: doll fires for doll-outfit and needlepoint ─────────────
    // 'doll' fires for "hand knitted wool outfit for a doll" → blocks ch.62 (doll clothing 6209.90)
    // 'doll' fires for "handmade needlepoint doll" → blocks ch.39 (needlepoint canvas 3921)
    addNoneOf('DOLL_TOY_INTENT', [
      'outfit', 'doll outfit', 'doll clothes', 'doll clothing', 'clothes for doll',
      'needlepoint', 'needlepoint canvas', 'embroidery canvas', 'canvas kit',
      'sewing pattern', 'knitted outfit',
    ], 'outfit/needlepoint context prevents doll-toy rule blocking garments/canvas in ch.62/39');

    // ── 13. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: bone fires for tarot items ───────────
    // 'bone' fires for "tarot cloth teeth and bone" → ch.31 blocks ch.55
    addNoneOf('AI_CH31_ORGANIC_ANIMAL_FERTILIZER', [
      'teeth', 'skull', 'tarot', 'altar', 'altar cloth', 'wicca', 'witchcraft',
      'oracle', 'occult', 'metaphysical', 'crystal',
    ], 'tarot/altar/teeth context prevents bone-fertilizer rule blocking altar cloths in ch.55');

    // ── 14. AI_CH75_NICKEL_MESH_CLOTH: cloth fires for tarot/altar items ─────────────
    // 'cloth' fires for "tarot cloth teeth and bone" → ch.75 blocks ch.55
    addNoneOf('AI_CH75_NICKEL_MESH_CLOTH', [
      'tarot', 'altar', 'altar cloth', 'wicca', 'oracle', 'occult',
      'crystal', 'metaphysical', 'witchcraft', 'pagan',
    ], 'tarot/altar context prevents nickel-mesh rule blocking woven textiles in ch.55');

    // ── 15. AI_CH03_FISH_MEAL_FLOUR: meal fires for collectible cups ─────────────────
    // 'meal' fires for "OVO Cup McDonalds Limited Edition Drake Meal After Hours"
    addNoneOf('AI_CH03_FISH_MEAL_FLOUR', [
      'cup', 'limited edition', 'edition', 'collectible', 'promotional', 'promo',
      'mcdonalds', 'fast food', 'beverage cup', 'set of', 'licensed', 'merch',
      'merchandise', 'collab', 'collaboration',
    ], 'collectible-cup/limited-edition context prevents fish-meal rule blocking paper cups in ch.48');

    // ── 16. AI_CH11_SEMOLINA_GROATS: meal fires for collectible cups ─────────────────
    // 'meal' fires for same OVO Cup query
    addNoneOf('AI_CH11_SEMOLINA_GROATS', [
      'cup', 'limited edition', 'edition', 'collectible', 'promotional', 'promo',
      'mcdonalds', 'fast food', 'beverage cup', 'licensed', 'merch',
    ], 'collectible-cup/limited-edition context prevents semolina rule blocking paper cups in ch.48');

    // ── 17. AI_CH75_NICKEL_POWDER_FLAKE: powder fires for coating/sanding ───────────
    // 'powder' fires for "sanding anodizing powder coating protective tape ring makers tape"
    addNoneOf('AI_CH75_NICKEL_POWDER_FLAKE', [
      'coating', 'powder coating', 'coat', 'sanding', 'anodizing', 'anodize',
      'tape', 'protective', 'protective tape', 'paint', 'spray paint',
      'cosmetic', 'face powder', 'eyeshadow', 'blush', 'pigment', 'mica',
    ], 'coating/sanding/cosmetic context prevents nickel-powder rule blocking protective tapes in ch.39');

    // ── 18. AI_CH45_CORK_RAW: powder/raw fires for sanding/coating queries ──────────
    // 'powder' fires for "sanding anodizing powder coating protective tape"
    addNoneOf('AI_CH45_CORK_RAW', [
      'coating', 'powder coating', 'tape', 'anodizing', 'sanding', 'protective',
      'paint', 'primer', 'plating', 'galvanizing',
    ], 'coating/sanding/tape context prevents cork-raw rule blocking protective tapes in ch.39');

    // ── 19. AI_CH36_EXPLOSIVES: powder fires for coating/sanding queries ────────────
    // 'powder' fires for "sanding anodizing powder coating protective tape"
    addNoneOf('AI_CH36_EXPLOSIVES', [
      'coating', 'powder coating', 'tape', 'anodizing', 'sanding', 'protective',
      'ring makers', 'paint', 'plating',
    ], 'coating/sanding/tape context prevents explosives rule blocking protective tapes in ch.39');

    // ── 20. AI_CH75_NICKEL_SHEET_PLATE_FOIL: plate fires for machine parts ──────────
    // 'plate' fires for "laser rotary extension plate fixture plate" → ch.75 blocks ch.84
    addNoneOf('AI_CH75_NICKEL_SHEET_PLATE_FOIL', [
      'laser', 'laser rotary', 'rotary', 'fixture', 'fixture plate', 'extension plate',
      'cnc', 'routing', 'router', 'machine', 'machinery', 'tool plate',
      'spoilboard', 'wasteboard', 'mounting plate', 'jig', 'workholding',
    ], 'laser/rotary/fixture context prevents nickel-plate rule blocking CNC machine parts in ch.84');

    // ── 21. NEW SYNTHETIC_BRAIDING_HAIR_INTENT ─────────────────────────────────────
    // "Freetress 3X Clean Therapy Braiding Hair - 1B/52" → 5503.20 (synthetic staple fibers)
    // Expected ch.55; without rule, ch.96/90 (hair accessories/medical) rank higher
    patches.push({
      priority: 561,
      rule: {
        id: 'SYNTHETIC_BRAIDING_HAIR_INTENT',
        description: 'Synthetic braiding hair, kanekalon, hair extensions → ch.55 (5503.20). ' +
          '"Freetress braiding hair", "kanekalon jumbo braid" → 5503.20 (synthetic staple fibers). ' +
          'Without rule, hair accessories (ch.96) or medical (ch.90) rank higher.',
        pattern: {
          anyOf: [
            'braiding hair', 'kanekalon', 'freetress', 'synthetic braid',
            'jumbo braid', 'box braid hair', 'crochet braid',
            'marley hair', 'senegalese twist hair', 'loc extension',
            'kinky twist', 'afro twist', 'water wave braid',
          ],
        },
        whitelist: { allowChapters: ['55', '67'] },
        inject: [
          { prefix: '5503.20', syntheticRank: 9 }, // Synthetic staple fibers of polyesters
          { prefix: '5503.30', syntheticRank: 8 }, // Acrylic/modacrylic
          { prefix: '6703.00', syntheticRank: 7 }, // Human hair prepared for wigs
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '5503.20' },
          { delta: 0.4, chapterMatch: '55' },
        ],
      } as IntentRule,
    });

    // ── 22. NEW AUTOMOTIVE_MEDIA_PRESS_KIT_INTENT ─────────────────────────────────
    // "2005 Infiniti G35 Q45 FX35 FX45 QX56 Kuraza Concept 2006 M35 M45 Press Kit" → 8523.49 (ch.85)
    // Press kits = optical media (DVDs/CDs) for automotive media/marketing → 8523.49.40
    patches.push({
      priority: 574,
      rule: {
        id: 'AUTOMOTIVE_MEDIA_PRESS_KIT_INTENT',
        description: 'Automotive/media press kits → ch.85 (8523.49). ' +
          '"Infiniti G35 Press Kit", "Honda press kit" → 8523.49 (optical/solid-state media). ' +
          'Without rule, ch.96 fasteners or ch.84 machinery rank higher.',
        pattern: {
          anyOf: [
            'press kit', 'presskit', 'media kit', 'press package',
            'promo kit', 'promotional kit', 'media package',
          ],
          noneOf: ['screwdriver', 'kit bag', 'tool kit', 'repair kit', 'first aid'],
        },
        whitelist: { allowChapters: ['85', '49'] },
        inject: [
          { prefix: '8523.49', syntheticRank: 9 }, // Optical media / solid-state storage
          { prefix: '8523.29', syntheticRank: 8 }, // Other magnetic media
          { prefix: '4911.99', syntheticRank: 7 }, // Other printed matter
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8523.49' },
          { delta: 0.3, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 23. NEW CAMERA_PARTS_ACCESSORIES_INTENT ───────────────────────────────────
    // "2x3 to 4x5 Graflex Graphic Crown or Speed Pacemaker adapter" → 9006.91 (ch.90)
    // "CUSED CANON DSLR EOS MAIN PCB ASSY ORIGINAL PART" → 9007.91 (ch.90)
    // Camera adapter, PCB, parts → ch.90 (photographic equipment parts)
    patches.push({
      priority: 571,
      rule: {
        id: 'CAMERA_PARTS_ACCESSORIES_INTENT',
        description: 'Camera parts, adapters, PCBs → ch.90 (9006.91/9007.91). ' +
          '"Graflex adapter", "Canon DSLR PCB", "camera lens adapter" → 9006.91/9007.91. ' +
          'Without rule, ch.27/26 (petroleum/minerals) rank higher.',
        pattern: {
          anyOf: [
            'graflex', 'dslr pcb', 'camera pcb', 'camera main board',
            'dslr main board', 'eos pcb', 'camera assy', 'camera parts',
            'pacemaker adapter', 'speed pacemaker', 'lens adapter', 'camera adapter',
            'speed graphic', 'crown graphic', 'view camera',
            'cinema camera', 'film back', 'digital back',
          ],
          noneOf: ['tripod', 'bag', 'strap'],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [
          { prefix: '9006.91', syntheticRank: 9 }, // Parts/accessories for cameras
          { prefix: '9007.91', syntheticRank: 8 }, // Parts for cinematographic cameras
          { prefix: '9006.59', syntheticRank: 7 }, // Other cameras
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9006.91' },
          { delta: 0.5, prefixMatch: '9007.91' },
          { delta: 0.4, chapterMatch: '90' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch JJJJ)...`);
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
    console.log(`\nPatch JJJJ complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
