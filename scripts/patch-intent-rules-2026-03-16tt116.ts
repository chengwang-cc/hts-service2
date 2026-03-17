#!/usr/bin/env ts-node
/**
 * Patch TT116 — 2026-03-16: Fix enamel pins, compression leggings, leather journals.
 *
 * Fix 1: UPDATE ENAMEL_DECORATIVE_PIN_INTENT — add noneOf for "enamel pin/pins"
 *   "Lucifer Enamel Pin 2" → 7319.40 WRONG (expected 7117.90.45.00)
 *   "Enamel Pins (2)" → 7319.40 WRONG (expected 7117.90.55.00)
 *   Root cause: ENAMEL_DECORATIVE_PIN_INTENT fires for "enamel pin/pins" BUT it injects 7319.40
 *   (sewing/safety pins) AND denies ch.71 (imitation jewelry). The correct code 7117.90.xx is ch.71
 *   which gets BLOCKED by denyChapters:['71']. Fix: add noneOf for "enamel pin/pins" so the existing
 *   intent doesn't fire for decorative collectible enamel pins.
 *
 * Fix 2: NEW ENAMEL_COLLECTIBLE_PIN_INTENT → 7117.90 (imitation jewelry, other)
 *   "Lucifer Enamel Pin 2" → expected 7117.90.45.00 (imitation jewelry, valued ≤$1.50/doz)
 *   "Death's-Head Moth Hard-Enamel Pin" → expected 7117.90.75.00
 *   "Hazbin Hotel Alastor CATBOY Pin" → expected 7117.90.45.00
 *   Fix: new high-priority intent targeting "enamel pin/pins" with inject 7117.90 rank 1
 *   and allowChapters:['71'] to force ch.71 imitation jewelry codes.
 *
 * Fix 3: NEW COMPRESSION_LEGGINGS_HOSIERY_INTENT → 6115.10 (graduated compression hosiery)
 *   "Everyday Compression Leggings - Black / L / Regular" → 6104.69 (bib overalls) WRONG
 *   "Everyday Compression Leggings - Black / M / Regular" → 6104.69 WRONG
 *   "41% Nylon, 59% Elastane Compression Leggings" → 6104.69 WRONG
 *   Root cause: "leggings" triggers 6104.69 (trousers/breeches in knit garments chapter).
 *   6115.10 = "Graduated compression hosiery" — medical/therapeutic compression stockings.
 *   Fix: new intent for "compression leggings/stockings" → 6115.10, denyChapters:['61'] (garments).
 *
 * Fix 4: NEW LEATHER_JOURNAL_FLAT_GOOD_INTENT → 4202.21.90.00
 *   "Cognac Leather Journal | A4 size" → 4820.10.20.30 (paper notebook) WRONG
 *   "Cognac Leather Journal | Regular/Standard Size" → 4820.10.20.30 WRONG
 *   Root cause: "journal" strongly triggers ch.48 paper stationery codes.
 *   4202.21.90.00 = flat goods of leather normally carried in pocket/handbag.
 *   A "leather journal" is the leather COVER/CASE, not the paper content.
 *   Fix: new intent for "leather journal" → inject 4202.21, deny 4820 prefix.
 *
 * Fix 5: NEW GRADED_CARD_FRAME_BAMBOO_INTENT → 4421.91.30.00
 *   "Ancient Mew Display Frame | 8x10 or A5 | PSA Graded" → 9504.40 (playing cards) WRONG
 *   "Magikarp Pokemon Card Display Frame | PSA Graded" → 9504.40 WRONG
 *   Root cause: "Pokemon", "Card", "PSA Graded" trigger playing card codes (9504.40).
 *   4421.91.30.00 = bamboo articles consisting of wooden frames in center of which there are
 *   thin sheets of bamboo — these are bamboo picture/display frames.
 *   Fix: new intent targeting display frames for graded/trading cards → inject 4421.91.30.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-16tt116.ts
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

    // 1. UPDATE ENAMEL_DECORATIVE_PIN_INTENT — exclude "enamel pin/pins" from pattern
    //    The intent fires for "enamel pin" queries but injects 7319.40 (sewing pins)
    //    AND denies ch.71. This blocks 7117.90 (imitation jewelry) which is the correct code.
    //    Fix: add noneOf so the intent doesn't fire for generic "enamel pin" queries.
    //    The new ENAMEL_COLLECTIBLE_PIN_INTENT will handle those at higher priority.
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_DECORATIVE_PIN_INTENT');
      if (existing) {
        const currentNoneOf = (existing as any).pattern?.noneOf || [];
        const addNoneOf = [
          // Decorative collectible enamel pins → handled by ENAMEL_COLLECTIBLE_PIN_INTENT
          'enamel pin', 'enamel pins', 'hard enamel pin', 'soft enamel pin',
          'enamel lapel pin', 'collectible enamel', 'hard-enamel pin',
        ];
        const updated = {
          ...existing,
          pattern: {
            ...(existing as any).pattern,
            noneOf: [...new Set([...currentNoneOf, ...addNoneOf])],
          },
        } as IntentRule;
        patches.push({ priority: (existing as any).priority ?? 568, rule: updated });
        console.log('ENAMEL_DECORATIVE_PIN_INTENT: added noneOf for "enamel pin/pins" (defer to ENAMEL_COLLECTIBLE_PIN_INTENT)');
      } else {
        console.log('ENAMEL_DECORATIVE_PIN_INTENT: not found');
      }
    }

    // 2. NEW ENAMEL_COLLECTIBLE_PIN_INTENT → 7117.90 (imitation jewelry, other)
    //    Decorative enamel pins (character, collectible, hard enamel, soft enamel) are
    //    imitation jewelry (7117.90), not sewing/safety pins (7319.40).
    //    ENAMEL_DECORATIVE_PIN_INTENT was blocking ch.71 (correct chapter for 7117.90).
    {
      const existing = allRules.find(r => r.id === 'ENAMEL_COLLECTIBLE_PIN_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'ENAMEL_COLLECTIBLE_PIN_INTENT',
          description: 'Decorative enamel pins (collectible/character) → 7117.90 (imitation jewelry, other)',
          pattern: {
            anyOf: [
              'enamel pin', 'enamel pins',
              'hard enamel pin', 'soft enamel pin',
              'hard enamel pins', 'soft enamel pins',
              'enamel pin badge', 'enamel badge',
              'collectible enamel pin', 'anime enamel pin',
              'character enamel pin', 'character pin',
              'artist pin', 'flair pin',
            ],
            noneOf: [
              // Lapel flag pins / brooch pins → ENAMEL_DECORATIVE_PIN_INTENT
              'flag pin', 'flag lapel pin', 'baby pin', 'diaper pin', 'kilt pin',
              'safety pin', 'hair pin', 'bobby pin',
              // Precious metal → 7113
              'gold pin', 'silver pin', 'sterling pin',
            ],
          },
          inject: [
            { prefix: '7117.90', syntheticRank: 1 },   // imitation jewelry, other (collectible pins)
            { prefix: '7117.19', syntheticRank: 4 },   // base metal imitation jewelry
          ],
          whitelist: {
            allowChapters: ['71'],    // positive filter: only imitation jewelry/precious metals chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '7117.90' },  // very strong boost for collectible pins
            { delta: 0.60, prefixMatch: '7117.' },     // moderate boost for imitation jewelry
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '7319.' },  // penalty for sewing/safety pins (wrong for enamel)
            { delta: 0.90, prefixMatch: '9504.' },  // penalty for games/playing cards
          ],
        } as IntentRule;
        patches.push({ priority: 575, rule: newRule });
        console.log('ENAMEL_COLLECTIBLE_PIN_INTENT: created (enamel pin → 7117.90, allowChapters:[71])');
      } else {
        console.log('ENAMEL_COLLECTIBLE_PIN_INTENT: already exists, skipping');
      }
    }

    // 3. NEW COMPRESSION_LEGGINGS_HOSIERY_INTENT → 6115.10 (graduated compression hosiery)
    //    "compression leggings" → 6104.69.10.00 (bib overalls) WRONG
    //    "leggings" word triggers knitwear chapter (6104.69). But compression leggings are
    //    medical/therapeutic hosiery classified under 6115.10 (graduated compression hosiery).
    {
      const existing = allRules.find(r => r.id === 'COMPRESSION_LEGGINGS_HOSIERY_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'COMPRESSION_LEGGINGS_HOSIERY_INTENT',
          description: 'Compression leggings/stockings → 6115.10 (graduated compression hosiery)',
          pattern: {
            anyOf: [
              'compression leggings', 'compression stocking',
              'compression stockings', 'graduated compression',
              'compression hosiery', 'compression tights',
              'medical compression stocking', 'therapeutic compression',
              'anti-embolism stocking', 'varicose vein stocking',
              'support stocking', 'support stockings',
              'support hose', 'compression sock', 'compression socks',
              'compression leg sleeve',
            ],
            noneOf: [
              // Non-compression socks → different intent
              'ankle sock', 'crew sock', 'no-show sock', 'fuzzy sock',
              // Surgical → 6115.10.05 (handled separately)
              'surgical pantyhose',
            ],
          },
          inject: [
            { prefix: '6115.10', syntheticRank: 1 },    // graduated compression hosiery
            { prefix: '6115.10.10', syntheticRank: 2 },  // of synthetic fibers
            { prefix: '6115.10.15', syntheticRank: 3 },  // of other textile materials
          ],
          whitelist: {
            allowChapters: ['61'],    // only knit garments/hosiery chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '6115.10' },  // very strong boost for compression hosiery
            { delta: 0.60, prefixMatch: '6115.' },     // moderate boost for hosiery
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '6104.' },  // penalty for knitwear (bib overalls/trousers)
            { delta: 0.90, prefixMatch: '6114.' },  // penalty for other garments
          ],
        } as IntentRule;
        patches.push({ priority: 569, rule: newRule });
        console.log('COMPRESSION_LEGGINGS_HOSIERY_INTENT: created (compression leggings → 6115.10, allowChapters:[61])');
      } else {
        console.log('COMPRESSION_LEGGINGS_HOSIERY_INTENT: already exists, skipping');
      }
    }

    // 4. NEW LEATHER_JOURNAL_FLAT_GOOD_INTENT → 4202.21.90.00
    //    "Cognac Leather Journal" is a LEATHER COVER/CASE for a journal (4202.21 flat goods of leather).
    //    "journal" word strongly triggers ch.48 paper stationery (4820.10.20.30 composition books).
    //    Fix: inject 4202.21 at rank 1, deny 4820.xx prefix.
    {
      const existing = allRules.find(r => r.id === 'LEATHER_JOURNAL_FLAT_GOOD_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'LEATHER_JOURNAL_FLAT_GOOD_INTENT',
          description: 'Leather journal covers/cases → 4202.21.90.00 (flat goods of leather)',
          pattern: {
            anyOf: [
              'leather journal', 'leather journals',
              'leather bound journal', 'leather travel journal',
              'genuine leather journal', 'leather journal cover',
              'leather notebook cover', 'leather diary',
              'cognac leather journal', 'leather refillable journal',
            ],
            noneOf: [
              // Raw leather material → ch.41
              'leather piece', 'leather hide', 'leather scrap',
              // PU/faux leather → different classification
              'pu leather journal', 'faux leather journal',
            ],
          },
          inject: [
            { prefix: '4202.21', syntheticRank: 1 },   // flat goods of leather (pocket/handbag type)
            { prefix: '4202.11', syntheticRank: 5 },   // briefcases/attache cases of leather (fallback)
          ],
          whitelist: {
            denyPrefixes: ['4820.'],    // hard-block paper stationery codes
            denyChapters: ['49'],        // hard-block books/printed matter chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4202.21' },  // very strong boost for leather flat goods
            { delta: 0.60, prefixMatch: '4202.' },     // moderate boost for bags/cases
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '4820.' },  // strong penalty for stationery
          ],
        } as IntentRule;
        patches.push({ priority: 573, rule: newRule });
        console.log('LEATHER_JOURNAL_FLAT_GOOD_INTENT: created (leather journal → 4202.21, denyPrefixes:[4820.])');
      } else {
        console.log('LEATHER_JOURNAL_FLAT_GOOD_INTENT: already exists, skipping');
      }
    }

    // 5. NEW GRADED_CARD_FRAME_BAMBOO_INTENT → 4421.91.30.00
    //    "Ancient Mew Display Frame | PSA Graded" → 9504.40 (playing cards) WRONG
    //    "Magikarp Pokemon Card Display Frame" → 9504.40 WRONG
    //    Keywords "Pokemon", "Card", "PSA Graded" trigger playing card codes (9504.40).
    //    4421.91.30.00 = bamboo articles consisting of wooden frames in center (picture frames).
    //    These are bamboo picture/display frames for trading cards.
    {
      const existing = allRules.find(r => r.id === 'GRADED_CARD_FRAME_BAMBOO_INTENT');
      if (!existing) {
        const newRule: IntentRule = {
          id: 'GRADED_CARD_FRAME_BAMBOO_INTENT',
          description: 'Bamboo/wood display frames for graded/trading cards → 4421.91.30.00',
          pattern: {
            anyOf: [
              'card display frame', 'trading card frame',
              'graded card frame', 'psa graded display frame',
              'psa graded frame', 'pokemon card display frame',
              'trading card display', 'tcg display frame',
              'card frame display', 'graded display frame',
              'pokemon display frame', 'sports card frame',
            ],
            noneOf: [
              // Actual game cards → 9504.40
              'playing card deck', 'card game', 'board game',
            ],
          },
          inject: [
            { prefix: '4421.91.30', syntheticRank: 1 },  // bamboo frames (display/picture frames)
            { prefix: '4421.91', syntheticRank: 4 },     // other bamboo articles
            { prefix: '4414.', syntheticRank: 6 },       // wood picture frames
          ],
          whitelist: {
            allowChapters: ['44'],    // positive filter: only wood articles chapter
          },
          boosts: [
            { delta: 0.95, prefixMatch: '4421.91.30' },  // very strong boost
            { delta: 0.60, prefixMatch: '4421.' },        // moderate boost for wood articles
          ],
          penalties: [
            { delta: 0.90, prefixMatch: '9504.' },  // strong penalty for games/playing cards
          ],
        } as IntentRule;
        patches.push({ priority: 574, rule: newRule });
        console.log('GRADED_CARD_FRAME_BAMBOO_INTENT: created (card display frame → 4421.91.30, allowChapters:[44])');
      } else {
        console.log('GRADED_CARD_FRAME_BAMBOO_INTENT: already exists, skipping');
      }
    }

    console.log(`\nApplying ${patches.length} rule patches (batch TT116)...`);
    for (const { rule, priority } of patches) {
      try {
        await svc.upsertRule(rule, priority);
        console.log(`  ✅ ${rule.id}`);
      } catch (e: any) {
        console.error(`  ❌ ${rule.id}: ${e.message}`);
      }
    }
    console.log(`\nPatch TT116 complete: ${patches.length} applied`);
    console.log(`Rules in cache: ${svc.getAllRules().length}`);
  } finally {
    await app.close();
  }
}

patch().catch(err => { console.error(err); process.exit(1); });
