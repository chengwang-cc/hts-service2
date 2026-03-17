#!/usr/bin/env ts-node
/**
 * Patch TT21 — 2026-03-15: Embroidered patches + ceramic mugs + Christmas ornaments + plastic pouches + 3D-print decor.
 * Current: ~31.58% (after TT19; TT20 pending eval)
 *
 * Targets:
 *  1. EMBROIDERED_PATCH_TEXTILE_INTENT → 6307.90 (embroidered patches, iron-on, woven labels)
 *     "FFXIV Job Story Embroidered Tag" → 6307.90.98; 43 entries in cluster
 *  2. CERAMIC_MUG_TABLEWARE_INTENT → 6911.10 + 6912.00 (ceramic mugs, bowls, cups)
 *     "Ceramic Mug and Wood Coaster" → 6911.10; "4 pc mug set" → 6912.00; 65 entries combined
 *  3. CHRISTMAS_HOLIDAY_ORNAMENT_INTENT → 9505.10 (Christmas ornaments, holiday decorations)
 *     "Glass Cardinal Memorial Ornament" → 9505.10; "Glass Christmas ornament" → 9505.10; 20 entries
 *  4. PLASTIC_SILICONE_POUCH_INTENT → 4202.92 (silicone pouches, plastic bags, neoprene pouches)
 *     "Silicone Pouch Dog Treat Pouch" → 4202.92; 43 entries
 *  5. 3D_PRINTED_PLASTIC_DECOR_INTENT → 9403.70 (3D-printed plastic decor/furniture articles)
 *     "3D printed decorative bookshelf item made of plastic" → 9403.70; 18 entries
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt21.ts
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

    const addAnyOf = (e: IntentRule, ...terms: string[]) => {
      const pat = (e.pattern as any) ?? {};
      return { ...pat, anyOf: [...new Set([...(pat.anyOf ?? []), ...terms])] };
    };

    // 1. EMBROIDERED_PATCH_TEXTILE_INTENT → 6307.90 (embroidered patches, iron-on patches, woven labels)
    //    "FFXIV Job Story Embroidered Tag - DRK" → 6307.90.98.96
    //    "Embroidered patch" → 6307.90.98.96; "iron on patch" → 6307.90.98.96
    //    "woven patch" → 6307.90.72.00; "woven label" → 6307.90.72.00
    //    "embroidered badge" → 6307.90.98; "motif embroidered" → 6307.90.60.00
    //    43 entries in 6307.90 cluster
    {
      const existing = allRules.find(r => r.id === 'EMBROIDERED_PATCH_TEXTILE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'EMBROIDERED_PATCH_TEXTILE_INTENT',
          description: 'Embroidered patches, iron-on patches, woven labels, embroidered badges → ch.63 (6307.90)',
          pattern: {
            anyOf: [
              'embroidered patch', 'embroidered patches', 'iron on patch', 'iron-on patch',
              'sew on patch', 'sew-on patch', 'embroidered badge', 'woven patch',
              'woven label', 'embroidered label', 'woven tag', 'embroidered tag',
              'embroidered motif', 'embroidered applique', 'applique patch',
              'patch badge', 'patch set', 'patches set',
              'cosplay patch', 'anime patch', 'military patch', 'morale patch',
              'hat patch', 'jacket patch', 'back patch', 'velcro patch',
              'hook and loop patch', 'custom embroidered patch',
            ],
            noneOf: ['quilt patch', 'eye patch', 'adhesive patch', 'nicotine patch', 'skin patch'],
          },
          inject: [{ prefix: '6307.90', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '6307.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('EMBROIDERED_PATCH_TEXTILE_INTENT: created (embroidered patches → 6307.90)');
      }
    }

    // 2. CERAMIC_MUG_TABLEWARE_INTENT → 6911.10 + 6912.00 (ceramic/porcelain tableware)
    //    "Ceramic Mug and Wood Coaster" → 6911.10.00.21 (porcelain/china)
    //    "Ceramic Pet Bowl" → 6911.10.00.21; "4 pc mug set" → 6912.00.44.00 (other ceramic)
    //    "ABC mug: pink 22kt gold" → 6912.00.44; "Ceramic coffee mug" → 6911.10 or 6912.00
    //    Inject both; semantic similarity picks the right subheading
    {
      const existing = allRules.find(r => r.id === 'CERAMIC_MUG_TABLEWARE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CERAMIC_MUG_TABLEWARE_INTENT',
          description: 'Ceramic/porcelain mugs, bowls, cups, tableware → ch.69 (6911.10, 6912.00)',
          pattern: {
            anyOf: [
              'ceramic mug', 'ceramic mugs', 'ceramic cup', 'ceramic cups',
              'ceramic bowl', 'ceramic bowls', 'ceramic plate', 'ceramic plates',
              'ceramic coffee mug', 'ceramic tea mug', 'ceramic travel mug',
              'ceramic pet bowl', 'ceramic dog bowl', 'ceramic cat bowl',
              'stoneware mug', 'stoneware mug set', 'stoneware bowl', 'stoneware cup',
              'stoneware plate', 'stoneware dish', 'stoneware set',
              'porcelain mug', 'porcelain cup', 'porcelain bowl', 'porcelain plate',
              'porcelain dish', 'fine china mug', 'bone china mug', 'china cup',
              'earthenware mug', 'earthenware bowl', 'terracotta mug',
              'mug set', 'mug sets', 'pc mug set', 'mug collection',
              'handmade ceramic mug', 'hand thrown mug', 'pottery mug', 'artisan mug',
            ],
            noneOf: ['travel tumbler', 'stainless mug', 'glass mug', 'enamel mug', 'plastic mug', 'silicone mug'],
          },
          inject: [
            { prefix: '6911.10', syntheticRank: 5 },
            { prefix: '6912.00', syntheticRank: 6 },
          ],
          boosts: [
            { delta: 0.55, prefixMatch: '6911.1' },
            { delta: 0.50, prefixMatch: '6912.0' },
          ],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('CERAMIC_MUG_TABLEWARE_INTENT: created (ceramic/porcelain mugs → 6911.10 + 6912.00)');
      }
    }

    // 3. CHRISTMAS_HOLIDAY_ORNAMENT_INTENT → 9505.10 (Christmas/holiday ornaments & decorations)
    //    "Glass Cardinal Memorial Ornament free personalized" → 9505.10.15.20
    //    "Glass Christmas ornament" → 9505.10.15.20
    //    "Christmas tree ornament" → 9505.10.15; 20 entries in cluster
    {
      const existing = allRules.find(r => r.id === 'CHRISTMAS_HOLIDAY_ORNAMENT_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CHRISTMAS_HOLIDAY_ORNAMENT_INTENT',
          description: 'Christmas/holiday ornaments, decorations, nativity scenes → ch.95 (9505.10)',
          pattern: {
            anyOf: [
              'christmas ornament', 'christmas ornaments', 'holiday ornament', 'holiday ornaments',
              'tree ornament', 'xmas ornament', 'xmas ornaments', 'ornament christmas',
              'glass ornament', 'glass christmas ornament', 'glass ball ornament',
              'memorial ornament', 'personalized ornament', 'custom ornament',
              'photo ornament', 'acrylic ornament', 'wooden ornament',
              'cardinal ornament', 'snowflake ornament', 'angel ornament',
              'nativity scene', 'nativity set', 'christmas figurine',
              'advent calendar', 'christmas decoration', 'christmas decor',
              'christmas wreath', 'yule decor', 'holiday decor',
              'elf decor', 'santa figurine', 'reindeer figurine', 'christmas stocking',
            ],
            noneOf: [],
          },
          inject: [{ prefix: '9505.10', syntheticRank: 5 }],
          boosts: [{ delta: 0.60, prefixMatch: '9505.1' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('CHRISTMAS_HOLIDAY_ORNAMENT_INTENT: created (Christmas ornaments → 9505.10)');
      }
    }

    // 4. PLASTIC_SILICONE_POUCH_INTENT → 4202.92 (silicone/plastic pouches, dog treat pouches)
    //    "Silicone Pouch Dog Treat Pouch" → 4202.92.30.31
    //    "Silicone Pouch for Dog Treats" → 4202.92.30.31
    //    "plastic zipper pouch" → 4202.92; "pvc pouch" → 4202.92; 43 entries
    //    NOTE: 4202.92 = "travel bags, toiletry bags, similar containers of plastic sheeting"
    {
      const existing = allRules.find(r => r.id === 'PLASTIC_SILICONE_POUCH_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'PLASTIC_SILICONE_POUCH_INTENT',
          description: 'Silicone/plastic pouches, dog treat pouches, travel bags of plastic → ch.42 (4202.92)',
          pattern: {
            anyOf: [
              'silicone pouch', 'silicone bag', 'silicone treat pouch', 'silicone treat bag',
              'dog treat pouch', 'treat pouch dog', 'dog training pouch', 'training treat bag',
              'silicone food bag', 'silicone storage bag', 'silicone ziplock',
              'pvc pouch', 'pvc bag', 'pvc zipper bag', 'clear pvc bag',
              'vinyl pouch', 'vinyl bag', 'clear vinyl bag', 'envelope vinyl pouch',
              'neoprene pouch', 'neoprene bag', 'neoprene case',
              'waterproof pouch', 'waterproof bag plastic', 'dry bag',
              'mesh bag nylon', 'clear zipper pouch', 'plastic zipper pouch',
            ],
            noneOf: ['paper bag', 'fabric bag', 'cotton bag', 'canvas bag', 'leather bag', 'felt bag'],
          },
          inject: [{ prefix: '4202.92', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '4202.9' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('PLASTIC_SILICONE_POUCH_INTENT: created (silicone/plastic pouches → 4202.92)');
      }
    }

    // 5. 3D_PRINTED_PLASTIC_DECOR_INTENT → 9403.70 (3D-printed plastic furniture/decor articles)
    //    "3D printed decorative bookshelf item made of plastic or resin" → 9403.70.80.10
    //    "3D printed home decor items made from plastic materials" → 9403.70.80.10
    //    9403.70 = furniture of plastics; 18 entries in cluster
    //    Also covers custom/handmade 3D printed organizers, shelves
    {
      const existing = allRules.find(r => r.id === '3D_PRINTED_PLASTIC_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: '3D_PRINTED_PLASTIC_DECOR_INTENT',
          description: '3D printed plastic/resin decor, furniture articles → ch.94 (9403.70)',
          pattern: {
            anyOf: [
              '3d printed', '3d print', 'fdm print', 'resin print', 'resin printed',
              '3d printed decor', '3d printed decoration', '3d printed figurine',
              '3d printed shelf', '3d printed organizer', '3d printed holder',
              '3d printed vase', '3d printed planter', '3d printed art',
              '3d printed toy', '3d printed model', '3d printed miniature',
              'printed in pla', 'pla print', 'pla printed', 'abs printed',
              'resin model', 'resin figurine', 'resin miniature', 'resin sculpture',
            ],
            noneOf: ['screen print', 'heat transfer print', 'sublimation', 'digital print on fabric',
                     'print on demand', 'vinyl print', 'photo print', 'art print'],
          },
          inject: [{ prefix: '9403.70', syntheticRank: 5 }],
          boosts: [{ delta: 0.55, prefixMatch: '9403.7' }],
        } as IntentRule;
        patches.push({ priority: 565, rule: newRule });
        console.log('3D_PRINTED_PLASTIC_DECOR_INTENT: created (3D printed plastic decor → 9403.70)');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT21)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT21 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
