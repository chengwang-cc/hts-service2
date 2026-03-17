#!/usr/bin/env ts-node
/**
 * Patch TT76 — 2026-03-15: Revert sticker routing, add leather articles, enamel pins.
 *
 * Fixes:
 *  1. REVERT STICKER_LABEL_INTENT — remove 3919.90 injection added in TT75
 *     TT75 added 3919.90.10 injection (rank 3) to STICKER_LABEL_INTENT
 *     REGRESSION: Caused 8x exp:49 failures (decalcomanias → 3919 instead of 4908)
 *                 Caused 7x exp:48 failures (paper-based stickers → 3919 instead of 4811)
 *     "100% Vinyl sticker made in Canada" → expected 4908.90 (decalcomania) now routes to 3919
 *     "Vinyl Sticker" → expected 4811.41 (self-adhesive paper) now routes to 3919
 *     FIX: Revert STICKER_LABEL_INTENT to original: inject 4821.10 only, boosts for 4821.
 *
 *  2. NEW LEATHER_ARTICLES_INTENT → 4202/4203 (leather articles)
 *     "Leather Wrist Braces" → 4107 (raw leather/hides!) WRONG (expected 4203.10.40)
 *     "Leather Patch With Field Sharpener" → 4107 WRONG (expected 4202.91.90)
 *     "Leather cover case for earbuds" → 4107 WRONG (expected 4202.99.90)
 *     BUG: "leather" → ch.41 (raw hides/leather by the piece) instead of ch.42 (leather articles)
 *     4202 = travel goods, handbags, cases; 4203 = articles of leather
 *     FIX: New intent for leather articles/accessories → 4202/4203, deny ch.41
 *
 *  3. NEW ENAMEL_DECORATIVE_PIN_INTENT → 7319.40 (iron/steel pins)
 *     "Crying Bunny Enamel Pin" → 7117 (imitation jewelry!) WRONG (expected 7319.40)
 *     "Baby Pin Baby Keepsake Newborn Gift" → 7113 WRONG (expected 7319.40)
 *     "Flag Lapel Pin" → 7117 WRONG (expected 7315.82)
 *     BUG: Enamel pins and decorative pins → jewelry chapter (71) but expected in ch.73 (steel)
 *     7319.40 = safety pins and other pins of iron or steel (includes decorative enamel pins)
 *     FIX: New intent for enamel pins, lapel pins → 7319.40, deny ch.71
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-15tt76.ts
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

    // 1. REVERT STICKER_LABEL_INTENT — remove 3919.90 injection added in TT75
    //    TT75 added 3919.90 rank:3, 3919.10 rank:8 which caused decalcomanias (4908) to route
    //    to 3919 instead, and paper-based sticker queries (4811) to route to 3919.
    //    Restoring original: inject 4821.10 rank:22, boost 0.65 for '4821.'
    {
      const existing = allRules.find(r => r.id === 'STICKER_LABEL_INTENT');
      if (existing) {
        const updated = {
          ...existing,
          inject: [
            { prefix: '4821.10', syntheticRank: 22 }, // paper labels
          ],
          boosts: [
            { delta: 0.65, prefixMatch: '4821.' },    // restored original boost
          ],
        } as IntentRule;
        patches.push({ priority: 0, rule: updated });
        console.log('STICKER_LABEL_INTENT: reverted to original 4821.10 injection (removed 3919 from TT75)');
      } else {
        console.log('STICKER_LABEL_INTENT: not found');
      }
    }

    // 2. NEW LEATHER_ARTICLES_INTENT → 4202/4203 (leather articles vs raw leather)
    //    "Leather Wrist Braces" → 4107 (raw leather!) WRONG (expected 4203.10.40)
    //    "Leather Patch With Field Sharpener" → 4107 WRONG (expected 4202.91.90)
    //    "Leather cover case for earbuds" → 4107 WRONG (expected 4202.99.90)
    //    BUG: "leather" alone → ch.41 (raw hides, leather by the sq ft/meter) not ch.42 (articles)
    //    The LEATHER_GLOVES_INTENT already covers gloves. This covers non-glove leather articles.
    //    4202.91 = travel bags/cases/hunting bags of leather; 4203 = leather sporting/protective articles
    //    FIX: New intent for leather wrist guards, patches, small cases → 4202/4203, deny ch.41
    {
      const existing = allRules.find(r => r.id === 'LEATHER_ARTICLES_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LEATHER_ARTICLES_INTENT',
          description: 'Leather articles (patches, wrist guards, small cases) → ch.42 (4202/4203)',
          pattern: {
            anyOf: [
              // Wrist/arm protection
              'leather wrist brace', 'leather wrist strap', 'leather wristband',
              'leather arm guard', 'leather bracer', 'leather cuff', 'leather archer',
              // Patches and accessories
              'leather patch', 'leather patches', 'leather keychain fob',
              'leather luggage tag', 'leather name tag', 'leather handle wrap',
              'leather cord organizer', 'leather cord wrap',
              // Small cases (not already covered by phone case/laptop intent)
              'leather earbud case', 'leather earphone case', 'leather case for',
              'leather cover for', 'leather sleeve for',
              // Tool rolls / pouches
              'leather tool roll', 'leather tool pouch', 'leather tool wrap',
              'leather knife roll', 'leather strop',
              // Belts, straps (not medical)
              'leather camera strap', 'leather guitar strap', 'leather bag strap',
              'leather watch band', 'leather watch strap',
            ],
            noneOf: [
              // Exclude raw leather (by the piece)
              'leather hide', 'leather skin', 'raw leather', 'crust leather',
              'veg tan leather', 'vegetable tanned', 'chrome tanned',
              // Exclude footwear
              'leather boot', 'leather shoe', 'leather sandal',
              // Exclude gloves (handled by LEATHER_GLOVES_INTENT)
              'leather glove', 'leather mitt',
            ],
          },
          inject: [
            { prefix: '4202.91', syntheticRank: 3 },  // travel bags of leather
            { prefix: '4202.99', syntheticRank: 5 },  // other articles of leather
            { prefix: '4203.10', syntheticRank: 7 },  // leather articles for sport
            { prefix: '4203.29', syntheticRank: 10 }, // leather gloves/mitts (fallback)
          ],
          whitelist: {
            allowChapters: ['42'],                    // leather/composition leather goods
            denyChapters: ['41', '61', '62', '63'],   // deny raw hides/textile
          },
          boosts: [
            { delta: 0.75, prefixMatch: '4202.' },
            { delta: 0.65, prefixMatch: '4203.' },
            { delta: 0.40, chapterMatch: '42' },
          ],
          penalties: [
            { delta: 0.70, chapterMatch: '41' }, // penalize raw leather
          ],
        } as IntentRule;
        patches.push({ priority: 569, rule: newRule });
        console.log('LEATHER_ARTICLES_INTENT: created (leather patches/wrist guards → 4202/4203, deny ch.41)');
      } else {
        console.log('LEATHER_ARTICLES_INTENT: already exists, skipping');
      }
    }

    // 3. NEW ENAMEL_DECORATIVE_PIN_INTENT → 7319.40 (iron/steel pins)
    //    "Crying Bunny Enamel Pin" → 7117 (imitation jewelry) WRONG (expected 7319.40.20.5)
    //    "Baby Pin Baby Keepsake" → 7113 WRONG (expected 7319.40.20.5)
    //    "Flag Lapel Pin" → 7117 WRONG (expected 7315.82.30.0)
    //    BUG: Decorative enamel pins and lapel pins → jewelry (ch.71) instead of steel pins (ch.73)
    //    7319.40 = safety pins and other pins of iron/steel (includes enamel decorative pins)
    //    7315.82 = other chain of iron/steel (some lapel/chain-type pins)
    //    FIX: New intent for enamel/lapel/decorative pins → 7319.40, deny ch.71
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_DECORATIVE_PIN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENAMEL_DECORATIVE_PIN_INTENT',
          description: 'Enamel/lapel/decorative pins → ch.73 (7319.40 iron/steel pins)',
          pattern: {
            anyOf: [
              // Enamel pins
              'enamel pin', 'enamel pins', 'hard enamel pin', 'soft enamel pin',
              'enamel lapel pin', 'enamel badge', 'cloisonne pin',
              // Baby/keepsake pins
              'baby pin', 'baby brooch', 'baby keepsake pin', 'newborn pin',
              // Lapel/hat pins
              'lapel pin', 'lapel pins', 'hat pin', 'hat pins',
              'tie pin', 'tie tack', 'stick pin',
              // Flag/patriotic pins
              'flag lapel pin', 'flag pin', 'flag enamel pin',
              // Brooch (steel/enamel)
              'enamel brooch', 'pin brooch', 'decorative pin',
            ],
            noneOf: [
              // Exclude precious metal jewelry
              'gold pin', 'silver pin', 'gold brooch', 'sterling brooch',
              // Exclude safety pins (functional)
              'diaper pin', 'kilt pin', 'safety pin',
              // Exclude hair accessories
              'hair pin', 'bobby pin', 'hairpin',
              // Exclude sewing pins
              'sewing pin', 'dressmaker pin', 'straight pin',
            ],
          },
          inject: [
            { prefix: '7319.40', syntheticRank: 2 },  // safety pins and other pins of iron/steel
            { prefix: '7319.40.20', syntheticRank: 3 }, // other pins of iron/steel
            { prefix: '7315.82', syntheticRank: 8 },  // other chain (for chain-attached pins)
          ],
          whitelist: {
            allowChapters: ['73'],                    // iron/steel articles only
            denyChapters: ['71', '96'],               // deny jewelry, miscellaneous articles
          },
          boosts: [
            { delta: 0.80, prefixMatch: '7319.' },
            { delta: 0.50, chapterMatch: '73' },
          ],
          penalties: [
            { delta: 0.65, chapterMatch: '71' }, // penalize jewelry chapter
          ],
        } as IntentRule;
        patches.push({ priority: 568, rule: newRule });
        console.log('ENAMEL_DECORATIVE_PIN_INTENT: created (enamel/lapel pins → 7319.40, deny ch.71)');
      } else {
        console.log('ENAMEL_DECORATIVE_PIN_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT76)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT76 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
