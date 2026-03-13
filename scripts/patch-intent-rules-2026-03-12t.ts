#!/usr/bin/env ts-node
/**
 * Patch T — 2026-03-12:
 *
 * Fix 4 more overly-broad rules causing EMPTY results:
 *
 * 1. AI_CH03_MAHI_SNAPPER_GROUPER: bare "ray" in anyOf fires for "X-ray" token
 *    in telecom instruments and X-ray apparatus HTS descriptions → allowChapters:[03]
 *    blocks ch.90 (measuring/optical instruments). Fix: replace "ray" with "stingray"
 *    phrase; add noneOf for X-ray/radiation context.
 *
 * 2. MEAT_BEEF_INTENT: fires for "beef" in "Beef in airtight containers" →
 *    allowChapters:[02] (fresh beef). But airtight containers = prepared meats (ch.16).
 *    No ch.02 entry matches "airtight containers" → score threshold → EMPTY.
 *    Fix: add noneOf=['airtight','canned','preserved','prepared meals'] so the intent
 *    doesn't fire when beef is in a prepared/canned food context.
 *
 * 3. AI_CH56_TWINE_BALER: "hemp" in anyOf fires for "hemp seeds" HTS descriptions
 *    (ch.23 = oilcake/animal feed from hemp seeds) → allowChapters:[56] blocks ch.23.
 *    Fix: add noneOf=['seeds','seed','oilcake','oil cake','meal','cake'] so hemp fiber
 *    intent doesn't fire for hemp seed/oil products.
 *
 * 4. COMIC_INTENT: "graphic" in anyOf fires for "graphic purposes" in paper HTS
 *    descriptions (e.g. "paper for writing printing or other graphic purposes" ch.48).
 *    COMIC_INTENT has a complex denyNonAllowedUnlessEntryHasTokens clause that filters
 *    out non-ch.49 entries unless they contain comic/book tokens, causing EMPTY for
 *    paper queries. Fix: remove "graphic" (too generic — "graphic purposes" ≠ graphic
 *    novel) or add noneOf for paper/printing context.
 *
 * Run:
 *   cd hts-service
 *   npx ts-node -P tsconfig.json -r tsconfig-paths/register scripts/patch-intent-rules-2026-03-12t.ts
 */
import 'tsconfig-paths/register';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IntentRuleService } from '../src/modules/lookup/services/intent-rule.service';
import type { IntentRule } from '../src/modules/lookup/services/intent-rules';

const PATCHES: Array<{ rule: IntentRule; priority: number }> = [

  // ── 1. Fix AI_CH03_MAHI_SNAPPER_GROUPER — remove "ray" (fires for X-ray) ─────
  {
    priority: 640,
    rule: {
      id: 'AI_CH03_MAHI_SNAPPER_GROUPER',
      description: 'Ocean fish (mahi, snapper, grouper, bass, shark...) → ch.03. ' +
        'Removed bare "ray" from anyOf (fires for "X-ray" in medical/telecom equipment ' +
        'HTS descriptions → allowChapters:[03] blocks ch.90). Use "stingray" phrase. ' +
        'Also removed "sole" (fires for "sole leather" in ch.41 descriptions, from patch S). ' +
        'Added noneOf for leather/tanning and X-ray/radiation context.',
      pattern: {
        anyOf: [
          'mahi', 'dolphinfish', 'snapper', 'grouper', 'monkfish', 'swordfish',
          'bass', 'shark',
          'stingray',   // "ray" removed — too generic (X-ray, beta ray, gamma ray)
          'skate', 'pollock', 'haddock', 'mackerel',
          'sardine', 'pilchard', 'herring', 'anchovy', 'flounder',
          'dover sole',    // "sole" removed — fires for "sole leather"
          'lemon sole',
          'plaice', 'turbot', 'perch', 'pike', 'eel', 'mullet', 'sturgeon',
          'sprat', 'capelin', 'smelt', 'whiting', 'lingcod', 'sablefish', 'butterfish',
        ],
        noneOf: [
          // Leather/tanning context (from patch S)
          'leather', 'tanning', 'tanned', 'parchment', 'crusting', 'hide', 'hides',
          // X-ray/radiation context
          'x-ray', 'xray', 'radiograph', 'radiation', 'radiotherapy', 'ionizing',
          'alpha', 'beta', 'gamma',
        ],
      },
      whitelist: { allowChapters: ['03'] },
    },
  },

  // ── 2. Fix MEAT_BEEF_INTENT — exclude airtight/canned/preserved context ───────
  {
    priority: 650,
    rule: {
      id: 'MEAT_BEEF_INTENT',
      description: 'Beef, steak, brisket, sirloin, bovine meat → ch.02. ' +
        'Added noneOf for airtight/canned/prepared context: "beef in airtight containers" ' +
        'belongs to ch.16 (prepared meats), not ch.02 (fresh beef). When allowChapters:[02] ' +
        'fires, no ch.02 entry scores high enough for a preserved-beef query → EMPTY. ' +
        'Also keeps noneOf for leather/tanning context (from patch S).',
      pattern: {
        anyOf: ['beef', 'steak', 'brisket', 'sirloin', 'bovine', 'ground beef'],
        noneOf: [
          // Prepared/canned meat context → ch.16
          'airtight', 'airtight containers', 'canned', 'preserved', 'prepared meals',
          'in oil', 'smoked',
          // Leather/tanning context → ch.41 (from patch S)
          'leather', 'tanning', 'tanned', 'parchment', 'crusting', 'hide', 'hides',
        ],
      },
      whitelist: { allowChapters: ['02'] },
    },
  },

  // ── 3. Fix AI_CH56_TWINE_BALER — exclude seeds/oilcake context ───────────────
  {
    priority: 630,
    rule: {
      id: 'AI_CH56_TWINE_BALER',
      description: 'Twine, baler twine, sisal, jute, hemp fiber, manila → ch.56. ' +
        'Added noneOf for seeds/oilcake context: "hemp" fires for "hemp seeds" HTS ' +
        'descriptions which belong to ch.12 (seeds for sowing) or ch.23 (oilcake/animal ' +
        'feed). Hemp fiber (twine) ≠ hemp seeds (food/feed).',
      pattern: {
        anyOf: [
          'baler twine', 'baling twine', 'sisal twine', 'twine',
          'sisal', 'jute', 'hemp', 'manila',
        ],
        noneOf: [
          // Machinery context (from patch Q)
          'machinery', 'machine', 'machines', 'mower', 'mowers', 'harvesting', 'baling machine',
          // Seeds/oilcake context → ch.12 or ch.23
          'seeds', 'seed', 'oilcake', 'oil cake', 'meal', 'animal feed', 'fodder',
          'residue', 'extraction',
        ],
      },
      whitelist: { allowChapters: ['56'] },
    },
  },

  // ── 4. Fix COMIC_INTENT — remove "graphic" (fires for "graphic purposes" paper) ─
  {
    priority: 640,
    rule: {
      id: 'COMIC_INTENT',
      description: 'Comic books, manga, graphic novels → ch.49 (or deny ch.84 for notebooks). ' +
        'Removed "graphic" from anyOf: "graphic" fires for "graphic purposes" in paper/printing ' +
        'HTS descriptions (ch.48), causing COMIC_INTENT\'s denyNonAllowedUnlessEntryHasTokens ' +
        'clause to filter out all ch.48 entries → EMPTY. ' +
        '"comic", "comics", and "manga" are sufficient to detect comic/manga intent.',
      pattern: {
        anyOf: [
          'comic',
          'comics',
          'manga',
          // "graphic" removed — too generic (fires for "graphic purposes" in paper descriptions)
          'graphic novel',  // use phrase instead
          'graphic novels',
        ],
      },
      whitelist: {
        denyChapters: ['84'],
        denyChaptersIfEntryHasTokens: [
          { tokens: ['diaries', 'diary', 'address', 'exercise', 'composition', 'notebook', 'notebooks'], chapter: '48' },
        ],
        denyNonAllowedUnlessEntryHasTokens: {
          tokens: ['comic', 'comics', 'manga', 'book', 'books', 'periodical', 'periodicals', 'journal', 'magazine', 'newspaper', 'paperbound', 'hardbound'],
          allowedChapters: ['49'],
        },
      },
    },
  },

];

async function patch(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const svc = app.get(IntentRuleService, { strict: false });

    console.log(`Applying ${PATCHES.length} rule patches (batch T)...`);

    let success = 0;
    let failed = 0;

    for (const { rule, priority } of PATCHES) {
      try {
        await svc.upsertRule(rule, priority, true);
        console.log(`  ✅ ${rule.id}`);
        success++;
      } catch (err) {
        console.error(`  ❌ ${rule.id}:`, err);
        failed++;
      }
    }

    await svc.reload();
    console.log(`\nPatch T complete: ${success} applied, ${failed} failed`);
    console.log(`Rules in cache: ${svc.ruleCount}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

patch().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
