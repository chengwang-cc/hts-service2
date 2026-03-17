#!/usr/bin/env ts-node
/**
 * Patch AAAA — 2026-03-13:
 *
 * Fix garment queries EMPTY due to ch.51 wool/fabric rules blocking ch.61/62, and other gaps.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-13aaaa.ts
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
      patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, description: (existing.description ?? ruleId) + ` — Fixed AAAA: ${note}`, pattern: { ...pat, anyOf: [...currentAnyOf, ...newTerms] } } });
      console.log(`${ruleId}: adding ${newTerms.length} anyOf terms`);
    }

    function addNoneOf(ruleId: string, toAdd: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const newTerms = toAdd.filter(t => !currentNoneOf.includes(t));
      patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, description: (existing.description ?? ruleId) + ` — Fixed AAAA: ${note}`, pattern: { ...pat, noneOf: [...currentNoneOf, ...newTerms] } } });
      console.log(`${ruleId}: adding ${newTerms.length} noneOf terms`);
    }

    function replaceNoneOf(ruleId: string, remove: string[], note: string): void {
      const existing = allRules.find(r => r.id === ruleId) as IntentRule | undefined;
      if (!existing) { console.log(`WARNING: ${ruleId} not found`); return; }
      const pat = existing.pattern as any ?? {};
      const currentNoneOf: string[] = pat.noneOf ?? [];
      const filtered = currentNoneOf.filter(t => !remove.includes(t));
      patches.push({ priority: (existing as any).priority ?? 500, rule: { ...existing, description: (existing.description ?? ruleId) + ` — Fixed AAAA: ${note}`, pattern: { ...pat, noneOf: filtered } } });
      console.log(`${ruleId}: removing ${remove.length} noneOf terms`);
    }

    // ── 1. AI_CH51_WOOL_FABRIC: add garment noneOf ─────────────────────────────
    // anyOf=['tweed','flannel','worsted','woolen'] with allowChapters=['51']
    // Fires for "vintage woolen shirt", "Long Sleeve Dylan Shirt Tweed Indigo" → EMPTY
    addNoneOf('AI_CH51_WOOL_FABRIC', [
      'shirt', 'shirts', 'tshirt', 'tshirts', 't-shirt', 't-shirts',
      'dress', 'dresses', 'skirt', 'skirts', 'blouse', 'blouses',
      'jacket', 'jackets', 'coat', 'coats', 'blazer', 'blazers',
      'vest', 'vests', 'cardigan', 'cardigans', 'sweater', 'sweaters',
      'trousers', 'pants', 'jeans', 'shorts',
      'suit', 'suits', 'uniform', 'uniforms',
      'scarf', 'scarves', 'shawl', 'shawls', 'wrap',
      'clothing', 'apparel', 'garment', 'garments', 'wear',
      'vintage', 'used', 'secondhand', 'preloved',
    ], 'added garment/apparel terms → ch.51 fabric rule must not fire on clothing queries');

    // ── 2. AI_CH51_RAW_WOOL: add garment noneOf ───────────────────────────────
    // anyOf=['wool','fleece','greasy','shorn','raw','unwashed'] with allowChapters=['51']
    // 'wool' alone fires for "wool shirt", "wool t shirt" → blocks ch.61/62 → EMPTY
    addNoneOf('AI_CH51_RAW_WOOL', [
      'shirt', 'shirts', 'tshirt', 'tshirts', 't-shirt',
      'dress', 'dresses', 'skirt', 'pants', 'trousers', 'jeans',
      'jacket', 'coat', 'blazer', 'cardigan', 'sweater', 'vest',
      'blouse', 'tunic', 'top', 'hoodie', 'sweatshirt',
      'socks', 'stockings', 'leggings', 'tights',
      'underwear', 'bra', 'briefs', 'boxer',
      'scarf', 'scarves', 'shawl', 'wrap', 'poncho',
      'hat', 'cap', 'beanie', 'gloves', 'mittens',
      'clothing', 'apparel', 'garment', 'wear',
    ], 'added garment terms → raw wool rule must not fire when wool is fabric descriptor in clothing queries');

    // ── 3. Expand BONE_CHINA_CERAMIC_DISHWARE_INTENT ──────────────────────────
    // "Ceramic decorative figurine", "nemesis now figurine" → still EMPTY
    addToAnyOf('BONE_CHINA_CERAMIC_DISHWARE_INTENT', [
      'ceramic figurine', 'ceramic decorative', 'decorative figurine', 'decorative ceramic',
      'figurine', 'figurines', 'resin figurine',
      'nemesis now', 'design toscano',
      'herb plate', 'botanical plate', 'decorative plate', 'display plate',
      'vintage plate', 'vintage ceramic', 'vintage porcelain', 'antique china',
    ], 'added figurine/decorative/brand terms → ch.69');

    // ── 4. Expand LEATHER_FOLIO_CROSSBODY_BAG_INTENT ──────────────────────────
    // "Baggu Medium Cargo Crossbody" → 'crossbody' standalone not matching
    addToAnyOf('LEATHER_FOLIO_CROSSBODY_BAG_INTENT', [
      'crossbody', 'cross body',
      'saddle bag', 'saddlebag', 'bicycle bag', 'bike bag',
      'cargo bag', 'cargo crossbody',
      'messenger bag', 'messenger',
      'belt bag', 'fanny pack', 'bum bag',
      'hobo bag', 'bucket bag',
    ], 'added crossbody/saddlebag/messenger standalone terms → ch.42');

    // Remove 'saddle' (alone) from noneOf — saddlebag is a valid ch.42 bag
    replaceNoneOf('LEATHER_FOLIO_CROSSBODY_BAG_INTENT', ['saddle', 'horse', 'equestrian'],
      'removed saddle/horse from noneOf — saddle bag is a valid bag type');

    // ── 5. NEW RECORDED_MEDIA_VHS_DVD_INTENT ──────────────────────────────────
    // "Bedknobs and Broomsticks (VHS)", "Scream (VHS, 1997)" → 8523 (ch.85)
    patches.push({
      priority: 590,
      rule: {
        id: 'RECORDED_MEDIA_VHS_DVD_INTENT',
        description: 'Prerecorded VHS tapes, DVDs, Blu-rays → 8523 (ch.85). ' +
          '"VHS movie", "DVD", "Blu-ray" → 8523.29. ' +
          'Without rule, VHS/DVD movie queries return EMPTY.',
        pattern: {
          anyOf: [
            'vhs', 'vhs tape', 'vhs movie', 'vhs video', 'vhs sealed',
            'dvd', 'dvd movie', 'dvd disc', 'dvd video',
            'blu-ray', 'blu ray', 'bluray',
            'laserdisc', 'laser disc',
          ],
          noneOf: [
            'dvd player', 'vhs player', 'vcr player', 'blu-ray player',
            'dvd drive', 'dvd burner', 'dvd writer',
          ],
        },
        whitelist: { allowChapters: ['85'] },
        inject: [
          { prefix: '8523.29.20', syntheticRank: 9 }, // Recorded optical media
          { prefix: '8523.29.40', syntheticRank: 8 }, // Recorded optical discs
          { prefix: '8523.80.20', syntheticRank: 7 }, // Recorded magnetic tapes (VHS)
          { prefix: '8523.80.10', syntheticRank: 6 }, // Other recorded media
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8523' },
        ],
      } as IntentRule,
    });

    // ── 6. NEW HEAT_SEALER_PACKAGING_MACHINE_INTENT ────────────────────────────
    // "impulse sealer", "bag sealer" → 8422.30 (ch.84 packaging machines)
    patches.push({
      priority: 575,
      rule: {
        id: 'HEAT_SEALER_PACKAGING_MACHINE_INTENT',
        description: 'Impulse sealers, bag sealers → 8422 (ch.84). ' +
          '"Impulse sealer", "heat sealer", "bag sealer" → 8422.30. ' +
          'Without rule, sealer queries return EMPTY.',
        pattern: {
          anyOf: [
            'impulse sealer', 'bag sealer', 'pouch sealer', 'heat sealer',
            'impulse heat sealer', 'poly bag sealer', 'plastic bag sealer',
            'vacuum sealer', 'vacuum sealing machine',
            'shrink wrap machine', 'shrink tunnel', 'heat shrink machine',
            'band sealer', 'continuous band sealer',
          ],
          noneOf: [
            'jar sealer', 'mason jar', 'canning',
          ],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [
          { prefix: '8422.30.91', syntheticRank: 9 }, // Packaging/wrapping machinery
          { prefix: '8422.30.11', syntheticRank: 8 }, // Packaging machinery
          { prefix: '8477.80.00', syntheticRank: 7 }, // Machinery for working plastics
          { prefix: '8422.40.91', syntheticRank: 6 }, // Other packing machinery
        ],
        boosts: [
          { delta: 0.45, prefixMatch: '8422' },
        ],
      } as IntentRule,
    });

    // ── 7. NEW TEXTILE_LOOM_MACHINE_INTENT ────────────────────────────────────
    // "100% Wood Loom", "rigid heddle loom" → 8446/8447 (ch.84)
    patches.push({
      priority: 572,
      rule: {
        id: 'TEXTILE_LOOM_MACHINE_INTENT',
        description: 'Looms and knitting machines → 8446/8447 (ch.84). ' +
          '"Weaving loom", "rigid heddle loom", "knitting machine" → ch.84. ' +
          'Without rule, loom queries return EMPTY.',
        pattern: {
          anyOf: [
            'loom', 'looms', 'weaving loom', 'hand loom', 'floor loom',
            'rigid heddle', 'rigid heddle loom', 'tape loom', 'inkle loom',
            'potholder loom', 'frame loom', 'backstrap loom',
            'knitting machine', 'circular knitting machine', 'sock knitting machine',
            'knitting machine cover', 'knitting machine part',
          ],
          noneOf: [
            'loom band', 'rubber band loom', 'loom bracelet',
            'pattern', 'pdf pattern',
          ],
        },
        whitelist: { allowChapters: ['84'] },
        inject: [
          { prefix: '8446.30.00', syntheticRank: 9 }, // Other weaving machines (looms)
          { prefix: '8446.10.00', syntheticRank: 8 }, // Shuttle looms
          { prefix: '8447.90.00', syntheticRank: 7 }, // Other knitting machines
          { prefix: '8447.11.00', syntheticRank: 6 }, // Circular knitting machines
        ],
        boosts: [
          { delta: 0.5, prefixMatch: '8446' },
          { delta: 0.4, prefixMatch: '8447' },
        ],
      } as IntentRule,
    });

    // ── 8. Expand WOODEN_DECORATIVE_ARTICLE_INTENT ─────────────────────────────
    // "Handmade cherry wood decorative box" → 'cherry wood box' phrase not in query
    addToAnyOf('WOODEN_DECORATIVE_ARTICLE_INTENT', [
      'cherry wood', 'cherrywood',
      'walnut wood', 'oak wood', 'maple wood', 'pine wood', 'bamboo wood',
      'wooden decorative', 'wood decorative', 'decorative wood',
      'handmade wood', 'handcrafted wood', 'hand carved wood',
      'wood craft', 'woodcraft',
    ], 'added wood-type phrases to avoid cherry-fruit mismatch → ch.44');

    console.log(`Applying ${patches.length} rule patches (batch AAAA)...`);
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
    console.log(`\nPatch AAAA complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

patch().catch((err) => { console.error('Fatal:', err); process.exit(1); });
