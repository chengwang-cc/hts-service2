#!/usr/bin/env ts-node
/**
 * Patch MMMM — 2026-03-14:
 *
 * noneOf fixes (15 rules):
 * 1. AI_CH75_NICKEL_STRANDED_WIRE: add audio/speaker context → "Audio cable Bulk 50ft" blocked by 'cable'
 * 2. AI_CH89_FERRY_CARGO_VESSEL: add audio/cable context → blocked by 'bulk'
 * 3. AI_CH67_WIGS_HAIRPIECES: add digital/video/hdmi/grip band → "digital video switch processor" + "wig grip band"
 * 4. AI_CH75_NICKEL_SHEET_PLATE_FOIL: add silicone/wig grip/comic/bed sheet → "wig grip band" + "Batman flat sheet"
 * 5. AI_CH45_CORK_MISC_ARTICLES: add comic/batman/bed sheet → "Batman Twin Flat Sheet" blocked by 'sheet'
 * 6. AI_CH03_SHARK_FIN: add faux/fur/keychain → "Faux Fur Keychain Tail Accessory" blocked by 'tail'
 * 7. AI_CH02_HORSE_MEAT: add door knocker/figurine → "metal Horse Head Door Knocker" blocked by 'horse'
 * 8. INDOOR_PLANT_INTENT: add tote/bag/barong/rice → "Palay (Rice Plant) Barong Tote" blocked by 'plant'
 * 9. AI_CH45_CORK_WALLCOVERING: add shelf/wall shelf/farmhouse → "Rustic Wall Shelf" blocked by 'wall'
 * 10. REFRACTORY_CLAY_CEMENT_INTENT: add figure/figurine → "clay figure" blocked by 'clay'
 * 11. NAIL_RIVET_INTENT: add vinyl/decal/nail art → "vinyl nail decal" blocked by 'nail'
 * 12. AI_CH75_NICKEL_POWDER_FLAKE: add color remover/dyeing → "color remover dyeing powder" blocked by 'powder'
 * 13. AI_CH45_CORK_RAW: add color/dyeing/dye → same query
 * 14. AI_CH36_EXPLOSIVES: add color/dyeing → same query
 * 15. FRESH_FRUIT_INTENT: add canvas/craft kit/embroidery → "Plastic Canvas Craft Kit Cherries"
 *
 * Updates (2 rules):
 * 16. CLOCK_TIMEPIECE_INTENT: add inject for 9102.xx so "Large Green Diamonds Clock" finds ch.91 entries
 * 17. INCENSE_AROMATHERAPY_INTENT: new rule for incense → ch.33 (3307.41)
 *
 * New rules (6):
 * 18. LAPTOP_COMPUTER_BOARD_INTENT (ch.84): motherboard/thinkpad/lenovo board → 8473.30
 * 19. PRINTER_FUSER_DRUM_INTENT (ch.84): fuser/drum unit/lexmark → 8443.99
 * 20. IPOD_MUSIC_PLAYER_INTENT (ch.85): ipod/mp3 player/zune → 8519.81
 * 21. BOOK_NOVEL_PAPERBACK_INTENT (ch.49): softcover/paperback/novel → 4901.99
 * 22. DENTAL_ORAL_INSTRUMENT_INTENT (ch.90): cheek retractor/dental retractor → 9018.49
 * 23. AUDIO_CABLE_WIRE_INTENT (ch.85): audio cable/speaker wire/xlr cable → 8544.42
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14mmmm.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed MMMM: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function addInject(ruleId: string, newInject: any[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const currentInject: any[] = (existing as any).inject ?? [];
      const currentPrefixes = new Set(currentInject.map((i: any) => i.prefix));
      const toAdd = newInject.filter(i => !currentPrefixes.has(i.prefix));
      patches.push({
        priority: (existing as any).priority ?? 500,
        rule: {
          ...existing,
          description: (existing.description ?? ruleId) + ` — Fixed MMMM: ${note}`,
          inject: [...currentInject, ...toAdd],
        },
      });
      console.log(`${ruleId}: adding ${toAdd.length} inject specs`);
    }

    // ── 1. AI_CH75_NICKEL_STRANDED_WIRE: 'cable' fires for "Audio cable Bulk 50ft" ─
    addNoneOf('AI_CH75_NICKEL_STRANDED_WIRE', [
      'audio', 'audio cable', 'speaker', 'headphone', 'rca', 'microphone',
      'patch cable', 'instrument cable', 'stereo cable', 'aux cable', 'xlr',
      'phono', 'line cable', 'cable bulk',
    ], 'audio/speaker context prevents cable rule from blocking audio cables going to ch.85');

    // ── 2. AI_CH89_FERRY_CARGO_VESSEL: 'bulk' fires for "Audio cable Bulk 50ft" ────
    addNoneOf('AI_CH89_FERRY_CARGO_VESSEL', [
      'audio', 'audio cable', 'speaker cable', 'cable bulk', 'wire bulk',
      'bulk cable', 'xlr cable',
    ], 'audio cable context prevents ferry/cargo rule from blocking audio cables');

    // ── 3. AI_CH67_WIGS_HAIRPIECES: 'switch' fires for HDMI processors; 'wig' for grip bands ─
    addNoneOf('AI_CH67_WIGS_HAIRPIECES', [
      'digital', 'video', 'hdmi', 'processor', 'video processor', 'digital video',
      'digital switch', 'signal', 'matrix', 'capture card',
      'grip band', 'wig grip band', 'wig grip', 'non-slip band', 'grip',
    ], 'digital/HDMI context + wig grip band context prevents wig rule from blocking ch.85 video gear and ch.65 headwear');

    // ── 4. AI_CH75_NICKEL_SHEET_PLATE_FOIL: 'band'→wig grip; 'flat'/'sheet'→bed linen ──
    addNoneOf('AI_CH75_NICKEL_SHEET_PLATE_FOIL', [
      'silicone', 'wig grip', 'non-slip', 'grip band', 'wig grip band',
      'comic', 'comics', 'batman', 'superman', 'marvel', 'dc comics',
      'flat sheet', 'bed sheet', 'twin sheet', 'queen sheet', 'king sheet', 'fitted sheet',
      'bed linen', 'pillowcase', 'duvet', 'comforter',
    ], 'silicone/wig grip + comic/bed sheet context prevents nickel foil rule from blocking ch.65 headwear and ch.63 bed linen');

    // ── 5. AI_CH45_CORK_MISC_ARTICLES: 'sheet' fires for "Batman Twin Flat Sheet" ───
    addNoneOf('AI_CH45_CORK_MISC_ARTICLES', [
      'comic', 'comics', 'batman', 'superman', 'marvel', 'dc comics',
      'flat sheet', 'bed sheet', 'twin sheet', 'queen sheet', 'king sheet', 'fitted sheet',
      'bed linen', 'pillowcase', 'duvet', 'comforter', 'cotton sheet',
    ], 'comic/bed sheet context prevents cork-sheet rule from blocking ch.63 bed linen');

    // ── 6. AI_CH03_SHARK_FIN: 'tail'/'head' fires for "Faux Fur Keychain Tail Accessory" ─
    addNoneOf('AI_CH03_SHARK_FIN', [
      'faux', 'faux fur', 'fake fur', 'keychain', 'accessory', 'fur tail',
      'costume tail', 'plush tail', 'cosplay',
    ], 'faux fur/keychain context prevents shark fin rule from blocking faux fur accessories in ch.60');

    // ── 7. AI_CH02_HORSE_MEAT: 'horse' fires for "metal Horse Head Door Knocker" ────
    addNoneOf('AI_CH02_HORSE_MEAT', [
      'door knocker', 'knocker', 'figurine', 'statue', 'sculpture',
      'decor', 'ornament', 'metal horse', 'horse head', 'horse figurine',
    ], 'door knocker/figurine context prevents horse-meat rule from blocking metal hardware in ch.83');

    // ── 8. INDOOR_PLANT_INTENT: 'plant' fires for "Palay (Rice Plant) Barong Tote" ─
    addNoneOf('INDOOR_PLANT_INTENT', [
      'tote', 'bag', 'tote bag', 'barong', 'rice', 'palay', 'rice plant',
    ], 'tote/bag context prevents indoor plant rule from blocking tote bags in ch.42');

    // ── 9. AI_CH45_CORK_WALLCOVERING: 'wall' fires for "Rustic Wall Shelf with Hooks" ─
    addNoneOf('AI_CH45_CORK_WALLCOVERING', [
      'shelf', 'shelves', 'wall shelf', 'wood shelf', 'wooden shelf',
      'farmhouse', 'coat rack', 'hooks', 'hook', 'entryway', 'organizer',
      'reclaimed wood', 'barnwood', 'barn wood',
    ], 'shelf/farmhouse context prevents cork wallcovering from blocking wooden shelves in ch.44');

    // ── 10. REFRACTORY_CLAY_CEMENT_INTENT: 'clay' fires for "clay figure" ──────────
    addNoneOf('REFRACTORY_CLAY_CEMENT_INTENT', [
      'figure', 'figurine', 'clay figure', 'clay doll', 'model',
      'collectible', 'fan art', 'anime', 'game character', 'handcrafted',
      'polymer clay', 'air dry clay',
    ], 'figurine/handcrafted context prevents refractory clay rule from blocking clay art figures in ch.69');

    // ── 11. NAIL_RIVET_INTENT: 'nail' fires for "vinyl nail decal" ───────────────
    addNoneOf('NAIL_RIVET_INTENT', [
      'vinyl', 'decal', 'nail decal', 'nail art', 'nail sticker',
      'nail design', 'adhesive', 'press on', 'press-on nail', 'nail wrap',
      'nail strip',
    ], 'vinyl/decal context prevents nail rivet rule from blocking nail art accessories in ch.39');

    // ── 12. AI_CH75_NICKEL_POWDER_FLAKE: 'powder' fires for "color remover dyeing powder" ─
    addNoneOf('AI_CH75_NICKEL_POWDER_FLAKE', [
      'color remover', 'dye remover', 'hair color', 'dyeing', 'hair dye',
      'color powder', 'bleach powder', 'toner', 'developer',
    ], 'color remover/dyeing context prevents nickel powder rule from blocking hair/dye chemicals in ch.38');

    // ── 13. AI_CH45_CORK_RAW: add color/dyeing context ───────────────────────────
    addNoneOf('AI_CH45_CORK_RAW', [
      'color', 'dyeing', 'dye', 'hair color', 'color remover', 'hair dye',
      'bleach', 'toner',
    ], 'color/dyeing context prevents cork raw rule from blocking dye chemicals');

    // ── 14. AI_CH36_EXPLOSIVES: add color/dyeing context ─────────────────────────
    addNoneOf('AI_CH36_EXPLOSIVES', [
      'color', 'dyeing', 'color remover', 'dye remover', 'hair color', 'hair dye',
    ], 'color/dyeing context prevents explosives rule from blocking dye chemicals');

    // ── 15. FRESH_FRUIT_INTENT: 'cherries' fires for "Plastic Canvas Craft Kit" ──
    addNoneOf('FRESH_FRUIT_INTENT', [
      'canvas', 'plastic canvas', 'craft kit', 'embroidery', 'needlepoint',
      'stitch kit', 'cross stitch', 'counted cross',
    ], 'canvas/craft kit context prevents fresh fruit rule from blocking craft kits in ch.59');

    // ── 16. CLOCK_TIMEPIECE_INTENT: add inject for clock HTS codes ───────────────
    addInject('CLOCK_TIMEPIECE_INTENT', [
      { prefix: '9102.11', syntheticRank: 9 }, // Battery-operated wrist watches, mechanical display
      { prefix: '9102.12', syntheticRank: 8 }, // Battery-operated wrist watches, opto-electronic display
      { prefix: '9102.19', syntheticRank: 8 }, // Other battery-operated wrist watches
      { prefix: '9102.91', syntheticRank: 7 }, // Other clocks, battery-operated
      { prefix: '9102.99', syntheticRank: 7 }, // Other clocks
      { prefix: '9105.21', syntheticRank: 6 }, // Wall clocks, battery operated
    ], 'add inject so fused has clock candidates even when lexical/semantic misses');

    // ── 17. NEW INCENSE_AROMATHERAPY_INTENT ──────────────────────────────────────
    // "Aquamarine - Sense of Incense (Sense of Wonder) Series" → 3307.41 (ch.33)
    patches.push({
      priority: 551,
      rule: {
        id: 'INCENSE_AROMATHERAPY_INTENT',
        description: 'Incense, aromatherapy, and air freshener products → ch.33 (3307.41). ' +
          '"Sense of Incense", "incense sticks", "incense cones" → 3307.41. ' +
          'Without rule, no results for incense product queries.',
        pattern: {
          anyOf: [
            'incense', 'incense stick', 'incense sticks', 'incense cone', 'incense cones',
            'joss stick', 'joss sticks', 'aromatherapy', 'diffuser oil', 'essential oil blend',
            'scented candle', 'reed diffuser', 'room spray', 'air freshener',
          ],
          noneOf: ['candle holder', 'candle jar', 'candle making', 'wax melt'],
        },
        whitelist: { allowChapters: ['33', '34'] },
        inject: [
          { prefix: '3307.41', syntheticRank: 9 }, // Incense
          { prefix: '3307.49', syntheticRank: 8 }, // Other room deodorizers
          { prefix: '3307.10', syntheticRank: 7 }, // Pre-shave / shaving preparations
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3307.41' },
          { delta: 0.4, chapterMatch: '33' },
        ],
      } as IntentRule,
    });

    // ── 18. NEW LAPTOP_COMPUTER_BOARD_INTENT ─────────────────────────────────────
    // "Lenovo ThinkPad T430 T430i Motherboard 04X3639" → 8473.30 (ch.84)
    // "Antminer S19 Hashboard Deflector Baffles" → ch.84
    patches.push({
      priority: 563,
      rule: {
        id: 'LAPTOP_COMPUTER_BOARD_INTENT',
        description: 'Laptop/computer motherboards and mainboards → ch.84 (8473.30). ' +
          '"ThinkPad motherboard", "Lenovo mainboard", "laptop board" → 8473.30. ' +
          'Without rule, fused.size=0 for model-number-heavy board queries.',
        pattern: {
          anyOf: [
            'motherboard', 'mainboard', 'system board', 'logic board', 'main board',
            'thinkpad', 'ideapad', 'latitude board', 'inspiron board',
            'laptop board', 'notebook board', 'hashboard', 'antminer',
            'deflector baffle', 'baffles',
          ],
          noneOf: ['case', 'software', 'adapter', 'charger'],
        },
        whitelist: { allowChapters: ['84', '85'] },
        inject: [
          { prefix: '8473.30', syntheticRank: 9 }, // Parts for computers
          { prefix: '8471.30', syntheticRank: 8 }, // Portable computers
          { prefix: '8543.70', syntheticRank: 7 }, // Other electrical machines
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8473.30' },
          { delta: 0.4, chapterMatch: '84' },
        ],
      } as IntentRule,
    });

    // ── 19. NEW PRINTER_FUSER_DRUM_INTENT ────────────────────────────────────────
    // "Dell Lexmark Fuser DRU0443" → 8443.99 (ch.84)
    patches.push({
      priority: 561,
      rule: {
        id: 'PRINTER_FUSER_DRUM_INTENT',
        description: 'Printer fuser units, drum units, and printer parts → ch.84 (8443.99). ' +
          '"Lexmark fuser", "HP drum unit", "printer fuser" → 8443.99. ' +
          'Without rule, fused.size=0 for part-number-heavy printer queries.',
        pattern: {
          anyOf: [
            'fuser', 'fuser unit', 'fuser assembly', 'fuser roller',
            'drum unit', 'drum cartridge', 'imaging drum', 'developer unit',
            'lexmark', 'printhead', 'print head',
            'transfer belt', 'imaging unit',
          ],
          noneOf: ['ink', 'toner cartridge', 'ink cartridge'],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [
          { prefix: '8443.99', syntheticRank: 9 }, // Parts for printers
          { prefix: '8443.32', syntheticRank: 8 }, // Inkjet printers
          { prefix: '8443.39', syntheticRank: 7 }, // Other printers
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8443.99' },
          { delta: 0.4, chapterMatch: '84' },
        ],
      } as IntentRule,
    });

    // ── 20. NEW IPOD_MUSIC_PLAYER_INTENT ─────────────────────────────────────────
    // "Ipod Shuffle Second Generation 1 gig" → 8519.81 (ch.85)
    patches.push({
      priority: 558,
      rule: {
        id: 'IPOD_MUSIC_PLAYER_INTENT',
        description: 'iPod, MP3 players, and portable music players → ch.85 (8519.81). ' +
          '"iPod Shuffle", "iPod nano", "MP3 player" → 8519.81. ' +
          'Without rule, semantic returns petroleum or wrong chapter.',
        pattern: {
          anyOf: [
            'ipod', 'mp3 player', 'mp3 players', 'mp4 player', 'zune',
            'ipod shuffle', 'ipod nano', 'ipod touch', 'ipod classic',
            'portable music player', 'portable audio player', 'digital audio player',
            'walkman', 'discman',
          ],
          noneOf: ['software', 'app', 'subscription', 'streaming'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8519.81', syntheticRank: 9 }, // Sound recording/reproducing apparatus
          { prefix: '8519.89', syntheticRank: 8 }, // Other sound reproducing apparatus
          { prefix: '8527.91', syntheticRank: 7 }, // Radio-broadcast receivers
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8519.81' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 21. NEW BOOK_NOVEL_PAPERBACK_INTENT ──────────────────────────────────────
    // "SOFTCOVER NOVEL" → 4901.99 (ch.49)
    patches.push({
      priority: 554,
      rule: {
        id: 'BOOK_NOVEL_PAPERBACK_INTENT',
        description: 'Paperback/softcover books and novels → ch.49 (4901.99). ' +
          '"Softcover novel", "paperback book", "hardcover" → 4901.99. ' +
          'Without rule, fused.size=0 for generic book queries.',
        pattern: {
          anyOf: [
            'softcover', 'soft cover', 'paperback', 'hardcover', 'hard cover',
            'novel', 'paperback novel', 'softcover novel', 'fiction novel',
            'textbook', 'workbook',
          ],
          noneOf: ['ebook', 'digital book', 'kindle', 'pdf'],
        },
        whitelist: { allowChapters: ['49'] },
        inject: [
          { prefix: '4901.99', syntheticRank: 9 }, // Other printed books
          { prefix: '4901.10', syntheticRank: 8 }, // Books in single sheets
          { prefix: '4901.91', syntheticRank: 7 }, // Dictionaries and encyclopedias
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4901.99' },
          { delta: 0.4, chapterMatch: '49' },
        ],
      } as IntentRule,
    });

    // ── 22. NEW DENTAL_ORAL_INSTRUMENT_INTENT ────────────────────────────────────
    // "Cheek Retractors" → 9018.49 (ch.90)
    patches.push({
      priority: 570,
      rule: {
        id: 'DENTAL_ORAL_INSTRUMENT_INTENT',
        description: 'Dental and oral instruments/tools → ch.90 (9018.49). ' +
          '"Cheek retractors", "dental retractor", "cheek spreader" → 9018.49. ' +
          'Without rule, fused.size=0 for specialized dental tool queries.',
        pattern: {
          anyOf: [
            'cheek retractor', 'cheek retractors', 'cheek spreader',
            'dental retractor', 'lip retractor', 'mouth retractor',
            'dental mirror', 'dental probe', 'dental explorer', 'dental scaler',
            'orthodontic tool', 'orthodontic instrument', 'dental instrument',
            'intraoral', 'mouth prop', 'bite block',
          ],
          noneOf: ['software', 'subscription'],
        },
        whitelist: { allowChapters: ['90'] },
        inject: [
          { prefix: '9018.49', syntheticRank: 9 }, // Other dental instruments
          { prefix: '9018.41', syntheticRank: 8 }, // Dental drill engines
          { prefix: '9021.10', syntheticRank: 7 }, // Orthopedic appliances
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '9018.49' },
          { delta: 0.4, chapterMatch: '90' },
        ],
      } as IntentRule,
    });

    // ── 23. NEW AUDIO_CABLE_WIRE_INTENT ──────────────────────────────────────────
    // "Audio cable Bulk 50ft" → 8544.42 (ch.85)
    patches.push({
      priority: 576,
      rule: {
        id: 'AUDIO_CABLE_WIRE_INTENT',
        description: 'Audio cables, speaker wire, instrument cables → ch.85 (8544.42). ' +
          '"Audio cable bulk", "XLR cable", "speaker wire", "patch cable" → 8544.42. ' +
          'Without rule, AI_CH75_NICKEL_STRANDED_WIRE blocks for "cable", AI_CH89 blocks for "bulk".',
        pattern: {
          anyOf: [
            'audio cable', 'speaker cable', 'speaker wire', 'xlr cable', 'xlr',
            'patch cable', 'instrument cable', 'stereo cable', 'aux cable',
            'rca cable', 'coaxial cable', 'microphone cable',
            'bulk cable', 'cable bulk', 'wire bulk',
            'optical cable', 'toslink',
          ],
          noneOf: ['software', 'subscription'],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8544.42', syntheticRank: 9 }, // Electric conductors, fitted with connectors, ≤80V
          { prefix: '8544.49', syntheticRank: 8 }, // Other electric conductors, ≤1000V
          { prefix: '8544.60', syntheticRank: 7 }, // Electric conductors, >1000V
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8544.42' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch MMMM)...`);
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
    console.log(`\nPatch MMMM complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
