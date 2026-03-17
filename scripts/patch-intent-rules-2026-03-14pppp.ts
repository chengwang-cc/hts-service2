#!/usr/bin/env ts-node
/**
 * Patch PPPP — 2026-03-14:
 *
 * noneOf fixes (22 rules):
 * 1. AI_CH75_NICKEL_MESH_CLOTH: add dog/cat/pet toy context
 * 2. AI_CH40_PET_TOY_RUBBER: add dog/cat context (ch.40 shouldn't block pet toys in ch.42)
 * 3. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: add cat toy/feather toy context (feather in anyOf)
 * 4. AI_CH91_POCKET_WATCH: add key fob/leather case context (fob in anyOf)
 * 5-7. AI_CH45_CORK_RAW + AI_CH36_EXPLOSIVES + AI_CH75_NICKEL_POWDER_FLAKE: add scour/scouring
 * 8. AI_CH66_TELESCOPIC_UMBRELLA: add cargo/carrier/webbing/door context (collapsible/travel in anyOf)
 * 9. AI_CH89_FERRY_CARGO_VESSEL: add carrier/hitch/roof rack context (cargo in anyOf)
 * 10. AI_CH59_COATED_FABRIC_PVC_PU: add slider/metal slider context (nylon+coated → blocks ch.96 sliders)
 * 11. AI_CH13_NATURAL_GUMS_RESINS: add 'magn' (abbreviated magnet)
 * 12. AI_CH91_MARINE_CHRONOMETER: add shelf/coat rack/farmhouse context (nautical in anyOf)
 * 13. CEMENT_CONCRETE_INTENT: add shave/bowl context (concrete in anyOf)
 * 14. AI_CH58_RIBBON_TRIM: add shell/easter/craft kit context (ribbon in anyOf)
 * 15. AI_CH66_WALKING_STICK: add neck/guitar context (swagger in anyOf)
 * 16. AI_CH45_CORK_MISC_ARTICLES: add nikah/calligraphy/baby breath context (tray in anyOf)
 * 17-18. AI_CH03_SMOKED_DRIED_SALTED_FISH + AI_CH02_SALTED_CURED_MEAT: add flower/nikah context
 * 19. FRESH_FRUIT_INTENT: add mousepad/kawaii/aesthetic context (strawberry in anyOf)
 * 20-21. AI_CH24_TOBACCO_EXTRACTS + AI_CH13_VEGETABLE_EXTRACTS: add tan/tanning/glass btl context
 * 22. AI_CH67_WIGS_HAIRPIECES: add 'faces' to noneOf ("36 Toppers - 6 Faces" → ch.95)
 *
 * New rules (5):
 * 23. PET_TOY_SUPPLY_INTENT (ch.42): dog toy/cat toy/squeaky toy → 4201.00
 * 24. COFFEE_SINGLE_ORIGIN_INTENT (ch.09): coffee/arabica/espresso → 0901.21
 * 25. PHOTOGRAPHY_PORTRAIT_INTENT (ch.37): portrait/family portrait → 3705.00
 * 26. ENCODER_INDUSTRIAL_INTENT (ch.85): encoder/step encoder/rotary encoder → 8543.70
 * 27. MOUSEPAD_DESK_PAD_INTENT (ch.59): mousepad/mouse pad/desk mat → 5911.90
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14pppp.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed PPPP: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH75_NICKEL_MESH_CLOTH: 'cloth' fires for "cloth dog toy" ─────────
    addNoneOf('AI_CH75_NICKEL_MESH_CLOTH', [
      'dog toy', 'cat toy', 'pet toy', 'chew toy', 'squeaky toy', 'dog toys', 'cat toys',
    ], 'pet toy context prevents nickel mesh rule from blocking ch.42 pet equipment');

    // ── 2. AI_CH40_PET_TOY_RUBBER: 'squeaky'/'chew' fires for dog toys ──────────
    // Expected ch.42 (4201 saddlery/pet equipment), not ch.40 (rubber)
    addNoneOf('AI_CH40_PET_TOY_RUBBER', [
      'dog toy', 'cat toy', 'dog', 'cat', 'dog chew', 'cat chew', 'pet toy',
    ], 'dog/cat context prevents rubber pet-toy rule from blocking ch.42 pet equipment');

    // ── 3. AI_CH31_ORGANIC_ANIMAL_FERTILIZER: 'feather' fires for cat toys ───────
    addNoneOf('AI_CH31_ORGANIC_ANIMAL_FERTILIZER', [
      'cat toy', 'pet toy', 'feather toy', 'feather wand', 'cat wand', 'feather teaser',
      'toy feather', 'interactive toy',
    ], 'cat toy/feather wand context prevents fertilizer rule from blocking ch.42 pet toys');

    // ── 4. AI_CH91_POCKET_WATCH: 'fob' fires for key fob (leather goods) ────────
    addNoneOf('AI_CH91_POCKET_WATCH', [
      'key fob', 'key holder', 'key case', 'leather case', 'remote fob', 'car key fob',
      'leather fob', 'key ring fob',
    ], 'key fob/leather case context prevents pocket watch rule from blocking ch.41 leather goods');

    // ── 5-7. Powder/scour rules: 'powder'/'crushed' fires for scouring powder ────
    const scourTerms = ['scour', 'scouring', 'scour powder', 'scouring powder', 'scouring agent'];
    addNoneOf('AI_CH45_CORK_RAW', scourTerms,
      'scouring context prevents cork raw rule from blocking ch.34 cleaning powders');
    addNoneOf('AI_CH36_EXPLOSIVES', scourTerms,
      'scouring context prevents explosives rule from blocking ch.34 cleaning powders');
    addNoneOf('AI_CH75_NICKEL_POWDER_FLAKE', scourTerms,
      'scouring context prevents nickel powder rule from blocking ch.34 cleaning powders');

    // ── 8. AI_CH66_TELESCOPIC_UMBRELLA: 'collapsible'/'travel' fires ──────────────
    // "Cargo Carrier, Collapsible" → ch.87 (vehicle attachments)
    // "Door Webbing Travel Accessory" → ch.76 (aluminum)
    addNoneOf('AI_CH66_TELESCOPIC_UMBRELLA', [
      'cargo', 'cargo carrier', 'hitch carrier', 'carrier', 'webbing', 'door webbing',
      'vehicle rack', 'bike carrier', 'roof rack', 'hitch', 'hitch mount',
      'luggage rack', 'door', 'door accessory',
    ], 'cargo/carrier/webbing context prevents telescopic umbrella rule from blocking vehicle accessories');

    // ── 9. AI_CH89_FERRY_CARGO_VESSEL: 'cargo' fires for cargo carriers ──────────
    addNoneOf('AI_CH89_FERRY_CARGO_VESSEL', [
      'carrier', 'cargo carrier', 'hitch carrier', 'hitch', 'roof rack', 'bike carrier',
      'vehicle carrier', 'luggage carrier',
    ], 'carrier/hitch context prevents cargo vessel rule from blocking vehicle cargo carriers in ch.87');

    // ── 10. AI_CH59_COATED_FABRIC_PVC_PU: nylon+coated fires for metal sliders ──
    // "RM - Nylon Coated Metal Sliders Rings" → ch.96 (miscellaneous articles)
    addNoneOf('AI_CH59_COATED_FABRIC_PVC_PU', [
      'slider', 'sliders', 'metal slider', 'zipper slider', 'metal ring', 'slide ring',
      'coated metal', 'nylon coated metal',
    ], 'metal slider context prevents coated fabric rule from blocking ch.96 metal sliders');

    // ── 11. AI_CH13_NATURAL_GUMS_RESINS: 'resin' fires for "fridge magn" (abbrev) ─
    // Already has 'magnet', 'fridge magnet' in noneOf but abbreviated 'magn' is a token
    addNoneOf('AI_CH13_NATURAL_GUMS_RESINS', [
      'magn',
    ], 'abbreviated magn (magnet) context prevents natural gums rule from blocking ch.85 fridge magnets');

    // ── 12. AI_CH91_MARINE_CHRONOMETER: 'nautical' fires for nautical decor ───────
    // "Rustic Farmhouse Wall Shelf... Nautical Coastal Blue White Gray Coat Rack" → ch.44
    addNoneOf('AI_CH91_MARINE_CHRONOMETER', [
      'shelf', 'wall shelf', 'coat rack', 'entryway', 'farmhouse', 'home decor',
      'hook', 'wall hook', 'wall organizer', 'coastal decor',
    ], 'shelf/coat rack/farmhouse context prevents marine chronometer rule from blocking ch.44 wood shelves');

    // ── 13. CEMENT_CONCRETE_INTENT: 'concrete' fires for shave bowl ──────────────
    // "CONCRETE SHAVE BOWL/BRUSH" → ch.68 (articles of stone, plaster, cement)
    addNoneOf('CEMENT_CONCRETE_INTENT', [
      'shave', 'shaving', 'shave bowl', 'shaving mug', 'shaving brush', 'bathroom',
      'bowl', 'mug', 'trinket', 'decor',
    ], 'shave/bowl context prevents cement rule from blocking ch.68 decorative concrete items');

    // ── 14. AI_CH58_RIBBON_TRIM: 'ribbon'/'ribbons' fires for Easter craft kits ──
    // "Easter craftkit: colorful paper, shells, ribbons" → ch.68
    addNoneOf('AI_CH58_RIBBON_TRIM', [
      'shell', 'shells', 'easter', 'craft kit', 'craftkit', 'craft supplies', 'paper craft',
      'colorful paper', 'mixed media',
    ], 'shell/easter/craft kit context prevents ribbon rule from blocking ch.68 craft kits');

    // ── 15. AI_CH66_WALKING_STICK: 'swagger' fires for guitar neck ───────────────
    // "V2 Stagger Swagger - Neck / Full Gold" → ch.92 (musical instruments)
    addNoneOf('AI_CH66_WALKING_STICK', [
      'neck', 'guitar', 'guitar neck', 'bass', 'bass neck', 'ukulele', 'instrument neck',
      'stagger', 'banjo', 'mandolin', 'fretboard',
    ], 'neck/guitar/instrument context prevents walking stick rule from blocking ch.92 guitar necks');

    // ── 16. AI_CH45_CORK_MISC_ARTICLES: 'tray' fires for decorative ring tray ────
    // "Personalized Nikah Ring Tray: Custom Arabic Calligraphy..." → ch.70 (glass/ceramics)
    addNoneOf('AI_CH45_CORK_MISC_ARTICLES', [
      'nikah', 'calligraphy', 'pearl border', 'arabic', 'baby breath', 'dried flower',
      'ring tray', 'wedding tray', 'personalized tray', 'arabic calligraphy',
    ], 'nikah/calligraphy/wedding context prevents cork articles rule from blocking ch.70 decorative ring trays');

    // ── 17-18. Fish/meat rules: 'dried' fires for "dried baby breath" flowers ──────
    const flowerContext = [
      'flower', 'dried flower', 'baby breath', 'nikah', 'ring tray', 'calligraphy',
      'wedding', 'floral', 'botanical', 'herb decoration', 'dried herb', 'wreath',
    ];
    addNoneOf('AI_CH03_SMOKED_DRIED_SALTED_FISH', flowerContext,
      'flower/wedding context prevents dried fish rule from blocking decorative ring trays');
    addNoneOf('AI_CH02_SALTED_CURED_MEAT', flowerContext,
      'flower/wedding context prevents cured meat rule from blocking decorative ring trays');

    // ── 19. FRESH_FRUIT_INTENT: 'strawberry' fires for mousepad ──────────────────
    // "Cute Die Cut Mousepad... Strawberry Aesthetic..." → ch.59
    addNoneOf('FRESH_FRUIT_INTENT', [
      'mousepad', 'mouse pad', 'die cut', 'desk mat', 'desk pad', 'kawaii', 'aesthetic',
      'gaming mat', 'desk accessory', 'wrist rest', 'mouse mat',
    ], 'mousepad/kawaii/aesthetic context prevents fresh fruit rule from blocking ch.59 printed mousepads');

    // ── 20-21. Extract rules: 'extract'/'essence'/'lqd tan' fires for glass bottle ─
    // "Glass btl lqd tan extract" → ch.32 (tanning/dyeing extracts)
    const tanContext = ['tan', 'tanning', 'glass bottle', 'glass btl', 'lqd', 'liquid', 'btl'];
    addNoneOf('AI_CH24_TOBACCO_EXTRACTS', tanContext,
      'tan/tanning/glass btl context prevents tobacco extract rule from blocking ch.32 tanning extracts');
    addNoneOf('AI_CH13_VEGETABLE_EXTRACTS', tanContext,
      'tan/tanning/glass btl context prevents vegetable extract rule from blocking ch.32 tanning extracts');

    // ── 22. AI_CH67_WIGS_HAIRPIECES: 'toppers' fires for "36 Toppers - 6 Faces" ──
    // Adding 'faces' to noneOf: wig-topper queries don't typically include 'faces'
    addNoneOf('AI_CH67_WIGS_HAIRPIECES', [
      'faces',
    ], '"faces" context prevents wig rule from blocking ch.95 party/game toppers with face designs');

    // ── 23. NEW PET_TOY_SUPPLY_INTENT ─────────────────────────────────────────────
    // "cloth dog toy" → 4201.00.60 (ch.42)
    // "dog toy squeaky" → 4201.00.60 (ch.42)
    // "cat toy feather" → 4201.00.60 (ch.42)
    patches.push({
      priority: 557,
      rule: {
        id: 'PET_TOY_SUPPLY_INTENT',
        description: 'Pet toys, dog toys, cat toys → ch.42 (4201.00). ' +
          '"Dog toy", "squeaky toy", "cat toy with feather", "chew toy" → 4201.00. ' +
          'Without rule, AI_CH75 (cloth), AI_CH40 (rubber/squeaky), AI_CH31 (feather) block ch.42.',
        pattern: {
          anyOf: [
            'dog toy', 'cat toy', 'pet toy', 'squeaky toy', 'chew toy', 'rope toy',
            'catnip toy', 'fetch toy', 'interactive toy', 'dog chew', 'kitten toy',
            'puppy toy', 'dog toys', 'cat toys', 'pet toys',
          ],
          noneOf: ['rubber mat', 'bath mat'],
        },
        whitelist: { allowChapters: ['42', '95'] },
        inject: [
          { prefix: '4201.00', syntheticRank: 9 }, // Saddlery and harness for animals
          { prefix: '9503.00', syntheticRank: 8 }, // Toys (games for children)
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '4201' },
          { delta: 0.4, chapterMatch: '42' },
        ],
      } as IntentRule,
    });

    // ── 24. NEW COFFEE_SINGLE_ORIGIN_INTENT ───────────────────────────────────────
    // "Ecuador, Angamaza Washed (300g)" → 0901.21 (ch.09)
    patches.push({
      priority: 568,
      rule: {
        id: 'COFFEE_SINGLE_ORIGIN_INTENT',
        description: 'Coffee beans, specialty coffee, single-origin coffee → ch.09 (0901.21). ' +
          '"Arabica coffee", "espresso beans", "single origin" → 0901.21. ' +
          'Without rule, no ch.09 results for specialty coffee queries.',
        pattern: {
          anyOf: [
            'coffee', 'arabica', 'robusta', 'espresso', 'cold brew', 'single origin',
            'coffee bean', 'coffee beans', 'green coffee', 'specialty coffee',
            'roasted coffee', 'drip coffee', 'pour over', 'french press',
            'filter coffee', 'barista', 'yirgacheffe', 'sidama', 'gesha', 'geisha',
          ],
          noneOf: ['coffee maker', 'coffee machine', 'coffee table', 'mug', 'cup', 'grinder'],
        },
        whitelist: { allowChapters: ['09'] },
        inject: [
          { prefix: '0901.21', syntheticRank: 9 }, // Coffee, roasted, not decaffeinated
          { prefix: '0901.11', syntheticRank: 8 }, // Coffee, not roasted, not decaffeinated
          { prefix: '0901.22', syntheticRank: 7 }, // Coffee, roasted, decaffeinated
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '0901' },
          { delta: 0.4, chapterMatch: '09' },
        ],
      } as IntentRule,
    });

    // ── 25. NEW PHOTOGRAPHY_PORTRAIT_INTENT ───────────────────────────────────────
    // "family portrait" → 3705.00 (ch.37 — photographic plates/film, exposed and developed)
    patches.push({
      priority: 552,
      rule: {
        id: 'PHOTOGRAPHY_PORTRAIT_INTENT',
        description: 'Developed photographic prints, portraits, photo prints → ch.37 (3705.00). ' +
          '"Family portrait", "portrait photo", "photographic print" → 3705.00. ' +
          'Without rule, no ch.37 results for photo portrait queries.',
        pattern: {
          anyOf: [
            'portrait', 'family portrait', 'portrait photo', 'photo print', 'portrait session',
            'photographic portrait', 'developed photo', 'photo lab', 'portrait print',
            'printed photo', 'graduation portrait', 'professional portrait',
          ],
          noneOf: ['camera', 'lens', 'tripod', 'photo frame', 'digital frame', 'mirror'],
        },
        whitelist: { allowChapters: ['37', '49'] },
        inject: [
          { prefix: '3705.00', syntheticRank: 9 }, // Photographic plates/film, exposed and developed
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '3705' },
          { delta: 0.4, chapterMatch: '37' },
        ],
      } as IntentRule,
    });

    // ── 26. NEW ENCODER_INDUSTRIAL_INTENT ─────────────────────────────────────────
    // "Step Encoder" → 8543.70 (ch.85 — other electrical machines)
    patches.push({
      priority: 563,
      rule: {
        id: 'ENCODER_INDUSTRIAL_INTENT',
        description: 'Encoders, rotary encoders, position sensors → ch.85 (8543.70). ' +
          '"Step encoder", "rotary encoder", "optical encoder" → 8543.70. ' +
          'Without rule, no ch.85 results for encoder queries (no HTS text mentions encoder).',
        pattern: {
          anyOf: [
            'encoder', 'step encoder', 'rotary encoder', 'optical encoder',
            'incremental encoder', 'quadrature encoder', 'linear encoder',
            'absolute encoder', 'servo encoder', 'shaft encoder', 'angle encoder',
          ],
          noneOf: ['decoder', 'video decoder', 'audio decoder'],
        },
        whitelist: { allowChapters: ['85', '90'] },
        inject: [
          { prefix: '8543.70', syntheticRank: 9 }, // Other electrical machines/apparatus
          { prefix: '8543.90', syntheticRank: 8 }, // Parts of electrical machines
          { prefix: '9015.80', syntheticRank: 7 }, // Other instruments/appliances
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8543' },
          { delta: 0.4, chapterMatch: '85' },
        ],
      } as IntentRule,
    });

    // ── 27. NEW MOUSEPAD_DESK_PAD_INTENT ──────────────────────────────────────────
    // "Cute Die Cut Mousepad... Strawberry Aesthetic Desk Accessories" → ch.59
    patches.push({
      priority: 551,
      rule: {
        id: 'MOUSEPAD_DESK_PAD_INTENT',
        description: 'Mousepads, desk mats, gaming pads → ch.59 (5911.90). ' +
          '"Die cut mousepad", "gaming desk mat", "kawaii mouse pad" → 5911.90. ' +
          'Without rule, FRESH_FRUIT_INTENT blocks ch.59 for mousepads with fruit-themed designs.',
        pattern: {
          anyOf: [
            'mousepad', 'mouse pad', 'gaming mousepad', 'desk mat', 'desk pad',
            'mouse mat', 'extended mousepad', 'rgb mousepad', 'gaming mat',
            'kawaii mousepad', 'custom mousepad', 'die cut mousepad',
          ],
        },
        whitelist: { allowChapters: ['59', '39', '40'] },
        inject: [
          { prefix: '5911.90', syntheticRank: 9 }, // Other textile products for technical use
          { prefix: '3926.90', syntheticRank: 8 }, // Other articles of plastic
          { prefix: '4016.99', syntheticRank: 7 }, // Other articles of vulcanised rubber
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '59' },
          { delta: 0.4, prefixMatch: '5911' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch PPPP)...`);
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
    console.log(`\nPatch PPPP complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
