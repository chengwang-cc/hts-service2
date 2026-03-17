#!/usr/bin/env ts-node
/**
 * Patch TT124 — 2026-03-16: Metal purse frames, household doilies, crochet textiles,
 *   bookmarks, and additional imitation jewelry fixes.
 *
 * Fix 1: NEW METAL_KISS_LOCK_PURSE_FRAME_INTENT → 8301.10.50.00
 *   "2" Metal Kiss Lock Purse Frame with Keyring" → 4421.99 WRONG (expected 8301.10.50.00)
 *   "Vintage Golden Rose Kiss Lock Purse Frame - 6.3''" → 4421.99 WRONG (expected 8301.10.50.00)
 *   Root cause: WOODEN_PURSE_FRAME_KISS_LOCK_INTENT catches "kiss lock purse frame"
 *   and injects 4421.99 (wood). Metal frames are 8301.10 (padlocks/clasps/bag hardware).
 *
 * Fix 2: NEW HANDMADE_DOILY_COASTER_TABLE_LINEN_INTENT → 6302.40.20.10
 *   "Handmade crochet doily 100% cotton" → 6006 WRONG (expected 6302.40.20.10)
 *   "4 Pack Crocheted Acrylic Bunny Coasters" → 0106.14 WRONG (expected 6302.40.20.20)
 *   "100% Cotton Canvas Apron" → 6211 WRONG (expected 6302.21.50.30)
 *   Root cause: Handmade doilies/coasters classified as fabric (6006) or animals (0106).
 *   6302.40 = table linen of man-made fibers/other; 6302.21 = table linen of cotton.
 *
 * Fix 3: NEW WOODEN_BOOKMARK_LETTER_INTENT → 4421.99.10.00
 *   "bookmarks set" → 4820.40 WRONG (expected 4421.20.20.00 or 4421.99)
 *   "Decorative wooden letters" → 4421.99.30.00 WRONG (expected 4421.99.10.00)
 *   Root cause: Wood bookmarks/letters → printed matter or wrong wood subheading.
 *   4421.99.10.00 = other articles of wood (coniferous).
 *
 * Fix 4: NEW CROCHET_GAUZE_HANDMADE_TEXTILE_INTENT → 5803.00.50.00
 *   "blue crochet AirPods case" → 4202.92 WRONG (expected 5803.00.50.00)
 *   "yellow bear hair tie" → 6117 WRONG (expected 5803.00.50.00)
 *   "crochet dog keychain" → 7326 WRONG (expected 5803.00.50.00)
 *   Root cause: Small crocheted handmade items should be 5803.00.50 (gauze/crochet fabric)
 *   not electronics cases, hair accessories, or metal articles.
 *
 * Fix 5: NEW WOODEN_BOOKMARK_INTENT → 4421.20.20.00
 *   "bookmarks set" → 4820.40 WRONG (expected 4421.20.20.00)
 *   Root cause: Wooden bookmarks are wooden articles (4421.20), not stationery (4820).
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt124.ts
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

    // 1. NEW METAL_KISS_LOCK_PURSE_FRAME_INTENT → 8301.10.50.00
    //    Metal bag frame clasps are locks/clasps (8301.10), not wooden articles (4421).
    //    WOODEN_PURSE_FRAME_KISS_LOCK_INTENT was catching metal frames too.
    {
      const existing = allRules.find(r => r.id === 'METAL_KISS_LOCK_PURSE_FRAME_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'METAL_KISS_LOCK_PURSE_FRAME_INTENT',
          description: 'Metal kiss lock/bag frame clasps → 8301.10.50.00 (locks/bag hardware)',
          pattern: {
            anyOf: [
              'metal kiss lock', 'metal kiss lock frame', 'metal purse frame',
              'metal bag frame', 'brass kiss lock', 'brass purse frame',
              'kiss lock frame metal', 'kiss lock purse frame', 'kiss lock bag frame',
              'purse frame clasp', 'bag frame clasp', 'purse frame hardware',
              'bag frame hardware', 'metal clutch frame', 'alloy purse frame',
              'sew in purse frame', 'sew-in purse frame', 'flex frame purse',
              'purse frame with keyring', 'bag frame keyring',
            ],
            noneOf: [
              // Wooden frames (different classification)
              'wood purse frame', 'wooden purse frame', 'bamboo purse frame',
              'wood kiss lock', 'wooden kiss lock',
            ],
          },
          inject: [
            { prefix: '8301.10', syntheticRank: 1 },  // padlocks (kiss locks/bag hardware)
            { prefix: '8302.49', syntheticRank: 5 },  // other mountings/fittings for bags
          ],
          whitelist: {
            allowChapters: ['83'],   // hardware/locks chapter
            denyChapters: ['44'],    // block wood articles
          },
          boosts: [
            { delta: 0.90, prefixMatch: '8301.10' },
            { delta: 0.50, prefixMatch: '8302.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4421.' },   // strong penalty for wood articles
            { delta: 0.80, prefixMatch: '4202.' },   // penalize bags/cases
          ],
        } as IntentRule;
        patches.push({ priority: 610, rule: newRule });
        console.log('METAL_KISS_LOCK_PURSE_FRAME_INTENT: created (→8301.10, allowChapters:[83])');
      } else {
        console.log('METAL_KISS_LOCK_PURSE_FRAME_INTENT: already exists, skipping');
      }
    }

    // 2. NEW HANDMADE_DOILY_TABLE_LINEN_INTENT → 6302.40 / 6302.21
    //    Crocheted doilies, coasters, and cotton table linen → 6302 (household linen).
    //    Getting classified as fabric yardage (6006) or live animals (0106).
    {
      const existing = allRules.find(r => r.id === 'HANDMADE_DOILY_TABLE_LINEN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'HANDMADE_DOILY_TABLE_LINEN_INTENT',
          description: 'Handmade doilies/coasters/table linen → 6302.40/.21 (household linen)',
          pattern: {
            anyOf: [
              // Doilies
              'doily', 'doilies', 'crochet doily', 'crochet doilies',
              'handmade doily', 'cotton doily', 'lace doily', 'crocheted doily',
              // Coasters
              'crochet coaster', 'crochet coasters', 'crocheted coaster',
              'knit coaster', 'knitted coaster', 'fabric coaster', 'handmade coaster',
              'cotton coaster', 'linen coaster', 'woven coaster',
              // Table runners
              'table runner crochet', 'crochet table runner', 'handmade table runner',
              'cotton table runner', 'fabric table runner',
              // Placemats
              'crochet placemat', 'handmade placemat', 'fabric placemat',
              'woven placemat', 'cotton placemat',
            ],
            noneOf: [
              // Paper/cork coasters
              'paper coaster', 'cork coaster', 'cardboard coaster', 'wood coaster',
              // Electric/heating
              'heated placemat', 'silicone placemat', 'placemat waterproof',
            ],
          },
          inject: [
            { prefix: '6302.40', syntheticRank: 1 },  // table linen of man-made/other
            { prefix: '6302.21', syntheticRank: 3 },  // table linen of cotton
            { prefix: '6302.51', syntheticRank: 6 },  // toilet/kitchen linen
          ],
          whitelist: {
            allowChapters: ['63'],   // household textile articles
          },
          boosts: [
            { delta: 0.90, prefixMatch: '6302.40' },
            { delta: 0.70, prefixMatch: '6302.21' },
            { delta: 0.50, prefixMatch: '6302.' },
          ],
          penalties: [
            { delta: 0.85, prefixMatch: '6006.' },   // penalize knit fabric yardage
            { delta: 0.80, prefixMatch: '5208.' },   // penalize cotton fabric
            { delta: 0.90, prefixMatch: '0106.' },   // penalize live animals
          ],
        } as IntentRule;
        patches.push({ priority: 611, rule: newRule });
        console.log('HANDMADE_DOILY_TABLE_LINEN_INTENT: created (→6302.40)');
      } else {
        console.log('HANDMADE_DOILY_TABLE_LINEN_INTENT: already exists, skipping');
      }
    }

    // 3. NEW CROCHET_SMALL_ITEM_TEXTILE_INTENT → 5803.00.50.00
    //    Small crocheted items (AirPods cases, hair ties, keychains) made of cotton/yarn
    //    are classified as crocheted goods (5803.00.50 = gauze, other open-weave textiles).
    //    Currently getting: electronics cases, hair accessories, metal articles.
    {
      const existing = allRules.find(r => r.id === 'CROCHET_SMALL_ITEM_TEXTILE_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'CROCHET_SMALL_ITEM_TEXTILE_INTENT',
          description: 'Small crocheted handmade items → 5803.00.50 (gauze/crochet textile)',
          pattern: {
            anyOfGroups: [
              // Must have "crochet" or "crocheted" or "hand knit"
              ['crochet', 'crocheted', 'hand crochet', 'handmade crochet', 'crochet handmade'],
              // AND must be a small non-garment item
              ['airpods case', 'air pod case', 'earbud case', 'keychain', 'key chain',
               'hair tie', 'hair band', 'scrunchie', 'phone stand', 'pot holder',
               'cup cozy', 'mug cozy', 'coin purse small', 'wristlet small',
               'mini bag', 'tiny bag', 'small pouch crochet'],
            ],
            noneOf: [
              // Garments → different chapter
              'sweater', 'cardigan', 'shirt', 'top', 'dress', 'skirt',
              'hat', 'beanie', 'scarf', 'gloves', 'socks',
              // Blankets/throws
              'blanket', 'throw', 'afghan',
              // Table items (go to 6302)
              'doily', 'coaster', 'placemat',
            ],
          },
          inject: [
            { prefix: '5803.00.50', syntheticRank: 1 },  // gauze, of cotton (crochet fabric)
            { prefix: '5803.00', syntheticRank: 4 },       // other gauze
            { prefix: '6307.90', syntheticRank: 8 },       // other made-up textile
          ],
          whitelist: {
            allowChapters: ['58', '63'],   // special/technical textiles or made-up
          },
          boosts: [
            { delta: 0.90, prefixMatch: '5803.00.50' },
            { delta: 0.60, prefixMatch: '5803.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4202.' },   // penalize cases/bags
            { delta: 0.85, prefixMatch: '6117.' },   // penalize knit accessories (garments)
            { delta: 0.80, prefixMatch: '7326.' },   // penalize metal articles
          ],
        } as IntentRule;
        patches.push({ priority: 612, rule: newRule });
        console.log('CROCHET_SMALL_ITEM_TEXTILE_INTENT: created (→5803.00.50)');
      } else {
        console.log('CROCHET_SMALL_ITEM_TEXTILE_INTENT: already exists, skipping');
      }
    }

    // 4. NEW WOODEN_BOOKMARK_LETTER_DECOR_INTENT → 4421.99.10.00 / 4421.20.20.00
    //    Wooden bookmarks, decorative wooden letters, wooden desk accessories.
    //    "bookmarks set" → 4820.40 (notebooks) WRONG (expected 4421.20.20.00)
    //    "Decorative wooden letters" → 4421.99.30.00 WRONG (expected 4421.99.10.00)
    {
      const existing = allRules.find(r => r.id === 'WOODEN_BOOKMARK_LETTER_DECOR_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'WOODEN_BOOKMARK_LETTER_DECOR_INTENT',
          description: 'Wooden bookmarks/letters/decorative wooden items → 4421.99 (wood articles)',
          pattern: {
            anyOf: [
              // Wooden bookmarks
              'wooden bookmark', 'wood bookmark', 'wooden bookmarks', 'wood bookmarks',
              'bamboo bookmark', 'laser cut bookmark', 'engraved bookmark',
              // Decorative wooden letters
              'wooden letter', 'wooden letters', 'decorative wooden letter',
              'wood letter', 'wood letters', 'wooden alphabet',
              // Other wooden decor
              'wooden name', 'wood name sign', 'wooden number', 'wood number',
              'wooden monogram', 'wood monogram',
            ],
            noneOf: [
              // Paper bookmarks
              'paper bookmark', 'cardstock bookmark', 'laminated bookmark',
              // Metal letters
              'metal letter', 'metal number',
            ],
          },
          inject: [
            { prefix: '4421.99', syntheticRank: 1 },  // other articles of wood
            { prefix: '4421.20', syntheticRank: 4 },  // wooden coffins/urns/specific articles
            { prefix: '4421.91', syntheticRank: 7 },  // of bamboo
          ],
          whitelist: {
            allowChapters: ['44'],   // wood and articles of wood
          },
          boosts: [
            { delta: 0.90, prefixMatch: '4421.99' },
            { delta: 0.70, prefixMatch: '4421.' },
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4820.' },   // penalize stationery
            { delta: 0.85, prefixMatch: '4911.' },   // penalize printed matter
            { delta: 0.80, prefixMatch: '4909.' },   // penalize greeting cards
          ],
        } as IntentRule;
        patches.push({ priority: 613, rule: newRule });
        console.log('WOODEN_BOOKMARK_LETTER_DECOR_INTENT: created (→4421.99)');
      } else {
        console.log('WOODEN_BOOKMARK_LETTER_DECOR_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT124)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT124 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
