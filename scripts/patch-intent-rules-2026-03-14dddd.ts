#!/usr/bin/env ts-node
/**
 * Patch DDDD — 2026-03-14:
 *
 * Fix multiple EMPTY cases identified after CCCC:
 *
 * 1. PILLOW_BEDDING_INTENT: Add allowChapters=['94']
 *    Root cause: AI_CH67_FEATHER_ARTICLES fires for "down pillow" (anyOfGroups: group1=down/feather, group2=pillow)
 *    with allowChapters=['67'], blocking ALL non-ch.67 entries.
 *    PILLOW_BEDDING_INTENT had no allowChapters → not in rulesWithAllow → ch.94 inject fails passesAny.
 *    Fix: Add allowChapters=['94'] so PILLOW_BEDDING_INTENT provides ch.94 path.
 *
 * 2. BEANIE_HAT_INTENT: Add toque, skullcap, etc.
 *    "Cuffed Toque", "Midnight Rosary Skullcap" → EMPTY (not in anyOf)
 *
 * 3. GLASSWARE_DRINKING_INTENT: Add highball, milk glass, seed beads
 *    "Culver Valencia Highball Glasses", "Vintage Milk Glass Bud Vases", "Preciosa Seed Beads" → EMPTY
 *
 * 4. BED_SHEET_INTENT: Add napkin, tablecloth terms
 *    "Set of 8 Fiddling Ferns Cotton Napkins" → EMPTY
 *
 * 5. WOODEN_DECORATIVE_ARTICLE_INTENT: Add cake topper, embroidery hoop
 *    "Paper Cupcake Toppers", "Bamboo Embroidery Hoop", "Personalized Cake Topper" → EMPTY
 *
 * 6. TABLE_LAMP_INTENT: Add 'lamp' standalone and more lamp types
 *    "lamp with clock", "Used electric table lamp" → EMPTY
 *
 * 7. AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT: Add rotary switch, kill switch
 *    "ROTARY SWITCH" → EMPTY
 *
 * 8. NEW VEHICLE_PARTS_SWITCH_INTENT: Transfer case switch, 4x4 switch, ebike throttle → ch.87
 *    "Automotive Transfer Case Switch" → EMPTY (expected ch.87, not ch.85)
 *
 * 9. NEW THREAD_EMBROIDERY_CORD_INTENT: Macrame cord, embroidery thread, metallic thread → ch.56
 *    "0.5mm Waxed Polyester Cord", "DMC Metallic Thread", "312x DMC skeins" → EMPTY
 *
 * 10. NEW SPORTS_EQUIPMENT_INLINE_SKATE_INTENT: Inline skate chassis, roller blade → ch.95
 *     "Composite inline skate chassis/frame" → EMPTY
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14dddd.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed DDDD: ${note}`,
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
          description: (existing.description ?? ruleId) + ` — Fixed DDDD: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. PILLOW_BEDDING_INTENT: Add allowChapters=['94'] ────────────────────
    // Root cause: AI_CH67_FEATHER_ARTICLES fires for "down pillow" (group1=down, group2=pillow)
    // with allowChapters=['67']. PILLOW_BEDDING_INTENT had whitelist=undefined (not in rulesWithAllow)
    // so ch.94 inject failed passesAny check → EMPTY.
    // Fix: add allowChapters=['94'] so PILLOW_BEDDING_INTENT joins rulesWithAllow.
    {
      const existing = allRules.find(r => r.id === 'PILLOW_BEDDING_INTENT') as IntentRule | undefined;
      if (existing) {
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'PILLOW_BEDDING_INTENT') +
              ' — Fixed DDDD: added allowChapters=[94] to fix down pillow EMPTY (AI_CH67_FEATHER_ARTICLES was blocking ch.94).',
            whitelist: {
              ...((existing.whitelist as any) ?? {}),
              allowChapters: ['94'],
            },
            pattern: {
              ...(existing.pattern as any),
              anyOf: [
                ...((existing.pattern as any)?.anyOf ?? []),
                'throw pillow', 'decorative pillow', 'cushion pillow', 'feather pillow',
                'pillow insert', 'bed cushion', 'sofa pillow', 'accent pillow',
                'piercing pillow', 'donut pillow', 'ear piercing pillow',
              ].filter((v, i, a) => a.indexOf(v) === i),
            },
          },
        });
        console.log('PILLOW_BEDDING_INTENT: adding allowChapters=[94] + extra anyOf terms');
      } else {
        console.log('WARNING: PILLOW_BEDDING_INTENT not found');
      }
    }

    // ── 2. BEANIE_HAT_INTENT: Add toque, skullcap, kippah, newsboy ───────────
    // "Cuffed Toque", "Midnight Rosary Skullcap" → ch.65 (6505)
    addToAnyOf('BEANIE_HAT_INTENT', [
      'toque', 'toques', 'tuque', 'tuques',
      'skullcap', 'skull cap',
      'kippah', 'kippa', 'yarmulke', 'yarmulka',
      'kufi', 'kufis',
      'newsboy cap', 'newsboy hat', 'gatsby cap',
      'flat cap', 'ivy cap',
      'watch cap', 'watch hat',
      'beret', 'berets',
      'tam', 'tam hat',
    ], 'added toque/skullcap/kippah/newsboy to hat intent → ch.65');

    // ── 3. GLASSWARE_DRINKING_INTENT: Add highball, milk glass, seed beads ───
    // "Culver Valencia Highball Glasses" → 7013 (ch.70)
    // "Indiana Milk Glass Hen On a Nest" → ch.70
    // "10/0 Preciosa Opaque Seed Beads" → 7018 (glass beads)
    // "Hand Blown Crystal Figurine" → 7013/7018
    addToAnyOf('GLASSWARE_DRINKING_INTENT', [
      'highball', 'highball glass', 'highball glasses', 'highball tumbler',
      'rocks glass', 'old fashioned glass', 'lowball glass',
      'cocktail glass', 'martini glass', 'champagne flute',
      'milk glass', 'milk glass vase', 'milk glass bowl', 'milk glass figurine',
      'glass vase', 'glass figurine', 'blown glass figurine', 'crystal figurine',
      'hand blown glass', 'art glass', 'glass art',
      'seed bead', 'seed beads', 'glass bead', 'glass beads',
      'glass pearl', 'glass pearls', 'glass marble', 'glass marbles',
      'stained glass piece', 'fused glass',
    ], 'added highball/milk glass/seed beads/crystal figurine → ch.70');

    // ── 4. BED_SHEET_INTENT: Add napkin, tablecloth terms ────────────────────
    // "Set of 8 Fiddling Ferns Cotton Napkins" → ch.63 (6304)
    // "Vintage DC Comics Batman Twin Flat Sheet" → ch.63 (6302)
    addToAnyOf('BED_SHEET_INTENT', [
      'napkin', 'napkins', 'cloth napkin', 'cotton napkin', 'linen napkin',
      'table napkin', 'dinner napkin', 'cocktail napkin',
      'tablecloth', 'table cloth', 'table cover', 'table runner',
      'placemats', 'placemat',
      'pillow sham', 'duvet cover',
    ], 'added napkins/tablecloth/table runner → ch.63 (6302/6304)');

    // ── 5. WOODEN_DECORATIVE_ARTICLE_INTENT: Add cake toppers, embroidery hoop ─
    // "Paper Cupcake Toppers with Toothpicks" → ch.44 (4421)
    // "Personalized Princess Castle Cake Topper" → ch.44
    // "Bamboo Embroidery Hoop, Cross Stitch Frame" → ch.44 (4421)
    // "Rustic Farmhouse Wall Shelf with Hooks" → ch.44
    addToAnyOf('WOODEN_DECORATIVE_ARTICLE_INTENT', [
      'cake topper', 'cake toppers', 'cupcake topper', 'cupcake toppers',
      'birthday topper', 'wedding topper', 'toothpick topper',
      'embroidery hoop', 'embroidery hoops', 'embroidery frame',
      'cross stitch hoop', 'cross stitch frame',
      'bamboo hoop', 'wooden hoop', 'needlework hoop',
      'wooden shelf', 'wall shelf', 'wood shelf',
      'coat rack', 'entryway organizer',
    ], 'added cake topper/embroidery hoop/wall shelf → ch.44 (4420/4421)');

    // Also add embroidery hoop to noneOf of AI_CH14 so bamboo hoop doesn't fire plaiting rule
    addNoneOf('AI_CH14_PLAITING_MATERIALS', [
      'embroidery hoop', 'embroidery frame', 'hoop', 'hoops',
      'cross stitch hoop', 'needlework hoop',
    ], 'embroidery hoop context → ch.44, not ch.14 plaiting materials');

    // ── 6. TABLE_LAMP_INTENT: Add more lamp types ─────────────────────────────
    // "lamp with clock" → ch.94 (9405) — TABLE_LAMP_INTENT fires on 'table lamp' phrase
    // but "lamp with clock" only has 'lamp' as standalone token
    // Also add to FLOOR_LAMP_INTENT
    {
      const existing = allRules.find(r => r.id === 'TABLE_LAMP_INTENT') as IntentRule | undefined;
      if (existing) {
        const pat = existing.pattern as any ?? {};
        const currentAnyOf: string[] = pat.anyOf ?? [];
        const toAdd = [
          'lamp with clock', 'clock lamp', 'electric lamp', 'pendant lamp',
          'sconce lamp', 'wall lamp', 'ceiling lamp',
          'accent lamp', 'mood lamp', 'atmosphere lamp',
          'lava lamp', 'himalayan salt lamp', 'salt lamp',
          'banker lamp', 'gooseneck lamp',
        ].filter(t => !currentAnyOf.includes(t));
        patches.push({
          priority: (existing as any).priority ?? 500,
          rule: {
            ...existing,
            description: (existing.description ?? 'TABLE_LAMP_INTENT') +
              ' — Fixed DDDD: added lamp with clock, electric lamp, other lamp types.',
            pattern: { ...pat, anyOf: [...currentAnyOf, ...toAdd] },
          },
        });
        console.log(`TABLE_LAMP_INTENT: adding ${toAdd.length} anyOf terms`);
      }
    }

    // ── 7. AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT: Add rotary switch, kill switch ─
    // "ROTARY SWITCH" → expected ch.85 (8536 electrical switches)
    addToAnyOf('AUTOMOTIVE_ELECTRICAL_SWITCH_INTENT', [
      'rotary switch', 'rotary selector', 'selector switch',
      'kill switch', 'killswitch', 'cutoff switch',
      'toggle switch', 'momentary switch', 'push button switch',
      'rocker switch', 'rocker', 'illuminated switch',
      'ignition switch', 'start switch', 'starter switch',
      'multi-function switch',
    ], 'added rotary/kill/toggle/rocker switch → ch.85 (8536)');

    // ── 8. NEW VEHICLE_PARTS_SWITCH_INTENT (ch.87) ───────────────────────────
    // "Automotive Transfer Case Switch", "Automotive 4X4 Switch", "Automotive Neutral Switch"
    // → 8708.99 (parts and accessories of motor vehicles)
    // "EBIKE THROTTLE" → 8714.99 (parts/accessories for cycles)
    patches.push({
      priority: 565,
      rule: {
        id: 'VEHICLE_PARTS_SWITCH_INTENT',
        description: 'Vehicle drivetrain/4WD switch controls and e-bike parts → ch.87 (8708/8714). ' +
          '"Transfer case switch", "4WD switch", "neutral switch" → 8708 (motor vehicle parts). ' +
          '"Ebike throttle", "electric bicycle throttle" → 8714 (bicycle parts). ' +
          'Without rule, these automotive/cycle parts route to ch.85 or EMPTY.',
        pattern: {
          anyOf: [
            'transfer case switch', 'transfer case control',
            '4x4 switch', '4wd switch', 'four wheel drive switch', '4x4 control',
            'awd switch', 'all wheel drive switch',
            'neutral switch', 'neutral safety switch',
            'transmission switch', 'gear position switch',
            'ebike throttle', 'e-bike throttle', 'electric bike throttle',
            'electric bicycle throttle', 'moped throttle', 'scooter throttle',
            'cargo carrier collapsible', 'hitch cargo carrier',
          ],
        },
        whitelist: { allowChapters: ['87'] },
        inject: [
          { prefix: '8708.99.81', syntheticRank: 9 }, // Parts of motor vehicles
          { prefix: '8708.99.68', syntheticRank: 8 },
          { prefix: '8714.99.80', syntheticRank: 7 }, // Parts for cycles
          { prefix: '8714.99.50', syntheticRank: 6 },
        ],
        boosts: [
          { delta: 0.4, chapterMatch: '87' },
        ],
      } as IntentRule,
    });

    // ── 9. NEW THREAD_EMBROIDERY_CORD_INTENT (ch.56) ─────────────────────────
    // "0.5mm Linhasita Waxed Polyester Cord" → ch.56 (5607 twine/cordage)
    // "DMC Diamant Metallic Thread" → ch.56 (5606 metallic yarn/thread)
    // "312x DMC skeins" → ch.56 (5606 embroidery thread)
    // "Handmade St. Patrick's Day Felt Garland" → ch.56 (5602 felt articles)
    patches.push({
      priority: 547,
      rule: {
        id: 'THREAD_EMBROIDERY_CORD_INTENT',
        description: 'Embroidery thread, metallic thread, waxed cord, felt garland → ch.56 (5602/5606/5607). ' +
          '"DMC floss", "waxed cord", "metallic thread", "felt garland" → ch.56 or ch.52. ' +
          'Without rule, these craft textile items return EMPTY.',
        pattern: {
          anyOf: [
            // Embroidery thread
            'embroidery floss', 'embroidery thread', 'hand embroidery floss',
            'dmc floss', 'dmc thread', 'dmc skeins', 'dmc skein', 'dmc diamant',
            'metallic thread', 'metallic embroidery', 'metallic floss',
            'cotton floss', 'silk floss', 'pearl cotton',
            // Cord/twine
            'macrame cord', 'waxed cord', 'waxed thread', 'waxed polyester cord',
            'braided cord', 'twisted cord', 'knotting cord', 'knotting string',
            'micro macrame', 'beading thread',
            // Felt/nonwoven garland
            'felt garland', 'felt banner', 'felt decoration',
            'felt garland banner',
          ],
          noneOf: [
            'cord blood', 'electrical cord', 'power cord', 'extension cord',
            'umbilical cord', 'cord cover', 'cable',
            'pattern', 'pdf', 'digital',
          ],
        },
        whitelist: { allowChapters: ['56', '52'] },
        inject: [
          { prefix: '5606.00.00', syntheticRank: 9 }, // Gimped yarn, metallised yarn
          { prefix: '5607.50.25', syntheticRank: 8 }, // Twine/cordage of polyester
          { prefix: '5602.10.90', syntheticRank: 7 }, // Needleloom felt
          { prefix: '5607.50.40', syntheticRank: 6 }, // Other cordage of polyester
          { prefix: '5204.11.00', syntheticRank: 5 }, // Sewing thread of cotton
        ],
        boosts: [
          { delta: 0.4, prefixMatch: '5606' },
          { delta: 0.35, prefixMatch: '5607' },
          { delta: 0.3, chapterMatch: '56' },
        ],
      } as IntentRule,
    });

    // ── 10. NEW INLINE_SKATE_SPORTS_INTENT (ch.95) ────────────────────────────
    // "Composite inline skate chassis/frame for roller skates" → 9506 (sports equipment)
    // SKI_SNOWBOARD_INTENT already has 'alpine ski' and should handle ski queries
    // But inline skate chassis not covered
    patches.push({
      priority: 557,
      rule: {
        id: 'INLINE_SKATE_SPORTS_INTENT',
        description: 'Inline skates, roller skates, roller blades, skate parts → ch.95 (9506). ' +
          '"Inline skate chassis", "roller skate frame", "roller blade" → 9506.70. ' +
          'Without rule, composite skate chassis routes to ch.39/ch.84 or EMPTY.',
        pattern: {
          anyOf: [
            'inline skate', 'inline skates', 'inline skating',
            'roller skate', 'roller skates', 'roller blades', 'rollerblade',
            'inline skate chassis', 'inline skate frame', 'skate chassis',
            'roller skate chassis', 'roller skate frame',
            'ice skate', 'ice skates', 'ice skating',
            'hockey skate', 'figure skate', 'speed skate',
          ],
          noneOf: ['shoes', 'boots', 'footwear'],  // Boots alone go to ch.64
        },
        whitelist: { allowChapters: ['95'] },
        inject: [
          { prefix: '9506.70.20', syntheticRank: 9 }, // Ice skates
          { prefix: '9506.70.40', syntheticRank: 8 }, // Roller skates
          { prefix: '9506.70.60', syntheticRank: 7 }, // Other skates
          { prefix: '9506.99.25', syntheticRank: 6 }, // Parts and accessories of articles of 9506
        ],
        boosts: [
          { delta: 0.4, chapterMatch: '95' },
          { delta: 0.5, prefixMatch: '9506.70' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch DDDD)...`);
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
    console.log(`\nPatch DDDD complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
