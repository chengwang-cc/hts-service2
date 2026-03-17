#!/usr/bin/env ts-node
/**
 * Patch EEEE — 2026-03-14:
 *
 * Fix more EMPTY cases by preventing false-positive allowChapters rules
 * and adding missing anyOf terms:
 *
 * 1. AI_CH91_POCKET_WATCH: Add bag/purse terms to noneOf
 *    'pocket' fires this rule → allowChapters=['91'] blocks ch.42 for "Rocket Pocket Saddle Bag"
 *
 * 2. AI_CH88_SPACECRAFT: Add bag/saddle terms to noneOf
 *    'rocket' fires this rule → allowChapters=['88'] blocks ch.42 for "Rocket Pocket Saddle Bag"
 *
 * 3. AI_CH66_TELESCOPIC_UMBRELLA: Add elastic/lingerie terms to noneOf
 *    'folding' fires this rule → allowChapters=['66'] blocks ch.58 for "Folding Lingerie Elastic"
 *
 * 4. LEATHER_FOLIO_CROSSBODY_BAG_INTENT: Add saddle bag, motorcycle bag, jewelry box terms
 *    "Rocket Pocket Saddle Bag" → ch.42 (AAAA patch may not have persisted saddle bag)
 *    "Personalized Velvet Travel Jewelry Box" → ch.42 (4202 jewelry cases)
 *
 * 5. AI_CH14_PLAITING_MATERIALS: Add 'top', 'dolman', 'tank top' to noneOf
 *    "ladies 95% bamboo rayon 5% spandex dolman top" → EMPTY (bamboo fires ch.14 rule)
 *
 * 6. AI_CH54_ELASTOMERIC_YARN: Add 'dolman', 'top', 'ladies' to noneOf
 *    Same query → spandex fires ch.54 rule
 *
 * 7. OUTERWEAR_JACKET_GARMENT_INTENT: Add 'tank top', 'tank tops', 'sleeveless top'
 *    "Vintage womans Tank Top" → EMPTY (no rule fires for 'tank top' woven garment)
 *    This intent has allowChapters=['61','62'] → ch.62 tank top passes
 *
 * 8. NEW JEWELRY_CASE_VELVET_BOX_INTENT: Velvet jewelry box, ring box, earring case → ch.42
 *    "Personalized Velvet Travel Jewelry Box", "Personalized Birth Flower Velvet Jewelry Box" → ch.42
 *
 * 9. NEW AUDIO_VIDEO_PLAYER_INTENT: Sony Walkman, digital photo frame, CD player → ch.85
 *    "Vintage Sony Walkman", "Digital Photo Frame Nixplay" → EMPTY (expected ch.85)
 *
 * 10. addNoneOf AI_CH54_RAYON_FABRIC: Add dolman, top, ladies for same root cause
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-14eeee.ts
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
          description: (existing.description ?? ruleId) + ` — Fixed EEEE: ${note}`,
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
          description: (existing.description ?? ruleId) + ` — Fixed EEEE: ${note}`,
          pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] },
        },
      });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    // ── 1. AI_CH91_POCKET_WATCH: Add bag/purse noneOf ─────────────────────────
    // 'pocket' fires this rule → allowChapters=['91'] blocks ch.42 leather goods.
    // "Rocket Pocket Saddle Bag": 'pocket' = pocket in bag name, not pocket watch.
    addNoneOf('AI_CH91_POCKET_WATCH', [
      'bag', 'bags', 'saddle', 'saddle bag', 'purse', 'handbag', 'handbags',
      'backpack', 'pouch', 'crossbody', 'satchel', 'tote',
    ], 'bag/saddle/purse context prevents pocket watch rule firing for leather goods');

    // ── 2. AI_CH88_SPACECRAFT: Add bag/saddle/pocket noneOf ───────────────────
    // 'rocket' fires this rule → allowChapters=['88'] blocks ch.42 for "Rocket Pocket Saddle Bag"
    // "Rocket Pocket Saddle Bag" is a brand/product name, not spacecraft.
    addNoneOf('AI_CH88_SPACECRAFT', [
      'bag', 'bags', 'saddle', 'pocket', 'pouch', 'purse', 'handbag',
      'backpack', 'tote', 'wallet', 'case',
      'stove', 'fuel', 'canister', 'camp stove', 'propane',  // camping rocket stoves
    ], 'bag/saddle/pocket context prevents spacecraft rule firing for leather goods');

    // ── 3. AI_CH66_TELESCOPIC_UMBRELLA: Add elastic/lingerie noneOf ────────────
    // 'folding' fires this rule → allowChapters=['66'] blocks ch.58 elastic fabric.
    // "Folding Lingerie Elastic" = lingerie elastic/ribbon, not folding umbrella.
    addNoneOf('AI_CH66_TELESCOPIC_UMBRELLA', [
      'elastic', 'elastics', 'elastic band', 'lingerie elastic',
      'lingerie', 'bra', 'underwear', 'knicker', 'garter',
      'fabric', 'ribbon', 'trim', 'lace trim', 'elastic trim',
      'lanyard',  // folding lanyard → not umbrella
      'hoop', 'embroidery', 'chair',  // folding chair → not umbrella
    ], 'elastic/lingerie/fabric context prevents telescopic umbrella rule misfiring');

    // ── 4. LEATHER_FOLIO_CROSSBODY_BAG_INTENT: Re-add saddle bag + jewelry box ─
    // Saddle bag terms may have been lost from DB; re-adding them.
    // Also add jewelry box terms: "Personalized Velvet Travel Jewelry Box" → 4202.
    addToAnyOf('LEATHER_FOLIO_CROSSBODY_BAG_INTENT', [
      // Saddle/motorcycle bags
      'saddle bag', 'saddlebag', 'saddle bags', 'saddlebags',
      'motorcycle bag', 'bicycle bag', 'bike bag', 'messenger bag',
      'cargo crossbody', 'cargo bag',
      'belt bag', 'belt pouch', 'waist bag',
      // Jewelry cases (4202.12)
      'jewelry box', 'jewellery box', 'jewelry case', 'jewellery case',
      'ring box', 'velvet jewelry box', 'travel jewelry box',
      'earring case', 'necklace box', 'bracelet box',
      'jewelry organizer', 'jewelry pouch',
      // Other ch.42 bags
      'coin purse', 'coin bag', 'small bag',
      'lunch bag', 'insulated bag', 'tote bag',
    ], 'added saddle bag/jewelry box/coin purse/tote → ch.42 (4202)');

    // ── 5. AI_CH14_PLAITING_MATERIALS: Add garment top terms to noneOf ─────────
    // 'bamboo' fires this rule with allowChapters=['14'] for garment queries.
    // "ladies 95% bamboo rayon 5% spandex dolman top" → bamboo in noneOf context:
    addNoneOf('AI_CH14_PLAITING_MATERIALS', [
      'top', 'tops', 'dolman', 'dolman top',
      'tank top', 'tank tops', 'crop top', 'crop tops',
      'ladies', 'womens', 'women', 'mens', 'men',
      'yoga', 'activewear', 'athletic',
      'tunic', 'blouse',
    ], 'garment-top context prevents bamboo plaiting material rule blocking ch.61');

    // ── 6. AI_CH54_ELASTOMERIC_YARN: Add dolman/top/ladies to noneOf ────────────
    // 'spandex' fires this rule with allowChapters=['54'] for garment queries.
    addNoneOf('AI_CH54_ELASTOMERIC_YARN', [
      'dolman', 'dolman top',
      'top', 'tops', 'tank top', 'tank tops', 'crop top',
      'ladies', 'womens', 'men', 'mens',
      'yoga', 'activewear',
    ], 'garment-top context prevents spandex/elastane rule blocking ch.61');

    // ── 7. AI_CH54_RAYON_FABRIC: Add dolman/top to noneOf ───────────────────────
    // 'rayon' fires this rule with allowChapters=['54'] for garment queries.
    addNoneOf('AI_CH54_RAYON_FABRIC', [
      'dolman', 'dolman top',
      'top', 'tops', 'tank top',
      'ladies', 'womens',
    ], 'garment-top context prevents rayon rule blocking ch.61');

    // ── 8. OUTERWEAR_JACKET_GARMENT_INTENT: Add tank top, sleeveless top ────────
    // "Vintage womans Tank Top" → expected ch.62 (6211 woven garments).
    // Adding tank top to OUTERWEAR/garment intent gives ch.61/62 path.
    addToAnyOf('OUTERWEAR_JACKET_GARMENT_INTENT', [
      'tank top', 'tank tops', 'tank shirt', 'tank tee',
      'sleeveless top', 'sleeveless shirt', 'sleeveless blouse',
      'athletic top', 'gym top', 'yoga top',
      'women top', 'ladies top', 'girls top',
      'blouse', 'blouses', 'tunic', 'tunics',
    ], 'added tank top/sleeveless/blouse/tunic → ch.61/62 garment path');

    // ── 9. NEW JEWELRY_CASE_VELVET_BOX_INTENT (ch.42 backup) ─────────────────
    // "Personalized Velvet Travel Jewelry Box - Custom Bridesmaid Gift" → 4202 (ch.42)
    // "Personalized Birth Flower Velvet Jewelry Box: Navy Travel Case" → 4202
    patches.push({
      priority: 563,
      rule: {
        id: 'JEWELRY_CASE_VELVET_BOX_INTENT',
        description: 'Jewelry cases, ring boxes, velvet boxes → ch.42 (4202). ' +
          '"Velvet jewelry box", "personalized ring box", "travel jewelry case" → 4202.12. ' +
          'Without rule, personalized jewelry boxes route to wrong chapters or EMPTY.',
        pattern: {
          anyOf: [
            'jewelry box', 'jewellery box', 'jewelry case', 'jewellery case',
            'ring box', 'ring case', 'engagement ring box',
            'velvet jewelry box', 'velvet ring box', 'velvet box',
            'travel jewelry box', 'bridesmaid jewelry box', 'personalized jewelry box',
            'earring box', 'necklace box', 'bracelet box',
            'watch box', 'cufflink box',
          ],
          noneOf: ['music box', 'mechanical', 'wind up'],
        },
        whitelist: { allowChapters: ['42'] },
        inject: [
          { prefix: '4202.12.20', syntheticRank: 9 }, // Cases for jewelry
          { prefix: '4202.12.40', syntheticRank: 8 }, // Other cases (jewelry)
          { prefix: '4202.99.10', syntheticRank: 7 }, // Other; of cotton/textile
          { prefix: '4202.92.45', syntheticRank: 6 }, // Travel, sport, similar
        ],
        boosts: [
          { delta: 0.5, chapterMatch: '42' },
          { delta: 0.4, prefixMatch: '4202.12' },
        ],
      } as IntentRule,
    });

    // ── 10. NEW AUDIO_VIDEO_PLAYER_INTENT (ch.85) ─────────────────────────────
    // "Vintage Sony Walkman" → 8519 (sound reproducing apparatus)
    // "Digital Photo Frame Nixplay" → 8528.59 (monitors/displays)
    // "Buick Verano Dash Radio Information Display Screen" → 8528
    patches.push({
      priority: 582,
      rule: {
        id: 'AUDIO_VIDEO_PLAYER_INTENT',
        description: 'Audio/video players and displays → ch.85 (8519/8528). ' +
          '"Walkman", "cassette player", "photo frame", "display screen" → ch.85. ' +
          'Without rule, branded player/display queries return EMPTY.',
        pattern: {
          anyOf: [
            // Audio players
            'walkman', 'cd player', 'cassette player', 'record player',
            'mp3 player', 'media player', 'music player', 'audio player',
            'portable player', 'discman',
            // Photo frames / displays
            'digital photo frame', 'digital picture frame', 'photo frame wifi',
            'nixplay', 'digital frame',
            'display screen', 'dash display', 'radio display screen',
            'information display', 'display monitor',
            // Fuse boxes / electrical panels (ch.85)
            'fuse box', 'fusebox', 'fuse panel', 'fuse board',
            'junction box', 'electrical panel',
          ],
          noneOf: [
            'record player stand', 'picture frame',  // Regular frames → different ch
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8519.81', syntheticRank: 9 }, // Sound reproducing apparatus
          { prefix: '8528.59', syntheticRank: 8 }, // Monitors/displays
          { prefix: '8528.71', syntheticRank: 7 }, // Reception apparatus for TV
          { prefix: '8536.50', syntheticRank: 6 }, // Electrical switches/fuse boxes
        ],
        boosts: [
          { delta: 0.4, chapterMatch: '85' },
          { delta: 0.5, prefixMatch: '8519' },
          { delta: 0.4, prefixMatch: '8528' },
        ],
      } as IntentRule,
    });

    console.log(`Applying ${patches.length} rule patches (batch EEEE)...`);
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
    console.log(`\nPatch EEEE complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
