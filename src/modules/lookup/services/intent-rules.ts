/**
 * Declarative intent registry for HTS product search.
 *
 * Each IntentRule fully describes one consumer product intent:
 *   - how to detect it from query tokens
 *   - which HTS prefixes to inject into the candidate pool
 *   - which tokens to strip from lexical search
 *   - which HTS prefixes/chapters to whitelist or deny
 *   - how to score candidates (boost / penalize)
 *
 * NOTE: Rules are now stored in the `lookup_intent_rule` Postgres table (DB-backed).
 * The INTENT_RULES array below is the canonical seed source only — not the runtime source.
 * To add a new rule: INSERT/upsert into lookup_intent_rule, then call IntentRuleService.reload().
 * To do a full re-seed: run scripts/seed-intent-rules.ts.
 *
 * Phase 2 additions:
 *   - detectChapterIntent(): lightweight chapter detection from chapter-terms.ts
 *   - 6 weak chapter-boost rules (delta 0.12–0.15) for major consumer chapters
 *     not already covered by Phase 1 strong rules.
 */

import { CHAPTER_TERMS } from '../constants/chapter-terms';

/**
 * Token pattern for intent detection.
 * A rule fires when ALL conditions below are satisfied simultaneously:
 *   - All `required` tokens are present in the query token set
 *   - At least one `anyOf` token is present (if anyOf is non-empty)
 *   - Every group in `anyOfGroups` has at least one matching token
 *   - None of the `noneOf` tokens are present
 */
export interface TokenPattern {
  /** ALL of these tokens must be present. */
  required?: string[];
  /** AT LEAST ONE of these tokens must be present. */
  anyOf?: string[];
  /**
   * Each inner array is its own independent "at least one" group.
   * ALL groups must have at least one match.
   * Use when a rule requires multiple independent "any of" constraints.
   * Example: phone accessory needs [phone|smartphone|iphone] AND [case|stand|holder|...].
   */
  anyOfGroups?: string[][];
  /** NONE of these tokens may be present. */
  noneOf?: string[];
}

/** Describes an HTS prefix to inject into the fused candidate map when this intent fires. */
export interface InjectSpec {
  /** HTS prefix, e.g. "3926.90". All 10-digit leaf codes under this prefix are injected. */
  prefix: string;
  /** Synthetic rank position (default 40). rrf(rank) = 1/(RRF_K + rank + 1). */
  syntheticRank?: number;
}

/**
 * Hard whitelist / denylist rules for candidate filtering.
 * When an entry fails these checks, it is excluded from results entirely.
 * Applied after the candidate pool is built, before scoring.
 */
export interface WhitelistSpec {
  /** Entry.htsNumber MUST start with one of these prefixes. */
  allowPrefixes?: string[];
  /** Entry.htsNumber MUST NOT start with any of these prefixes. */
  denyPrefixes?: string[];
  /** Entry.chapter MUST be one of these. */
  allowChapters?: string[];
  /** Entry.chapter MUST NOT be any of these. */
  denyChapters?: string[];
  /**
   * Deny entries in a specific chapter when their text contains any of the given tokens.
   * Example: deny ch.48 entries that have stationery vocabulary (diaries, notebooks, etc.).
   */
  denyChaptersIfEntryHasTokens?: { chapter: string; tokens: string[] }[];
  /**
   * Deny entries in a specific chapter UNLESS their text contains any of the given tokens.
   * Example: deny ch.62 entries unless they have tshirt vocabulary.
   */
  denyChapterUnlessEntryHasTokens?: { chapter: string; tokens: string[] }[];
  /**
   * Deny entries NOT in the listed chapters, UNLESS entry text has any of the fallback tokens.
   * Example: deny non-ch.49 entries unless they have media vocabulary (books, comics, etc.).
   */
  denyNonAllowedUnlessEntryHasTokens?: { allowedChapters: string[]; tokens: string[] };
}

/**
 * A single score adjustment (boost or penalty) applied to candidate entries.
 * All conditions must be satisfied for the adjustment to apply.
 */
export interface ScoreAdjustment {
  /** Amount to add (boost) or subtract (penalty). Always positive; the engine handles sign. */
  delta: number;
  /** Apply only if entry.htsNumber starts with this prefix. */
  prefixMatch?: string;
  /** Apply only if entry.chapter equals this value. */
  chapterMatch?: string;
  /** Skip (do not apply) if entry.htsNumber starts with this prefix. */
  denyPrefixMatch?: string;
  /** Skip (do not apply) if entry.chapter equals this value. */
  skipIfChapter?: string;
  /** Apply only if entry token set contains at least one of these tokens. */
  entryMustHaveAnyToken?: string[];
  /** Skip (do not apply) if entry token set contains any of these tokens. */
  skipIfEntryHasAnyToken?: string[];
}

/** A single declarative product-intent rule. */
export interface IntentRule {
  /** Unique identifier used for logging, testing, and inter-rule interactions. */
  id: string;
  /** Human-readable description of the product this rule targets. */
  description: string;
  /** Token pattern that must match for this rule to fire. */
  pattern: TokenPattern;
  /** Tokens to strip from lexical search when this rule fires. */
  lexicalFilter?: { stripTokens?: string[] };
  /** HTS prefixes to inject into the fused candidate map when this rule fires. */
  inject?: InjectSpec[];
  /** Hard entry whitelist / denylist applied before scoring. */
  whitelist?: WhitelistSpec;
  /** Score boosts applied to matching candidate entries. */
  boosts?: ScoreAdjustment[];
  /** Score penalties applied to mismatched candidate entries. Always positive deltas. */
  penalties?: ScoreAdjustment[];
}

/**
 * Pure function: given the query token set, return all IntentRules that fire.
 * No database access; safe to call from any context.
 *
 * @deprecated Use IntentRuleService.matchRules() for the DB-backed runtime path.
 * This function operates on the static INTENT_RULES seed array, not the live DB.
 */
export function matchRules(tokens: Set<string>, queryLower = ''): IntentRule[] {
  return INTENT_RULES.filter((rule) => patternMatches(rule.pattern, tokens, queryLower));
}

/**
 * Lightweight chapter intent detection using CHAPTER_TERMS.strongTokens.
 *
 * Returns the list of HTS chapter codes that the query token set likely targets.
 * A chapter fires when ANY of its strongTokens is present in the query.
 *
 * This is used by Phase 2 weak chapter-boost rules and for analytics/logging.
 * Strong single-token signals only — multi-word phrases are not evaluated here.
 *
 * @param tokens - query token set (lowercased)
 * @returns array of 2-digit chapter codes (e.g. ["64", "42"])
 */
export function detectChapterIntent(tokens: Set<string>): string[] {
  const chapters: string[] = [];
  for (const [chapter, entry] of Object.entries(CHAPTER_TERMS)) {
    if (entry.strongTokens.some((token) => tokens.has(token))) {
      chapters.push(chapter);
    }
  }
  return chapters;
}

/** Exported so IntentRuleService can reuse the matching logic without duplicating it. */
/**
 * Check whether a token or phrase matches.
 * Single-word tokens are checked against the token set (exact, fast).
 * Multi-word phrases (containing spaces) are checked as substrings of the
 * normalized raw query so rules like anyOf:['board game','playing card'] work.
 */
function tokenOrPhraseMatches(t: string, tokens: Set<string>, queryLower: string): boolean {
  return t.includes(' ') ? queryLower.includes(t) : tokens.has(t);
}

export function patternMatches(
  pattern: TokenPattern,
  tokens: Set<string>,
  /** Lowercase normalized query string — enables multi-word phrase matching */
  queryLower = '',
): boolean {
  if (pattern.required) {
    for (const t of pattern.required) {
      if (!tokenOrPhraseMatches(t, tokens, queryLower)) return false;
    }
  }
  if (pattern.anyOf && pattern.anyOf.length > 0) {
    if (!pattern.anyOf.some((t) => tokenOrPhraseMatches(t, tokens, queryLower))) return false;
  }
  if (pattern.anyOfGroups) {
    for (const group of pattern.anyOfGroups) {
      if (group.length > 0 && !group.some((t) => tokenOrPhraseMatches(t, tokens, queryLower))) return false;
    }
  }
  if (pattern.noneOf) {
    for (const t of pattern.noneOf) {
      if (tokenOrPhraseMatches(t, tokens, queryLower)) return false;
    }
  }
  return true;
}

// ── Token vocabulary sets referenced by multiple rules ────────────────────────

const MEDIA_RESULT_HINT_TOKENS = [
  'comic', 'comics', 'manga', 'book', 'books',
  'periodical', 'periodicals', 'journal', 'magazine', 'newspaper',
  'paperbound', 'hardbound',
];

const TSHIRT_RESULT_HINT_TOKENS = [
  'tshirt', 'tshirts', 'tee', 'crew', 'neckline', 'undershirt',
];

const APPAREL_RESULT_HINT_TOKENS = [
  'tshirt', 'tshirts', 'shirt', 'shirts', 'tee', 'apparel',
  'garment', 'pullover', 'jersey', 'undershirt', 'singlet',
];

// ── INTENT_RULES ─────────────────────────────────────────────────────────────

export const INTENT_RULES: IntentRule[] = [

  // ── Rule 1: MEDIA_INTENT ───────────────────────────────────────────────────
  // Books, comics, manga, periodicals → ch.49 (printed matter)
  {
    id: 'MEDIA_INTENT',
    description: 'Printed media (books, comics, manga, periodicals) → chapter 49',
    pattern: {
      anyOf: ['comic', 'comics', 'manga', 'book', 'books', 'periodical', 'periodicals', 'journal', 'magazine', 'newspaper', 'graphic'],
    },
    boosts: [
      { delta: 0.38, chapterMatch: '49' },
      { delta: 0.42, entryMustHaveAnyToken: MEDIA_RESULT_HINT_TOKENS },
    ],
  },

  // ── Rule 2: COMIC_INTENT ───────────────────────────────────────────────────
  // Comics / manga specifically → 4901.99, 4902 (printed books/periodicals)
  {
    id: 'COMIC_INTENT',
    description: 'Comics/manga → 4901.99.00.9x, 4902; hard-filter ch.84 machinery and ch.48 stationery',
    pattern: {
      anyOf: ['comic', 'comics', 'manga', 'graphic'],
    },
    whitelist: {
      // Deny ch.84 (printing machinery) — lifted if MANUFACTURING_INTENT also fires
      denyChapters: ['84'],
      // Deny ch.48 entries that have stationery vocabulary
      denyChaptersIfEntryHasTokens: [
        {
          chapter: '48',
          tokens: ['diaries', 'diary', 'address', 'exercise', 'composition', 'notebook', 'notebooks'],
        },
      ],
      // Deny non-ch.49 entries that lack media vocabulary
      denyNonAllowedUnlessEntryHasTokens: {
        allowedChapters: ['49'],
        tokens: MEDIA_RESULT_HINT_TOKENS,
      },
    },
    boosts: [
      { delta: 0.48, prefixMatch: '4901.99.00.9' },
      { delta: 0.48, prefixMatch: '4902.' },
      {
        delta: 0.35,
        entryMustHaveAnyToken: ['comic', 'comics', 'manga', 'graphic', 'pages', 'covers', 'periodical', 'periodicals'],
      },
      {
        delta: 0.18,
        entryMustHaveAnyToken: ['page', 'pages', 'excluding', 'covers'],
      },
    ],
    penalties: [
      // ch.48 stationery → strong penalty (also hard-filtered, belt-and-suspenders)
      {
        delta: 0.70,
        chapterMatch: '48',
        entryMustHaveAnyToken: ['diaries', 'diary', 'address', 'exercise', 'composition', 'notebook', 'notebooks'],
      },
      // ch.84 printing machinery → strong penalty (also hard-filtered unless MANUFACTURING_INTENT)
      {
        delta: 0.80,
        chapterMatch: '84',
        entryMustHaveAnyToken: ['machinery', 'machine', 'parts', 'printing', 'binding', 'bind'],
      },
      // Non-ch.49 without media vocabulary → moderate penalty
      // (skip if ch.49 OR entry has media tokens — equivalent to original condition)
      {
        delta: 0.35,
        skipIfChapter: '49',
        skipIfEntryHasAnyToken: MEDIA_RESULT_HINT_TOKENS,
      },
    ],
  },

  // ── Rule 3: TRANSFORMER_MEDIA ──────────────────────────────────────────────
  // "transformer" in a media context → fictional character, NOT electrical transformer
  {
    id: 'TRANSFORMER_MEDIA',
    description: '"Transformer" character in media context → suppress ch.85 electrical transformers',
    pattern: {
      anyOf: ['transformer', 'transformers'],
      anyOfGroups: [
        ['comic', 'comics', 'manga', 'book', 'books', 'periodical', 'periodicals', 'journal', 'magazine', 'newspaper', 'graphic'],
      ],
    },
    lexicalFilter: {
      // Strip "transformer/transformers" to prevent ch.85 electrical match flooding
      stripTokens: ['transformer', 'transformers'],
    },
    penalties: [
      {
        delta: 1.05,
        chapterMatch: '85',
        entryMustHaveAnyToken: ['transformer', 'transformers', 'electrical', 'voltage', 'coil', 'core', 'wound', 'stacked'],
      },
    ],
  },

  // ── Rule 4: MANUFACTURING_INTENT ───────────────────────────────────────────
  // Query explicitly about manufacturing equipment — used as a modifier by COMIC_INTENT
  // to allow ch.84 results when the user is asking about printing/binding machines.
  {
    id: 'MANUFACTURING_INTENT',
    description: 'Manufacturing/industrial equipment — lifts COMIC_INTENT ch.84 denial',
    pattern: {
      anyOf: ['machine', 'machinery', 'printer', 'printing', 'equipment', 'industrial'],
    },
    // No boosts/penalties: this rule acts as a flag that other rules can check.
  },

  // ── Rule 5: APPAREL_INTENT ─────────────────────────────────────────────────
  // T-shirts, shirts, apparel → ch.61/62 (knitted/woven clothing)
  {
    id: 'APPAREL_INTENT',
    description: 'Apparel/clothing → chapters 61 (knit) and 62 (woven)',
    pattern: {
      anyOf: ['tshirt', 'tshirts', 'shirt', 'shirts', 'tee', 'apparel', 'garment', 'clothing'],
    },
    boosts: [
      { delta: 0.35, chapterMatch: '61' },
      { delta: 0.35, chapterMatch: '62' },
      { delta: 0.30, entryMustHaveAnyToken: APPAREL_RESULT_HINT_TOKENS },
    ],
    penalties: [
      // ch.52 yarn/thread entries that surface due to cotton/fabric tokens
      {
        delta: 0.45,
        chapterMatch: '52',
        entryMustHaveAnyToken: ['yarn', 'spun', 'thread', 'fiber', 'fibers', 'filament'],
      },
    ],
  },

  // ── Rule 6: COTTON_APPAREL ─────────────────────────────────────────────────
  // "cotton" modifier on apparel → extra boost for cotton-chapter entries
  {
    id: 'COTTON_APPAREL',
    description: '"Cotton" modifier on apparel → extra boost for ch.61/62 entries',
    pattern: {
      required: ['cotton'],
      anyOf: ['tshirt', 'tshirts', 'shirt', 'shirts', 'tee', 'apparel', 'garment', 'clothing'],
    },
    boosts: [
      { delta: 0.08, chapterMatch: '61' },
      { delta: 0.08, chapterMatch: '62' },
    ],
  },

  // ── Rule 7: TSHIRT_INTENT ──────────────────────────────────────────────────
  // T-shirt specifically → 6109 (knitted T-shirts/singlets/vests)
  {
    id: 'TSHIRT_INTENT',
    description: 'T-shirt → 6109 (knit T-shirts/singlets); hard-filter ch.62 non-tshirt entries',
    pattern: {
      anyOf: ['tshirt', 'tshirts'],
    },
    whitelist: {
      // Deny ch.62 (woven apparel) entries that lack tshirt vocabulary
      denyChapterUnlessEntryHasTokens: [
        { chapter: '62', tokens: TSHIRT_RESULT_HINT_TOKENS },
      ],
      // Deny non-ch.61/62 entries that lack tshirt vocabulary
      denyNonAllowedUnlessEntryHasTokens: {
        allowedChapters: ['61', '62'],
        tokens: TSHIRT_RESULT_HINT_TOKENS,
      },
    },
    boosts: [
      { delta: 0.55, prefixMatch: '6109.' },
      { delta: 0.30, entryMustHaveAnyToken: TSHIRT_RESULT_HINT_TOKENS },
    ],
    penalties: [
      // "Subject to cotton restraints" entries are administrative headings, not products
      { delta: 0.55, chapterMatch: '61', entryMustHaveAnyToken: ['restraints'] },
      // ch.62 (woven) without tshirt vocabulary — belt-and-suspenders with whitelist
      {
        delta: 0.75,
        chapterMatch: '62',
        skipIfEntryHasAnyToken: TSHIRT_RESULT_HINT_TOKENS,
      },
    ],
  },

  // ── Rule 8: PHONE_ACCESSORY_INTENT ────────────────────────────────────────
  // Phone case/stand/holder → ch.39 plastic articles (3926.90)
  {
    id: 'PHONE_ACCESSORY_INTENT',
    description: 'Phone case/cover/stand/holder → 3926.90 (other articles of plastics)',
    pattern: {
      anyOfGroups: [
        ['phone', 'smartphone', 'iphone'],
        ['case', 'stand', 'holder', 'grip', 'mount', 'cover', 'silicone'],
      ],
    },
    lexicalFilter: {
      // Strip tokens that cause wrong chapters to dominate:
      // "phone" → expands to "telephone" → floods ch.85 handsets
      // "case" → matches ch.42 attache/briefcases via lexical search
      stripTokens: ['phone', 'phones', 'smartphone', 'smartphones', 'iphone', 'case'],
    },
    inject: [
      { prefix: '3926.90', syntheticRank: 40 },
    ],
    whitelist: {
      // Hard restrict: only manufactured plastic articles (3926.xx)
      allowPrefixes: ['3926.'],
    },
    boosts: [
      { delta: 0.55, chapterMatch: '39' },
      { delta: 0.45, prefixMatch: '3926.90' },
    ],
    penalties: [
      { delta: 0.65, chapterMatch: '42' },
      {
        delta: 0.55,
        chapterMatch: '85',
        entryMustHaveAnyToken: ['loudspeaker', 'microphone', 'amplifier'],
      },
      // Raw plastic materials (sheets, films, primary forms) — not manufactured articles
      {
        delta: 0.55,
        chapterMatch: '39',
        denyPrefixMatch: '3926.90',
        entryMustHaveAnyToken: ['primary', 'sheet', 'film', 'foil', 'plate'],
      },
    ],
  },

  // ── Rule 9: KEYCHAIN_METAL_INTENT ─────────────────────────────────────────
  // Metal keychain → 7326 (other articles of iron/steel)
  {
    id: 'KEYCHAIN_METAL_INTENT',
    description: 'Metal keychain → 7326.20 (wire articles) and 7326.90 (other iron/steel articles)',
    pattern: {
      anyOf: ['keychain', 'keychains'],
      // Must NOT have plastic/acrylic material tokens (those go to KEYCHAIN_ACRYLIC_INTENT)
      noneOf: ['acrylic', 'resin', 'pvc', 'plastic'],
    },
    inject: [
      { prefix: '7326.20', syntheticRank: 40 },
      { prefix: '7326.90', syntheticRank: 45 },
    ],
    boosts: [
      { delta: 0.55, prefixMatch: '7326.' },
      { delta: 0.30, prefixMatch: '7326.20' },
    ],
    penalties: [
      { delta: 0.65, prefixMatch: '7323.' },
      { delta: 0.65, prefixMatch: '8301.' },
    ],
  },

  // ── Rule 10: KEYCHAIN_ACRYLIC_INTENT ──────────────────────────────────────
  // Acrylic/plastic keychain → 3926.40 (plastic ornamental/decorative articles)
  {
    id: 'KEYCHAIN_ACRYLIC_INTENT',
    description: 'Acrylic/plastic keychain → 3926.40 (plastic statuettes/ornamental articles)',
    pattern: {
      anyOf: ['keychain', 'keychains'],
      // MUST have plastic/acrylic material token
      anyOfGroups: [
        ['acrylic', 'resin', 'pvc', 'plastic'],
      ],
    },
    inject: [
      { prefix: '3926.40', syntheticRank: 40 },
    ],
    whitelist: {
      allowPrefixes: ['3926.'],
    },
    boosts: [
      { delta: 0.65, prefixMatch: '3926.40' },
      { delta: 0.25, chapterMatch: '39' },
    ],
    penalties: [
      { delta: 0.65, prefixMatch: '7326.' },
      { delta: 0.65, prefixMatch: '8302.' },
    ],
  },

  // ── Rule 11: SOCK_PLAIN_INTENT ─────────────────────────────────────────────
  // Plain (non-compression) socks → 6115.9x (cotton hosiery)
  {
    id: 'SOCK_PLAIN_INTENT',
    description: 'Plain socks → 6115.9x (cotton hosiery), not compression/support hosiery',
    pattern: {
      anyOf: ['sock', 'socks'],
      noneOf: ['compression', 'support', 'therapeutic'],
    },
    boosts: [
      { delta: 0.40, prefixMatch: '6115.9' },
    ],
    penalties: [
      { delta: 0.50, prefixMatch: '6115.10' },
      { delta: 0.50, prefixMatch: '6115.29' },
    ],
  },

  // ── Rule 12: SOCK_COMPRESSION_INTENT ──────────────────────────────────────
  // Compression/support socks → 6115.10 (graduated compression hosiery)
  {
    id: 'SOCK_COMPRESSION_INTENT',
    description: 'Compression/support socks → 6115.10 (graduated compression hosiery)',
    pattern: {
      anyOf: ['sock', 'socks'],
      anyOfGroups: [
        ['compression', 'support', 'therapeutic'],
      ],
    },
    boosts: [
      { delta: 0.55, prefixMatch: '6115.10' },
    ],
    penalties: [
      { delta: 0.45, prefixMatch: '6115.9' },
    ],
  },

  // ── Rule 13: EARBUD_INTENT ─────────────────────────────────────────────────
  // Earbuds/earphones → 8518.30 (headphones/earphones), NOT 8517 (phones/handsets)
  {
    id: 'EARBUD_INTENT',
    description: 'Earbuds/earphones → 8518.30 (headphones/earphones), hard-filter 8517 phones',
    pattern: {
      anyOf: ['earbud', 'earbuds', 'earphone', 'earphones'],
    },
    whitelist: {
      denyPrefixes: ['8517.'],
    },
    boosts: [
      { delta: 0.55, prefixMatch: '8518.30' },
      { delta: 0.25, prefixMatch: '8518.' },
    ],
  },

  // ── Rule 14: PLATED_JEWELRY_INTENT ────────────────────────────────────────
  // Plated jewelry → 7117 (imitation jewelry), NOT 7113 (articles of precious metal)
  {
    id: 'PLATED_JEWELRY_INTENT',
    description: '"Plated" jewelry → 7117 (imitation jewelry), not 7113 (precious metal)',
    pattern: {
      required: ['plated'],
    },
    boosts: [
      { delta: 0.65, prefixMatch: '7117.' },
      // ch.71 but NOT precious metal (7113.xx)
      { delta: 0.20, chapterMatch: '71', denyPrefixMatch: '7113.' },
    ],
    penalties: [
      { delta: 0.70, prefixMatch: '7113.' },
    ],
  },

  // ── Rule 15: LAPTOP_CASE_INTENT ────────────────────────────────────────────
  // Laptop sleeve/case/bag → 4202.12 (briefcase-style computer cases)
  {
    id: 'LAPTOP_CASE_INTENT',
    description: 'Laptop sleeve/case/bag → 4202.12 briefcase-style; deny silk/exotic subheadings (4202.12.89) and 4202.92',
    pattern: {
      anyOf: ['laptop', 'notebooks'],
      anyOfGroups: [
        ['sleeve', 'sleeves', 'case', 'bag', 'bags', 'holder'],
      ],
    },
    inject: [
      { prefix: '4202.12.29', syntheticRank: 25 },
      { prefix: '4202.12.21', syntheticRank: 30 },
    ],
    whitelist: {
      denyPrefixes: ['4202.92', '4202.12.89'],
    },
    boosts: [
      { delta: 0.70, prefixMatch: '4202.12.29' },
      { delta: 0.65, prefixMatch: '4202.12.21' },
      { delta: 0.45, prefixMatch: '4202.12' },
    ],
    penalties: [
      { delta: 0.90, prefixMatch: '4202.12.89' },
      { delta: 0.60, prefixMatch: '4202.92' },
    ],
  },

  // ── Rule 16: SHOPPING_BAG_INTENT ───────────────────────────────────────────
  // Tote/shopping bag → 4202.92 (textile shopping/sports bags)
  {
    id: 'SHOPPING_BAG_INTENT',
    description: 'Tote/shopping bag → 4202.92 (textile shopping/travel bags)',
    pattern: {
      anyOf: ['tote', 'shopping'],
      anyOfGroups: [
        ['bag', 'bags'],
      ],
    },
    whitelist: {
      denyPrefixes: ['4202.12'],
    },
    boosts: [
      { delta: 0.55, prefixMatch: '4202.92' },
    ],
    penalties: [
      { delta: 0.55, prefixMatch: '4202.12' },
    ],
  },

  // ── Rule 17: WATER_BOTTLE_INTENT ───────────────────────────────────────────
  // Water bottle/flask → 7323.93/94 (stainless steel/other metal) or 3924.10 (plastic)
  // Deny 8422 (dishwasher parts), 7323.10 (pot scourers), 7324 (sanitary ware)
  {
    id: 'WATER_BOTTLE_INTENT',
    description: 'Water bottle/flask → 7323.93/94 (stainless/metal) or 3924.10 (plastic drinkware)',
    pattern: {
      anyOf: ['bottle', 'bottles', 'flask'],
    },
    inject: [
      { prefix: '7323.93', syntheticRank: 22 },
      { prefix: '7323.94', syntheticRank: 24 },
      { prefix: '3924.10', syntheticRank: 30 },
    ],
    whitelist: {
      denyPrefixes: ['8422.', '7324.', '7323.10'],
    },
    boosts: [
      { delta: 0.75, prefixMatch: '7323.93' },
      { delta: 0.70, prefixMatch: '7323.94' },
      { delta: 0.55, prefixMatch: '3924.10' },
    ],
    penalties: [
      { delta: 0.90, prefixMatch: '7323.10' },
      { delta: 0.70, prefixMatch: '7324.' },
      { delta: 0.90, prefixMatch: '8422.' },
      // Teakettles, bakeware — not drinking water bottles
      { delta: 0.70, entryMustHaveAnyToken: ['teakettle', 'teakettles', 'kettle', 'kettles', 'bakeware', 'oven'] },
    ],
  },

  // ── Phase 2 weak chapter-boost rules (delta 0.12–0.15) ───────────────────
  // These fire on highly distinctive tokens that unambiguously indicate a
  // chapter. They coexist with Phase 1 strong rules — if both fire for the
  // same chapter, the deltas stack (e.g. APPAREL_INTENT+0.35 and the weak
  // ch.61 rule are independent and may reinforce each other).
  // Only VERY distinctive tokens are used to minimize false positives.

  // ── Rule 18: FOOTWEAR_INTENT (weak) ────────────────────────────────────────
  {
    id: 'FOOTWEAR_INTENT',
    description: 'Footwear → chapter 64 (weak boost; distinctive tokens only)',
    pattern: {
      anyOf: ['sneaker', 'sneakers', 'loafer', 'loafers', 'stiletto', 'stilettos',
               'moccasin', 'moccasins', 'slipper', 'slippers', 'espadrille', 'espadrilles',
               'sandal', 'sandals', 'boots'],
    },
    boosts: [
      { delta: 0.15, chapterMatch: '64' },
    ],
    penalties: [
      { delta: 0.35, chapterMatch: '87', entryMustHaveAnyToken: ['vehicle', 'automobile', 'truck', 'motorcycle'] },
    ],
  },

  // ── Rule 19: FURNITURE_INTENT (weak) ───────────────────────────────────────
  {
    id: 'FURNITURE_INTENT',
    description: 'Furniture → chapter 94 (weak boost; distinctive tokens only)',
    pattern: {
      anyOf: ['sofa', 'couch', 'loveseat', 'recliner', 'armchair', 'ottoman',
               'mattress', 'bookcase', 'bookshelf', 'dresser', 'nightstand',
               'wardrobe', 'armoire', 'credenza', 'chandelier'],
    },
    boosts: [
      { delta: 0.15, chapterMatch: '94' },
    ],
  },

  // ── Rule 20: TOY_GAME_INTENT (weak) ────────────────────────────────────────
  {
    id: 'TOY_GAME_INTENT',
    description: 'Toys and games → chapter 95 (weak boost; brand-safe distinctive tokens)',
    pattern: {
      anyOf: ['lego', 'playmobil', 'barbie', 'nerf', 'jigsaw', 'trampoline',
               'playstation', 'xbox', 'nintendo', 'gameboy'],
    },
    boosts: [
      { delta: 0.12, chapterMatch: '95' },
    ],
  },

  // ── Rule 21: COSMETIC_INTENT (weak) ────────────────────────────────────────
  {
    id: 'COSMETIC_INTENT',
    description: 'Cosmetics and personal care → chapter 33 (weak boost)',
    pattern: {
      anyOf: ['lipstick', 'mascara', 'eyeshadow', 'concealer', 'blush', 'bronzer',
               'highlighter', 'eyeliner', 'moisturizer', 'serum', 'toner', 'primer',
               'cologne', 'deodorant', 'antiperspirant', 'sunscreen', 'sunblock'],
    },
    boosts: [
      { delta: 0.15, chapterMatch: '33' },
    ],
  },

  // ── Rule 22: JEWELRY_INTENT (weak) ─────────────────────────────────────────
  // Note: 'ring' alone is too ambiguous; use compound tokens instead.
  {
    id: 'JEWELRY_INTENT',
    description: 'Jewelry → chapter 71 (weak boost; "necklace/bracelet/earring" etc.)',
    pattern: {
      anyOf: ['necklace', 'bracelet', 'earring', 'earrings', 'pendant',
               'brooch', 'locket', 'anklet', 'cufflink', 'cufflinks', 'tiara'],
    },
    boosts: [
      { delta: 0.12, chapterMatch: '71' },
    ],
  },

  // ── Rule 23: HOME_APPLIANCE_INTENT (weak) ──────────────────────────────────
  {
    id: 'HOME_APPLIANCE_INTENT',
    description: 'Home appliances → chapter 84 (weak boost; distinctive appliance tokens)',
    pattern: {
      anyOf: ['refrigerator', 'dishwasher', 'microwave', 'dehumidifier', 'humidifier',
               'espresso'],
    },
    boosts: [
      { delta: 0.12, chapterMatch: '84' },
    ],
  },

  // ── Rule 24: DRINKWARE_INTENT ───────────────────────────────────────────────
  // Coffee mug, cup, tea cup → 6911/6912 (ceramic) or 7013 (glass)
  // Deny ch.09 (coffee/tea commodities) which overwhelms lexical search for "coffee mug"
  {
    id: 'DRINKWARE_INTENT',
    description: 'Mugs/cups (drinkware) → ch.69 ceramic cups or ch.70 glass; deny ch.09 coffee/tea commodities',
    pattern: {
      anyOf: ['mug', 'mugs', 'cup', 'cups'],
    },
    inject: [
      { prefix: '6911.10', syntheticRank: 30 },
      { prefix: '6912.00', syntheticRank: 33 },
      { prefix: '7013.28', syntheticRank: 36 },
    ],
    whitelist: {
      denyChapters: ['09'],
    },
    boosts: [
      { delta: 0.65, chapterMatch: '69' },
      { delta: 0.50, chapterMatch: '70', entryMustHaveAnyToken: ['cup', 'drinking', 'glass', 'tumbler'] },
    ],
    penalties: [
      { delta: 0.90, chapterMatch: '09' },
    ],
  },

  // ── Rule 25: BASEBALL_CAP_INTENT ───────────────────────────────────────────
  // Baseball cap / sports cap → ch.65 (headwear 6505)
  // Deny ch.95 sporting goods (baseballs, sports balls)
  {
    id: 'BASEBALL_CAP_INTENT',
    description: 'Baseball cap → ch.65 headwear (6505); deny ch.95 sporting goods',
    pattern: {
      required: ['baseball'],
      anyOf: ['cap', 'caps', 'hat', 'hats', 'headwear', 'headgear'],
    },
    inject: [
      { prefix: '6505.00', syntheticRank: 30 },
    ],
    whitelist: {
      denyChapters: ['95'],
    },
    boosts: [
      { delta: 0.75, chapterMatch: '65' },
    ],
    penalties: [
      { delta: 0.90, chapterMatch: '95' },
    ],
  },

  // ── Rule 26: COOKWARE_INTENT ────────────────────────────────────────────────
  // Frying pan, skillet, pot, saucepan → 7323.93/94 (stove-top cookware)
  // Deny ch.85 electronics ("flat panel" match from "pan"), bakeware subheadings
  {
    id: 'COOKWARE_INTENT',
    description: 'Cookware (frying pan, skillet, pot) → 7323.93/94/7615 stove-top; deny ch.85 and bakeware',
    pattern: {
      anyOf: ['frying', 'skillet', 'saucepan', 'cookware', 'wok', 'casserole',
               'stockpot', 'saucier'],
    },
    inject: [
      { prefix: '7323.93', syntheticRank: 22 },
      { prefix: '7323.94', syntheticRank: 25 },
      { prefix: '7615.10', syntheticRank: 30 },
      { prefix: '7615.19', syntheticRank: 33 },
    ],
    whitelist: {
      denyChapters: ['85', '84'],
    },
    boosts: [
      { delta: 0.75, prefixMatch: '7323.93' },
      { delta: 0.70, prefixMatch: '7323.94' },
      { delta: 0.65, prefixMatch: '7615.10' },
      { delta: 0.60, prefixMatch: '7615.19' },
    ],
    penalties: [
      { delta: 0.90, chapterMatch: '85' },
      { delta: 0.70, chapterMatch: '84' },
      // Penalize bakeware and kettle entries — frying pans are stove-top, not oven-only or kettles
      { delta: 0.80, entryMustHaveAnyToken: ['bakeware', 'oven', 'kettle', 'teakettle', 'teakettles', 'kettles'] },
    ],
  },

  // ── Rule 27: PAN_COOKWARE_INTENT ────────────────────────────────────────────
  // "pan" alone with cooking context → cookware; deny ch.85/84 electronics/machinery
  {
    id: 'PAN_COOKWARE_INTENT',
    description: '"pan" with cooking context → cookware; deny electronics/machinery',
    pattern: {
      anyOf: ['pan', 'pans'],
      noneOf: ['solar', 'satellite', 'display', 'flat', 'panel'],
    },
    whitelist: {
      denyChapters: ['85', '84'],
    },
    boosts: [
      { delta: 0.55, prefixMatch: '7323.' },
      { delta: 0.45, prefixMatch: '7615.' },
    ],
    penalties: [
      { delta: 0.85, chapterMatch: '85' },
    ],
  },

  // ── Rule 28: FITNESS_WEIGHT_INTENT ─────────────────────────────────────────
  // Dumbbell, barbell, weight plates → 9506.91 (sports/fitness equipment)
  {
    id: 'FITNESS_WEIGHT_INTENT',
    description: 'Dumbbells/barbells/weights → 9506.91 fitness equipment',
    pattern: {
      anyOf: ['dumbbell', 'dumbbells', 'barbell', 'barbells', 'kettlebell', 'kettlebells'],
    },
    inject: [
      { prefix: '9506.91', syntheticRank: 30 },
    ],
    whitelist: {
      denyChapters: ['82', '84'],
    },
    boosts: [
      { delta: 0.75, chapterMatch: '95' },
    ],
    penalties: [
      { delta: 0.90, chapterMatch: '82' },
      { delta: 0.70, chapterMatch: '84' },
    ],
  },

  // ── Rule 29: LIGHTING_INTENT ────────────────────────────────────────────────
  // Desk lamp, floor lamp, table lamp → 9405.10/20 (luminaires); deny 8539 (bulbs), 9405.42 (LED modules)
  {
    id: 'LIGHTING_INTENT',
    description: 'Lamps/lighting fixtures → 9405.10/20 luminaires; deny 8539 bulbs and 9405.42 LED modules',
    pattern: {
      anyOf: ['lamp', 'lamps', 'lantern', 'lanterns', 'chandelier', 'sconce', 'sconces',
               'luminaire', 'luminaires', 'nightlight'],
    },
    inject: [
      { prefix: '9405.20', syntheticRank: 20 },
      { prefix: '9405.10', syntheticRank: 25 },
      { prefix: '9405.40', syntheticRank: 30 },
    ],
    whitelist: {
      denyPrefixes: ['8539.', '9405.42', '9405.41'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '9405.20' },
      { delta: 0.70, prefixMatch: '9405.10' },
      { delta: 0.55, prefixMatch: '9405.40' },
    ],
    penalties: [
      { delta: 0.90, prefixMatch: '8539.' },
      { delta: 0.90, prefixMatch: '9405.42' },
      { delta: 0.90, prefixMatch: '9405.41' },
      { delta: 0.80, prefixMatch: '8513.' },
      { delta: 0.70, prefixMatch: '9405.11' },  // chandeliers/ceiling fittings ≠ desk lamps
    ],
  },

  // ── Rule 30: HAIR_DRYER_INTENT ──────────────────────────────────────────────
  // Hair dryer → 8516.31; distinguish from hand-drying apparatus (8516.40) and parts (8516.90)
  {
    id: 'HAIR_DRYER_INTENT',
    description: 'Hair dryer → 8516.31; deny 8516.90 parts and 8516.40 hand dryers',
    pattern: {
      required: ['hair'],
      anyOf: ['dryer', 'dryers', 'drying'],
    },
    inject: [
      { prefix: '8516.31', syntheticRank: 20 },
    ],
    whitelist: {
      allowPrefixes: ['8516.31'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '8516.31' },
    ],
    penalties: [
      { delta: 0.90, prefixMatch: '8516.90' },
      { delta: 0.80, prefixMatch: '8516.40' },
    ],
  },

  // ── Rule 31: GARDEN_HOSE_INTENT ────────────────────────────────────────────
  // Garden hose → 3917 (plastic tubing/piping); deny vehicle brake/hydraulic hoses (4009.12)
  {
    id: 'GARDEN_HOSE_INTENT',
    description: 'Garden/irrigation hose → 3917 plastic tubing; deny vehicle-specific rubber hoses',
    pattern: {
      anyOf: ['hose', 'hoses'],
      noneOf: ['brake', 'hydraulic', 'fuel', 'vehicle', 'automotive'],
    },
    inject: [
      { prefix: '3917.32', syntheticRank: 30 },
      { prefix: '3917.39', syntheticRank: 33 },
    ],
    whitelist: {
      denyChaptersIfEntryHasTokens: [
        { chapter: '40', tokens: ['brake', 'hydraulic', 'vehicle', 'fuel', 'automobile'] },
      ],
    },
    boosts: [
      { delta: 0.60, prefixMatch: '3917.' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '4009.12', entryMustHaveAnyToken: ['brake', 'hydraulic', 'vehicle'] },
    ],
  },

  // ── Rule 32: CUSHION_INTENT ─────────────────────────────────────────────────
  // Throw pillow / cushion → 9404.90 (pillows, cushions, pouffes); deny 6302 (bedding pillowcovers)
  {
    id: 'CUSHION_INTENT',
    description: 'Throw pillow/cushion → 9404.90 (pillows/cushions); deny 6302 bedding/pillowcovers',
    pattern: {
      anyOf: ['cushion', 'cushions', 'throw'],
      anyOfGroups: [
        ['pillow', 'pillows', 'cushion', 'cushions'],
      ],
    },
    inject: [
      { prefix: '9404.90', syntheticRank: 30 },
    ],
    whitelist: {
      denyPrefixes: ['6302.'],
    },
    boosts: [
      { delta: 0.75, prefixMatch: '9404.90' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '6302.' },
    ],
  },

  // ── Rule 33: YOGA_MAT_INTENT ────────────────────────────────────────────────
  // Yoga mat / exercise mat → 4016.91 (rubber floor coverings/mats) or 3926.90 (plastic)
  {
    id: 'YOGA_MAT_INTENT',
    description: 'Yoga/exercise mat → 4016.91 rubber mats or 3926.90 plastics; deny ch.46 plaiting materials',
    pattern: {
      anyOf: ['yoga', 'exercise', 'fitness'],
      anyOfGroups: [
        ['mat', 'mats', 'pad', 'padding'],
      ],
    },
    inject: [
      { prefix: '4016.91', syntheticRank: 25 },
      { prefix: '3926.90', syntheticRank: 35 },
    ],
    whitelist: {
      denyChapters: ['46'],
    },
    boosts: [
      { delta: 0.75, prefixMatch: '4016.91' },
      { delta: 0.45, prefixMatch: '3926.90' },
    ],
    penalties: [
      { delta: 0.90, chapterMatch: '46' },
    ],
  },

  // ── Rule 34: BACKPACK_INTENT ─────────────────────────────────────────────────
  // Backpack / rucksack → 4202.92.31 (textile outer surface, with back straps)
  {
    id: 'BACKPACK_INTENT',
    description: 'Backpack/rucksack → 4202.92.31; deny 4202.12 (briefcases/suitcases)',
    pattern: {
      anyOf: ['backpack', 'backpacks', 'rucksack', 'rucksacks', 'knapsack'],
    },
    inject: [
      { prefix: '4202.92.31', syntheticRank: 22 },
      { prefix: '4202.92.15', syntheticRank: 28 },
    ],
    whitelist: {
      denyPrefixes: ['4202.12'],
    },
    boosts: [
      { delta: 0.80, prefixMatch: '4202.92.31' },
      { delta: 0.55, prefixMatch: '4202.92' },
    ],
    penalties: [
      { delta: 0.90, prefixMatch: '4202.12' },
    ],
  },

  // ── Rule 35: LUGGAGE_INTENT ──────────────────────────────────────────────────
  // Luggage / suitcase → 4202.12 (travel bags/suitcases with hard/soft outer surface)
  {
    id: 'LUGGAGE_INTENT',
    description: 'Luggage/suitcase → 4202.12; deny 4202.92 (shopping/sport bags)',
    pattern: {
      anyOf: ['luggage', 'suitcase', 'suitcases', 'baggage', 'trolley'],
    },
    inject: [
      { prefix: '4202.12.29', syntheticRank: 22 },
      { prefix: '4202.11', syntheticRank: 28 },
    ],
    whitelist: {
      denyPrefixes: ['4202.92'],
    },
    boosts: [
      { delta: 0.80, prefixMatch: '4202.12' },
      { delta: 0.60, prefixMatch: '4202.11' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '4202.92' },
    ],
  },

  // ── Rule 36: HANDBAG_INTENT ──────────────────────────────────────────────────
  // Handbag / purse → 4202.21 (leather outer surface) or 4202.22 (textile outer surface)
  {
    id: 'HANDBAG_INTENT',
    description: 'Handbag/purse → 4202.21/22; deny 4202.91/92 (travel bags)',
    pattern: {
      anyOf: ['handbag', 'handbags'],
      noneOf: ['backpack', 'laptop', 'notebook', 'travel', 'luggage'],
    },
    inject: [
      { prefix: '4202.21', syntheticRank: 22 },
      { prefix: '4202.22', syntheticRank: 25 },
    ],
    boosts: [
      { delta: 0.75, prefixMatch: '4202.21' },
      { delta: 0.65, prefixMatch: '4202.22' },
    ],
    penalties: [
      { delta: 0.70, prefixMatch: '4202.91' },
      { delta: 0.70, prefixMatch: '4202.92' },
      { delta: 0.80, prefixMatch: '4202.12' },
    ],
  },

  // ── Rule 37: BELT_APPAREL_INTENT ────────────────────────────────────────────
  // Clothing belt → 6217.10 (textile accessories) or 4203.30 (leather belts)
  {
    id: 'BELT_APPAREL_INTENT',
    description: 'Clothing belt → 6217.10 textile or 4203.30 leather; deny industrial/mechanical',
    pattern: {
      anyOf: ['belt', 'belts'],
      noneOf: ['conveyor', 'timing', 'drive', 'transmission', 'fan', 'engine', 'industrial'],
    },
    inject: [
      { prefix: '6217.10', syntheticRank: 22 },
      { prefix: '4203.30', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6217.' },
      { delta: 0.60, prefixMatch: '4203.30' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 38: CARPET_RUG_INTENT ──────────────────────────────────────────────
  // Carpet / rug → 5703 (tufted) or 5705 (other textile floor coverings)
  {
    id: 'CARPET_RUG_INTENT',
    description: 'Carpet/rug → 5703/5705 textile floor coverings; deny ch.39 plastic',
    pattern: {
      anyOf: ['carpet', 'carpets', 'rug', 'rugs'],
    },
    inject: [
      { prefix: '5703.20', syntheticRank: 22 },
      { prefix: '5703.30', syntheticRank: 25 },
      { prefix: '5705.00', syntheticRank: 28 },
      { prefix: '5702.50', syntheticRank: 32 },
    ],
    whitelist: {
      allowChapters: ['57'],
    },
    boosts: [
      { delta: 0.75, chapterMatch: '57' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '39' },
      { delta: 0.80, chapterMatch: '56' },
    ],
  },

  // ── Rule 39: OUTERWEAR_INTENT ────────────────────────────────────────────────
  // Jacket / coat → 6201/6202 (woven outerwear) or 6101/6102 (knitted outerwear)
  {
    id: 'OUTERWEAR_INTENT',
    description: 'Jacket/coat → ch.62 woven or ch.61 knitted outerwear',
    pattern: {
      anyOf: ['jacket', 'jackets', 'coat', 'coats', 'outerwear'],
      noneOf: ['life', 'safety', 'lab', 'laboratory', 'paint', 'spray'],
    },
    inject: [
      { prefix: '6201.', syntheticRank: 22 },
      { prefix: '6202.', syntheticRank: 25 },
      { prefix: '6101.', syntheticRank: 30 },
      { prefix: '6102.', syntheticRank: 33 },
    ],
    boosts: [
      { delta: 0.60, chapterMatch: '62' },
      { delta: 0.55, chapterMatch: '61' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
      { delta: 0.70, chapterMatch: '85' },
    ],
  },

  // ── Rule 40: DRESS_SKIRT_INTENT ──────────────────────────────────────────────
  // Dress / skirt → 6204 (women's woven suits/dresses) or 6104 (knitted)
  {
    id: 'DRESS_SKIRT_INTENT',
    description: 'Dress/skirt → 6204/6104 women\'s apparel',
    pattern: {
      anyOf: ['dress', 'dresses', 'skirt', 'skirts'],
      noneOf: ['code', 'uniform', 'military'],
    },
    inject: [
      { prefix: '6204.4', syntheticRank: 22 },
      { prefix: '6204.5', syntheticRank: 25 },
      { prefix: '6104.4', syntheticRank: 28 },
      { prefix: '6104.5', syntheticRank: 31 },
    ],
    boosts: [
      { delta: 0.60, chapterMatch: '62' },
      { delta: 0.55, chapterMatch: '61' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '84' },
    ],
  },

  // ── Rule 41: PANTS_JEANS_INTENT ──────────────────────────────────────────────
  // Pants / jeans / trousers → 6203.42 (cotton trousers, men's) or 6204.61/62 (women's)
  {
    id: 'PANTS_JEANS_INTENT',
    description: 'Pants/jeans/trousers → 6203.42/6204.62 woven bottoms',
    pattern: {
      anyOf: ['pants', 'jeans', 'trousers'],
    },
    inject: [
      { prefix: '6203.42', syntheticRank: 22 },
      { prefix: '6204.62', syntheticRank: 25 },
      { prefix: '6103.42', syntheticRank: 30 },
      { prefix: '6104.62', syntheticRank: 33 },
    ],
    boosts: [
      { delta: 0.60, chapterMatch: '62' },
      { delta: 0.55, chapterMatch: '61' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '84' },
    ],
  },

  // ── Rule 42: KNITWEAR_INTENT ─────────────────────────────────────────────────
  // Hoodie / sweater / sweatshirt / pullover → 6110 (jerseys/pullovers/sweatshirts, knitted)
  {
    id: 'KNITWEAR_INTENT',
    description: 'Hoodie/sweater/sweatshirt → 6110 knitted jerseys/pullovers; boost ch.61',
    pattern: {
      anyOf: ['hoodie', 'hoodies', 'sweater', 'sweaters', 'sweatshirt', 'sweatshirts', 'pullover', 'pullovers'],
    },
    inject: [
      { prefix: '6110.20', syntheticRank: 22 },
      { prefix: '6110.30', syntheticRank: 25 },
      { prefix: '6110.11', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '6110.' },
      { delta: 0.45, chapterMatch: '61' },
    ],
    penalties: [
      { delta: 0.60, chapterMatch: '62' },
    ],
  },

  // ── Rule 43: SWIMWEAR_INTENT ─────────────────────────────────────────────────
  // Swimwear / swimsuit / bikini → 6112 (knitted swimwear) or 6211 (woven swimwear)
  {
    id: 'SWIMWEAR_INTENT',
    description: 'Swimwear/swimsuit/bikini → 6112.41/49 knitted or 6211.11/12 woven swimwear',
    pattern: {
      anyOf: ['swimwear', 'swimsuit', 'swimsuits', 'bikini', 'bikinis'],
    },
    inject: [
      { prefix: '6112.41', syntheticRank: 22 },
      { prefix: '6112.49', syntheticRank: 25 },
      { prefix: '6211.11', syntheticRank: 28 },
      { prefix: '6211.12', syntheticRank: 31 },
    ],
    boosts: [
      { delta: 0.75, prefixMatch: '6112.' },
      { delta: 0.60, prefixMatch: '6211.' },
    ],
  },

  // ── Rule 44: UNDERWEAR_INTENT ────────────────────────────────────────────────
  // Underwear / bra / briefs / boxers → 6207/6208 (woven) or 6107/6108 (knitted)
  {
    id: 'UNDERWEAR_INTENT',
    description: 'Underwear/bra/briefs/boxers → 6207/6208 woven or 6107/6108 knitted',
    pattern: {
      anyOf: ['underwear', 'bra', 'bras', 'briefs', 'boxers', 'underpants', 'lingerie'],
    },
    inject: [
      { prefix: '6212.10', syntheticRank: 22 },
      { prefix: '6108.', syntheticRank: 25 },
      { prefix: '6107.', syntheticRank: 28 },
      { prefix: '6208.', syntheticRank: 31 },
    ],
    boosts: [
      { delta: 0.65, chapterMatch: '61' },
      { delta: 0.55, chapterMatch: '62' },
    ],
  },

  // ── Rule 45: GLOVES_INTENT ───────────────────────────────────────────────────
  // Clothing gloves / mittens → 6116 (knitted) or 6216 (other gloves)
  {
    id: 'GLOVES_INTENT',
    description: 'Clothing gloves/mittens → 6116/6216; deny latex surgical/rubber industrial',
    pattern: {
      anyOf: ['glove', 'gloves', 'mitten', 'mittens'],
      noneOf: ['latex', 'rubber', 'medical', 'surgical', 'boxing', 'oven', 'baseball'],
    },
    inject: [
      { prefix: '6116.10', syntheticRank: 22 },
      { prefix: '6116.92', syntheticRank: 25 },
      { prefix: '6116.93', syntheticRank: 28 },
      { prefix: '6216.00', syntheticRank: 32 },
    ],
    boosts: [
      { delta: 0.65, chapterMatch: '61' },
      { delta: 0.55, chapterMatch: '62' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '40' },
    ],
  },

  // ── Rule 46: TOWEL_INTENT ────────────────────────────────────────────────────
  // Bath towel / hand towel → 6302.60 (terry towelling, knitted) or 6302.91/99 (other)
  {
    id: 'TOWEL_INTENT',
    description: 'Towel → 6302.60/91/99 toilet/kitchen linen; deny 6302.10 printed table linen',
    pattern: {
      anyOf: ['towel', 'towels'],
    },
    inject: [
      { prefix: '6302.60', syntheticRank: 22 },
      { prefix: '6302.91', syntheticRank: 25 },
      { prefix: '6302.99', syntheticRank: 28 },
    ],
    whitelist: {
      allowChapters: ['63'],
    },
    boosts: [
      { delta: 0.75, prefixMatch: '6302.60' },
      { delta: 0.65, prefixMatch: '6302.91' },
      { delta: 0.65, prefixMatch: '6302.99' },
    ],
    penalties: [
      { delta: 0.70, prefixMatch: '6302.10' },
    ],
  },

  // ── Rule 47: BLANKET_INTENT ──────────────────────────────────────────────────
  // Blanket / quilt → 6301 (blankets and traveling rugs)
  {
    id: 'BLANKET_INTENT',
    description: 'Blanket/quilt → 6301; deny ch.85 electric blankets',
    pattern: {
      anyOf: ['blanket', 'blankets', 'quilt', 'quilts'],
      noneOf: ['electric', 'heated'],
    },
    inject: [
      { prefix: '6301.40', syntheticRank: 22 },
      { prefix: '6301.20', syntheticRank: 25 },
      { prefix: '6301.30', syntheticRank: 28 },
    ],
    whitelist: {
      allowChapters: ['63'],
    },
    boosts: [
      { delta: 0.75, prefixMatch: '6301.' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '85' },
    ],
  },

  // ── Rule 48: CURTAIN_DRAPE_INTENT ────────────────────────────────────────────
  // Curtain / drape → 6303 (curtains, drapes, and interior blinds)
  {
    id: 'CURTAIN_DRAPE_INTENT',
    description: 'Curtain/drape → 6303.91/92 textile curtains and interior blinds',
    pattern: {
      anyOf: ['curtain', 'curtains', 'drape', 'drapes'],
    },
    inject: [
      { prefix: '6303.91', syntheticRank: 22 },
      { prefix: '6303.92', syntheticRank: 25 },
    ],
    whitelist: {
      allowChapters: ['63'],
    },
    boosts: [
      { delta: 0.80, prefixMatch: '6303.' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '84' },
    ],
  },

  // ── Rule 49: UMBRELLA_INTENT ─────────────────────────────────────────────────
  // Umbrella / parasol → 6601 (umbrellas, sun umbrellas, garden umbrellas)
  {
    id: 'UMBRELLA_INTENT',
    description: 'Umbrella/parasol → 6601.99; deny ch.64 footwear',
    pattern: {
      anyOf: ['umbrella', 'umbrellas', 'parasol', 'parasols'],
    },
    inject: [
      { prefix: '6601.99', syntheticRank: 22 },
      { prefix: '6601.10', syntheticRank: 28 },
    ],
    whitelist: {
      allowChapters: ['66'],
    },
    boosts: [
      { delta: 0.85, chapterMatch: '66' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '64' },
    ],
  },

  // ── Rule 50: CERAMIC_TABLEWARE_INTENT ────────────────────────────────────────
  // Plate / bowl / dish → 6911 (porcelain/china tableware) or 6912 (other ceramic)
  {
    id: 'CERAMIC_TABLEWARE_INTENT',
    description: 'Plate/bowl/dish → 6911/6912 ceramic tableware; deny ch.84/85 machinery',
    pattern: {
      anyOf: ['plate', 'plates', 'bowl', 'bowls', 'dish', 'dishes'],
      noneOf: ['satellite', 'antenna', 'brake', 'clutch', 'engine', 'solar', 'solar panel'],
    },
    inject: [
      { prefix: '6911.10', syntheticRank: 22 },
      { prefix: '6912.00', syntheticRank: 25 },
      { prefix: '7013.37', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.70, chapterMatch: '69' },
      { delta: 0.50, chapterMatch: '70' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '85' },
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 51: VASE_INTENT ─────────────────────────────────────────────────────
  // Vase → 6913 (ceramic ornamental articles) or 7013 (glass vases)
  {
    id: 'VASE_INTENT',
    description: 'Vase → 6913.10 porcelain or 6913.90 other ceramic; deny ch.39 plastic',
    pattern: {
      anyOf: ['vase', 'vases'],
    },
    inject: [
      { prefix: '6913.10', syntheticRank: 22 },
      { prefix: '6913.90', syntheticRank: 25 },
      { prefix: '7013.99', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '6913.' },
      { delta: 0.50, prefixMatch: '7013.' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '39' },
    ],
  },

  // ── Rule 52: GLASSWARE_DRINKING_INTENT ───────────────────────────────────────
  // Drinking glass / wine glass / beer glass → 7013 (glassware for table/kitchen/toilet)
  {
    id: 'GLASSWARE_DRINKING_INTENT',
    description: 'Drinking glass/wine glass → 7013.22/37/28 glassware; deny ch.69 ceramic',
    pattern: {
      anyOf: ['glassware', 'wineglass', 'goblet'],
      // OR: 'glass'/'glasses' + drinking context
    },
    inject: [
      { prefix: '7013.22', syntheticRank: 22 },
      { prefix: '7013.37', syntheticRank: 25 },
      { prefix: '7013.28', syntheticRank: 28 },
    ],
    whitelist: {
      allowChapters: ['70'],
    },
    boosts: [
      { delta: 0.75, chapterMatch: '70' },
    ],
    penalties: [
      { delta: 0.60, chapterMatch: '69' },
    ],
  },

  // ── Rule 53: MIRROR_INTENT ───────────────────────────────────────────────────
  // Mirror → 7009 (glass mirrors, whether or not framed)
  {
    id: 'MIRROR_INTENT',
    description: 'Mirror → 7009.91/92 glass mirrors; deny ch.39 plastic mirrors',
    pattern: {
      anyOf: ['mirror', 'mirrors'],
    },
    inject: [
      { prefix: '7009.91', syntheticRank: 22 },
      { prefix: '7009.92', syntheticRank: 25 },
    ],
    whitelist: {
      allowChapters: ['70'],
    },
    boosts: [
      { delta: 0.85, chapterMatch: '70' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '39' },
    ],
  },

  // ── Rule 54: KITCHEN_KNIFE_INTENT ────────────────────────────────────────────
  // Kitchen knife / chef knife → 8211 (knives with cutting blades)
  {
    id: 'KITCHEN_KNIFE_INTENT',
    description: 'Knife/knives → 8211.92/93 kitchen/table knives; deny 8210/8215 (openers/forks)',
    pattern: {
      anyOf: ['knife', 'knives'],
      noneOf: ['jackknife', 'pocket', 'army', 'swiss', 'penknife'],
    },
    inject: [
      { prefix: '8211.92', syntheticRank: 22 },
      { prefix: '8211.93', syntheticRank: 25 },
      { prefix: '8211.91', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '8211.' },
    ],
    penalties: [
      { delta: 0.60, prefixMatch: '8210.' },
      { delta: 0.60, prefixMatch: '8215.' },
    ],
  },

  // ── Rule 55: CUTLERY_UTENSIL_INTENT ──────────────────────────────────────────
  // Fork / spoon / cutlery set → 8215 (spoons, forks, ladles, skimmers, etc.)
  {
    id: 'CUTLERY_UTENSIL_INTENT',
    description: 'Fork/spoon/cutlery/utensil → 8215.91/99 spoons/forks/ladles/skimmers',
    pattern: {
      anyOf: ['fork', 'forks', 'spoon', 'spoons', 'cutlery', 'utensil', 'utensils', 'ladle', 'spatula'],
    },
    inject: [
      { prefix: '8215.91', syntheticRank: 22 },
      { prefix: '8215.99', syntheticRank: 25 },
      { prefix: '8215.20', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '8215.' },
    ],
    penalties: [
      { delta: 0.60, prefixMatch: '8211.' },
    ],
  },

  // ── Rule 56: PADLOCK_INTENT ──────────────────────────────────────────────────
  // Padlock → 8301.10 (padlocks)
  {
    id: 'PADLOCK_INTENT',
    description: 'Padlock → 8301.10; deny ch.69/70 decorative locks',
    pattern: {
      anyOf: ['padlock', 'padlocks'],
    },
    inject: [
      { prefix: '8301.10', syntheticRank: 22 },
    ],
    whitelist: {
      allowChapters: ['83'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '8301.10' },
    ],
  },

  // ── Rule 57: VACUUM_CLEANER_INTENT ───────────────────────────────────────────
  // Vacuum cleaner → 8508 (vacuum cleaners)
  {
    id: 'VACUUM_CLEANER_INTENT',
    description: 'Vacuum cleaner → 8508.11/19; deny 8421 (centrifuges/filters)',
    pattern: {
      anyOf: ['vacuum', 'vacuums'],
    },
    inject: [
      { prefix: '8508.11', syntheticRank: 22 },
      { prefix: '8508.19', syntheticRank: 25 },
    ],
    whitelist: {
      allowPrefixes: ['8508.'],
    },
    boosts: [
      { delta: 0.85, prefixMatch: '8508.' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '8421.' },
    ],
  },

  // ── Rule 58: ELECTRIC_SHAVER_INTENT ──────────────────────────────────────────
  // Electric shaver / trimmer → 8510 (shavers, hair clippers, depilatory appliances)
  {
    id: 'ELECTRIC_SHAVER_INTENT',
    description: 'Electric shaver/trimmer → 8510.10/20; deny ch.82 manual razors',
    pattern: {
      anyOf: ['shaver', 'shavers', 'trimmer', 'trimmers'],
      noneOf: ['manual', 'blade', 'disposable', 'safety'],
    },
    inject: [
      { prefix: '8510.10', syntheticRank: 22 },
      { prefix: '8510.20', syntheticRank: 25 },
    ],
    whitelist: {
      allowPrefixes: ['8510.'],
    },
    boosts: [
      { delta: 0.85, prefixMatch: '8510.' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '82' },
    ],
  },

  // ── Rule 59: COFFEE_MAKER_INTENT ─────────────────────────────────────────────
  // Coffee maker / espresso machine → 8516.71 (coffee or tea makers)
  {
    id: 'COFFEE_MAKER_INTENT',
    description: 'Coffee maker/espresso → 8516.71; deny ch.84 (industrial machinery)',
    pattern: {
      required: ['coffee'],
      anyOfGroups: [
        ['maker', 'makers', 'machine', 'brewer', 'brewers', 'drip', 'espresso', 'percolator', 'coffeemaker'],
      ],
    },
    inject: [
      { prefix: '8516.71', syntheticRank: 20 },
    ],
    whitelist: {
      allowPrefixes: ['8516.'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '8516.71' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
      { delta: 0.70, prefixMatch: '8516.90' },
    ],
  },

  // ── Rule 60: BICYCLE_INTENT ──────────────────────────────────────────────────
  // Bicycle / bike → 8712 (bicycles and other cycles, not motorized)
  {
    id: 'BICYCLE_INTENT',
    description: 'Bicycle/bike → 8712.00; deny ch.84 engines and ch.87 motor vehicles',
    pattern: {
      anyOf: ['bicycle', 'bicycles', 'bike', 'bikes', 'cycle', 'cycling'],
      noneOf: ['motor', 'motorized', 'electric', 'moped', 'scooter'],
    },
    inject: [
      { prefix: '8712.00.35', syntheticRank: 22 },
      { prefix: '8712.00.44', syntheticRank: 25 },
      { prefix: '8712.00.48', syntheticRank: 28 },
    ],
    whitelist: {
      allowChapters: ['87'],
    },
    boosts: [
      { delta: 0.85, prefixMatch: '8712.' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 61: SUNGLASSES_INTENT ───────────────────────────────────────────────
  // Sunglasses → 9004.10 (sunglasses)
  {
    id: 'SUNGLASSES_INTENT',
    description: 'Sunglasses → 9004.10; deny 9001 optical fiber',
    pattern: {
      anyOf: ['sunglasses', 'sunglass'],
    },
    inject: [
      { prefix: '9004.10', syntheticRank: 22 },
    ],
    whitelist: {
      allowPrefixes: ['9004.'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '9004.10' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '9001.' },
    ],
  },

  // ── Rule 62: MUSICAL_INSTRUMENT_INTENT ───────────────────────────────────────
  // Guitar / violin / piano / drum → ch.92 musical instruments
  {
    id: 'MUSICAL_INSTRUMENT_INTENT',
    description: 'Guitar/violin/piano/drum → ch.92 musical instruments; deny ch.85 electronics',
    pattern: {
      anyOf: ['guitar', 'guitars', 'violin', 'violins', 'piano', 'pianos', 'drum', 'drums', 'ukulele', 'cello', 'trumpet', 'flute', 'saxophone'],
    },
    inject: [
      { prefix: '9202.10', syntheticRank: 22 },
      { prefix: '9207.10', syntheticRank: 25 },
      { prefix: '9205.10', syntheticRank: 28 },
      { prefix: '9206.00', syntheticRank: 30 },
    ],
    whitelist: {
      allowChapters: ['92'],
    },
    boosts: [
      { delta: 0.85, chapterMatch: '92' },
    ],
    penalties: [
      { delta: 0.75, chapterMatch: '85' },
    ],
  },

  // ── Rule 63: PEN_PENCIL_INTENT ───────────────────────────────────────────────
  // Pen / ballpoint pen / pencil → 9608/9609 (ball-point pens, pencils)
  {
    id: 'PEN_PENCIL_INTENT',
    description: 'Pen/ballpoint/pencil → 9608.10/40 or 9609.10; deny ch.84/85',
    pattern: {
      anyOf: ['pen', 'pens', 'ballpoint', 'pencil', 'pencils', 'highlighter', 'marker'],
      noneOf: ['tablet', 'stylus', 'digital', 'smart'],
    },
    inject: [
      { prefix: '9608.10', syntheticRank: 22 },
      { prefix: '9608.40', syntheticRank: 25 },
      { prefix: '9609.10', syntheticRank: 28 },
      { prefix: '9608.20', syntheticRank: 30 },
    ],
    whitelist: {
      allowChapters: ['96'],
    },
    boosts: [
      { delta: 0.85, chapterMatch: '96' },
    ],
    penalties: [
      { delta: 0.75, chapterMatch: '84' },
      { delta: 0.75, chapterMatch: '85' },
    ],
  },

  // ── Rule 64: TOOTHBRUSH_INTENT ───────────────────────────────────────────────
  // Toothbrush → 9603.21 (toothbrushes, including dental-plate brushes)
  {
    id: 'TOOTHBRUSH_INTENT',
    description: 'Toothbrush → 9603.21; deny ch.84/85 electric appliances',
    pattern: {
      anyOf: ['toothbrush', 'toothbrushes'],
    },
    inject: [
      { prefix: '9603.21', syntheticRank: 22 },
    ],
    whitelist: {
      allowPrefixes: ['9603.'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '9603.21' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
      { delta: 0.70, chapterMatch: '85' },
    ],
  },

  // ── Rule 65: SOAP_INTENT ─────────────────────────────────────────────────────
  // Soap / bar soap / liquid soap → 3401 (soap; organic surface-active products for skin)
  {
    id: 'SOAP_INTENT',
    description: 'Soap → 3401.11/20 soap and organic surface-active products; deny ch.85 washing machines',
    pattern: {
      anyOf: ['soap', 'soaps'],
    },
    inject: [
      { prefix: '3401.11', syntheticRank: 22 },
      { prefix: '3401.20', syntheticRank: 25 },
    ],
    whitelist: {
      allowChapters: ['34'],
    },
    boosts: [
      { delta: 0.80, chapterMatch: '34' },
    ],
    penalties: [
      { delta: 0.85, chapterMatch: '85' },
    ],
  },

  // ── Rule 66: PERFUME_INTENT ──────────────────────────────────────────────────
  // Perfume / cologne / fragrance → 3303 (perfumes and toilet waters)
  {
    id: 'PERFUME_INTENT',
    description: 'Perfume/cologne/fragrance → 3303.00 perfumes and toilet waters',
    pattern: {
      anyOf: ['perfume', 'perfumes', 'cologne', 'fragrance', 'fragrances'],
    },
    inject: [
      { prefix: '3303.00', syntheticRank: 22 },
    ],
    whitelist: {
      allowChapters: ['33'],
    },
    boosts: [
      { delta: 0.90, prefixMatch: '3303.' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '85' },
    ],
  },

  // ── Rule 67: SHAMPOO_HAIR_CARE_INTENT ────────────────────────────────────────
  // Shampoo / conditioner → 3305 (preparations for use on the hair)
  {
    id: 'SHAMPOO_HAIR_CARE_INTENT',
    description: 'Shampoo/conditioner → 3305.10/20 hair preparations; deny ch.34 soap',
    pattern: {
      anyOf: ['shampoo', 'shampoos', 'conditioner', 'conditioners'],
    },
    inject: [
      { prefix: '3305.10', syntheticRank: 22 },
      { prefix: '3305.20', syntheticRank: 26 },
    ],
    whitelist: {
      allowChapters: ['33'],
    },
    boosts: [
      { delta: 0.85, prefixMatch: '3305.10' },
      { delta: 0.70, prefixMatch: '3305.20' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '34' },
    ],
  },

  // ── Rule 68: FRESH_FLOWER_INTENT ─────────────────────────────────────────────
  {
    id: 'FRESH_FLOWER_INTENT',
    description: 'Rose/orchid/tulip/cut flower → 0603 cut flowers; deny ch.39/73 plastic/metal',
    pattern: {
      anyOf: ['rose', 'roses', 'orchid', 'orchids', 'tulip', 'tulips', 'lily', 'lilies',
               'carnation', 'carnations', 'flower', 'flowers', 'bouquet', 'chrysanthemum'],
    },
    inject: [
      { prefix: '0603.11', syntheticRank: 22 },
      { prefix: '0603.13', syntheticRank: 24 },
      { prefix: '0603.12', syntheticRank: 26 },
      { prefix: '0603.19', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['06'] },
    boosts: [
      { delta: 0.85, chapterMatch: '06' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '39' },
      { delta: 0.80, chapterMatch: '73' },
    ],
  },

  // ── Rule 69: INDOOR_PLANT_INTENT ─────────────────────────────────────────────
  {
    id: 'INDOOR_PLANT_INTENT',
    description: 'Plant/succulent/houseplant → 0602 live plants; deny ch.39/84',
    pattern: {
      anyOf: ['plant', 'plants', 'succulent', 'succulents', 'houseplant', 'houseplants',
               'bonsai', 'seedling', 'herb'],
      noneOf: ['factory', 'power', 'industrial', 'manufacturing'],
    },
    inject: [
      { prefix: '0602.90', syntheticRank: 22 },
      { prefix: '0602.10', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['06'] },
    boosts: [
      { delta: 0.85, chapterMatch: '06' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
      { delta: 0.80, chapterMatch: '39' },
    ],
  },

  // ── Rule 70: COFFEE_BEAN_INTENT ──────────────────────────────────────────────
  {
    id: 'COFFEE_BEAN_INTENT',
    description: 'Coffee beans/roasted coffee → 0901; deny ch.85 appliances, ch.69 mugs',
    pattern: {
      anyOf: ['coffee'],
      noneOf: ['maker', 'machine', 'brewer', 'espresso', 'mug', 'cup', 'mugs', 'cups',
                'drip', 'percolator', 'grinder', 'pod', 'capsule'],
    },
    inject: [
      { prefix: '0901.21', syntheticRank: 22 },
      { prefix: '0901.22', syntheticRank: 25 },
      { prefix: '0901.11', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['09'] },
    boosts: [
      { delta: 0.85, chapterMatch: '09' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '85' },
      { delta: 0.80, chapterMatch: '69' },
    ],
  },

  // ── Rule 71: TEA_INTENT ──────────────────────────────────────────────────────
  {
    id: 'TEA_INTENT',
    description: 'Green/black/herbal tea → 0902; deny ch.69 teapots, ch.63 tea towels',
    pattern: {
      anyOf: ['tea', 'teas', 'matcha', 'chamomile', 'oolong', 'jasmine tea', 'herbal tea'],
      noneOf: ['pot', 'kettle', 'maker', 'set', 'towel', 'light', 'service'],
    },
    inject: [
      { prefix: '0902.10', syntheticRank: 22 },
      { prefix: '0902.30', syntheticRank: 24 },
      { prefix: '0902.20', syntheticRank: 26 },
      { prefix: '0902.40', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['09'] },
    boosts: [
      { delta: 0.85, chapterMatch: '09' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '69' },
      { delta: 0.70, chapterMatch: '63' },
    ],
  },

  // ── Rule 72: CHOCOLATE_CANDY_INTENT ──────────────────────────────────────────
  {
    id: 'CHOCOLATE_CANDY_INTENT',
    description: 'Chocolate bar/candy/gummies → 1806/1704 confectionery',
    pattern: {
      anyOf: ['chocolate', 'chocolates', 'candy', 'candies', 'gummy', 'gummies',
               'lollipop', 'caramel', 'toffee', 'praline', 'truffle', 'bonbon'],
    },
    inject: [
      { prefix: '1806.32', syntheticRank: 22 },
      { prefix: '1806.31', syntheticRank: 24 },
      { prefix: '1806.20', syntheticRank: 26 },
      { prefix: '1704.90', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.75, chapterMatch: '18' },
      { delta: 0.60, chapterMatch: '17' },
    ],
  },

  // ── Rule 73: PASTA_NOODLE_INTENT ─────────────────────────────────────────────
  {
    id: 'PASTA_NOODLE_INTENT',
    description: 'Pasta/noodles/ramen → 1902 pasta products',
    pattern: {
      anyOf: ['pasta', 'noodle', 'noodles', 'ramen', 'spaghetti', 'penne', 'linguine',
               'fettuccine', 'lasagna', 'macaroni', 'vermicelli', 'udon', 'soba'],
    },
    inject: [
      { prefix: '1902.19', syntheticRank: 22 },
      { prefix: '1902.11', syntheticRank: 25 },
      { prefix: '1902.30', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['19'] },
    boosts: [
      { delta: 0.85, chapterMatch: '19' },
    ],
  },

  // ── Rule 74: WINE_INTENT ─────────────────────────────────────────────────────
  {
    id: 'WINE_INTENT',
    description: 'Wine/champagne/prosecco → 2204 wines; deny ch.22 other beverages',
    pattern: {
      anyOf: ['wine', 'wines', 'champagne', 'prosecco', 'bordeaux', 'chardonnay',
               'merlot', 'pinot', 'cabernet', 'riesling', 'sauvignon', 'rosé'],
      noneOf: ['glass', 'opener', 'bottle opener', 'decanter', 'rack'],
    },
    inject: [
      { prefix: '2204.21', syntheticRank: 22 },
      { prefix: '2204.22', syntheticRank: 25 },
      { prefix: '2204.10', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['22'] },
    boosts: [
      { delta: 0.85, chapterMatch: '22' },
    ],
  },

  // ── Rule 75: BEER_INTENT ─────────────────────────────────────────────────────
  {
    id: 'BEER_INTENT',
    description: 'Beer/ale/lager → 2203 beer made from malt',
    pattern: {
      anyOf: ['beer', 'beers', 'ale', 'ales', 'lager', 'stout', 'porter', 'pilsner', 'ipa'],
      noneOf: ['glass', 'mug', 'opener', 'garden', 'root beer'],
    },
    inject: [
      { prefix: '2203.00', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['2203.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '2203.' },
    ],
  },

  // ── Rule 76: HONEY_INTENT ────────────────────────────────────────────────────
  {
    id: 'HONEY_INTENT',
    description: 'Honey → 0409 natural honey',
    pattern: {
      anyOf: ['honey', 'honeys'],
      noneOf: ['mustard', 'lemon'],
    },
    inject: [
      { prefix: '0409.00', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['0409.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '0409.' },
    ],
  },

  // ── Rule 77: NUTS_SNACK_INTENT ───────────────────────────────────────────────
  {
    id: 'NUTS_SNACK_INTENT',
    description: 'Almonds/cashews/walnuts/peanuts → ch.08/12 edible nuts',
    pattern: {
      anyOf: ['almond', 'almonds', 'cashew', 'cashews', 'walnut', 'walnuts',
               'pistachio', 'pistachios', 'peanut', 'peanuts', 'macadamia',
               'hazelnut', 'hazelnuts', 'pecan', 'pecans', 'chestnut'],
    },
    inject: [
      { prefix: '0802.12', syntheticRank: 22 },
      { prefix: '0802.52', syntheticRank: 24 },
      { prefix: '0802.32', syntheticRank: 26 },
      { prefix: '1202.42', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.75, chapterMatch: '08' },
      { delta: 0.65, chapterMatch: '12' },
    ],
  },

  // ── Rule 78: OLIVE_OIL_INTENT ────────────────────────────────────────────────
  {
    id: 'OLIVE_OIL_INTENT',
    description: 'Olive oil → 1509.10 virgin / 1509.90 other olive oil',
    pattern: {
      required: ['olive'],
      anyOf: ['oil', 'oils', 'extra', 'virgin'],
    },
    inject: [
      { prefix: '1509.10', syntheticRank: 22 },
      { prefix: '1509.90', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['15'] },
    boosts: [
      { delta: 0.85, prefixMatch: '1509.' },
    ],
  },

  // ── Rule 79: CUTTING_BOARD_INTENT ────────────────────────────────────────────
  {
    id: 'CUTTING_BOARD_INTENT',
    description: 'Cutting/chopping board → 4419.11 wooden bread boards and similar',
    pattern: {
      anyOfGroups: [
        ['cutting', 'chopping', 'bread'],
        ['board', 'boards'],
      ],
      noneOf: ['circuit', 'skateboard', 'snowboard', 'ironing', 'surfboard'],
    },
    inject: [
      { prefix: '4419.11', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['4419.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '4419.' },
    ],
  },

  // ── Rule 80: PICTURE_FRAME_INTENT ────────────────────────────────────────────
  {
    id: 'PICTURE_FRAME_INTENT',
    description: 'Picture/photo frame → 4414 wooden frames; deny ch.85/84',
    pattern: {
      anyOfGroups: [
        ['photo', 'picture', 'painting', 'portrait', 'canvas', 'photograph'],
        ['frame', 'frames'],
      ],
    },
    inject: [
      { prefix: '4414.', syntheticRank: 22 },
      { prefix: '3926.10', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.85, prefixMatch: '4414.' },
      { delta: 0.45, prefixMatch: '3926.10' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '85' },
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 81: TISSUE_PAPER_INTENT ─────────────────────────────────────────────
  {
    id: 'TISSUE_PAPER_INTENT',
    description: 'Facial tissue/tissue paper/paper towel → 4818.20/30',
    pattern: {
      anyOf: ['tissue', 'tissues', 'kleenex'],
      noneOf: ['steel', 'organ', 'connective'],
    },
    inject: [
      { prefix: '4818.20', syntheticRank: 22 },
      { prefix: '4818.30', syntheticRank: 25 },
    ],
    whitelist: { allowPrefixes: ['4818.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '4818.20' },
      { delta: 0.75, prefixMatch: '4818.30' },
    ],
  },

  // ── Rule 82: TOILET_PAPER_INTENT ─────────────────────────────────────────────
  {
    id: 'TOILET_PAPER_INTENT',
    description: 'Toilet paper → 4818.10',
    pattern: {
      required: ['toilet'],
      anyOf: ['paper', 'tissue', 'roll', 'rolls'],
    },
    inject: [
      { prefix: '4818.10', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['4818.10'] },
    boosts: [
      { delta: 0.95, prefixMatch: '4818.10' },
    ],
  },

  // ── Rule 83: SNEAKER_ATHLETIC_SHOE_INTENT ────────────────────────────────────
  {
    id: 'SNEAKER_ATHLETIC_SHOE_INTENT',
    description: 'Sneakers/trainers/running shoes → 6402.91/6404.11; deny ch.84',
    pattern: {
      anyOf: ['sneaker', 'sneakers', 'trainer', 'trainers', 'running shoe', 'running shoes',
               'athletic shoe', 'athletic shoes', 'tennis shoe', 'tennis shoes'],
      noneOf: ['basketball', 'football', 'cleats'],
    },
    inject: [
      { prefix: '6402.91', syntheticRank: 22 },
      { prefix: '6404.11', syntheticRank: 25 },
      { prefix: '6402.99', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.70, chapterMatch: '64' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 84: BOOT_INTENT ─────────────────────────────────────────────────────
  {
    id: 'BOOT_INTENT',
    description: 'Boots/ankle boots → 6403.51/91 leather boots; deny ch.84 car boot',
    pattern: {
      anyOf: ['boot', 'boots', 'ankle boot', 'ankle boots'],
      noneOf: ['car', 'trunk', 'computer', 'startup', 'camp'],
    },
    inject: [
      { prefix: '6403.51', syntheticRank: 22 },
      { prefix: '6403.91', syntheticRank: 25 },
      { prefix: '6403.40', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.70, chapterMatch: '64' },
    ],
  },

  // ── Rule 85: SANDAL_FLIP_FLOP_INTENT ────────────────────────────────────────
  {
    id: 'SANDAL_FLIP_FLOP_INTENT',
    description: 'Sandals/flip flops → 6402.99/6404.19 open footwear',
    pattern: {
      anyOf: ['sandal', 'sandals', 'flipflop', 'flipflops', 'flip flop', 'flip flops',
               'thong sandal', 'slides'],
      noneOf: ['dental', 'shower curtain'],
    },
    inject: [
      { prefix: '6402.99', syntheticRank: 22 },
      { prefix: '6404.19', syntheticRank: 25 },
    ],
    boosts: [
      { delta: 0.70, chapterMatch: '64' },
    ],
  },

  // ── Rule 86: SLIPPER_INTENT ──────────────────────────────────────────────────
  {
    id: 'SLIPPER_INTENT',
    description: 'Slippers/house shoes → 6405 other footwear',
    pattern: {
      anyOf: ['slipper', 'slippers', 'house shoe', 'house shoes'],
    },
    inject: [
      { prefix: '6405.20', syntheticRank: 22 },
      { prefix: '6405.10', syntheticRank: 25 },
      { prefix: '6405.90', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.70, chapterMatch: '64' },
    ],
  },

  // ── Rule 87: ALUMINUM_FOIL_INTENT ────────────────────────────────────────────
  {
    id: 'ALUMINUM_FOIL_INTENT',
    description: 'Aluminum/tin foil → 7607.11/19 aluminum foil',
    pattern: {
      anyOfGroups: [
        ['aluminum', 'aluminium', 'tin'],
        ['foil'],
      ],
    },
    inject: [
      { prefix: '7607.11', syntheticRank: 22 },
      { prefix: '7607.19', syntheticRank: 25 },
    ],
    whitelist: { allowPrefixes: ['7607.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '7607.' },
    ],
  },

  // ── Rule 88: SCISSORS_INTENT ─────────────────────────────────────────────────
  {
    id: 'SCISSORS_INTENT',
    description: 'Scissors/shears → 8213 scissors and similar shears',
    pattern: {
      anyOf: ['scissors', 'scissor', 'shears', 'snips', 'clippers'],
      noneOf: ['hedge', 'pruning', 'grass', 'nail clipper'],
    },
    inject: [
      { prefix: '8213.00', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['8213.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '8213.' },
    ],
  },

  // ── Rule 89: AIR_PURIFIER_INTENT ─────────────────────────────────────────────
  {
    id: 'AIR_PURIFIER_INTENT',
    description: 'Air purifier/HEPA filter → 8421.39 filtering/purifying apparatus for air',
    pattern: {
      anyOfGroups: [
        ['air'],
        ['purifier', 'purifiers', 'hepa', 'cleaner'],
      ],
      noneOf: ['conditioning', 'conditioner', 'compressor', 'pump'],
    },
    inject: [
      { prefix: '8421.39', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['8421.39'] },
    boosts: [
      { delta: 0.85, prefixMatch: '8421.39' },
    ],
    penalties: [
      { delta: 0.70, prefixMatch: '8415.' },
    ],
  },

  // ── Rule 90: RICE_COOKER_INTENT ──────────────────────────────────────────────
  {
    id: 'RICE_COOKER_INTENT',
    description: 'Rice cooker → 8516.79 other electrothermic appliances',
    pattern: {
      required: ['rice'],
      anyOf: ['cooker', 'cookers', 'maker', 'steamer', 'pot'],
    },
    inject: [
      { prefix: '8516.79', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['8516.79'] },
    boosts: [
      { delta: 0.90, prefixMatch: '8516.79' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 91: MICROWAVE_OVEN_INTENT ───────────────────────────────────────────
  {
    id: 'MICROWAVE_OVEN_INTENT',
    description: 'Microwave oven → 8516.50; deny ch.84 industrial',
    pattern: {
      anyOf: ['microwave', 'microwaves'],
      noneOf: ['radio', 'frequency', 'transmitter', 'tower'],
    },
    inject: [
      { prefix: '8516.50', syntheticRank: 20 },
      { prefix: '8516.60', syntheticRank: 26 },
    ],
    whitelist: { allowPrefixes: ['8516.50', '8516.60'] },
    boosts: [
      { delta: 0.90, prefixMatch: '8516.50' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '84' },
    ],
  },

  // ── Rule 92: ELECTRIC_KETTLE_INTENT ──────────────────────────────────────────
  {
    id: 'ELECTRIC_KETTLE_INTENT',
    description: 'Electric kettle → 8516.79 electrothermic appliances; deny teakettles ch.73',
    pattern: {
      anyOf: ['kettle', 'kettles', 'electric kettle'],
      noneOf: ['teakettle', 'teakettles', 'stovetop', 'camp', 'drum'],
    },
    inject: [
      { prefix: '8516.79', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['8516.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '8516.79' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '73' },
    ],
  },

  // ── Rule 93: EXTENSION_CORD_INTENT ───────────────────────────────────────────
  {
    id: 'EXTENSION_CORD_INTENT',
    description: 'Extension cord/power strip → 8544.42 insulated electric conductors with connectors',
    pattern: {
      anyOf: ['extension cord', 'extension cords', 'power strip', 'power strips',
               'surge protector', 'surge strip', 'powerstrip'],
    },
    inject: [
      { prefix: '8544.42.90', syntheticRank: 22 },
      { prefix: '8536.69', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '8544.42' },
      { delta: 0.65, prefixMatch: '8536.' },
    ],
  },

  // ── Rule 94: POWER_BANK_INTENT ───────────────────────────────────────────────
  {
    id: 'POWER_BANK_INTENT',
    description: 'Power bank/portable charger → 8507.60 lithium-ion battery or 8504.40 charger',
    pattern: {
      anyOf: ['power bank', 'powerbank', 'portable charger', 'portable battery',
               'battery pack', 'backup battery'],
    },
    inject: [
      { prefix: '8507.60', syntheticRank: 22 },
      { prefix: '8504.40', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.75, prefixMatch: '8507.60' },
      { delta: 0.65, prefixMatch: '8504.40' },
    ],
  },

  // ── Rule 95: SMARTWATCH_INTENT ───────────────────────────────────────────────
  {
    id: 'SMARTWATCH_INTENT',
    description: 'Smartwatch/fitness tracker/wearable → 8517.62 or 9102',
    pattern: {
      anyOf: ['smartwatch', 'smartwatches', 'fitness tracker', 'fitness trackers',
               'fitbit', 'wearable', 'smart watch'],
    },
    inject: [
      { prefix: '8517.62', syntheticRank: 22 },
      { prefix: '9102.12', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '8517.' },
      { delta: 0.60, prefixMatch: '9102.' },
    ],
  },

  // ── Rule 96: LED_STRIP_INTENT ────────────────────────────────────────────────
  {
    id: 'LED_STRIP_INTENT',
    description: 'LED strip/LED tape → 9405.40 other electric lamps and lighting fittings',
    pattern: {
      anyOfGroups: [
        ['led'],
        ['strip', 'tape', 'ribbon', 'rope light', 'light strip'],
      ],
      noneOf: ['earring', 'bracelet', 'textile', 'film'],
    },
    inject: [
      { prefix: '9405.40', syntheticRank: 22 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '9405.40' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '85' },
    ],
  },

  // ── Rule 97: WIFI_ROUTER_INTENT ──────────────────────────────────────────────
  {
    id: 'WIFI_ROUTER_INTENT',
    description: 'WiFi router/modem/access point → 8517.62 data communication apparatus',
    pattern: {
      anyOf: ['router', 'routers', 'wifi', 'wi-fi', 'access point', 'modem', 'modems',
               'wireless router', 'mesh wifi'],
      noneOf: ['woodworking', 'wood router', 'cnc'],
    },
    inject: [
      { prefix: '8517.62', syntheticRank: 22 },
      { prefix: '8517.69', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['85'] },
    boosts: [
      { delta: 0.80, prefixMatch: '8517.' },
    ],
  },

  // ── Rule 98: DRONE_UAV_INTENT ────────────────────────────────────────────────
  {
    id: 'DRONE_UAV_INTENT',
    description: 'Drone/quadcopter/UAV → 8806 unmanned aircraft',
    pattern: {
      anyOf: ['drone', 'drones', 'quadcopter', 'quadcopters', 'uav', 'fpv drone',
               'unmanned aircraft'],
    },
    inject: [
      { prefix: '8806.21', syntheticRank: 22 },
      { prefix: '8806.22', syntheticRank: 25 },
      { prefix: '8806.24', syntheticRank: 28 },
    ],
    whitelist: { allowChapters: ['88'] },
    boosts: [
      { delta: 0.90, chapterMatch: '88' },
    ],
  },

  // ── Rule 99: GAMING_CONSOLE_INTENT ───────────────────────────────────────────
  {
    id: 'GAMING_CONSOLE_INTENT',
    description: 'PlayStation/Xbox/Nintendo/gaming console → 9504.50 video game consoles',
    pattern: {
      anyOf: ['playstation', 'xbox', 'nintendo', 'gaming console', 'console',
               'gamepad', 'game controller', 'controller'],
      noneOf: ['industrial', 'military', 'dashboard', 'car'],
    },
    inject: [
      { prefix: '9504.50', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['9504.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '9504.50' },
    ],
  },

  // ── Rule 100: STROLLER_INTENT ────────────────────────────────────────────────
  {
    id: 'STROLLER_INTENT',
    description: 'Baby stroller/pram/pushchair → 8715.00',
    pattern: {
      anyOf: ['stroller', 'strollers', 'pram', 'prams', 'buggy', 'buggies',
               'pushchair', 'baby carriage'],
    },
    inject: [
      { prefix: '8715.00', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['8715.'] },
    boosts: [
      { delta: 0.95, prefixMatch: '8715.' },
    ],
  },

  // ── Rule 101: CONTACT_LENS_INTENT ────────────────────────────────────────────
  {
    id: 'CONTACT_LENS_INTENT',
    description: 'Contact lens → 9001.30; deny 9001.10 optical fiber',
    pattern: {
      anyOfGroups: [
        ['contact'],
        ['lens', 'lenses'],
      ],
    },
    inject: [
      { prefix: '9001.30', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['9001.30'] },
    boosts: [
      { delta: 0.95, prefixMatch: '9001.30' },
    ],
    penalties: [
      { delta: 0.90, prefixMatch: '9001.10' },
      { delta: 0.80, chapterMatch: '85' },
    ],
  },

  // ── Rule 102: SLEEPING_BAG_INTENT ────────────────────────────────────────────
  {
    id: 'SLEEPING_BAG_INTENT',
    description: 'Sleeping bag → 9404.30/40; deny 6307 bag shells only',
    pattern: {
      required: ['sleeping'],
      anyOf: ['bag', 'bags'],
    },
    inject: [
      { prefix: '9404.30', syntheticRank: 20 },
      { prefix: '9404.40', syntheticRank: 24 },
    ],
    whitelist: { allowPrefixes: ['9404.3', '9404.4'] },
    boosts: [
      { delta: 0.90, prefixMatch: '9404.30' },
      { delta: 0.80, prefixMatch: '9404.40' },
    ],
  },

  // ── Rule 103: OFFICE_CHAIR_INTENT ────────────────────────────────────────────
  {
    id: 'OFFICE_CHAIR_INTENT',
    description: 'Office/desk/ergonomic chair → 9401.30 swivel seats with height adjustment',
    pattern: {
      anyOfGroups: [
        ['office', 'desk', 'computer', 'swivel', 'ergonomic', 'gaming chair'],
        ['chair', 'chairs', 'seat', 'seating'],
      ],
      noneOf: ['wheel', 'wheelchair', 'rocking', 'folding', 'beach'],
    },
    inject: [
      { prefix: '9401.30', syntheticRank: 22 },
      { prefix: '9401.39', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '9401.30' },
      { delta: 0.55, chapterMatch: '94' },
    ],
  },

  // ── Rule 104: MATTRESS_INTENT ────────────────────────────────────────────────
  {
    id: 'MATTRESS_INTENT',
    description: 'Mattress → 9404.21/29 spring/foam mattresses; deny inflatable air mattress',
    pattern: {
      anyOf: ['mattress', 'mattresses'],
      noneOf: ['air', 'inflatable', 'camping'],
    },
    inject: [
      { prefix: '9404.21', syntheticRank: 22 },
      { prefix: '9404.29', syntheticRank: 25 },
    ],
    whitelist: { allowPrefixes: ['9404.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '9404.2' },
    ],
  },

  // ── Rule 105: FISHING_ROD_INTENT ─────────────────────────────────────────────
  {
    id: 'FISHING_ROD_INTENT',
    description: 'Fishing rod/pole → 9507.10',
    pattern: {
      required: ['fishing'],
      anyOf: ['rod', 'rods', 'pole', 'poles', 'tackle'],
    },
    inject: [
      { prefix: '9507.10', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['9507.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '9507.' },
    ],
  },

  // ── Rule 106: SKATEBOARD_INTENT ──────────────────────────────────────────────
  {
    id: 'SKATEBOARD_INTENT',
    description: 'Skateboard/longboard → 9506.91 articles for gymnastics/athletics',
    pattern: {
      anyOf: ['skateboard', 'skateboards', 'longboard', 'longboards', 'skate deck'],
    },
    inject: [
      { prefix: '9506.91', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['9506.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '9506.91' },
    ],
  },

  // ── Rule 107: CAMPING_TENT_INTENT ────────────────────────────────────────────
  {
    id: 'CAMPING_TENT_INTENT',
    description: 'Camping/outdoor tent → 6306.22/12 tents of synthetic fibers',
    pattern: {
      anyOfGroups: [
        ['camping', 'outdoor', 'backpacking', 'hiking'],
        ['tent', 'tents'],
      ],
    },
    inject: [
      { prefix: '6306.22', syntheticRank: 22 },
      { prefix: '6306.12', syntheticRank: 25 },
    ],
    whitelist: { allowPrefixes: ['6306.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '6306.' },
    ],
  },

  // ── Rule 108: BOARD_GAME_PUZZLE_INTENT ───────────────────────────────────────
  {
    id: 'BOARD_GAME_PUZZLE_INTENT',
    description: 'Board game/jigsaw puzzle → 9504.40/90; deny ch.85 digital/electronic games',
    pattern: {
      anyOf: ['board game', 'boardgame', 'jigsaw', 'puzzle', 'puzzles', 'monopoly',
               'scrabble', 'checkers', 'chess', 'dominoes', 'crossword'],
      noneOf: ['electric', 'digital', 'video', 'console', 'app'],
    },
    inject: [
      { prefix: '9504.40', syntheticRank: 22 },
      { prefix: '9504.90', syntheticRank: 25 },
    ],
    boosts: [
      { delta: 0.75, chapterMatch: '95' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '85' },
    ],
  },

  // ── Rule 109: NAIL_POLISH_INTENT ─────────────────────────────────────────────
  {
    id: 'NAIL_POLISH_INTENT',
    description: 'Nail polish/nail varnish → 3304.30 manicure preparations',
    pattern: {
      anyOfGroups: [
        ['nail', 'nails'],
        ['polish', 'varnish', 'lacquer', 'enamel', 'gel'],
      ],
    },
    inject: [
      { prefix: '3304.30', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['3304.30'] },
    boosts: [
      { delta: 0.95, prefixMatch: '3304.30' },
    ],
  },

  // ── Rule 110: LIPSTICK_LIP_MAKEUP_INTENT ────────────────────────────────────
  {
    id: 'LIPSTICK_LIP_MAKEUP_INTENT',
    description: 'Lipstick/lip gloss/lip balm → 3304.10 lip make-up preparations',
    pattern: {
      anyOf: ['lipstick', 'lipsticks', 'lip gloss', 'lip balm', 'chapstick',
               'lip liner', 'lip stain'],
    },
    inject: [
      { prefix: '3304.10', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['3304.10'] },
    boosts: [
      { delta: 0.95, prefixMatch: '3304.10' },
    ],
  },

  // ── Rule 111: EYE_MAKEUP_INTENT ──────────────────────────────────────────────
  {
    id: 'EYE_MAKEUP_INTENT',
    description: 'Mascara/eyeshadow/eyeliner → 3304.20 eye make-up preparations',
    pattern: {
      anyOf: ['mascara', 'mascaras', 'eyeshadow', 'eye shadow', 'eyeliner', 'eye liner',
               'eye makeup', 'kohl', 'eye pencil'],
    },
    inject: [
      { prefix: '3304.20', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['3304.20'] },
    boosts: [
      { delta: 0.95, prefixMatch: '3304.20' },
    ],
  },

  // ── Rule 112: DEODORANT_INTENT ───────────────────────────────────────────────
  {
    id: 'DEODORANT_INTENT',
    description: 'Deodorant/antiperspirant → 3307.20 personal deodorants',
    pattern: {
      anyOf: ['deodorant', 'deodorants', 'antiperspirant', 'antiperspirants'],
    },
    inject: [
      { prefix: '3307.20', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['3307.20'] },
    boosts: [
      { delta: 0.95, prefixMatch: '3307.20' },
    ],
  },

  // ── Rule 113: SUNSCREEN_INTENT ───────────────────────────────────────────────
  {
    id: 'SUNSCREEN_INTENT',
    description: 'Sunscreen/sunblock/SPF → 3304.99 other beauty preparations',
    pattern: {
      anyOf: ['sunscreen', 'sunscreens', 'sunblock', 'sunblocks', 'spf', 'suntan lotion',
               'sun protection', 'uv protection'],
    },
    inject: [
      { prefix: '3304.99', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['3304.99'] },
    boosts: [
      { delta: 0.90, prefixMatch: '3304.99' },
    ],
  },

  // ── Rule 114: SKINCARE_INTENT ────────────────────────────────────────────────
  {
    id: 'SKINCARE_INTENT',
    description: 'Moisturizer/serum/face cream/lotion → 3304.99 beauty preparations',
    pattern: {
      anyOf: ['moisturizer', 'moisturizers', 'serum', 'serums', 'face cream', 'face lotion',
               'body lotion', 'body cream', 'skincare', 'toner', 'primer'],
      noneOf: ['metal', 'paint', 'industrial', 'wood'],
    },
    inject: [
      { prefix: '3304.99', syntheticRank: 22 },
      { prefix: '3304.91', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['33'] },
    boosts: [
      { delta: 0.80, prefixMatch: '3304.99' },
      { delta: 0.70, prefixMatch: '3304.91' },
    ],
  },

  // ── Rule 115: LEGGINGS_TIGHTS_INTENT ────────────────────────────────────────
  {
    id: 'LEGGINGS_TIGHTS_INTENT',
    description: 'Leggings/yoga pants/tights → 6104.63/6114.20 knitted trousers/tights',
    pattern: {
      anyOf: ['leggings', 'legging', 'yoga pants', 'yoga pant', 'tights', 'jeggings'],
    },
    inject: [
      { prefix: '6104.63', syntheticRank: 22 },
      { prefix: '6114.20', syntheticRank: 25 },
      { prefix: '6115.10', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.70, chapterMatch: '61' },
    ],
  },

  // ── Rule 116: ATHLETIC_SPORTSWEAR_INTENT ─────────────────────────────────────
  {
    id: 'ATHLETIC_SPORTSWEAR_INTENT',
    description: 'Tracksuit/sportswear/activewear → 6211.20/43 track suits',
    pattern: {
      anyOf: ['tracksuit', 'tracksuits', 'athletic wear', 'activewear', 'sportswear',
               'jogging suit', 'sweatsuit', 'workout clothes'],
    },
    inject: [
      { prefix: '6211.20', syntheticRank: 22 },
      { prefix: '6211.43', syntheticRank: 25 },
      { prefix: '6112.11', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.60, chapterMatch: '62' },
      { delta: 0.55, chapterMatch: '61' },
    ],
  },

  // ── Rule 117: SCARF_SHAWL_INTENT ─────────────────────────────────────────────
  {
    id: 'SCARF_SHAWL_INTENT',
    description: 'Scarf/shawl/muffler/stole → 6214 shawls, scarves, mufflers',
    pattern: {
      anyOf: ['scarf', 'scarves', 'shawl', 'shawls', 'muffler', 'mufflers', 'stole', 'stoles'],
    },
    inject: [
      { prefix: '6214.20', syntheticRank: 22 },
      { prefix: '6214.30', syntheticRank: 25 },
      { prefix: '6214.10', syntheticRank: 28 },
      { prefix: '6214.90', syntheticRank: 31 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '6214.' },
    ],
  },

  // ── Rule 118: WALLET_PURSE_INTENT ────────────────────────────────────────────
  {
    id: 'WALLET_PURSE_INTENT',
    description: 'Wallet/billfold/card holder → 4202.31/32; deny 4202.21 handbags',
    pattern: {
      anyOf: ['wallet', 'wallets', 'billfold', 'billfolds', 'money clip', 'card holder',
               'cardholder', 'money wallet', 'coin purse'],
      noneOf: ['backpack', 'handbag', 'tote', 'bag'],
    },
    inject: [
      { prefix: '4202.31', syntheticRank: 22 },
      { prefix: '4202.32', syntheticRank: 25 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '4202.31' },
      { delta: 0.70, prefixMatch: '4202.32' },
    ],
    penalties: [
      { delta: 0.70, prefixMatch: '4202.21' },
      { delta: 0.70, prefixMatch: '4202.22' },
    ],
  },

  // ── Rule 119: WRISTWATCH_ANALOG_INTENT ───────────────────────────────────────
  {
    id: 'WRISTWATCH_ANALOG_INTENT',
    description: 'Wristwatch/timepiece → 9102.12/21 wristwatches; deny 8517 smartwatch',
    pattern: {
      anyOf: ['watch', 'watches', 'wristwatch', 'wristwatches', 'timepiece', 'timepieces'],
      noneOf: ['smartwatch', 'fitness tracker', 'smart watch', 'digital fitness'],
    },
    inject: [
      { prefix: '9102.12', syntheticRank: 22 },
      { prefix: '9102.21', syntheticRank: 25 },
      { prefix: '9101.11', syntheticRank: 30 },
    ],
    whitelist: { allowChapters: ['91'] },
    boosts: [
      { delta: 0.80, chapterMatch: '91' },
    ],
    penalties: [
      { delta: 0.70, chapterMatch: '85' },
    ],
  },

  // ── Rule 120: CANDLE_INTENT ──────────────────────────────────────────────────
  {
    id: 'CANDLE_INTENT',
    description: 'Candle/taper/tea light → 3406.00 candles and similar',
    pattern: {
      anyOf: ['candle', 'candles', 'taper candle', 'taper candles', 'pillar candle',
               'scented candle', 'tea light', 'tealight', 'votive candle'],
      noneOf: ['holder', 'stick', 'candlestick', 'chandelier', 'candelabra'],
    },
    inject: [
      { prefix: '3406.00', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['3406.'] },
    boosts: [
      { delta: 0.95, prefixMatch: '3406.' },
    ],
  },

  // ── Rule 121: ESSENTIAL_OIL_INTENT ───────────────────────────────────────────
  {
    id: 'ESSENTIAL_OIL_INTENT',
    description: 'Essential oil/aromatherapy → 3301 essential oils',
    pattern: {
      anyOfGroups: [
        ['essential', 'aromatherapy', 'lavender', 'peppermint', 'eucalyptus',
         'tea tree', 'frankincense', 'lemon oil', 'cedarwood'],
        ['oil', 'oils', 'extract', 'diffuser'],
      ],
    },
    inject: [
      { prefix: '3301.19', syntheticRank: 22 },
      { prefix: '3301.29', syntheticRank: 25 },
    ],
    whitelist: { allowChapters: ['33'] },
    boosts: [
      { delta: 0.85, prefixMatch: '3301.' },
    ],
  },

  // ── Rule 122: BABY_DIAPER_INTENT ─────────────────────────────────────────────
  {
    id: 'BABY_DIAPER_INTENT',
    description: 'Baby diaper/nappy → 9619.00 sanitary towels/napkins and diapers',
    pattern: {
      anyOf: ['diaper', 'diapers', 'nappy', 'nappies', 'baby diaper', 'infant diaper'],
    },
    inject: [
      { prefix: '9619.00', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['9619.'] },
    boosts: [
      { delta: 0.95, prefixMatch: '9619.' },
    ],
  },

  // ── Rule 123: PET_FOOD_INTENT ────────────────────────────────────────────────
  {
    id: 'PET_FOOD_INTENT',
    description: 'Dog/cat/pet food → 2309.10 dog or cat food for retail sale',
    pattern: {
      anyOfGroups: [
        ['dog', 'cat', 'pet', 'kitten', 'puppy'],
        ['food', 'feed', 'treat', 'treats', 'kibble', 'wet food', 'dry food'],
      ],
    },
    inject: [
      { prefix: '2309.10', syntheticRank: 22 },
      { prefix: '2309.90', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['23'] },
    boosts: [
      { delta: 0.85, prefixMatch: '2309.' },
    ],
  },

  // ── Rule 124: SUPPLEMENT_VITAMIN_INTENT ──────────────────────────────────────
  {
    id: 'SUPPLEMENT_VITAMIN_INTENT',
    description: 'Vitamin/supplement/omega/probiotic → 2936 vitamins or 3004 pharmaceutical',
    pattern: {
      anyOf: ['vitamin', 'vitamins', 'supplement', 'supplements', 'multivitamin',
               'omega', 'probiotics', 'probiotic', 'melatonin', 'zinc', 'collagen'],
    },
    inject: [
      { prefix: '2936.27', syntheticRank: 22 },
      { prefix: '2936.28', syntheticRank: 25 },
      { prefix: '3004.50', syntheticRank: 26 },
      { prefix: '2106.90', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.65, chapterMatch: '29' },
      { delta: 0.60, chapterMatch: '30' },
      { delta: 0.55, chapterMatch: '21' },
    ],
  },

  // ── Rule 125: BEANIE_HAT_INTENT ───────────────────────────────────────────────
  {
    id: 'BEANIE_HAT_INTENT',
    description: 'Beanie/fedora/knit hat/sun hat → 6505.00 hats and headwear',
    pattern: {
      anyOf: ['beanie', 'beanies', 'fedora', 'fedoras', 'knit hat', 'sun hat',
               'straw hat', 'winter hat', 'bucket hat', 'cloche'],
    },
    inject: [
      { prefix: '6505.00', syntheticRank: 22 },
      { prefix: '6504.00', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['65'] },
    boosts: [
      { delta: 0.80, chapterMatch: '65' },
    ],
  },

  // ── Rule 126: BICYCLE_HELMET_INTENT ──────────────────────────────────────────
  {
    id: 'BICYCLE_HELMET_INTENT',
    description: 'Bicycle/sports helmet → 6506.10 safety headgear',
    pattern: {
      anyOf: ['helmet', 'helmets', 'bike helmet', 'cycling helmet', 'bicycle helmet',
               'sports helmet', 'ski helmet', 'motorcycle helmet'],
      noneOf: ['football', 'american football', 'construction', 'hard hat'],
    },
    inject: [
      { prefix: '6506.10', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['6506.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '6506.' },
    ],
  },

  // ── Rule 127: SPICE_SEASONING_INTENT ─────────────────────────────────────────
  {
    id: 'SPICE_SEASONING_INTENT',
    description: 'Pepper/cinnamon/cumin/spice → ch.09 spices and condiments',
    pattern: {
      anyOf: ['pepper', 'peppers', 'peppercorn', 'cinnamon', 'cumin', 'turmeric',
               'paprika', 'oregano', 'basil', 'thyme', 'rosemary', 'nutmeg', 'cardamom',
               'ginger powder', 'chili powder', 'cayenne', 'spice', 'spices', 'seasoning'],
      noneOf: ['bell pepper', 'fresh', 'plant', 'garden', 'mint plant'],
    },
    inject: [
      { prefix: '0904.22', syntheticRank: 22 },
      { prefix: '0906.11', syntheticRank: 25 },
      { prefix: '0908.21', syntheticRank: 28 },
      { prefix: '0910.91', syntheticRank: 30 },
    ],
    boosts: [
      { delta: 0.80, chapterMatch: '09' },
    ],
  },

  // ── Rule 128: ICE_CREAM_INTENT ───────────────────────────────────────────────
  {
    id: 'ICE_CREAM_INTENT',
    description: 'Ice cream/sorbet/gelato → 2105.00 ice cream and edible ice',
    pattern: {
      anyOf: ['ice cream', 'icecream', 'sorbet', 'gelato', 'frozen yogurt', 'sherbet', 'popsicle'],
    },
    inject: [
      { prefix: '2105.00', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['2105.'] },
    boosts: [
      { delta: 0.95, prefixMatch: '2105.' },
    ],
  },

  // ── Rule 129: TRIPOD_CAMERA_SUPPORT_INTENT ───────────────────────────────────
  {
    id: 'TRIPOD_CAMERA_SUPPORT_INTENT',
    description: 'Tripod/monopod/selfie stick → 9620.00 monopods, bipods, tripods',
    pattern: {
      anyOf: ['tripod', 'tripods', 'monopod', 'monopods', 'selfie stick', 'selfie sticks',
               'camera stand', 'gorilla pod', 'gorillapod'],
    },
    inject: [
      { prefix: '9620.00', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['9620.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '9620.' },
    ],
  },

  // ── Rule 130: BATTERY_INTENT ─────────────────────────────────────────────────
  {
    id: 'BATTERY_INTENT',
    description: 'AA/AAA/rechargeable battery → 8506.10/8507.60; deny car/EV batteries',
    pattern: {
      anyOf: ['battery', 'batteries', 'rechargeable battery', 'alkaline battery',
               'lithium battery'],
      noneOf: ['car battery', 'electric vehicle', 'phone battery', 'power bank'],
    },
    inject: [
      { prefix: '8506.10', syntheticRank: 22 },
      { prefix: '8506.50', syntheticRank: 25 },
      { prefix: '8507.60', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '8506.' },
      { delta: 0.60, prefixMatch: '8507.' },
    ],
  },

  // ── Rule 131: SPEAKER_AUDIO_INTENT ───────────────────────────────────────────
  {
    id: 'SPEAKER_AUDIO_INTENT',
    description: 'Bluetooth speaker/soundbar/subwoofer → 8518.22/29/40',
    pattern: {
      anyOf: ['bluetooth speaker', 'portable speaker', 'soundbar', 'subwoofer',
               'loudspeaker', 'bookshelf speaker', 'floor speaker'],
      noneOf: ['phone speaker', 'earphone', 'earbuds'],
    },
    inject: [
      { prefix: '8518.22', syntheticRank: 22 },
      { prefix: '8518.29', syntheticRank: 25 },
      { prefix: '8518.40', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '8518.' },
    ],
  },

  // ── Rule 132: MICROPHONE_INTENT ──────────────────────────────────────────────
  {
    id: 'MICROPHONE_INTENT',
    description: 'Microphone/mic → 8518.10 microphones',
    pattern: {
      anyOf: ['microphone', 'microphones', 'condenser microphone', 'dynamic microphone',
               'usb microphone', 'studio mic', 'lapel mic'],
    },
    inject: [
      { prefix: '8518.10', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['8518.10'] },
    boosts: [
      { delta: 0.90, prefixMatch: '8518.10' },
    ],
  },

  // ── Rule 133: COMPUTER_KEYBOARD_INTENT ───────────────────────────────────────
  {
    id: 'COMPUTER_KEYBOARD_INTENT',
    description: 'Computer keyboard → 8471.60 input/output units; deny ch.92 piano keyboard',
    pattern: {
      anyOf: ['computer keyboard', 'mechanical keyboard', 'wireless keyboard',
               'gaming keyboard', 'bluetooth keyboard'],
    },
    inject: [
      { prefix: '8471.60', syntheticRank: 22 },
    ],
    whitelist: { allowPrefixes: ['8471.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '8471.60' },
    ],
    penalties: [
      { delta: 0.80, chapterMatch: '92' },
    ],
  },

  // ── Rule 134: HONEY_COSMETIC_INTENT overridden by HONEY_INTENT above

  // ── Rule 134: MINERAL_WATER_INTENT ───────────────────────────────────────────
  {
    id: 'MINERAL_WATER_INTENT',
    description: 'Mineral water/sparkling water → 2201.10 mineral and aerated waters',
    pattern: {
      anyOfGroups: [
        ['mineral', 'sparkling', 'carbonated', 'still'],
        ['water', 'waters'],
      ],
      noneOf: ['bottle opener', 'heater', 'pipe', 'irrigation', 'hose', 'pump'],
    },
    inject: [
      { prefix: '2201.10', syntheticRank: 22 },
      { prefix: '2202.10', syntheticRank: 25 },
    ],
    whitelist: { allowPrefixes: ['2201.', '2202.'] },
    boosts: [
      { delta: 0.85, chapterMatch: '22' },
    ],
  },

  // ── Rule 135: BICYCLE_ACCESSORY_INTENT ───────────────────────────────────────
  {
    id: 'BICYCLE_LOCK_INTENT',
    description: 'Bicycle lock/chain lock → 8301.20 padlocks/locks for bicycles',
    pattern: {
      anyOfGroups: [
        ['bicycle', 'bike', 'cycling'],
        ['lock', 'locks', 'chain lock', 'u-lock', 'cable lock'],
      ],
    },
    inject: [
      { prefix: '8301.20', syntheticRank: 22 },
    ],
    boosts: [
      { delta: 0.85, prefixMatch: '8301.20' },
    ],
  },

  // ── Rule 136: PROTEIN_SUPPLEMENT_INTENT ─────────────────────────────────────
  {
    id: 'PROTEIN_SUPPLEMENT_INTENT',
    description: 'Protein powder/whey → 2106.10 protein concentrates and textured proteins',
    pattern: {
      anyOfGroups: [
        ['protein', 'whey', 'casein', 'collagen'],
        ['powder', 'supplement', 'shake', 'bar'],
      ],
    },
    inject: [
      { prefix: '2106.10', syntheticRank: 22 },
      { prefix: '3502.20', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.80, prefixMatch: '2106.10' },
    ],
  },

  // ── Rule 137: HAIR_ACCESSORY_INTENT ──────────────────────────────────────────
  {
    id: 'HAIR_ACCESSORY_INTENT',
    description: 'Headband/hair clip/barrette/bobby pin → 9615 combs, hair-slides and the like',
    pattern: {
      anyOf: ['headband', 'headbands', 'hair clip', 'hair clips', 'barrette', 'barrettes',
               'bobby pin', 'bobby pins', 'hair tie', 'hair ties', 'hair slide', 'scrunchie'],
      noneOf: ['sweatband', 'sports headband'],
    },
    inject: [
      { prefix: '9615.19', syntheticRank: 22 },
      { prefix: '9615.90', syntheticRank: 25 },
    ],
    whitelist: { allowPrefixes: ['9615.'] },
    boosts: [
      { delta: 0.85, prefixMatch: '9615.' },
    ],
  },

  // ── Rule 138: CANDLE_HOLDER_INTENT ───────────────────────────────────────────
  {
    id: 'CANDLE_HOLDER_INTENT',
    description: 'Candle holder/candlestick/hurricane → 9405.50 non-electric lamps/candlesticks',
    pattern: {
      anyOf: ['candle holder', 'candle holders', 'candleholder', 'candleholders',
               'candlestick', 'candlesticks', 'hurricane candle', 'votive holder',
               'candelabra', 'taper holder'],
    },
    inject: [
      { prefix: '9405.50', syntheticRank: 22 },
    ],
    boosts: [
      { delta: 0.85, prefixMatch: '9405.50' },
    ],
  },

  // ── Rule 139: ELECTRIC_TOOTHBRUSH_INTENT ─────────────────────────────────────
  {
    id: 'ELECTRIC_TOOTHBRUSH_INTENT',
    description: 'Electric toothbrush/sonic toothbrush → 8509.80 electromechanical domestic appliances',
    pattern: {
      anyOfGroups: [
        ['electric', 'sonic', 'battery', 'powered'],
        ['toothbrush', 'toothbrushes'],
      ],
    },
    inject: [
      { prefix: '8509.80', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['8509.'] },
    boosts: [
      { delta: 0.90, prefixMatch: '8509.80' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '9603.' },
    ],
  },

  // ── Rule 140: BABY_FOOD_INTENT ───────────────────────────────────────────────
  {
    id: 'BABY_FOOD_INTENT',
    description: 'Baby food/infant formula → 1901.10 preparations for infant use',
    pattern: {
      anyOfGroups: [
        ['baby', 'infant', 'toddler'],
        ['food', 'formula', 'cereal', 'puree'],
      ],
      noneOf: ['diaper', 'stroller', 'monitor', 'carriage', 'toy'],
    },
    inject: [
      { prefix: '1901.10', syntheticRank: 22 },
      { prefix: '2106.90', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['19', '21'] },
    boosts: [
      { delta: 0.85, prefixMatch: '1901.10' },
    ],
  },

  // ── Rule 141: OLIVE_STANDALONE_INTENT ────────────────────────────────────────
  {
    id: 'OLIVE_STANDALONE_INTENT',
    description: 'Olives (food, not oil) → 2005.70 prepared/preserved olives',
    pattern: {
      anyOf: ['olives', 'stuffed olives', 'black olives', 'green olives', 'kalamata'],
      noneOf: ['oil', 'oils', 'extra', 'virgin'],
    },
    inject: [
      { prefix: '2005.70', syntheticRank: 22 },
    ],
    boosts: [
      { delta: 0.90, prefixMatch: '2005.70' },
    ],
  },

  // ── Rule 142: COOKING_OIL_INTENT ─────────────────────────────────────────────
  {
    id: 'COOKING_OIL_INTENT',
    description: 'Vegetable cooking oil/coconut oil/avocado oil → ch.15 fats and oils',
    pattern: {
      anyOfGroups: [
        ['vegetable', 'coconut', 'avocado', 'sunflower', 'canola', 'soybean',
         'sesame', 'palm', 'grape seed', 'peanut oil'],
        ['oil', 'oils', 'cooking', 'frying'],
      ],
      noneOf: ['engine', 'motor', 'machine', 'lubricant', 'mineral'],
    },
    inject: [
      { prefix: '1513.11', syntheticRank: 22 },
      { prefix: '1512.11', syntheticRank: 25 },
      { prefix: '1515.90', syntheticRank: 28 },
    ],
    boosts: [
      { delta: 0.75, chapterMatch: '15' },
    ],
  },

  // ── Rule 143: BLUETOOTH_EARBUDS_INTENT ───────────────────────────────────────
  {
    id: 'BLUETOOTH_EARBUDS_INTENT',
    description: 'TWS/wireless earbuds → 8518.30 headphones/earphones; deny 8517 phones',
    pattern: {
      anyOfGroups: [
        ['wireless', 'bluetooth', 'tws', 'true wireless'],
        ['earbuds', 'earphones', 'earphones'],
      ],
    },
    inject: [
      { prefix: '8518.30', syntheticRank: 20 },
    ],
    whitelist: { allowPrefixes: ['8518.30'] },
    boosts: [
      { delta: 0.90, prefixMatch: '8518.30' },
    ],
    penalties: [
      { delta: 0.80, prefixMatch: '8517.' },
    ],
  },

  // ── Rule 144: PHONE_STAND_HOLDER_INTENT ──────────────────────────────────────
  {
    id: 'PHONE_STAND_HOLDER_INTENT',
    description: 'Phone stand/holder/mount → 3926.90 other articles of plastics',
    pattern: {
      anyOfGroups: [
        ['phone', 'smartphone', 'iphone', 'mobile'],
        ['stand', 'holder', 'mount', 'dock', 'cradle', 'arm'],
      ],
      noneOf: ['case', 'cover', 'screen protector'],
    },
    inject: [
      { prefix: '3926.90', syntheticRank: 22 },
      { prefix: '7326.90', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '3926.90' },
    ],
  },

  // ── Rule 145: SCREEN_PROTECTOR_INTENT ────────────────────────────────────────
  {
    id: 'SCREEN_PROTECTOR_INTENT',
    description: 'Screen protector/tempered glass → 3920.49/7007.19 for mobile phones',
    pattern: {
      anyOf: ['screen protector', 'screen protectors', 'tempered glass', 'screen guard',
               'privacy screen', 'glass protector'],
    },
    inject: [
      { prefix: '3920.49', syntheticRank: 22 },
      { prefix: '7007.19', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.75, prefixMatch: '3920.' },
      { delta: 0.65, prefixMatch: '7007.' },
    ],
  },

  // ── Rule 146: FRESH_VEGETABLE_INTENT ─────────────────────────────────────────
  {
    id: 'FRESH_VEGETABLE_INTENT',
    description: 'Fresh vegetables → ch.07',
    pattern: {
      anyOf: ['broccoli', 'carrot', 'carrots', 'potato', 'potatoes', 'onion', 'onions',
               'tomato', 'tomatoes', 'spinach', 'lettuce', 'mushroom', 'mushrooms',
               'cucumber', 'cucumbers', 'corn', 'garlic', 'asparagus', 'zucchini',
               'eggplant', 'celery', 'cabbage', 'cauliflower', 'pumpkin', 'squash',
               'vegetable', 'vegetables', 'produce'],
    },
    inject: [
      { prefix: '0702.', syntheticRank: 22 },
      { prefix: '0706.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['07'] },
    boosts: [{ delta: 0.70, chapterMatch: '07' }],
  },

  // ── Rule 147: FRESH_FRUIT_INTENT ─────────────────────────────────────────────
  {
    id: 'FRESH_FRUIT_INTENT',
    description: 'Fresh fruits → ch.08',
    pattern: {
      anyOf: ['apple', 'apples', 'banana', 'bananas', 'orange', 'oranges', 'strawberry',
               'strawberries', 'blueberry', 'blueberries', 'grape', 'grapes', 'mango',
               'mangoes', 'avocado', 'avocados', 'lemon', 'lemons', 'lime', 'limes',
               'peach', 'peaches', 'pear', 'pears', 'watermelon', 'pineapple', 'cherry',
               'cherries', 'kiwi', 'papaya', 'coconut', 'plum', 'plums', 'fruit', 'fruits'],
    },
    inject: [
      { prefix: '0808.', syntheticRank: 22 },
      { prefix: '0805.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['08'] },
    boosts: [{ delta: 0.70, chapterMatch: '08' }],
  },

  // ── Rule 148: DAIRY_INTENT ────────────────────────────────────────────────────
  {
    id: 'DAIRY_INTENT',
    description: 'Dairy products → ch.04',
    pattern: {
      anyOf: ['milk', 'cheese', 'cheeses', 'butter', 'yogurt', 'yoghurt', 'cream',
               'dairy', 'mozzarella', 'cheddar', 'parmesan', 'brie'],
    },
    inject: [
      { prefix: '0401.', syntheticRank: 22 },
      { prefix: '0406.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['04'] },
    boosts: [{ delta: 0.70, chapterMatch: '04' }],
  },

  // ── Rule 149: EGG_INTENT ──────────────────────────────────────────────────────
  {
    id: 'EGG_INTENT',
    description: 'Eggs → 0407',
    pattern: {
      anyOf: ['egg', 'eggs', 'poultry egg'],
      noneOf: ['easter', 'toy', 'chocolate egg'],
    },
    inject: [{ prefix: '0407.', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['0407.'] },
    boosts: [{ delta: 0.75, prefixMatch: '0407.' }],
  },

  // ── Rule 150: MEAT_BEEF_INTENT ────────────────────────────────────────────────
  {
    id: 'MEAT_BEEF_INTENT',
    description: 'Beef/steak → ch.02',
    pattern: {
      anyOf: ['beef', 'steak', 'brisket', 'sirloin', 'bovine', 'ground beef'],
    },
    inject: [
      { prefix: '0201.', syntheticRank: 22 },
      { prefix: '0202.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['02'] },
    boosts: [{ delta: 0.70, chapterMatch: '02' }],
  },

  // ── Rule 151: MEAT_POULTRY_INTENT ────────────────────────────────────────────
  {
    id: 'MEAT_POULTRY_INTENT',
    description: 'Chicken/turkey/poultry → 0207',
    pattern: {
      anyOf: ['chicken', 'turkey', 'poultry', 'broiler', 'fowl', 'duck', 'goose'],
    },
    inject: [{ prefix: '0207.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['02'] },
    boosts: [{ delta: 0.70, chapterMatch: '02' }],
  },

  // ── Rule 152: MEAT_PORK_INTENT ────────────────────────────────────────────────
  {
    id: 'MEAT_PORK_INTENT',
    description: 'Pork/bacon/ham → 0203/0210',
    pattern: {
      anyOf: ['pork', 'bacon', 'ham', 'swine', 'lard', 'prosciutto'],
    },
    inject: [
      { prefix: '0203.', syntheticRank: 22 },
      { prefix: '0210.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['02'] },
    boosts: [{ delta: 0.70, chapterMatch: '02' }],
  },

  // ── Rule 153: SEAFOOD_FISH_INTENT ────────────────────────────────────────────
  {
    id: 'SEAFOOD_FISH_INTENT',
    description: 'Fish/seafood → ch.03',
    pattern: {
      anyOf: ['salmon', 'tuna', 'shrimp', 'prawn', 'lobster', 'crab', 'seafood', 'fish',
               'fillet', 'tilapia', 'cod', 'halibut', 'catfish', 'trout', 'scallop',
               'oyster', 'clam', 'mussel', 'squid', 'octopus'],
    },
    inject: [
      { prefix: '0302.', syntheticRank: 22 },
      { prefix: '0306.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['03'] },
    boosts: [{ delta: 0.70, chapterMatch: '03' }],
  },

  // ── Rule 154: CONDIMENT_SAUCE_INTENT ─────────────────────────────────────────
  {
    id: 'CONDIMENT_SAUCE_INTENT',
    description: 'Condiments & sauces → 2103',
    pattern: {
      anyOf: ['ketchup', 'catsup', 'mustard', 'mayonnaise', 'mayo', 'salsa', 'relish',
               'hot sauce', 'sriracha', 'tabasco', 'condiment', 'dipping sauce',
               'worcestershire', 'teriyaki', 'bbq sauce', 'barbecue sauce'],
    },
    inject: [{ prefix: '2103.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['21'] },
    boosts: [{ delta: 0.65, chapterMatch: '21' }],
  },

  // ── Rule 155: VINEGAR_INTENT ──────────────────────────────────────────────────
  {
    id: 'VINEGAR_INTENT',
    description: 'Vinegar → 2209',
    pattern: {
      anyOf: ['vinegar', 'balsamic', 'apple cider vinegar', 'white vinegar', 'rice vinegar'],
    },
    inject: [{ prefix: '2209.', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '2209.' }],
  },

  // ── Rule 156: JUICE_BEVERAGE_INTENT ──────────────────────────────────────────
  {
    id: 'JUICE_BEVERAGE_INTENT',
    description: 'Fruit/vegetable juice → 2009',
    pattern: {
      anyOf: ['juice', 'orange juice', 'apple juice', 'grape juice', 'smoothie', 'lemonade'],
      noneOf: ['detergent', 'cleaner', 'grease'],
    },
    inject: [{ prefix: '2009.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['20'] },
    boosts: [{ delta: 0.70, chapterMatch: '20' }],
  },

  // ── Rule 157: SODA_BEVERAGE_INTENT ───────────────────────────────────────────
  {
    id: 'SODA_BEVERAGE_INTENT',
    description: 'Carbonated soft drinks → 2202',
    pattern: {
      anyOf: ['soda', 'cola', 'carbonated drink', 'soft drink', 'energy drink',
               'sports drink', 'sparkling water'],
    },
    inject: [{ prefix: '2202.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['22'] },
    boosts: [{ delta: 0.70, chapterMatch: '22' }],
  },

  // ── Rule 158: SNACK_CHIP_INTENT ──────────────────────────────────────────────
  {
    id: 'SNACK_CHIP_INTENT',
    description: 'Chips/crisps/popcorn/crackers → 1905/1904',
    pattern: {
      anyOf: ['chips', 'crisps', 'potato chips', 'corn chips', 'tortilla chips',
               'popcorn', 'crackers', 'cracker', 'pretzels', 'pretzel', 'rice cake',
               'puffed snack'],
      noneOf: ['casino', 'poker', 'gambling'],
    },
    inject: [
      { prefix: '1905.', syntheticRank: 22 },
      { prefix: '1904.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['19'] },
    boosts: [{ delta: 0.65, chapterMatch: '19' }],
  },

  // ── Rule 159: GRANOLA_CEREAL_INTENT ──────────────────────────────────────────
  {
    id: 'GRANOLA_CEREAL_INTENT',
    description: 'Granola/cereal/oat → 1904/1106',
    pattern: {
      anyOf: ['granola', 'granola bar', 'cereal', 'muesli', 'oatmeal', 'oats', 'cornflakes'],
    },
    inject: [{ prefix: '1904.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['19'] },
    boosts: [{ delta: 0.65, chapterMatch: '19' }],
  },

  // ── Rule 160: TABLET_COMPUTER_INTENT ─────────────────────────────────────────
  {
    id: 'TABLET_COMPUTER_INTENT',
    description: 'Tablet computer/iPad → 8471.30',
    pattern: {
      anyOf: ['tablet', 'ipad', 'android tablet', 'slate', 'digital tablet'],
      noneOf: ['medicine', 'vitamin', 'pill', 'supplement'],
    },
    inject: [{ prefix: '8471.30', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8471.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8471.' }],
  },

  // ── Rule 161: PROJECTOR_INTENT ────────────────────────────────────────────────
  {
    id: 'PROJECTOR_INTENT',
    description: 'Video projector → 8528.62/9008',
    pattern: {
      anyOf: ['projector', 'video projector', 'lcd projector', 'dlp projector', 'beamer',
               'home theater projector', 'pico projector'],
    },
    inject: [
      { prefix: '8528.62', syntheticRank: 22 },
      { prefix: '9008.', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '8528.' },
      { delta: 0.55, prefixMatch: '9008.' },
    ],
  },

  // ── Rule 162: BLENDER_INTENT ──────────────────────────────────────────────────
  {
    id: 'BLENDER_INTENT',
    description: 'Blender/juicer/food processor → 8509',
    pattern: {
      anyOf: ['blender', 'smoothie maker', 'food blender', 'juicer', 'food processor',
               'immersion blender', 'hand blender'],
    },
    inject: [{ prefix: '8509.', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8509.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8509.' }],
  },

  // ── Rule 163: TOASTER_INTENT ──────────────────────────────────────────────────
  {
    id: 'TOASTER_INTENT',
    description: 'Toaster/toaster oven → 8516.72',
    pattern: {
      anyOf: ['toaster', 'bread toaster', 'toaster oven', 'pop-up toaster'],
    },
    inject: [{ prefix: '8516.72', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '8516.72' }],
  },

  // ── Rule 164: CLOTHES_IRON_INTENT ────────────────────────────────────────────
  {
    id: 'CLOTHES_IRON_INTENT',
    description: 'Clothes iron/steam iron → 8516.40',
    pattern: {
      anyOf: ['clothes iron', 'steam iron', 'garment iron', 'ironing board'],
      noneOf: ['cast iron', 'wrought iron', 'hair flat iron'],
    },
    inject: [{ prefix: '8516.40', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '8516.40' }],
  },

  // ── Rule 165: ELECTRIC_FAN_INTENT ────────────────────────────────────────────
  {
    id: 'ELECTRIC_FAN_INTENT',
    description: 'Electric fan → 8414.51',
    pattern: {
      anyOf: ['electric fan', 'ceiling fan', 'desk fan', 'tower fan', 'pedestal fan',
               'box fan', 'bladeless fan'],
    },
    inject: [{ prefix: '8414.51', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '8414.' }],
  },

  // ── Rule 166: SHORTS_INTENT ───────────────────────────────────────────────────
  {
    id: 'SHORTS_INTENT',
    description: 'Shorts/bermuda → 6203.42/6204.62',
    pattern: {
      anyOf: ['shorts', 'short pants', 'bermuda shorts', 'cut-offs', 'board shorts',
               'gym shorts', 'running shorts'],
    },
    inject: [
      { prefix: '6203.42', syntheticRank: 22 },
      { prefix: '6204.62', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '6203.' },
      { delta: 0.70, prefixMatch: '6204.' },
    ],
  },

  // ── Rule 167: PAJAMAS_SLEEPWEAR_INTENT ───────────────────────────────────────
  {
    id: 'PAJAMAS_SLEEPWEAR_INTENT',
    description: 'Pajamas/sleepwear → 6207/6208',
    pattern: {
      anyOf: ['pajamas', 'pyjamas', 'sleepwear', 'nightwear', 'nightgown', 'nightshirt',
               'lounge set', 'loungewear'],
    },
    inject: [
      { prefix: '6207.', syntheticRank: 22 },
      { prefix: '6208.', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.70, prefixMatch: '6207.' },
      { delta: 0.70, prefixMatch: '6208.' },
    ],
  },

  // ── Rule 168: NECKTIE_INTENT ──────────────────────────────────────────────────
  {
    id: 'NECKTIE_INTENT',
    description: 'Necktie/bow tie → 6215',
    pattern: {
      anyOf: ['necktie', 'bow tie', 'cravat', 'neckwear'],
      noneOf: ['shoelace', 'hair tie', 'cable tie', 'zip tie'],
    },
    inject: [
      { prefix: '6215.10', syntheticRank: 22 },
      { prefix: '6215.20', syntheticRank: 26 },
    ],
    whitelist: { allowPrefixes: ['6215.'] },
    boosts: [{ delta: 0.75, prefixMatch: '6215.' }],
  },

  // ── Rule 169: BLAZER_SUIT_INTENT ─────────────────────────────────────────────
  {
    id: 'BLAZER_SUIT_INTENT',
    description: 'Blazer/suit jacket → 6203.31/6204.31',
    pattern: {
      anyOf: ['blazer', 'suit jacket', 'sport coat', 'sports coat', 'formal jacket'],
      noneOf: ['tshirt', 'hoodie', 'sweatshirt'],
    },
    inject: [
      { prefix: '6203.31', syntheticRank: 22 },
      { prefix: '6204.31', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6203.' },
      { delta: 0.65, prefixMatch: '6204.' },
    ],
  },

  // ── Rule 170: POLO_SHIRT_INTENT ───────────────────────────────────────────────
  {
    id: 'POLO_SHIRT_INTENT',
    description: 'Polo shirt → 6105/6106',
    pattern: {
      anyOf: ['polo', 'polo shirt', 'golf shirt', 'tennis shirt'],
    },
    inject: [
      { prefix: '6105.', syntheticRank: 22 },
      { prefix: '6106.', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6105.' },
      { delta: 0.65, prefixMatch: '6106.' },
    ],
  },

  // ── Rule 171: BATHROBE_INTENT ─────────────────────────────────────────────────
  {
    id: 'BATHROBE_INTENT',
    description: 'Bathrobe/robe → 6207.91/6208.91',
    pattern: {
      anyOf: ['bathrobe', 'robe', 'dressing gown', 'towel robe', 'spa robe'],
    },
    inject: [
      { prefix: '6207.91', syntheticRank: 22 },
      { prefix: '6208.91', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6207.' },
      { delta: 0.65, prefixMatch: '6208.' },
    ],
  },

  // ── Rule 172: APRON_INTENT ────────────────────────────────────────────────────
  {
    id: 'APRON_INTENT',
    description: 'Apron → 6211',
    pattern: {
      anyOf: ['apron', 'kitchen apron', 'cooking apron', 'chef apron', 'bib apron'],
    },
    inject: [{ prefix: '6211.', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '6211.' }],
  },

  // ── Rule 173: SOFA_COUCH_INTENT ──────────────────────────────────────────────
  {
    id: 'SOFA_COUCH_INTENT',
    description: 'Sofa/couch → 9401.61/9401.71',
    pattern: {
      anyOf: ['sofa', 'couch', 'settee', 'loveseat', 'sectional sofa', 'futon',
               'sleeper sofa', 'sofa bed', 'daybed'],
    },
    inject: [
      { prefix: '9401.61', syntheticRank: 22 },
      { prefix: '9401.71', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 174: BOOKSHELF_INTENT ────────────────────────────────────────────────
  {
    id: 'BOOKSHELF_INTENT',
    description: 'Bookshelf/bookcase/shelving → 9403',
    pattern: {
      anyOf: ['bookshelf', 'bookcase', 'shelving', 'shelves', 'book shelf'],
    },
    inject: [{ prefix: '9403.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 175: WARDROBE_CLOSET_INTENT ─────────────────────────────────────────
  {
    id: 'WARDROBE_CLOSET_INTENT',
    description: 'Wardrobe/closet/armoire → 9403',
    pattern: {
      anyOf: ['wardrobe', 'closet', 'armoire', 'clothes cabinet', 'linen cabinet'],
    },
    inject: [{ prefix: '9403.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 176: CLOCK_TIMEPIECE_INTENT ─────────────────────────────────────────
  {
    id: 'CLOCK_TIMEPIECE_INTENT',
    description: 'Wall/alarm clock → 9105',
    pattern: {
      anyOf: ['clock', 'wall clock', 'alarm clock', 'mantel clock', 'cuckoo clock',
               'digital clock', 'desk clock'],
      noneOf: ['watch', 'smartwatch', 'wristwatch'],
    },
    inject: [
      { prefix: '9105.', syntheticRank: 22 },
      { prefix: '9103.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['91'] },
    boosts: [{ delta: 0.70, chapterMatch: '91' }],
  },

  // ── Rule 177: HAMMER_TOOL_INTENT ─────────────────────────────────────────────
  {
    id: 'HAMMER_TOOL_INTENT',
    description: 'Hammer/mallet → 8205.20',
    pattern: {
      anyOf: ['hammer', 'claw hammer', 'mallet', 'sledgehammer', 'ball-peen hammer'],
    },
    inject: [{ prefix: '8205.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.75, prefixMatch: '8205.' }],
  },

  // ── Rule 178: SCREWDRIVER_TOOL_INTENT ────────────────────────────────────────
  {
    id: 'SCREWDRIVER_TOOL_INTENT',
    description: 'Screwdriver → 8205.40',
    pattern: {
      anyOf: ['screwdriver', 'flathead screwdriver', 'phillips screwdriver', 'torx screwdriver'],
    },
    inject: [{ prefix: '8205.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.75, prefixMatch: '8205.' }],
  },

  // ── Rule 179: WRENCH_PLIERS_INTENT ───────────────────────────────────────────
  {
    id: 'WRENCH_PLIERS_INTENT',
    description: 'Wrench/pliers/spanner → 8204/8203',
    pattern: {
      anyOf: ['wrench', 'spanner', 'adjustable wrench', 'torque wrench',
               'pliers', 'needle-nose pliers', 'locking pliers', 'vice grips'],
    },
    inject: [
      { prefix: '8204.', syntheticRank: 22 },
      { prefix: '8203.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.70, chapterMatch: '82' }],
  },

  // ── Rule 180: POWER_DRILL_INTENT ─────────────────────────────────────────────
  {
    id: 'POWER_DRILL_INTENT',
    description: 'Electric drill/power tool → 8467.22/8467.29',
    pattern: {
      anyOf: ['drill', 'electric drill', 'power drill', 'cordless drill', 'impact drill',
               'hammer drill', 'rotary drill'],
    },
    inject: [
      { prefix: '8467.22', syntheticRank: 22 },
      { prefix: '8467.29', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.70, prefixMatch: '8467.' }],
  },

  // ── Rule 181: BABY_CRIB_INTENT ────────────────────────────────────────────────
  {
    id: 'BABY_CRIB_INTENT',
    description: 'Baby crib/cot → 9403.50',
    pattern: {
      anyOf: ['crib', 'baby crib', 'baby bed', 'cot', 'bassinet', 'infant bed',
               'toddler bed', 'baby cot'],
    },
    inject: [{ prefix: '9403.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.70, prefixMatch: '9403.' }],
  },

  // ── Rule 182: BABY_CARRIER_INTENT ────────────────────────────────────────────
  {
    id: 'BABY_CARRIER_INTENT',
    description: 'Baby carrier/sling/wrap → 6307.90',
    pattern: {
      anyOf: ['baby carrier', 'infant carrier', 'baby sling', 'baby wrap',
               'ergonomic carrier', 'baby backpack carrier'],
    },
    inject: [{ prefix: '6307.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '6307.' }],
  },

  // ── Rule 183: AQUARIUM_INTENT ─────────────────────────────────────────────────
  {
    id: 'AQUARIUM_INTENT',
    description: 'Aquarium/fish tank → 7020.00/3926.90',
    pattern: {
      anyOf: ['aquarium', 'fish tank', 'terrarium', 'vivarium'],
    },
    inject: [
      { prefix: '7020.00', syntheticRank: 22 },
      { prefix: '3926.90', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '7020.' },
      { delta: 0.55, prefixMatch: '3926.' },
    ],
  },

  // ── Rule 184: PLANTER_POT_INTENT ─────────────────────────────────────────────
  {
    id: 'PLANTER_POT_INTENT',
    description: 'Flower pot/planter → 6913.10/3924.90',
    pattern: {
      anyOf: ['planter', 'flower pot', 'plant pot', 'garden pot', 'window box',
               'hanging planter', 'self-watering pot'],
    },
    inject: [
      { prefix: '6913.10', syntheticRank: 22 },
      { prefix: '3924.90', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6913.' },
      { delta: 0.55, prefixMatch: '3924.' },
    ],
  },

  // ── Rule 185: HAMMOCK_INTENT ──────────────────────────────────────────────────
  {
    id: 'HAMMOCK_INTENT',
    description: 'Hammock → 6306.90',
    pattern: {
      anyOf: ['hammock', 'hanging hammock', 'camping hammock', 'portable hammock'],
    },
    inject: [{ prefix: '6306.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '6306.' }],
  },

  // ── Rule 186: BANDAGE_FIRST_AID_INTENT ───────────────────────────────────────
  {
    id: 'BANDAGE_FIRST_AID_INTENT',
    description: 'Bandage/wound dressing → 3005',
    pattern: {
      anyOf: ['bandage', 'adhesive bandage', 'wound dressing', 'plaster', 'medical bandage',
               'elastic bandage', 'gauze bandage', 'bandaid', 'band-aid'],
    },
    inject: [{ prefix: '3005.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['30'] },
    boosts: [{ delta: 0.75, chapterMatch: '30' }],
  },

  // ── Rule 187: THERMOMETER_MEDICAL_INTENT ─────────────────────────────────────
  {
    id: 'THERMOMETER_MEDICAL_INTENT',
    description: 'Medical thermometer → 9025.11',
    pattern: {
      anyOf: ['thermometer', 'fever thermometer', 'clinical thermometer', 'infrared thermometer',
               'ear thermometer', 'forehead thermometer', 'digital thermometer'],
    },
    inject: [{ prefix: '9025.11', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '9025.' }],
  },

  // ── Rule 188: CHRISTMAS_ORNAMENT_INTENT ──────────────────────────────────────
  {
    id: 'CHRISTMAS_ORNAMENT_INTENT',
    description: 'Christmas ornaments → 9505.10',
    pattern: {
      anyOf: ['christmas ornament', 'tree ornament', 'xmas ornament', 'holiday ornament',
               'ornament', 'christmas decoration', 'xmas decoration', 'christmas bauble'],
    },
    inject: [{ prefix: '9505.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.75, prefixMatch: '9505.' }],
  },

  // ── Rule 189: CHRISTMAS_LIGHTS_INTENT ────────────────────────────────────────
  {
    id: 'CHRISTMAS_LIGHTS_INTENT',
    description: 'Christmas/string/fairy lights → 9405.40',
    pattern: {
      anyOf: ['christmas lights', 'holiday lights', 'xmas lights', 'fairy lights',
               'string lights', 'icicle lights', 'led string lights'],
    },
    inject: [{ prefix: '9405.40', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9405.' }],
  },

  // ── Rule 190: HALLOWEEN_COSTUME_INTENT ───────────────────────────────────────
  {
    id: 'HALLOWEEN_COSTUME_INTENT',
    description: 'Halloween/fancy dress costume → 9505.90',
    pattern: {
      anyOf: ['halloween costume', 'fancy dress', 'costume', 'party costume',
               'dress up costume', 'cosplay costume', 'halloween outfit'],
      noneOf: ['jewelry', 'jewellery', 'necklace', 'bracelet', 'earring', 'ring', 'pendant'],
    },
    inject: [{ prefix: '9505.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 191: JEWELRY_BRACELET_INTENT ────────────────────────────────────────
  {
    id: 'JEWELRY_BRACELET_INTENT',
    description: 'Bracelet/bangle → 7117/7113',
    pattern: {
      anyOf: ['bracelet', 'bangle', 'charm bracelet', 'cuff bracelet', 'wristband jewelry'],
    },
    inject: [
      { prefix: '7117.19', syntheticRank: 22 },
      { prefix: '7113.19', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.65, chapterMatch: '71' }],
  },

  // ── Rule 192: JEWELRY_NECKLACE_INTENT ────────────────────────────────────────
  {
    id: 'JEWELRY_NECKLACE_INTENT',
    description: 'Necklace/pendant → 7117/7113',
    pattern: {
      anyOf: ['necklace', 'chain necklace', 'pendant necklace', 'choker', 'locket'],
    },
    inject: [
      { prefix: '7117.19', syntheticRank: 22 },
      { prefix: '7113.19', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.65, chapterMatch: '71' }],
  },

  // ── Rule 193: JEWELRY_EARRING_INTENT ─────────────────────────────────────────
  {
    id: 'JEWELRY_EARRING_INTENT',
    description: 'Earrings/studs → 7117/7113',
    pattern: {
      anyOf: ['earring', 'earrings', 'stud earring', 'hoop earring', 'drop earring',
               'dangle earring'],
    },
    inject: [
      { prefix: '7117.19', syntheticRank: 22 },
      { prefix: '7113.19', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.65, chapterMatch: '71' }],
  },

  // ── Rule 194: SKINCARE_MOISTURIZER_INTENT ────────────────────────────────────
  {
    id: 'SKINCARE_MOISTURIZER_INTENT',
    description: 'Moisturizer/face cream/lotion → 3304',
    pattern: {
      anyOf: ['moisturizer', 'face cream', 'body lotion', 'body cream', 'skin cream',
               'hydrating cream', 'face lotion', 'daily moisturizer'],
    },
    inject: [{ prefix: '3304.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 195: SKINCARE_SERUM_INTENT ──────────────────────────────────────────
  {
    id: 'SKINCARE_SERUM_INTENT',
    description: 'Face serum/skin serum → 3304',
    pattern: {
      anyOf: ['serum', 'face serum', 'skin serum', 'vitamin c serum', 'hyaluronic acid',
               'retinol serum', 'eye serum'],
    },
    inject: [{ prefix: '3304.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 196: HAIR_CONDITIONER_INTENT ────────────────────────────────────────
  {
    id: 'HAIR_CONDITIONER_INTENT',
    description: 'Hair conditioner/mask → 3305',
    pattern: {
      anyOf: ['conditioner', 'hair conditioner', 'hair mask', 'deep conditioner',
               'leave-in conditioner', 'hair treatment'],
    },
    inject: [{ prefix: '3305.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 197: COMPUTER_MONITOR_INTENT ────────────────────────────────────────
  {
    id: 'COMPUTER_MONITOR_INTENT',
    description: 'Computer monitor/display → 8528.52',
    pattern: {
      anyOf: ['computer monitor', 'lcd monitor', 'led monitor', 'gaming monitor',
               'ultrawide monitor', '4k monitor', 'display screen'],
      noneOf: ['baby monitor', 'heart monitor'],
    },
    inject: [{ prefix: '8528.52', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8528.52' }],
  },

  // ── Rule 198: PRINTER_INTENT ──────────────────────────────────────────────────
  {
    id: 'PRINTER_INTENT',
    description: 'Inkjet/laser printer → 8443.31/8443.32',
    pattern: {
      anyOf: ['printer', 'inkjet printer', 'laser printer', 'document printer',
               '3d printer', 'label printer', 'photo printer'],
    },
    inject: [
      { prefix: '8443.31', syntheticRank: 22 },
      { prefix: '8443.32', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.70, prefixMatch: '8443.' }],
  },

  // ── Rule 199: WEBCAM_INTENT ───────────────────────────────────────────────────
  {
    id: 'WEBCAM_INTENT',
    description: 'Webcam/streaming camera → 8525.89',
    pattern: {
      anyOf: ['webcam', 'web camera', 'streaming camera', 'conference camera', 'usb camera'],
      noneOf: ['security camera', 'cctv', 'surveillance'],
    },
    inject: [{ prefix: '8525.89', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8525.' }],
  },

  // ── Rule 200: SECURITY_CAMERA_INTENT ─────────────────────────────────────────
  {
    id: 'SECURITY_CAMERA_INTENT',
    description: 'Security/surveillance camera → 8525.80',
    pattern: {
      anyOf: ['security camera', 'surveillance camera', 'ip camera', 'cctv',
               'home security camera', 'outdoor camera', 'nanny cam'],
    },
    inject: [{ prefix: '8525.80', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8525.' }],
  },

  // ── Rule 201: SMART_DOORBELL_INTENT ──────────────────────────────────────────
  {
    id: 'SMART_DOORBELL_INTENT',
    description: 'Video doorbell → 8531.10',
    pattern: {
      anyOf: ['doorbell', 'video doorbell', 'smart doorbell', 'ring doorbell', 'wifi doorbell'],
    },
    inject: [{ prefix: '8531.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8531.' }],
  },

  // ── Rule 202: THERMOSTAT_INTENT ───────────────────────────────────────────────
  {
    id: 'THERMOSTAT_INTENT',
    description: 'Thermostat → 9032.10',
    pattern: {
      anyOf: ['thermostat', 'smart thermostat', 'programmable thermostat', 'hvac thermostat'],
    },
    inject: [{ prefix: '9032.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '9032.' }],
  },

  // ── Rule 203: DOLL_TOY_INTENT ─────────────────────────────────────────────────
  {
    id: 'DOLL_TOY_INTENT',
    description: 'Doll/figurine toy → 9502',
    pattern: {
      anyOf: ['doll', 'toy doll', 'barbie', 'fashion doll', 'baby doll', 'action figure',
               'figurine', 'toy figurine'],
    },
    inject: [{ prefix: '9502.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9502.' }],
  },

  // ── Rule 204: CONSTRUCTION_TOY_INTENT ────────────────────────────────────────
  {
    id: 'CONSTRUCTION_TOY_INTENT',
    description: 'Building blocks/Lego/construction toy → 9503',
    pattern: {
      anyOf: ['lego', 'building blocks', 'construction toy', 'interlocking blocks',
               'duplo', 'mega bloks', 'brick toy'],
    },
    inject: [{ prefix: '9503.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9503.' }],
  },

  // ── Rule 205: PILLOW_BEDDING_INTENT ──────────────────────────────────────────
  {
    id: 'PILLOW_BEDDING_INTENT',
    description: 'Pillow/cushion for sleeping → 9404.90',
    pattern: {
      anyOf: ['sleeping pillow', 'bed pillow', 'memory foam pillow',
               'down pillow', 'body pillow', 'neck pillow'],
    },
    inject: [{ prefix: '9404.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9404.' }],
  },

  // ── Rule 206: DUVET_COMFORTER_INTENT ─────────────────────────────────────────
  {
    id: 'DUVET_COMFORTER_INTENT',
    description: 'Duvet/comforter/quilt → 9404.40',
    pattern: {
      anyOf: ['duvet', 'comforter', 'quilt', 'duvet cover', 'down comforter',
               'bedding comforter', 'weighted blanket'],
    },
    inject: [{ prefix: '9404.40', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9404.' }],
  },

  // ── Rule 207: BED_SHEET_INTENT ────────────────────────────────────────────────
  {
    id: 'BED_SHEET_INTENT',
    description: 'Bed sheets/bedding → 6302.21/6302.31',
    pattern: {
      anyOf: ['bed sheet', 'fitted sheet', 'flat sheet', 'sheet set', 'bedding set'],
    },
    inject: [
      { prefix: '6302.21', syntheticRank: 22 },
      { prefix: '6302.31', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, chapterMatch: '63' }],
  },

  // ── Rule 208: DIFFUSER_INTENT ─────────────────────────────────────────────────
  {
    id: 'DIFFUSER_INTENT',
    description: 'Essential oil diffuser → 8479.89',
    pattern: {
      anyOf: ['diffuser', 'aroma diffuser', 'essential oil diffuser', 'ultrasonic diffuser',
               'aromatherapy diffuser', 'reed diffuser'],
    },
    inject: [
      { prefix: '8479.89', syntheticRank: 22 },
      { prefix: '3307.49', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '8479.' }],
  },

  // ── Rule 209: LOCK_SECURITY_INTENT ───────────────────────────────────────────
  {
    id: 'LOCK_SECURITY_INTENT',
    description: 'Lock/deadbolt/smart lock → 8301',
    pattern: {
      anyOf: ['door lock', 'deadbolt', 'combination lock', 'security lock',
               'bike lock', 'smart lock', 'door knob lock'],
    },
    inject: [{ prefix: '8301.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['83'] },
    boosts: [{ delta: 0.70, chapterMatch: '83' }],
  },

  // ── Rule 210: SAFE_BOX_INTENT ─────────────────────────────────────────────────
  {
    id: 'SAFE_BOX_INTENT',
    description: 'Security safe/vault → 8303',
    pattern: {
      anyOf: ['gun safe', 'fireproof safe', 'security safe', 'vault', 'cash box',
               'lockbox', 'strongbox'],
    },
    inject: [{ prefix: '8303.', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '8303.' }],
  },

  // ── Rule 211: HDMI_CABLE_INTENT ───────────────────────────────────────────────
  {
    id: 'HDMI_CABLE_INTENT',
    description: 'HDMI cable/display cable → 8544.42',
    pattern: {
      anyOf: ['hdmi', 'hdmi cable', 'display cable', 'displayport cable',
               'dp cable', 'vga cable', 'dvi cable'],
    },
    inject: [{ prefix: '8544.42', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8544.' }],
  },

  // ── Rule 212: TREADMILL_INTENT ────────────────────────────────────────────────
  {
    id: 'TREADMILL_INTENT',
    description: 'Treadmill/running machine → 9506.91',
    pattern: {
      anyOf: ['treadmill', 'running machine', 'exercise treadmill', 'motorized treadmill'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.' }],
  },

  // ── Rule 213: KITCHEN_GRATER_INTENT ──────────────────────────────────────────
  {
    id: 'KITCHEN_GRATER_INTENT',
    description: 'Grater/mandoline → 8210.00/7323',
    pattern: {
      anyOf: ['grater', 'cheese grater', 'food grater', 'zester', 'mandoline', 'mandoline slicer'],
    },
    inject: [
      { prefix: '8210.00', syntheticRank: 22 },
      { prefix: '7323.99', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '8210.' }],
  },

  // ── Rule 214: COLANDER_STRAINER_INTENT ───────────────────────────────────────
  {
    id: 'COLANDER_STRAINER_INTENT',
    description: 'Colander/strainer → 7323.99',
    pattern: {
      anyOf: ['colander', 'strainer', 'pasta strainer', 'kitchen strainer', 'mesh strainer',
               'food strainer', 'sieve'],
    },
    inject: [{ prefix: '7323.99', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '7323.' }],
  },

  // ── Rule 215: BAKEWARE_PAN_INTENT ────────────────────────────────────────────
  {
    id: 'BAKEWARE_PAN_INTENT',
    description: 'Baking pan/tray/mold → 7323.94/7615.19',
    pattern: {
      anyOf: ['baking pan', 'cake pan', 'baking tray', 'sheet pan', 'loaf pan',
               'muffin tin', 'cupcake tin', 'bakeware', 'springform pan', 'bundt pan'],
    },
    inject: [
      { prefix: '7323.94', syntheticRank: 22 },
      { prefix: '7615.19', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '7323.' }],
  },

  // ── Rule 216: TAPESTRY_WALL_INTENT ───────────────────────────────────────────
  {
    id: 'TAPESTRY_WALL_INTENT',
    description: 'Tapestry/wall hanging → 5805.00/6304.99',
    pattern: {
      anyOf: ['tapestry', 'wall tapestry', 'woven wall art', 'wall hanging',
               'macrame wall hanging', 'woven tapestry'],
    },
    inject: [
      { prefix: '5805.00', syntheticRank: 22 },
      { prefix: '6304.99', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '5805.' }],
  },

  // ── Rule 217: SUITCASE_INTENT ─────────────────────────────────────────────────
  {
    id: 'SUITCASE_INTENT',
    description: 'Suitcase/rolling luggage → 4202.11/4202.12',
    pattern: {
      anyOf: ['suitcase', 'rolling suitcase', 'hard shell suitcase', 'travel luggage',
               'trolley bag', 'carry-on suitcase', 'checked luggage'],
    },
    inject: [
      { prefix: '4202.11', syntheticRank: 22 },
      { prefix: '4202.12', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, chapterMatch: '42' }],
  },

  // ── Rule 218: SNORKEL_DIVING_INTENT ──────────────────────────────────────────
  {
    id: 'SNORKEL_DIVING_INTENT',
    description: 'Snorkel/diving mask → 9004.90/9506.29',
    pattern: {
      anyOf: ['snorkel', 'snorkeling', 'dive mask', 'snorkel set', 'swim fins', 'flippers',
               'diving fins', 'wetsuit'],
    },
    inject: [
      { prefix: '9004.90', syntheticRank: 22 },
      { prefix: '9506.29', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 219: MUG_DRINKWARE_INTENT ───────────────────────────────────────────
  {
    id: 'MUG_DRINKWARE_INTENT',
    description: 'Mug/cup → 6912.00/6911.10',
    pattern: {
      anyOf: ['mug', 'coffee mug', 'tea mug', 'ceramic mug', 'travel mug', 'soup mug'],
      noneOf: ['shot glass', 'wine glass', 'beer glass', 'tumbler'],
    },
    inject: [
      { prefix: '6912.00', syntheticRank: 22 },
      { prefix: '6911.10', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6912.' },
      { delta: 0.55, prefixMatch: '6911.' },
    ],
  },

  // ── Rule 220: BOWL_TABLEWARE_INTENT ──────────────────────────────────────────
  {
    id: 'BOWL_TABLEWARE_INTENT',
    description: 'Bowl → 6912.00/6911.10',
    pattern: {
      anyOf: ['serving bowl', 'soup bowl', 'salad bowl', 'mixing bowl',
               'cereal bowl', 'pasta bowl', 'ceramic bowl'],
    },
    inject: [
      { prefix: '6912.00', syntheticRank: 22 },
      { prefix: '6911.10', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6912.' },
      { delta: 0.55, prefixMatch: '6911.' },
    ],
  },

  // ── Rule 221: PLATE_TABLEWARE_INTENT ─────────────────────────────────────────
  {
    id: 'PLATE_TABLEWARE_INTENT',
    description: 'Plate/dinner plate → 6912.00/6911.10',
    pattern: {
      anyOf: ['dinner plate', 'serving plate', 'ceramic plate', 'salad plate',
               'dessert plate', 'side plate'],
    },
    inject: [
      { prefix: '6912.00', syntheticRank: 22 },
      { prefix: '6911.10', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.65, prefixMatch: '6912.' },
      { delta: 0.55, prefixMatch: '6911.' },
    ],
  },

  // ── Rule 222: USB_HUB_INTENT ──────────────────────────────────────────────────
  {
    id: 'USB_HUB_INTENT',
    description: 'USB hub/port hub → 8517.62',
    pattern: {
      anyOf: ['usb hub', 'port hub', 'data hub', 'usb-c hub', 'docking station',
               'usb switch', 'kvm switch'],
    },
    inject: [{ prefix: '8517.62', syntheticRank: 22 }],
    boosts: [{ delta: 0.60, prefixMatch: '8517.' }],
  },

  // ── Rule 223: STAPLER_INTENT ──────────────────────────────────────────────────
  {
    id: 'STAPLER_INTENT',
    description: 'Stapler → 8472.30',
    pattern: {
      anyOf: ['stapler', 'electric stapler', 'heavy duty stapler', 'staple gun'],
    },
    inject: [{ prefix: '8472.30', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '8472.' }],
  },

  // ── Rule 224: CALCULATOR_INTENT ───────────────────────────────────────────────
  {
    id: 'CALCULATOR_INTENT',
    description: 'Calculator → 8470.10',
    pattern: {
      anyOf: ['calculator', 'scientific calculator', 'graphing calculator', 'financial calculator'],
    },
    inject: [{ prefix: '8470.10', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8470.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8470.' }],
  },

  // ── Rule 225: SEWING_MACHINE_INTENT ──────────────────────────────────────────
  {
    id: 'SEWING_MACHINE_INTENT',
    description: 'Sewing machine → 8452.10',
    pattern: {
      anyOf: ['sewing machine', 'embroidery machine', 'serger', 'overlock machine',
               'quilting machine', 'stitching machine'],
    },
    inject: [{ prefix: '8452.10', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8452.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8452.' }],
  },

  // ── Rule 226: GYM_BAG_INTENT ──────────────────────────────────────────────────
  {
    id: 'GYM_BAG_INTENT',
    description: 'Gym bag/duffel bag → 4202.92',
    pattern: {
      anyOf: ['gym bag', 'duffel bag', 'duffle bag', 'sports bag', 'workout bag',
               'athletic bag', 'overnight bag'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.92' }],
  },

  // ── Rule 227: FANNY_PACK_INTENT ───────────────────────────────────────────────
  {
    id: 'FANNY_PACK_INTENT',
    description: 'Fanny pack/waist bag → 4202.92',
    pattern: {
      anyOf: ['fanny pack', 'waist bag', 'belt bag', 'bum bag', 'hip pack'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.92' }],
  },

  // ── Rule 228: YARN_TEXTILE_INTENT ────────────────────────────────────────────
  {
    id: 'YARN_TEXTILE_INTENT',
    description: 'Yarn/thread/knitting → 5205/5207/5401',
    pattern: {
      anyOf: ['yarn', 'knitting yarn', 'crochet yarn', 'wool yarn', 'cotton yarn',
               'acrylic yarn', 'embroidery thread'],
    },
    inject: [
      { prefix: '5205.', syntheticRank: 22 },
      { prefix: '5401.', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, chapterMatch: '52' }],
  },

  // ── Rule 229: FLUTE_WOODWIND_INTENT ──────────────────────────────────────────
  {
    id: 'FLUTE_WOODWIND_INTENT',
    description: 'Flute/woodwind instrument → 9205.10',
    pattern: {
      anyOf: ['flute', 'piccolo', 'clarinet', 'oboe', 'bassoon', 'recorder instrument'],
    },
    inject: [{ prefix: '9205.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, chapterMatch: '92' }],
  },

  // ── Rule 230: TRUMPET_BRASS_INTENT ───────────────────────────────────────────
  {
    id: 'TRUMPET_BRASS_INTENT',
    description: 'Trumpet/brass instrument → 9205.90',
    pattern: {
      anyOf: ['trumpet', 'trombone', 'tuba', 'french horn', 'bugle', 'cornet', 'brass instrument'],
    },
    inject: [{ prefix: '9205.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, chapterMatch: '92' }],
  },

  // ── Rule 231: DASHCAM_INTENT ──────────────────────────────────────────────────
  {
    id: 'DASHCAM_INTENT',
    description: 'Dash cam/driving recorder → 8525.89',
    pattern: {
      anyOf: ['dashcam', 'dash cam', 'car camera', 'vehicle camera', 'driving recorder',
               'front camera car', 'rear camera car'],
    },
    inject: [{ prefix: '8525.89', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8525.' }],
  },

  // ── Rule 232: MEMORY_CARD_INTENT ──────────────────────────────────────────────
  {
    id: 'MEMORY_CARD_INTENT',
    description: 'Memory card/SD card → 8523.51',
    pattern: {
      anyOf: ['memory card', 'sd card', 'microsd', 'flash card', 'micro sd card',
               'compact flash'],
    },
    inject: [{ prefix: '8523.51', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8523.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8523.' }],
  },

  // ── Rule 233: FOOD_CONTAINER_INTENT ──────────────────────────────────────────
  {
    id: 'FOOD_CONTAINER_INTENT',
    description: 'Food container/lunch box → 3924.10',
    pattern: {
      anyOf: ['food container', 'meal prep container', 'lunch box', 'bento box',
               'food storage container', 'plastic food container', 'tupperware'],
    },
    inject: [{ prefix: '3924.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3924.' }],
  },

  // ── Rule 234: KITCHEN_UTENSIL_INTENT ─────────────────────────────────────────
  {
    id: 'KITCHEN_UTENSIL_INTENT',
    description: 'Spatula/ladle/tongs/whisk → 3924.90/7323.99',
    pattern: {
      anyOf: ['spatula', 'ladle', 'soup ladle', 'kitchen tongs', 'egg whisk',
               'wire whisk', 'slotted spoon', 'skimmer', 'cooking utensil'],
    },
    inject: [
      { prefix: '3924.90', syntheticRank: 22 },
      { prefix: '7323.99', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, prefixMatch: '3924.' }],
  },

  // ── Rule 235: NEON_SIGN_INTENT ────────────────────────────────────────────────
  {
    id: 'NEON_SIGN_INTENT',
    description: 'Neon/LED sign → 9405.40',
    pattern: {
      anyOf: ['neon sign', 'led sign', 'illuminated sign', 'custom sign', 'neon light sign',
               'neon bar sign'],
    },
    inject: [
      { prefix: '9405.40', syntheticRank: 22 },
      { prefix: '9405.99', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '9405.' }],
  },

  // ── Rule 236: PATIO_FURNITURE_INTENT ─────────────────────────────────────────
  {
    id: 'PATIO_FURNITURE_INTENT',
    description: 'Patio/garden/outdoor furniture → 9401.79/9403.89',
    pattern: {
      anyOf: ['patio chair', 'garden chair', 'outdoor chair', 'lawn chair', 'deck chair',
               'patio table', 'garden table', 'outdoor table', 'bistro table',
               'patio set', 'outdoor furniture', 'garden furniture'],
    },
    inject: [
      { prefix: '9401.79', syntheticRank: 22 },
      { prefix: '9403.89', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 237: RESISTANCE_BAND_INTENT ─────────────────────────────────────────
  {
    id: 'RESISTANCE_BAND_INTENT',
    description: 'Resistance band/exercise band → 9506.91',
    pattern: {
      anyOf: ['resistance band', 'exercise band', 'stretch band', 'fitness band',
               'loop band', 'mini band'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 238: JUMP_ROPE_INTENT ────────────────────────────────────────────────
  {
    id: 'JUMP_ROPE_INTENT',
    description: 'Jump rope/skipping rope → 9506.99',
    pattern: {
      anyOf: ['jump rope', 'skipping rope', 'skip rope', 'speed rope', 'weighted jump rope'],
    },
    inject: [{ prefix: '9506.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 239: SWIMMING_GOGGLES_INTENT ────────────────────────────────────────
  {
    id: 'SWIMMING_GOGGLES_INTENT',
    description: 'Swimming goggles → 9004.90',
    pattern: {
      anyOf: ['swimming goggles', 'swim goggles', 'pool goggles', 'anti-fog goggles',
               'racing goggles', 'kids swim goggles'],
    },
    inject: [{ prefix: '9004.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9004.' }],
  },

  // ── Rule 240: SPORTS_BALL_INTENT ──────────────────────────────────────────────
  {
    id: 'SPORTS_BALL_INTENT',
    description: 'Sports ball → 9506.62/9506.40',
    pattern: {
      anyOf: ['soccer ball', 'football', 'basketball', 'volleyball', 'baseball', 'softball',
               'rugby ball', 'tennis ball', 'sports ball', 'kickball'],
    },
    inject: [
      { prefix: '9506.62', syntheticRank: 22 },
      { prefix: '9506.40', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 241: TENNIS_RACKET_INTENT ───────────────────────────────────────────
  {
    id: 'TENNIS_RACKET_INTENT',
    description: 'Tennis/badminton/squash racket → 9506.51',
    pattern: {
      anyOf: ['tennis racket', 'racquet', 'badminton racket', 'squash racket',
               'pickleball paddle', 'racketball racket'],
    },
    inject: [{ prefix: '9506.51', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.51' }],
  },

  // ── Rule 242: BLOOD_PRESSURE_MONITOR_INTENT ──────────────────────────────────
  {
    id: 'BLOOD_PRESSURE_MONITOR_INTENT',
    description: 'Blood pressure monitor → 9019.20',
    pattern: {
      anyOf: ['blood pressure monitor', 'bp monitor', 'sphygmomanometer', 'blood pressure cuff',
               'automatic blood pressure'],
    },
    inject: [{ prefix: '9019.20', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9019.' }],
  },

  // ── Rule 243: LAMINATE_FLOORING_INTENT ───────────────────────────────────────
  {
    id: 'LAMINATE_FLOORING_INTENT',
    description: 'Laminate/vinyl flooring → 3918.10/4412',
    pattern: {
      anyOf: ['laminate', 'laminate floor', 'laminate flooring', 'vinyl plank', 'lvp flooring',
               'luxury vinyl', 'click flooring', 'floating floor'],
    },
    inject: [
      { prefix: '3918.10', syntheticRank: 22 },
      { prefix: '4412.', syntheticRank: 26 },
    ],
    boosts: [
      { delta: 0.60, prefixMatch: '3918.' },
      { delta: 0.55, prefixMatch: '4412.' },
    ],
  },

  // ── Rule 244: CARABINER_INTENT ────────────────────────────────────────────────
  {
    id: 'CARABINER_INTENT',
    description: 'Carabiner/snap hook → 7326.90',
    pattern: {
      anyOf: ['carabiner', 'climbing carabiner', 'snap hook', 'clip hook', 'locking carabiner'],
    },
    inject: [{ prefix: '7326.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '7326.' }],
  },

  // ── Rule 245: MOP_BROOM_CLEANING_INTENT ──────────────────────────────────────
  {
    id: 'MOP_BROOM_CLEANING_INTENT',
    description: 'Mop/broom/cleaning tool → 9603',
    pattern: {
      anyOf: ['floor mop', 'spin mop', 'steam mop', 'sweeping broom',
               'dustpan', 'floor brush', 'scrub brush'],
    },
    inject: [{ prefix: '9603.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, chapterMatch: '96' }],
  },

  // ── Rule 246: PLYWOOD_LUMBER_INTENT ──────────────────────────────────────────
  {
    id: 'PLYWOOD_LUMBER_INTENT',
    description: 'Plywood/lumber/wood panel → 4412/4407',
    pattern: {
      anyOf: ['plywood', 'plywood sheet', 'lumber', 'wood board', 'timber',
               'wooden pallet', 'wood pallet', 'pine board', 'hardwood board',
               'engineered wood', 'mdf', 'particle board', 'wood plank'],
    },
    inject: [
      { prefix: '4412.', syntheticRank: 22 },
      { prefix: '4407.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['44'] },
    boosts: [{ delta: 0.65, chapterMatch: '44' }],
  },

  // ── Rule 247: CARDBOARD_PAPER_INTENT ─────────────────────────────────────────
  {
    id: 'CARDBOARD_PAPER_INTENT',
    description: 'Cardboard/paperboard/carton → 4819/4817',
    pattern: {
      anyOf: ['cardboard', 'corrugated cardboard', 'cardboard box', 'carton',
               'paperboard', 'shipping box', 'corrugated box', 'mailer box'],
    },
    inject: [
      { prefix: '4819.', syntheticRank: 22 },
      { prefix: '4817.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['48'] },
    boosts: [{ delta: 0.65, chapterMatch: '48' }],
  },

  // ── Rule 248: PLASTIC_WRAP_INTENT ─────────────────────────────────────────────
  {
    id: 'PLASTIC_WRAP_INTENT',
    description: 'Plastic wrap/cling film → 3920.20',
    pattern: {
      anyOf: ['plastic wrap', 'cling wrap', 'cling film', 'food wrap', 'plastic film',
               'plastic sheet', 'polyethylene sheet', 'polypropylene sheet'],
    },
    inject: [{ prefix: '3920.20', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3920.' }],
  },

  // ── Rule 249: WINE_GLASS_INTENT ───────────────────────────────────────────────
  {
    id: 'WINE_GLASS_INTENT',
    description: 'Wine glass/stemware → 7013.22/7013.28',
    pattern: {
      anyOf: ['wine glass', 'crystal glass', 'stemware', 'goblet', 'champagne flute',
               'beer glass', 'pint glass', 'shot glass', 'drinking glass', 'cocktail glass'],
    },
    inject: [
      { prefix: '7013.22', syntheticRank: 22 },
      { prefix: '7013.28', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['70'] },
    boosts: [{ delta: 0.70, chapterMatch: '70' }],
  },

  // ── Rule 250: RUBBER_GLOVE_INTENT ─────────────────────────────────────────────
  {
    id: 'RUBBER_GLOVE_INTENT',
    description: 'Rubber/latex gloves → 4015.11',
    pattern: {
      anyOf: ['rubber glove', 'latex glove', 'disposable glove', 'nitrile glove',
               'cleaning glove', 'surgical glove', 'medical glove'],
    },
    inject: [{ prefix: '4015.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['40'] },
    boosts: [{ delta: 0.70, chapterMatch: '40' }],
  },

  // ── Rule 251: LEATHER_JACKET_INTENT ──────────────────────────────────────────
  {
    id: 'LEATHER_JACKET_INTENT',
    description: 'Leather jacket → 4203.10',
    pattern: {
      anyOf: ['leather jacket', 'biker jacket', 'moto jacket', 'leather coat', 'suede jacket'],
    },
    inject: [{ prefix: '4203.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.70, chapterMatch: '42' }],
  },

  // ── Rule 252: TEAPOT_INTENT ───────────────────────────────────────────────────
  {
    id: 'TEAPOT_INTENT',
    description: 'Teapot → 6912.00/6911.10',
    pattern: {
      anyOf: ['teapot', 'ceramic teapot', 'pottery teapot', 'tea set', 'tea kettle ceramic'],
    },
    inject: [
      { prefix: '6912.00', syntheticRank: 22 },
      { prefix: '6911.10', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '6912.' }],
  },

  // ── Rule 253: CERAMIC_TILE_INTENT ─────────────────────────────────────────────
  {
    id: 'CERAMIC_TILE_INTENT',
    description: 'Ceramic/porcelain tile → 6907',
    pattern: {
      anyOf: ['ceramic tile', 'floor tile', 'wall tile', 'porcelain tile', 'mosaic tile',
               'subway tile', 'backsplash tile', 'bathroom tile'],
    },
    inject: [{ prefix: '6907.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['69'] },
    boosts: [{ delta: 0.70, chapterMatch: '69' }],
  },

  // ── Rule 254: STEEL_PIPE_INTENT ───────────────────────────────────────────────
  {
    id: 'STEEL_PIPE_INTENT',
    description: 'Steel pipe/tube → 7306',
    pattern: {
      anyOf: ['steel pipe', 'iron pipe', 'metal tube', 'steel tube', 'plumbing pipe',
               'galvanized pipe', 'stainless pipe'],
    },
    inject: [{ prefix: '7306.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, chapterMatch: '73' }],
  },

  // ── Rule 255: WIRE_MESH_INTENT ────────────────────────────────────────────────
  {
    id: 'WIRE_MESH_INTENT',
    description: 'Wire mesh/fence → 7314',
    pattern: {
      anyOf: ['wire mesh', 'wire fence', 'metal mesh', 'steel mesh', 'chicken wire',
               'welded mesh', 'wire netting', 'hardware cloth'],
    },
    inject: [{ prefix: '7314.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, chapterMatch: '73' }],
  },

  // ── Rule 256: LED_LIGHT_INTENT ────────────────────────────────────────────────
  {
    id: 'LED_LIGHT_INTENT',
    description: 'LED lamp/bulb → 8539.50',
    pattern: {
      anyOf: ['led light', 'led lamp', 'led bulb', 'led panel', 'led lighting',
               'smart bulb', 'wifi bulb', 'led downlight', 'led spotlight'],
      noneOf: ['strip', 'flexible'],
    },
    inject: [{ prefix: '8539.50', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8539.' }],
  },

  // ── Rule 257: SOLAR_PANEL_INTENT ──────────────────────────────────────────────
  {
    id: 'SOLAR_PANEL_INTENT',
    description: 'Solar panel/PV module → 8541.40',
    pattern: {
      anyOf: ['solar panel', 'photovoltaic panel', 'pv panel', 'solar module', 'solar cell',
               'solar plate', 'monocrystalline panel', 'polycrystalline panel'],
    },
    inject: [{ prefix: '8541.40', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8541.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8541.' }],
  },

  // ── Rule 258: MICROSCOPE_INTENT ───────────────────────────────────────────────
  {
    id: 'MICROSCOPE_INTENT',
    description: 'Microscope → 9011',
    pattern: {
      anyOf: ['microscope', 'optical microscope', 'laboratory microscope', 'digital microscope',
               'stereo microscope', 'biological microscope'],
    },
    inject: [{ prefix: '9011.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.75, prefixMatch: '9011.' }],
  },

  // ── Rule 259: TELESCOPE_BINOCULARS_INTENT ────────────────────────────────────
  {
    id: 'TELESCOPE_BINOCULARS_INTENT',
    description: 'Telescope/binoculars → 9005',
    pattern: {
      anyOf: ['telescope', 'astronomical telescope', 'refracting telescope',
               'binoculars', 'field glasses', 'monocular'],
    },
    inject: [{ prefix: '9005.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, chapterMatch: '90' }],
  },

  // ── Rule 260: MULTIMETER_INTENT ───────────────────────────────────────────────
  {
    id: 'MULTIMETER_INTENT',
    description: 'Multimeter/electrical tester → 9030.33',
    pattern: {
      anyOf: ['multimeter', 'volt meter', 'ammeter', 'digital multimeter', 'electrical tester',
               'clamp meter', 'ohmmeter'],
    },
    inject: [{ prefix: '9030.33', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9030.' }],
  },

  // ── Rule 261: WHEELCHAIR_INTENT ───────────────────────────────────────────────
  {
    id: 'WHEELCHAIR_INTENT',
    description: 'Wheelchair → 8713',
    pattern: {
      anyOf: ['wheelchair', 'manual wheelchair', 'electric wheelchair', 'transport wheelchair',
               'power wheelchair', 'rollator', 'mobility scooter'],
    },
    inject: [{ prefix: '8713.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['87'] },
    boosts: [{ delta: 0.75, chapterMatch: '87' }],
  },

  // ── Rule 262: HEARING_AID_INTENT ─────────────────────────────────────────────
  {
    id: 'HEARING_AID_INTENT',
    description: 'Hearing aid → 9021.40',
    pattern: {
      anyOf: ['hearing aid', 'hearing device', 'digital hearing aid', 'behind-ear hearing aid',
               'in-ear hearing aid'],
    },
    inject: [{ prefix: '9021.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.75, prefixMatch: '9021.' }],
  },

  // ── Rule 263: READING_GLASSES_INTENT ─────────────────────────────────────────
  {
    id: 'READING_GLASSES_INTENT',
    description: 'Reading glasses/eyeglasses → 9004.10',
    pattern: {
      anyOf: ['reading glasses', 'eyeglasses', 'spectacles', 'prescription glasses',
               'bifocal glasses', 'progressive glasses'],
      noneOf: ['sunglasses', 'swimming goggles', 'safety goggles'],
    },
    inject: [{ prefix: '9004.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9004.' }],
  },

  // ── Rule 264: GOLF_CLUB_INTENT ────────────────────────────────────────────────
  {
    id: 'GOLF_CLUB_INTENT',
    description: 'Golf club/equipment → 9506.31',
    pattern: {
      anyOf: ['golf club', 'golf iron', 'golf driver', 'golf wedge', 'putter', 'golf set',
               'golf ball', 'golf bag', 'golf tee'],
    },
    inject: [{ prefix: '9506.31', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.' }],
  },

  // ── Rule 265: SKI_SNOWBOARD_INTENT ───────────────────────────────────────────
  {
    id: 'SKI_SNOWBOARD_INTENT',
    description: 'Ski/snowboard → 9506.11',
    pattern: {
      anyOf: ['ski', 'skis', 'alpine ski', 'downhill ski', 'cross-country ski',
               'snowboard', 'freestyle snowboard'],
    },
    inject: [{ prefix: '9506.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.' }],
  },

  // ── Rule 266: SURFBOARD_INTENT ────────────────────────────────────────────────
  {
    id: 'SURFBOARD_INTENT',
    description: 'Surfboard/bodyboard → 9506.29',
    pattern: {
      anyOf: ['surfboard', 'longboard surfboard', 'shortboard', 'bodyboard', 'boogie board',
               'paddleboard', 'sup board'],
    },
    inject: [{ prefix: '9506.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 267: BOXING_EQUIPMENT_INTENT ────────────────────────────────────────
  {
    id: 'BOXING_EQUIPMENT_INTENT',
    description: 'Boxing gloves/punching bag → 9506.99',
    pattern: {
      anyOf: ['boxing glove', 'boxing gloves', 'punching bag', 'heavy bag', 'speed bag',
               'sparring glove', 'boxing equipment', 'mma gloves'],
    },
    inject: [{ prefix: '9506.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 268: ARCHERY_INTENT ──────────────────────────────────────────────────
  {
    id: 'ARCHERY_INTENT',
    description: 'Archery bow/arrow → 9506.70',
    pattern: {
      anyOf: ['archery bow', 'compound bow', 'recurve bow', 'crossbow', 'archery',
               'arrow', 'quiver', 'bow hunting'],
    },
    inject: [{ prefix: '9506.70', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.' }],
  },

  // ── Rule 269: PAINT_ART_INTENT ────────────────────────────────────────────────
  {
    id: 'PAINT_ART_INTENT',
    description: 'Artist paint/acrylic/watercolor → 3213',
    pattern: {
      anyOf: ['acrylic paint', 'artist paint', 'watercolor paint', 'oil paint', 'gouache',
               'tempera paint', 'paint set', 'craft paint'],
      noneOf: ['wall paint', 'house paint', 'spray paint'],
    },
    inject: [{ prefix: '3213.', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '3213.' }],
  },

  // ── Rule 270: ARTIST_CANVAS_INTENT ───────────────────────────────────────────
  {
    id: 'ARTIST_CANVAS_INTENT',
    description: 'Artist canvas → 5901.90/4414.90',
    pattern: {
      anyOf: ['artist canvas', 'stretched canvas', 'canvas board', 'painting canvas',
               'canvas roll', 'canvas panel'],
    },
    inject: [
      { prefix: '5901.90', syntheticRank: 22 },
      { prefix: '4414.90', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, prefixMatch: '5901.' }],
  },

  // ── Rule 271: BABY_BOTTLE_INTENT ─────────────────────────────────────────────
  {
    id: 'BABY_BOTTLE_INTENT',
    description: 'Baby bottle/sippy cup → 3924.10',
    pattern: {
      anyOf: ['baby bottle', 'infant bottle', 'feeding bottle', 'nursing bottle', 'sippy cup',
               'toddler cup', 'training cup'],
    },
    inject: [{ prefix: '3924.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3924.' }],
  },

  // ── Rule 272: PACIFIER_INTENT ─────────────────────────────────────────────────
  {
    id: 'PACIFIER_INTENT',
    description: 'Pacifier/dummy/soother → 3924.90',
    pattern: {
      anyOf: ['pacifier', 'dummy', 'soother', 'infant pacifier', 'baby soother',
               'orthodontic pacifier'],
    },
    inject: [{ prefix: '3924.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3924.' }],
  },

  // ── Rule 273: PET_CARRIER_INTENT ─────────────────────────────────────────────
  {
    id: 'PET_CARRIER_INTENT',
    description: 'Pet carrier/travel bag → 4202.92',
    pattern: {
      anyOf: ['pet carrier', 'pet travel bag', 'dog carrier', 'cat carrier', 'animal carrier',
               'airline pet carrier', 'soft pet carrier'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.60, prefixMatch: '4202.' }],
  },

  // ── Rule 274: BIRD_CAGE_INTENT ────────────────────────────────────────────────
  {
    id: 'BIRD_CAGE_INTENT',
    description: 'Bird cage → 7323.99/3926.90',
    pattern: {
      anyOf: ['bird cage', 'birdcage', 'parrot cage', 'avian cage', 'pet cage',
               'hamster cage', 'rabbit cage', 'small animal cage'],
    },
    inject: [
      { prefix: '7323.99', syntheticRank: 22 },
      { prefix: '3926.90', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.55, prefixMatch: '7323.' }],
  },

  // ── Rule 275: CAR_BATTERY_INTENT ─────────────────────────────────────────────
  {
    id: 'CAR_BATTERY_INTENT',
    description: 'Car/auto battery → 8507.10',
    pattern: {
      anyOf: ['car battery', 'auto battery', 'vehicle battery', 'automotive battery',
               'lead acid battery', '12v car battery'],
    },
    inject: [{ prefix: '8507.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8507.' }],
  },

  // ── Rule 276: WINDSHIELD_WIPER_INTENT ────────────────────────────────────────
  {
    id: 'WINDSHIELD_WIPER_INTENT',
    description: 'Windshield wiper → 8512.30',
    pattern: {
      anyOf: ['windshield wiper', 'wiper blade', 'rain wiper', 'windscreen wiper',
               'front wiper', 'rear wiper'],
    },
    inject: [{ prefix: '8512.30', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8512.' }],
  },

  // ── Rule 277: AIR_CONDITIONER_INTENT ─────────────────────────────────────────
  {
    id: 'AIR_CONDITIONER_INTENT',
    description: 'Air conditioner → 8415',
    pattern: {
      anyOf: ['air conditioner', 'ac unit', 'room air conditioner', 'split ac', 'window ac',
               'portable air conditioner', 'mini split'],
    },
    inject: [{ prefix: '8415.', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8415.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8415.' }],
  },

  // ── Rule 278: DEHUMIDIFIER_INTENT ────────────────────────────────────────────
  {
    id: 'DEHUMIDIFIER_INTENT',
    description: 'Dehumidifier/humidifier → 8479.60',
    pattern: {
      anyOf: ['dehumidifier', 'room dehumidifier', 'portable dehumidifier', 'moisture remover'],
    },
    inject: [{ prefix: '8479.60', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8479.' }],
  },

  // ── Rule 279: HUMIDIFIER_INTENT ───────────────────────────────────────────────
  {
    id: 'HUMIDIFIER_INTENT',
    description: 'Humidifier → 8479.89',
    pattern: {
      anyOf: ['humidifier', 'room humidifier', 'cool mist humidifier', 'ultrasonic humidifier',
               'warm mist humidifier', 'whole house humidifier'],
    },
    inject: [{ prefix: '8479.89', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8479.' }],
  },

  // ── Rule 280: FAUCET_INTENT ───────────────────────────────────────────────────
  {
    id: 'FAUCET_INTENT',
    description: 'Faucet/tap → 8481.80',
    pattern: {
      anyOf: ['faucet', 'tap', 'water faucet', 'kitchen faucet', 'bathroom faucet',
               'mixer tap', 'basin tap', 'touchless faucet'],
    },
    inject: [{ prefix: '8481.80', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8481.' }],
  },

  // ── Rule 281: SHOWER_HEAD_INTENT ─────────────────────────────────────────────
  {
    id: 'SHOWER_HEAD_INTENT',
    description: 'Shower head → 8481.80',
    pattern: {
      anyOf: ['shower head', 'rain shower head', 'handheld shower', 'shower set',
               'dual shower head', 'waterfall shower head'],
    },
    inject: [{ prefix: '8481.80', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8481.' }],
  },

  // ── Rule 282: FLOOR_LAMP_INTENT ───────────────────────────────────────────────
  {
    id: 'FLOOR_LAMP_INTENT',
    description: 'Floor lamp/standing lamp → 9405.20',
    pattern: {
      anyOf: ['floor lamp', 'standing lamp', 'torchiere lamp', 'arc floor lamp',
               'tripod floor lamp', 'led floor lamp'],
    },
    inject: [{ prefix: '9405.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9405.' }],
  },

  // ── Rule 283: TABLE_LAMP_INTENT ───────────────────────────────────────────────
  {
    id: 'TABLE_LAMP_INTENT',
    description: 'Table lamp/desk lamp → 9405.20',
    pattern: {
      anyOf: ['table lamp', 'desk lamp', 'bedside lamp', 'reading lamp', 'night lamp',
               'touch lamp', 'usb desk lamp'],
    },
    inject: [{ prefix: '9405.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9405.' }],
  },

  // ── Rule 284: CHANDELIER_INTENT ───────────────────────────────────────────────
  {
    id: 'CHANDELIER_INTENT',
    description: 'Chandelier/ceiling light → 9405.10',
    pattern: {
      anyOf: ['chandelier', 'hanging chandelier', 'crystal chandelier', 'pendant light',
               'ceiling chandelier', 'dining chandelier'],
    },
    inject: [{ prefix: '9405.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9405.' }],
  },

  // ── Rule 285: SMOKE_DETECTOR_INTENT ──────────────────────────────────────────
  {
    id: 'SMOKE_DETECTOR_INTENT',
    description: 'Smoke detector/alarm → 8531.10',
    pattern: {
      anyOf: ['smoke detector', 'smoke alarm', 'fire detector', 'carbon monoxide detector',
               'co detector', 'fire alarm', 'heat detector'],
    },
    inject: [{ prefix: '8531.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8531.' }],
  },

  // ── Rule 286: FLOUR_GRAIN_INTENT ─────────────────────────────────────────────
  {
    id: 'FLOUR_GRAIN_INTENT',
    description: 'Flour/wheat flour → 1101',
    pattern: {
      anyOf: ['flour', 'all-purpose flour', 'wheat flour', 'bread flour', 'cake flour',
               'whole wheat flour', 'corn flour', 'rice flour'],
    },
    inject: [{ prefix: '1101.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['11'] },
    boosts: [{ delta: 0.70, chapterMatch: '11' }],
  },

  // ── Rule 287: SUGAR_INTENT ────────────────────────────────────────────────────
  {
    id: 'SUGAR_INTENT',
    description: 'Sugar → 1701',
    pattern: {
      anyOf: ['sugar', 'white sugar', 'brown sugar', 'cane sugar', 'powdered sugar',
               'granulated sugar', 'raw sugar', 'caster sugar'],
    },
    inject: [{ prefix: '1701.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['17'] },
    boosts: [{ delta: 0.70, chapterMatch: '17' }],
  },

  // ── Rule 288: YEAST_BAKING_INTENT ────────────────────────────────────────────
  {
    id: 'YEAST_BAKING_INTENT',
    description: 'Yeast → 2102.10',
    pattern: {
      anyOf: ['yeast', 'active dry yeast', 'instant yeast', 'baking yeast', 'bread yeast',
               'sourdough starter'],
    },
    inject: [{ prefix: '2102.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '2102.' }],
  },

  // ── Rule 289: JAM_PRESERVE_INTENT ────────────────────────────────────────────
  {
    id: 'JAM_PRESERVE_INTENT',
    description: 'Jam/jelly/fruit preserve → 2007',
    pattern: {
      anyOf: ['jam', 'fruit jam', 'jelly', 'marmalade', 'fruit spread', 'preserve',
               'strawberry jam', 'fruit preserve'],
    },
    inject: [{ prefix: '2007.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['20'] },
    boosts: [{ delta: 0.70, chapterMatch: '20' }],
  },

  // ── Rule 290: CANNED_FOOD_INTENT ─────────────────────────────────────────────
  {
    id: 'CANNED_FOOD_INTENT',
    description: 'Canned food → 1602/2002/2005',
    pattern: {
      anyOf: ['canned tuna', 'canned fish', 'canned beans', 'canned vegetables',
               'canned corn', 'canned tomatoes', 'canned food', 'canned meat',
               'preserved fish', 'canned soup'],
    },
    inject: [
      { prefix: '1602.', syntheticRank: 22 },
      { prefix: '2005.', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, chapterMatch: '16' }],
  },

  // ── Rule 291: NUTS_SEEDS_INTENT ───────────────────────────────────────────────
  {
    id: 'NUTS_SEEDS_INTENT',
    description: 'Nuts/seeds → 0801/0802',
    pattern: {
      anyOf: ['almonds', 'cashews', 'walnuts', 'peanuts', 'pistachios', 'macadamia',
               'hazelnuts', 'pecans', 'pine nuts', 'sunflower seeds', 'pumpkin seeds',
               'chia seeds', 'flaxseeds', 'sesame seeds'],
    },
    inject: [
      { prefix: '0801.', syntheticRank: 22 },
      { prefix: '0802.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['08'] },
    boosts: [{ delta: 0.65, chapterMatch: '08' }],
  },

  // ── Rule 292: COFFEE_POD_INTENT ───────────────────────────────────────────────
  {
    id: 'COFFEE_POD_INTENT',
    description: 'Coffee pod/capsule → 2101.11',
    pattern: {
      anyOf: ['coffee pod', 'k-cup', 'espresso pod', 'nespresso pod', 'coffee capsule',
               'dolce gusto pod', 'ground coffee', 'espresso grounds'],
    },
    inject: [{ prefix: '2101.11', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, chapterMatch: '21' }],
  },

  // ── Rule 293: FACE_MASK_SKINCARE_INTENT ──────────────────────────────────────
  {
    id: 'FACE_MASK_SKINCARE_INTENT',
    description: 'Face mask/sheet mask → 3304',
    pattern: {
      anyOf: ['face mask', 'sheet mask', 'clay mask', 'facial mask', 'peel-off mask',
               'mud mask', 'hydrating mask', 'eye mask skincare'],
      noneOf: ['surgical mask', 'n95', 'respirator', 'protective mask'],
    },
    inject: [{ prefix: '3304.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 294: MAKEUP_BLUSH_INTENT ────────────────────────────────────────────
  {
    id: 'MAKEUP_BLUSH_INTENT',
    description: 'Blush/bronzer/highlighter → 3304',
    pattern: {
      anyOf: ['blush', 'cheek blush', 'powder blush', 'bronzer', 'contouring powder',
               'highlighter', 'face highlighter', 'illuminating powder', 'strobing'],
    },
    inject: [{ prefix: '3304.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 295: MAKEUP_BRUSH_INTENT ────────────────────────────────────────────
  {
    id: 'MAKEUP_BRUSH_INTENT',
    description: 'Makeup brush/beauty brush → 9603.29',
    pattern: {
      anyOf: ['makeup brush', 'foundation brush', 'blush brush', 'eyeshadow brush',
               'beauty brush', 'makeup brush set', 'contour brush'],
    },
    inject: [{ prefix: '9603.29', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9603.' }],
  },

  // ── Rule 296: CONCEALER_FOUNDATION_INTENT ────────────────────────────────────
  {
    id: 'CONCEALER_FOUNDATION_INTENT',
    description: 'Concealer/foundation/BB cream → 3304',
    pattern: {
      anyOf: ['concealer', 'face concealer', 'foundation cream', 'bb cream', 'cc cream',
               'tinted moisturizer', 'liquid foundation', 'powder foundation'],
    },
    inject: [{ prefix: '3304.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 297: HAIR_STRAIGHTENER_INTENT ───────────────────────────────────────
  {
    id: 'HAIR_STRAIGHTENER_INTENT',
    description: 'Hair straightener/flat iron → 8516.32',
    pattern: {
      anyOf: ['hair straightener', 'flat iron hair', 'hair flat iron', 'ceramic straightener',
               'hair curler', 'curling iron', 'curling wand', 'hair waver'],
    },
    inject: [{ prefix: '8516.32', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8516.' }],
  },

  // ── Rule 298: TOOTHPASTE_INTENT ───────────────────────────────────────────────
  {
    id: 'TOOTHPASTE_INTENT',
    description: 'Toothpaste/mouthwash/dental → 3306',
    pattern: {
      anyOf: ['toothpaste', 'dental paste', 'whitening toothpaste', 'fluoride toothpaste',
               'mouthwash', 'mouth rinse', 'oral rinse', 'dental floss', 'floss picks'],
    },
    inject: [{ prefix: '3306.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.70, chapterMatch: '33' }],
  },

  // ── Rule 299: FISH_OIL_SUPPLEMENT_INTENT ─────────────────────────────────────
  {
    id: 'FISH_OIL_SUPPLEMENT_INTENT',
    description: 'Fish oil/omega-3 supplement → 2106.90',
    pattern: {
      anyOf: ['fish oil', 'omega-3', 'omega 3', 'cod liver oil', 'dha supplement',
               'vitamin d3', 'cholecalciferol', 'collagen', 'collagen peptide',
               'marine collagen', 'probiotic', 'probiotic supplement'],
    },
    inject: [{ prefix: '2106.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.60, chapterMatch: '21' }],
  },

  // ── Rule 300: LAUNDRY_DETERGENT_INTENT ───────────────────────────────────────
  {
    id: 'LAUNDRY_DETERGENT_INTENT',
    description: 'Laundry detergent/fabric softener → 3402',
    pattern: {
      anyOf: ['laundry detergent', 'washing powder', 'laundry powder', 'clothes detergent',
               'fabric softener', 'dryer sheet', 'fabric conditioner',
               'dishwasher tablet', 'dishwasher pod', 'dishwasher detergent'],
    },
    inject: [{ prefix: '3402.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.65, chapterMatch: '34' }],
  },

  // ── Rule 301: BLEACH_DISINFECTANT_INTENT ─────────────────────────────────────
  {
    id: 'BLEACH_DISINFECTANT_INTENT',
    description: 'Bleach/disinfectant → 2828.10/3808',
    pattern: {
      anyOf: ['bleach', 'chlorine bleach', 'laundry bleach', 'disinfectant bleach',
               'sodium hypochlorite', 'disinfectant spray', 'sanitizer spray'],
    },
    inject: [
      { prefix: '2828.10', syntheticRank: 22 },
      { prefix: '3808.94', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, prefixMatch: '2828.' }],
  },

  // ── Rule 302: DIAPER_BAG_INTENT ───────────────────────────────────────────────
  {
    id: 'DIAPER_BAG_INTENT',
    description: 'Diaper bag/nappy bag → 4202.92',
    pattern: {
      anyOf: ['diaper bag', 'nappy bag', 'baby changing bag', 'mommy bag', 'baby tote'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.92' }],
  },

  // ── Rule 303: LAPTOP_BAG_INTENT ───────────────────────────────────────────────
  {
    id: 'LAPTOP_BAG_INTENT',
    description: 'Laptop bag/computer bag → 4202.12',
    pattern: {
      anyOf: ['laptop bag', 'computer bag', 'notebook bag', 'work bag', 'laptop backpack',
               'camera bag', 'photography bag', 'camera backpack'],
    },
    inject: [{ prefix: '4202.12', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.' }],
  },

  // ── Rule 304: WIRELESS_CHARGER_INTENT ────────────────────────────────────────
  {
    id: 'WIRELESS_CHARGER_INTENT',
    description: 'Wireless charger/charging pad → 8504.40',
    pattern: {
      anyOf: ['wireless charger', 'qi charger', 'inductive charger', 'charging pad',
               'magsafe charger', 'wireless charging stand'],
    },
    inject: [{ prefix: '8504.40', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8504.' }],
  },

  // ── Rule 305: PHONE_GRIP_INTENT ───────────────────────────────────────────────
  {
    id: 'PHONE_GRIP_INTENT',
    description: 'Phone grip/pop socket → 3926.90',
    pattern: {
      anyOf: ['phone grip', 'pop socket', 'popsocket', 'phone ring', 'ring stand',
               'phone holder grip', 'finger grip phone'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3926.' }],
  },

  // ── Rule 306: MOUSE_PAD_INTENT ────────────────────────────────────────────────
  {
    id: 'MOUSE_PAD_INTENT',
    description: 'Mouse pad/desk mat → 3919.90',
    pattern: {
      anyOf: ['mouse pad', 'gaming mouse pad', 'desk mat', 'mouse mat', 'extended mousepad'],
    },
    inject: [{ prefix: '3919.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3919.' }],
  },

  // ── Rule 307: LAPTOP_STAND_INTENT ────────────────────────────────────────────
  {
    id: 'LAPTOP_STAND_INTENT',
    description: 'Laptop stand/notebook stand → 7326.90',
    pattern: {
      anyOf: ['laptop stand', 'notebook stand', 'computer stand', 'desk riser',
               'monitor stand', 'laptop riser'],
    },
    inject: [{ prefix: '7326.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.60, prefixMatch: '7326.' }],
  },

  // ── Rule 308: RECORD_PLAYER_INTENT ───────────────────────────────────────────
  {
    id: 'RECORD_PLAYER_INTENT',
    description: 'Record player/turntable → 8519.20',
    pattern: {
      anyOf: ['record player', 'turntable', 'vinyl player', 'phonograph', 'gramophone',
               'lp player'],
    },
    inject: [{ prefix: '8519.20', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '8519.' }],
  },

  // ── Rule 309: SOUNDBAR_INTENT ─────────────────────────────────────────────────
  {
    id: 'SOUNDBAR_INTENT',
    description: 'Soundbar → 8518.22',
    pattern: {
      anyOf: ['soundbar', 'sound bar', 'tv soundbar', 'home theater soundbar',
               'bluetooth soundbar', 'subwoofer soundbar'],
    },
    inject: [{ prefix: '8518.22', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8518.' }],
  },

  // ── Rule 310: VR_HEADSET_INTENT ───────────────────────────────────────────────
  {
    id: 'VR_HEADSET_INTENT',
    description: 'VR headset → 9004.90',
    pattern: {
      anyOf: ['vr headset', 'virtual reality headset', 'vr goggles', 'meta quest', 'oculus',
               'mixed reality headset', 'ar glasses'],
    },
    inject: [{ prefix: '9004.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9004.' }],
  },

  // ── Rule 311: FITNESS_TRACKER_INTENT ─────────────────────────────────────────
  {
    id: 'FITNESS_TRACKER_INTENT',
    description: 'Fitness tracker/activity band → 8517.62',
    pattern: {
      anyOf: ['fitness tracker', 'activity tracker', 'step counter', 'pedometer',
               'health band', 'fitness band', 'sport band'],
      noneOf: ['smartwatch', 'watch'],
    },
    inject: [{ prefix: '8517.62', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8517.' }],
  },

  // ── Rule 312: STANDING_DESK_INTENT ───────────────────────────────────────────
  {
    id: 'STANDING_DESK_INTENT',
    description: 'Standing desk/height-adjustable desk → 9403.30',
    pattern: {
      anyOf: ['standing desk', 'height adjustable desk', 'sit stand desk', 'electric desk',
               'ergonomic desk', 'office desk'],
    },
    inject: [{ prefix: '9403.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 313: PRINTER_INK_INTENT ─────────────────────────────────────────────
  {
    id: 'PRINTER_INK_INTENT',
    description: 'Printer ink cartridge/toner → 8443.99',
    pattern: {
      anyOf: ['printer ink', 'ink cartridge', 'toner cartridge', 'inkjet cartridge',
               'laser toner', 'printer toner', 'compatible cartridge'],
    },
    inject: [{ prefix: '8443.99', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8443.' }],
  },

  // ── Rule 314: KAYAK_INTENT ────────────────────────────────────────────────────
  {
    id: 'KAYAK_INTENT',
    description: 'Kayak/canoe → 8903.99',
    pattern: {
      anyOf: ['kayak', 'canoe', 'inflatable kayak', 'sea kayak', 'paddle kayak',
               'whitewater kayak', 'fishing kayak'],
    },
    inject: [{ prefix: '8903.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['89'] },
    boosts: [{ delta: 0.75, chapterMatch: '89' }],
  },

  // ── Rule 315: STICKER_LABEL_INTENT ───────────────────────────────────────────
  {
    id: 'STICKER_LABEL_INTENT',
    description: 'Sticker/label/decal → 4821.10',
    pattern: {
      anyOf: ['sticker', 'label sticker', 'adhesive sticker', 'vinyl sticker', 'decal',
               'wall decal', 'laptop sticker', 'price tag', 'hang tag'],
    },
    inject: [{ prefix: '4821.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '4821.' }],
  },

  // ── Rule 316: SAFETY_VEST_INTENT ─────────────────────────────────────────────
  {
    id: 'SAFETY_VEST_INTENT',
    description: 'Safety/reflective vest → 6211.33',
    pattern: {
      anyOf: ['safety vest', 'reflective vest', 'hi-vis vest', 'high visibility vest',
               'construction vest', 'work safety vest'],
    },
    inject: [{ prefix: '6211.33', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '6211.' }],
  },

  // ── Rule 317: HARD_HAT_INTENT ─────────────────────────────────────────────────
  {
    id: 'HARD_HAT_INTENT',
    description: 'Hard hat/safety helmet → 6506.10',
    pattern: {
      anyOf: ['hard hat', 'safety helmet', 'construction helmet', 'work helmet',
               'industrial helmet', 'hard cap'],
    },
    inject: [{ prefix: '6506.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '6506.' }],
  },

  // ── Rule 318: SAFETY_GOGGLES_INTENT ──────────────────────────────────────────
  {
    id: 'SAFETY_GOGGLES_INTENT',
    description: 'Safety/protective goggles → 9004.90',
    pattern: {
      anyOf: ['safety goggles', 'protective goggles', 'work goggles', 'eye protection',
               'lab goggles', 'industrial goggles'],
    },
    inject: [{ prefix: '9004.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9004.' }],
  },

  // ── Rule 319: RESIN_CRAFT_INTENT ─────────────────────────────────────────────
  {
    id: 'RESIN_CRAFT_INTENT',
    description: 'Epoxy/UV resin craft → 3907.30',
    pattern: {
      anyOf: ['resin', 'epoxy resin', 'uv resin', 'casting resin', 'craft resin',
               'clear resin', 'jewelry resin'],
    },
    inject: [{ prefix: '3907.30', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3907.' }],
  },

  // ── Rule 320: INSECTICIDE_INTENT ─────────────────────────────────────────────
  {
    id: 'INSECTICIDE_INTENT',
    description: 'Insecticide/pest control → 3808.91',
    pattern: {
      anyOf: ['insecticide', 'bug spray', 'insect killer', 'pest spray', 'mosquito spray',
               'rat trap', 'mouse trap', 'rodent trap', 'ant killer', 'cockroach killer'],
    },
    inject: [{ prefix: '3808.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['38'] },
    boosts: [{ delta: 0.70, chapterMatch: '38' }],
  },

  // ── Rule 321: STORAGE_RACK_INTENT ────────────────────────────────────────────
  {
    id: 'STORAGE_RACK_INTENT',
    description: 'Storage rack/shelving → 9403.20',
    pattern: {
      anyOf: ['storage rack', 'shelving rack', 'wire rack', 'garage rack', 'metal shelving',
               'storage shelf', 'utility shelf', 'industrial shelf'],
    },
    inject: [{ prefix: '9403.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 322: TOOLBOX_INTENT ──────────────────────────────────────────────────
  {
    id: 'TOOLBOX_INTENT',
    description: 'Toolbox/tool chest → 7326.90/3926.90',
    pattern: {
      anyOf: ['toolbox', 'tool chest', 'tool storage box', 'mechanics toolbox',
               'portable toolbox', 'plastic toolbox', 'metal toolbox'],
    },
    inject: [
      { prefix: '7326.90', syntheticRank: 22 },
      { prefix: '3926.90', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, prefixMatch: '7326.' }],
  },

  // ── Rule 323: ELECTRIC_MOTOR_INTENT ──────────────────────────────────────────
  {
    id: 'ELECTRIC_MOTOR_INTENT',
    description: 'Electric motor → 8501',
    pattern: {
      anyOf: ['electric motor', 'dc motor', 'ac motor', 'servo motor', 'stepper motor',
               'brushless motor', 'induction motor'],
    },
    inject: [{ prefix: '8501.', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8501.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8501.' }],
  },

  // ── Rule 324: TRANSFORMER_ELECTRICAL_INTENT ──────────────────────────────────
  {
    id: 'TRANSFORMER_ELECTRICAL_INTENT',
    description: 'Power transformer → 8504.31',
    pattern: {
      anyOf: ['voltage transformer', 'step-down transformer', 'power transformer',
               'isolation transformer', 'auto transformer'],
    },
    inject: [{ prefix: '8504.31', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8504.' }],
  },

  // ── Rule 325: RULER_COMPASS_INTENT ───────────────────────────────────────────
  {
    id: 'RULER_COMPASS_INTENT',
    description: 'Ruler/compass/protractor → 9017',
    pattern: {
      anyOf: ['ruler', 'measuring ruler', 'compass', 'drawing compass', 'protractor',
               'angle protractor', 'set square', 'drafting tool'],
    },
    inject: [{ prefix: '9017.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, chapterMatch: '90' }],
  },

  // ── Rule 326: PENCIL_CASE_INTENT ─────────────────────────────────────────────
  {
    id: 'PENCIL_CASE_INTENT',
    description: 'Pencil case/stationery case → 4205.00',
    pattern: {
      anyOf: ['pencil case', 'pen case', 'stationery case', 'pencil pouch', 'pencil bag',
               'zipper pencil case'],
    },
    inject: [{ prefix: '4205.00', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '4205.' }],
  },

  // ── Rule 327: SHOVEL_RAKE_GARDEN_INTENT ──────────────────────────────────────
  {
    id: 'SHOVEL_RAKE_GARDEN_INTENT',
    description: 'Shovel/rake/garden tool → 8201',
    pattern: {
      anyOf: ['shovel', 'garden shovel', 'spade', 'rake', 'garden rake', 'leaf rake',
               'hoe', 'garden fork', 'cultivator'],
    },
    inject: [{ prefix: '8201.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.70, chapterMatch: '82' }],
  },

  // ── Rule 328: GUITAR_STRING_INTENT ───────────────────────────────────────────
  {
    id: 'GUITAR_STRING_INTENT',
    description: 'Guitar strings/picks → 9209.30',
    pattern: {
      anyOf: ['guitar string', 'acoustic strings', 'electric strings', 'bass strings',
               'guitar pick', 'plectrum', 'music string', 'ukulele strings'],
    },
    inject: [{ prefix: '9209.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, chapterMatch: '92' }],
  },

  // ── Rule 329: CUFFLINKS_INTENT ────────────────────────────────────────────────
  {
    id: 'CUFFLINKS_INTENT',
    description: 'Cufflinks → 7117.19',
    pattern: {
      anyOf: ['cufflinks', 'cuff links', 'shirt cufflinks', 'formal cufflinks'],
    },
    inject: [{ prefix: '7117.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.70, chapterMatch: '71' }],
  },

  // ── Rule 330: HAIR_CLIP_ACCESSORY_INTENT ─────────────────────────────────────
  {
    id: 'HAIR_CLIP_ACCESSORY_INTENT',
    description: 'Hair clip/band/scrunchie → 9615.90',
    pattern: {
      anyOf: ['hair clip', 'barrette', 'bobby pin', 'hair pin', 'hair band',
               'hair tie', 'scrunchie', 'elastic hair band', 'ponytail holder'],
    },
    inject: [{ prefix: '9615.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9615.' }],
  },

  // ── Rule 331: ADHESIVE_GLUE_INTENT ───────────────────────────────────────────
  {
    id: 'ADHESIVE_GLUE_INTENT',
    description: 'Adhesive/glue → 3506',
    pattern: {
      anyOf: ['epoxy adhesive', 'super glue', 'cyanoacrylate', 'instant adhesive',
               'contact glue', 'wood glue', 'craft glue', 'hot glue', 'construction adhesive'],
    },
    inject: [{ prefix: '3506.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['35'] },
    boosts: [{ delta: 0.70, chapterMatch: '35' }],
  },

  // ── Rule 332: SPRAY_PAINT_INTENT ─────────────────────────────────────────────
  {
    id: 'SPRAY_PAINT_INTENT',
    description: 'Spray paint/aerosol paint → 3210.00',
    pattern: {
      anyOf: ['spray paint', 'aerosol paint', 'rattle can', 'enamel spray', 'primer spray',
               'touch up paint', 'graffiti spray'],
    },
    inject: [{ prefix: '3210.00', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '3210.' }],
  },

  // ── Rule 333: WALL_PAINT_INTENT ───────────────────────────────────────────────
  {
    id: 'WALL_PAINT_INTENT',
    description: 'Wall/house paint → 3209',
    pattern: {
      anyOf: ['wall paint', 'interior paint', 'exterior paint', 'latex paint', 'emulsion paint',
               'house paint', 'ceiling paint', 'primer paint'],
    },
    inject: [{ prefix: '3209.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['32'] },
    boosts: [{ delta: 0.70, chapterMatch: '32' }],
  },

  // ── Rule 334: SCREW_BOLT_INTENT ───────────────────────────────────────────────
  {
    id: 'SCREW_BOLT_INTENT',
    description: 'Screws/bolts/fasteners → 7318',
    pattern: {
      anyOf: ['screws', 'screw', 'wood screw', 'machine screw', 'self-tapping screw',
               'bolts', 'bolt', 'hex bolt', 'carriage bolt',
               'nuts', 'hex nut', 'lock nut', 'wing nut',
               'washers', 'washer', 'flat washer'],
    },
    inject: [{ prefix: '7318.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.70, chapterMatch: '73' }],
  },

  // ── Rule 335: NAIL_RIVET_INTENT ───────────────────────────────────────────────
  {
    id: 'NAIL_RIVET_INTENT',
    description: 'Nails/rivets → 7317/7318',
    pattern: {
      anyOf: ['nails', 'nail', 'framing nail', 'finish nail', 'brad nail', 'roofing nail',
               'rivets', 'rivet', 'blind rivet', 'pop rivet', 'aluminum rivet'],
    },
    inject: [
      { prefix: '7317.', syntheticRank: 22 },
      { prefix: '7318.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, chapterMatch: '73' }],
  },

  // ── Rule 336: CABLE_TIE_INTENT ────────────────────────────────────────────────
  {
    id: 'CABLE_TIE_INTENT',
    description: 'Cable tie/zip tie → 3926.90',
    pattern: {
      anyOf: ['zip ties', 'cable tie', 'plastic tie', 'wire tie', 'nylon tie',
               'cable strap', 'hook and loop tie'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3926.' }],
  },

  // ── Rule 337: DUCT_TAPE_INTENT ────────────────────────────────────────────────
  {
    id: 'DUCT_TAPE_INTENT',
    description: 'Duct tape/masking tape → 3919.10',
    pattern: {
      anyOf: ['duct tape', 'gaffer tape', 'silver tape', 'sealing tape', 'cloth tape',
               'masking tape', 'painters tape', 'blue tape', 'washi tape',
               'double sided tape', 'mounting tape', 'foam tape'],
    },
    inject: [{ prefix: '3919.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3919.' }],
  },

  // ── Rule 338: ETHERNET_CABLE_INTENT ──────────────────────────────────────────
  {
    id: 'ETHERNET_CABLE_INTENT',
    description: 'Ethernet/network cable → 8544.42',
    pattern: {
      anyOf: ['ethernet cable', 'network cable', 'cat6 cable', 'cat5 cable', 'lan cable',
               'coaxial cable', 'coax cable', 'rg6 cable', 'patch cable'],
    },
    inject: [{ prefix: '8544.42', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8544.' }],
  },

  // ── Rule 339: AA_BATTERY_INTENT ───────────────────────────────────────────────
  {
    id: 'AA_BATTERY_INTENT',
    description: 'AA/AAA/disposable battery → 8506',
    pattern: {
      anyOf: ['aa battery', 'aaa battery', 'alkaline battery', 'double-a battery',
               'triple-a battery', 'lr6 battery', 'lr03', 'disposable battery', 'carbon battery'],
    },
    inject: [{ prefix: '8506.', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8506.'] },
    boosts: [{ delta: 0.75, prefixMatch: '8506.' }],
  },

  // ── Rule 340: LED_STRIP_LIGHT_INTENT ─────────────────────────────────────────
  {
    id: 'LED_STRIP_LIGHT_INTENT',
    description: 'LED strip/tape light → 8539.50',
    pattern: {
      anyOf: ['led strip', 'rgb strip', 'flexible led', 'light strip', 'tape light',
               'led tape', 'color changing strip', 'addressable led'],
    },
    inject: [{ prefix: '8539.50', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8539.' }],
  },

  // ── Rule 341: NETWORK_SWITCH_INTENT ──────────────────────────────────────────
  {
    id: 'NETWORK_SWITCH_INTENT',
    description: 'Network switch/modem → 8517.62',
    pattern: {
      anyOf: ['network switch', 'ethernet switch', 'managed switch', 'unmanaged switch',
               'modem', 'cable modem', 'dsl modem', 'fiber modem',
               'wireless access point', 'wifi access point'],
    },
    inject: [{ prefix: '8517.62', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8517.'] },
    boosts: [{ delta: 0.65, prefixMatch: '8517.' }],
  },

  // ── Rule 342: CAMERA_TRIPOD_INTENT ───────────────────────────────────────────
  {
    id: 'CAMERA_TRIPOD_INTENT',
    description: 'Camera tripod/stabilizer → 9620.00',
    pattern: {
      anyOf: ['camera tripod', 'photography tripod', 'video tripod', 'flexible tripod',
               'gorilla pod', 'gimbal', 'camera gimbal', 'phone gimbal', 'video stabilizer'],
    },
    inject: [{ prefix: '9620.00', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '9620.' }],
  },

  // ── Rule 343: CAMERA_LENS_FILTER_INTENT ──────────────────────────────────────
  {
    id: 'CAMERA_LENS_FILTER_INTENT',
    description: 'Camera lens filter → 9002.90',
    pattern: {
      anyOf: ['nd filter', 'neutral density filter', 'camera filter', 'lens filter', 'uv filter',
               'polarizing filter', 'cpl filter', 'graduated filter'],
    },
    inject: [{ prefix: '9002.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9002.' }],
  },

  // ── Rule 344: DRONE_PARTS_INTENT ─────────────────────────────────────────────
  {
    id: 'DRONE_PARTS_INTENT',
    description: 'Drone parts/propellers → 8806.91',
    pattern: {
      anyOf: ['drone propeller', 'quadcopter propeller', 'uav propeller', 'drone battery',
               'lipo battery', 'drone motor', 'drone frame', 'drone controller'],
    },
    inject: [{ prefix: '8806.91', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8806.' }],
  },

  // ── Rule 345: LAB_GLASSWARE_INTENT ───────────────────────────────────────────
  {
    id: 'LAB_GLASSWARE_INTENT',
    description: 'Lab glassware → 7017.10',
    pattern: {
      anyOf: ['beaker', 'laboratory beaker', 'glass beaker', 'test tube', 'laboratory tube',
               'petri dish', 'culture dish', 'pipette', 'micropipette', 'dropper',
               'flask laboratory', 'erlenmeyer flask', 'graduated cylinder'],
    },
    inject: [{ prefix: '7017.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['70'] },
    boosts: [{ delta: 0.70, chapterMatch: '70' }],
  },

  // ── Rule 346: BASEBALL_BAT_INTENT ────────────────────────────────────────────
  {
    id: 'BASEBALL_BAT_INTENT',
    description: 'Baseball/cricket bat → 9506.99',
    pattern: {
      anyOf: ['baseball bat', 'softball bat', 'aluminum bat', 'wooden bat',
               'cricket bat', 'willow bat'],
    },
    inject: [{ prefix: '9506.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 347: HOCKEY_STICK_INTENT ────────────────────────────────────────────
  {
    id: 'HOCKEY_STICK_INTENT',
    description: 'Hockey stick/ping pong paddle → 9506.99',
    pattern: {
      anyOf: ['hockey stick', 'ice hockey stick', 'field hockey stick',
               'ping pong', 'table tennis', 'ping pong paddle', 'table tennis paddle'],
    },
    inject: [{ prefix: '9506.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 348: DUMBBELL_WEIGHT_INTENT ─────────────────────────────────────────
  {
    id: 'DUMBBELL_WEIGHT_INTENT',
    description: 'Dumbbells/barbells/weights → 9506.91',
    pattern: {
      anyOf: ['dumbbells', 'dumbbell', 'free weights', 'hand weight', 'adjustable dumbbell',
               'barbell', 'olympic barbell', 'weight plate', 'bumper plate', 'kettlebell'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 349: EXERCISE_MAT_INTENT ────────────────────────────────────────────
  {
    id: 'EXERCISE_MAT_INTENT',
    description: 'Exercise/gym mat → 3918.10',
    pattern: {
      anyOf: ['exercise mat', 'gym mat', 'fitness mat', 'workout mat', 'floor mat exercise',
               'ab roller', 'ab wheel', 'abdominal roller'],
    },
    inject: [{ prefix: '3918.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.60, prefixMatch: '3918.' }],
  },

  // ── Rule 350: WEIGHT_BENCH_INTENT ────────────────────────────────────────────
  {
    id: 'WEIGHT_BENCH_INTENT',
    description: 'Weight bench/gym bench → 9506.91',
    pattern: {
      anyOf: ['bench press', 'weight bench', 'gym bench', 'adjustable bench', 'flat bench',
               'pull-up bar', 'chin-up bar', 'doorframe bar', 'wall pull-up bar'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 351: SUN_LOUNGER_INTENT ─────────────────────────────────────────────
  {
    id: 'SUN_LOUNGER_INTENT',
    description: 'Sun lounger/chaise lounge → 9401.79',
    pattern: {
      anyOf: ['sun lounger', 'beach lounger', 'chaise lounge', 'reclining chair outdoor',
               'poolside chair', 'garden bench', 'picnic table'],
    },
    inject: [{ prefix: '9401.79', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 352: ELECTRIC_HEATER_INTENT ─────────────────────────────────────────
  {
    id: 'ELECTRIC_HEATER_INTENT',
    description: 'Electric/space heater → 8516.29',
    pattern: {
      anyOf: ['electric heater', 'space heater', 'portable heater', 'room heater',
               'convector heater', 'baseboard heater', 'infrared heater', 'oil heater'],
    },
    inject: [{ prefix: '8516.29', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['8516.'] },
    boosts: [{ delta: 0.70, prefixMatch: '8516.' }],
  },

  // ── Rule 353: HEATED_BLANKET_INTENT ──────────────────────────────────────────
  {
    id: 'HEATED_BLANKET_INTENT',
    description: 'Heated/electric blanket → 6301.90',
    pattern: {
      anyOf: ['heated blanket', 'electric blanket', 'warming blanket', 'electric throw'],
    },
    inject: [{ prefix: '6301.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '6301.' }],
  },

  // ── Rule 354: HEAT_GUN_INTENT ─────────────────────────────────────────────────
  {
    id: 'HEAT_GUN_INTENT',
    description: 'Heat gun/hot air tool → 8516.80',
    pattern: {
      anyOf: ['heat gun', 'hot air gun', 'heat blower', 'paint stripper gun',
               'shrink wrap gun', 'embossing heat gun'],
    },
    inject: [{ prefix: '8516.80', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 355: SEWING_SUPPLIES_INTENT ─────────────────────────────────────────
  {
    id: 'SEWING_SUPPLIES_INTENT',
    description: 'Sewing thread/needle → 5401/5204',
    pattern: {
      anyOf: ['sewing thread', 'polyester thread', 'embroidery thread sew',
               'sewing needle', 'hand needle', 'embroidery needle',
               'knitting needle', 'crochet hook', 'circular needle'],
    },
    inject: [
      { prefix: '5401.', syntheticRank: 22 },
      { prefix: '5204.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['54', '52'] },
    boosts: [{ delta: 0.65, chapterMatch: '54' }],
  },

  // ── Rule 356: ZIPPER_INTENT ───────────────────────────────────────────────────
  {
    id: 'ZIPPER_INTENT',
    description: 'Zipper/zip fastener → 9607',
    pattern: {
      anyOf: ['zipper', 'zip fastener', 'metal zipper', 'nylon zipper', 'invisible zipper',
               'ykk zipper', 'coil zipper', 'separating zipper'],
    },
    inject: [{ prefix: '9607.', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['9607.'] },
    boosts: [{ delta: 0.75, prefixMatch: '9607.' }],
  },

  // ── Rule 357: TRAVEL_ACCESSORY_INTENT ────────────────────────────────────────
  {
    id: 'TRAVEL_ACCESSORY_INTENT',
    description: 'Travel accessories → 4202',
    pattern: {
      anyOf: ['travel pillow', 'neck pillow travel', 'luggage tag', 'bag tag',
               'luggage lock', 'tsa lock', 'packing cube', 'travel organizer',
               'passport holder', 'passport cover', 'travel adapter'],
    },
    inject: [{ prefix: '4202.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.60, chapterMatch: '42' }],
  },

  // ── Rule 358: DOOR_HINGE_HARDWARE_INTENT ─────────────────────────────────────
  {
    id: 'DOOR_HINGE_HARDWARE_INTENT',
    description: 'Door hinge/cabinet hardware → 8302',
    pattern: {
      anyOf: ['door hinge', 'butt hinge', 'cabinet hinge', 'piano hinge', 'concealed hinge',
               'cabinet knob', 'drawer knob', 'furniture knob', 'cupboard knob',
               'cabinet handle', 'drawer handle', 'pull handle', 'bar handle'],
    },
    inject: [{ prefix: '8302.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['83'] },
    boosts: [{ delta: 0.70, chapterMatch: '83' }],
  },

  // ── Rule 359: VALVE_FITTING_INTENT ───────────────────────────────────────────
  {
    id: 'VALVE_FITTING_INTENT',
    description: 'Valve/pipe fitting → 8481',
    pattern: {
      anyOf: ['valve', 'ball valve', 'gate valve', 'check valve', 'solenoid valve',
               'pipe fitting', 'elbow fitting', 'tee fitting', 'reducer fitting'],
    },
    inject: [{ prefix: '8481.', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8481.' }],
  },

  // ── Rule 360: SOLAR_CHARGER_INVERTER_INTENT ──────────────────────────────────
  {
    id: 'SOLAR_CHARGER_INVERTER_INTENT',
    description: 'Solar charger/power inverter → 8504.40',
    pattern: {
      anyOf: ['solar charger', 'solar power bank', 'portable solar charger',
               'inverter', 'power inverter', 'solar inverter', 'dc ac inverter', 'ups inverter'],
    },
    inject: [{ prefix: '8504.40', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8504.' }],
  },

  // ── Rule 361: CAMP_CHAIR_TABLE_INTENT ────────────────────────────────────────
  {
    id: 'CAMP_CHAIR_TABLE_INTENT',
    description: 'Camping chair/table → 9401.79',
    pattern: {
      anyOf: ['camp chair', 'folding chair', 'camping chair', 'collapsible chair',
               'camp table', 'folding table', 'camping table', 'portable table'],
    },
    inject: [{ prefix: '9401.79', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 362: WATER_FILTER_INTENT ────────────────────────────────────────────
  {
    id: 'WATER_FILTER_INTENT',
    description: 'Water filter/purifier → 8421.21',
    pattern: {
      anyOf: ['water filter', 'water purifier', 'camping filter', 'filter straw',
               'under sink filter', 'reverse osmosis', 'countertop filter',
               'water pitcher filter', 'brita filter'],
    },
    inject: [{ prefix: '8421.21', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '8421.' }],
  },

  // ── Rule 363: HEADLAMP_INTENT ─────────────────────────────────────────────────
  {
    id: 'HEADLAMP_INTENT',
    description: 'Headlamp/head torch → 8513.10',
    pattern: {
      anyOf: ['headlamp', 'head torch', 'head flashlight', 'led headlamp', 'running headlamp',
               'rechargeable headlamp', 'mining headlamp'],
    },
    inject: [{ prefix: '8513.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8513.' }],
  },

  // ── Rule 364: FIRST_AID_KIT_INTENT ───────────────────────────────────────────
  {
    id: 'FIRST_AID_KIT_INTENT',
    description: 'First aid kit → 3005.90',
    pattern: {
      anyOf: ['first aid kit', 'emergency kit', 'medical kit', 'survival kit', 'trauma kit',
               'emergency blanket', 'mylar blanket', 'space blanket'],
    },
    inject: [{ prefix: '3005.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['30'] },
    boosts: [{ delta: 0.65, chapterMatch: '30' }],
  },

  // ── Rule 365: DISPOSABLE_TABLEWARE_INTENT ────────────────────────────────────
  {
    id: 'DISPOSABLE_TABLEWARE_INTENT',
    description: 'Disposable cups/plates → 3923.30',
    pattern: {
      anyOf: ['disposable cup', 'paper cup', 'plastic cup disposable',
               'disposable plate', 'paper plate', 'foam plate',
               'food tray', 'cafeteria tray', 'plastic tray disposable'],
    },
    inject: [
      { prefix: '3923.30', syntheticRank: 22 },
      { prefix: '4823.69', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.65, prefixMatch: '3923.' }],
  },

  // ── Rule 366: NAIL_FILE_TWEEZERS_INTENT ──────────────────────────────────────
  {
    id: 'NAIL_FILE_TWEEZERS_INTENT',
    description: 'Nail file/tweezers → 8214.20',
    pattern: {
      anyOf: ['nail file', 'emery board', 'nail buffer', 'nail care file',
               'tweezers', 'eyebrow tweezers', 'precision tweezers'],
    },
    inject: [{ prefix: '8214.20', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8214.' }],
  },

  // ── Rule 367: MAKEUP_MIRROR_INTENT ───────────────────────────────────────────
  {
    id: 'MAKEUP_MIRROR_INTENT',
    description: 'Makeup/vanity mirror → 7009.92',
    pattern: {
      anyOf: ['makeup mirror', 'vanity mirror', 'lighted mirror', 'magnifying mirror cosmetic',
               'led mirror', 'bathroom vanity mirror', 'tabletop mirror'],
    },
    inject: [{ prefix: '7009.92', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '7009.' }],
  },

  // ── Rule 368: CORRECTION_FLUID_INTENT ────────────────────────────────────────
  {
    id: 'CORRECTION_FLUID_INTENT',
    description: 'Correction fluid/tape → 3824.99',
    pattern: {
      anyOf: ['correction fluid', 'white-out', 'correction tape', 'liquid paper', 'tipp-ex'],
    },
    inject: [{ prefix: '3824.99', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3824.' }],
  },

  // ── Rule 369: RUBBER_STAMP_INTENT ────────────────────────────────────────────
  {
    id: 'RUBBER_STAMP_INTENT',
    description: 'Rubber stamp → 9611.00',
    pattern: {
      anyOf: ['rubber stamp', 'self-inking stamp', 'date stamp', 'office stamp',
               'ink stamp', 'custom stamp'],
    },
    inject: [{ prefix: '9611.00', syntheticRank: 22 }],
    boosts: [{ delta: 0.75, prefixMatch: '9611.' }],
  },

  // ── Rule 370: HIGHLIGHTER_PEN_INTENT ─────────────────────────────────────────
  {
    id: 'HIGHLIGHTER_PEN_INTENT',
    description: 'Highlighter pen/marker → 9608.20',
    pattern: {
      anyOf: ['highlighter', 'highlighter pen', 'fluorescent marker', 'text marker',
               'yellow marker', 'pink highlighter', 'chisel tip marker'],
    },
    inject: [{ prefix: '9608.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, chapterMatch: '96' }],
  },

  // ── Rule 371: STRETCH_WRAP_INTENT ─────────────────────────────────────────────
  {
    id: 'STRETCH_WRAP_INTENT',
    description: 'Stretch wrap/pallet wrap → 3920.10',
    pattern: {
      anyOf: ['stretch wrap', 'pallet wrap', 'stretch film', 'polyethylene wrap',
               'shrink wrap', 'shrink film', 'heat shrink wrap'],
    },
    inject: [{ prefix: '3920.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '3920.' }],
  },

  // ── Rule 372: ROPE_CORD_INTENT ────────────────────────────────────────────────
  {
    id: 'ROPE_CORD_INTENT',
    description: 'Rope/cord/paracord → 5607',
    pattern: {
      anyOf: ['nylon rope', 'polyester rope', 'braided rope', 'paracord', 'polypropylene rope',
               'bungee cord', 'elastic cord', 'shock cord', 'climbing rope', 'utility rope'],
    },
    inject: [{ prefix: '5607.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['56'] },
    boosts: [{ delta: 0.65, chapterMatch: '56' }],
  },

  // ── Rule 373: CUTLERY_SET_INTENT ─────────────────────────────────────────────
  {
    id: 'CUTLERY_SET_INTENT',
    description: 'Cutlery/flatware set → 8215.99',
    pattern: {
      anyOf: ['cutlery set', 'silverware set', 'flatware set', 'dinner set cutlery',
               'stainless cutlery', 'dinner fork', 'dinner knife', 'teaspoon set'],
    },
    inject: [{ prefix: '8215.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, chapterMatch: '82' }],
  },

  // ── Rule 374: GRANITE_MARBLE_INTENT ──────────────────────────────────────────
  {
    id: 'GRANITE_MARBLE_INTENT',
    description: 'Granite/marble/stone → 6802',
    pattern: {
      anyOf: ['granite tile', 'natural stone tile', 'marble tile', 'stone slab',
               'countertop granite', 'marble slab', 'travertine', 'slate tile'],
    },
    inject: [{ prefix: '6802.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['68'] },
    boosts: [{ delta: 0.70, chapterMatch: '68' }],
  },

  // ── Rule 375: CEMENT_CONCRETE_INTENT ─────────────────────────────────────────
  {
    id: 'CEMENT_CONCRETE_INTENT',
    description: 'Cement/concrete → 2523',
    pattern: {
      anyOf: ['cement', 'concrete', 'mortar', 'portland cement', 'ready mix cement',
               'concrete block', 'cinder block', 'cement board'],
    },
    inject: [{ prefix: '2523.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['25'] },
    boosts: [{ delta: 0.70, chapterMatch: '25' }],
  },

  // ── Rule 376: FIBERGLASS_COMPOSITE_INTENT ────────────────────────────────────
  {
    id: 'FIBERGLASS_COMPOSITE_INTENT',
    description: 'Fiberglass/composite panel → 7019',
    pattern: {
      anyOf: ['fiberglass', 'fibreglass', 'glass fiber', 'frp panel', 'composite panel',
               'carbon fiber', 'carbon fibre', 'kevlar fabric', 'fiberglass sheet'],
    },
    inject: [{ prefix: '7019.', syntheticRank: 22 }],
    whitelist: { allowChapters: ['70'] },
    boosts: [{ delta: 0.65, chapterMatch: '70' }],
  },

  // ── Rule 377: GARDEN_SPRAYER_INTENT ──────────────────────────────────────────
  {
    id: 'GARDEN_SPRAYER_INTENT',
    description: 'Garden sprayer/irrigation → 8424.41',
    pattern: {
      anyOf: ['irrigation system', 'drip irrigation', 'sprinkler system', 'soaker hose',
               'garden sprayer', 'pump sprayer', 'backpack sprayer', 'pesticide sprayer'],
    },
    inject: [{ prefix: '8424.41', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8424.' }],
  },

  // ── Rule 378: POLYESTER_FABRIC_INTENT ────────────────────────────────────────
  {
    id: 'POLYESTER_FABRIC_INTENT',
    description: 'Polyester/synthetic fabric → 5512/5407',
    pattern: {
      anyOf: ['polyester fabric', 'microfiber fabric', 'fleece fabric', 'nylon fabric',
               'synthetic fabric', 'knit fabric', 'woven polyester', 'polar fleece'],
    },
    inject: [
      { prefix: '5512.', syntheticRank: 22 },
      { prefix: '5407.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['55', '54'] },
    boosts: [{ delta: 0.60, chapterMatch: '55' }],
  },

  // ── Rule 379: LACE_VELVET_FABRIC_INTENT ──────────────────────────────────────
  {
    id: 'LACE_VELVET_FABRIC_INTENT',
    description: 'Lace/velvet/denim fabric → 5804/5801/5209',
    pattern: {
      anyOf: ['lace fabric', 'cotton lace', 'guipure lace', 'stretch lace',
               'velvet fabric', 'velour fabric', 'plush fabric',
               'denim fabric', 'denim cloth', 'jean fabric', 'indigo denim'],
    },
    inject: [
      { prefix: '5804.', syntheticRank: 22 },
      { prefix: '5801.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['58', '52'] },
    boosts: [{ delta: 0.60, chapterMatch: '58' }],
  },

  // ── Rule 380: MECHANICAL_WATCH_INTENT ────────────────────────────────────────
  {
    id: 'MECHANICAL_WATCH_INTENT',
    description: 'Mechanical/automatic watch → 9101/9102',
    pattern: {
      anyOf: ['mechanical watch', 'automatic watch', 'self-winding watch', 'luxury watch',
               'quartz watch', 'analog quartz', 'dress watch', 'chronograph watch'],
    },
    inject: [
      { prefix: '9102.', syntheticRank: 22 },
      { prefix: '9101.', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['91'] },
    boosts: [{ delta: 0.70, chapterMatch: '91' }],
  },

  // ── Rule 381: KEYBOARD_SYNTHESIZER_INTENT ────────────────────────────────────
  {
    id: 'KEYBOARD_SYNTHESIZER_INTENT',
    description: 'Electronic keyboard/synthesizer → 9207.10',
    pattern: {
      anyOf: ['musical keyboard', 'electronic keyboard', 'digital piano keyboard', 'midi keyboard',
               'synthesizer', 'synth', 'analog synthesizer', 'digital synthesizer'],
    },
    inject: [{ prefix: '9207.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, chapterMatch: '92' }],
  },

  // ── Rule 382: ACCORDION_HARMONICA_INTENT ─────────────────────────────────────
  {
    id: 'ACCORDION_HARMONICA_INTENT',
    description: 'Accordion/harmonica → 9205.20',
    pattern: {
      anyOf: ['accordion', 'piano accordion', 'button accordion', 'squeezebox',
               'harmonica', 'mouth organ', 'blues harp', 'diatonic harmonica'],
    },
    inject: [{ prefix: '9205.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, chapterMatch: '92' }],
  },

  // ── Rule 383: MUSIC_BOX_INTENT ────────────────────────────────────────────────
  {
    id: 'MUSIC_BOX_INTENT',
    description: 'Music box → 9208.10',
    pattern: {
      anyOf: ['music box', 'musical box', 'wind-up music box', 'decorative music box',
               'carousel music box'],
    },
    inject: [{ prefix: '9208.10', syntheticRank: 22 }],
    whitelist: { allowPrefixes: ['9208.'] },
    boosts: [{ delta: 0.75, prefixMatch: '9208.' }],
  },

  // ── Rule 384: TRADING_CARD_INTENT ────────────────────────────────────────────
  {
    id: 'TRADING_CARD_INTENT',
    description: 'Trading card / collectible card game → 4911.91 printed matter or 9504.40 playing cards',
    pattern: {
      // "card" must be present; plus at least one signal that it's a collectible/game card
      required: ['card'],
      anyOf: [
        'trading', 'pokemon', 'pikachu', 'charizard', 'eevee',
        'yugioh', 'ygo', 'mtg', 'magic', 'gathering', 'tcg',
        'collectible', 'sports', 'baseball', 'basketball', 'football',
        'hockey', 'soccer', 'nfl', 'nba', 'nhl', 'mlb',
      ],
    },
    inject: [
      { prefix: '4911.91', syntheticRank: 22 },
      { prefix: '9504.40', syntheticRank: 24 },
    ],
    whitelist: { allowChapters: ['49', '95'] },
    boosts: [
      { delta: 0.65, prefixMatch: '4911.' },
      { delta: 0.55, prefixMatch: '9504.40' },
    ],
  },

  // ── Rule 385: MODEL_KIT_INTENT ────────────────────────────────────────────────
  {
    id: 'MODEL_KIT_INTENT',
    description: 'Model kit/scale model → 9503.00',
    pattern: {
      anyOf: ['model kit', 'plastic model kit', 'scale model', 'gundam kit',
               'miniature model', 'model airplane', 'model car kit', 'model ship'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9503.' }],
  },

  // ── Rule 386: VINYL_FIGURE_INTENT ────────────────────────────────────────────
  {
    id: 'VINYL_FIGURE_INTENT',
    description: 'Vinyl figure/collectible → 9503.00',
    pattern: {
      anyOf: ['vinyl figure', 'pop figure', 'funko pop', 'collectible figure',
               'vinyl toy', 'designer toy', 'blind box figure'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9503.' }],
  },

  // ── Rule 387: GOLD_COIN_INTENT ────────────────────────────────────────────────
  {
    id: 'GOLD_COIN_INTENT',
    description: 'Gold/silver coin/bullion → 7108.13',
    pattern: {
      anyOf: ['gold coin', 'silver coin', 'commemorative coin', 'bullion coin',
               'numismatic coin', 'gold bar', 'silver bar', 'bullion'],
    },
    inject: [
      { prefix: '7108.13', syntheticRank: 22 },
      { prefix: '7106.92', syntheticRank: 26 },
    ],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.70, chapterMatch: '71' }],
  },

  // ── Rule 388: ANGLE_GRINDER_INTENT ───────────────────────────────────────────
  {
    id: 'ANGLE_GRINDER_INTENT',
    description: 'Angle grinder/jigsaw/power tool → 8467',
    pattern: {
      anyOf: ['angle grinder', 'disc grinder', 'bench grinder', 'hand grinder',
               'jigsaw', 'jig saw', 'reciprocating saw', 'scroll saw',
               'nail gun', 'brad nailer', 'framing nailer', 'pneumatic nailer'],
    },
    inject: [{ prefix: '8467.', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8467.' }],
  },

  // ── Rule 389: LEVEL_STUD_FINDER_INTENT ───────────────────────────────────────
  {
    id: 'LEVEL_STUD_FINDER_INTENT',
    description: 'Spirit level/stud finder → 9017/8479',
    pattern: {
      anyOf: ['level tool', 'spirit level', 'bubble level', 'laser level', 'torpedo level',
               'stud finder', 'wall scanner', 'electronic stud finder'],
    },
    inject: [
      { prefix: '9017.', syntheticRank: 22 },
      { prefix: '8479.89', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.60, chapterMatch: '90' }],
  },

  // ── Rule 390: WIND_CHIME_DECOR_INTENT ────────────────────────────────────────
  {
    id: 'WIND_CHIME_DECOR_INTENT',
    description: 'Wind chime/dreamcatcher → 4420.90/6307.90',
    pattern: {
      anyOf: ['wind chime', 'garden chime', 'outdoor chime', 'hanging chime',
               'dreamcatcher', 'dream catcher', 'boho decor', 'wall hanging dreamcatcher'],
    },
    inject: [
      { prefix: '4420.90', syntheticRank: 22 },
      { prefix: '6307.90', syntheticRank: 26 },
    ],
    boosts: [{ delta: 0.55, prefixMatch: '4420.' }],
  },

  // ── Rule 391: CASH_REGISTER_POS_INTENT ───────────────────────────────────────
  {
    id: 'CASH_REGISTER_POS_INTENT',
    description: 'Cash register/POS terminal → 8470.50',
    pattern: {
      anyOf: ['cash register', 'pos terminal', 'point of sale', 'retail register',
               'receipt printer', 'barcode scanner', 'cash drawer'],
    },
    inject: [{ prefix: '8470.50', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8470.' }],
  },

  // ── Rule 392: LAMINATOR_INTENT ────────────────────────────────────────────────
  {
    id: 'LAMINATOR_INTENT',
    description: 'Laminator/document machine → 8472.90',
    pattern: {
      anyOf: ['laminator', 'laminating machine', 'document laminator', 'photo laminator',
               'paper shredder', 'office shredder', 'document shredder', 'micro cut shredder'],
    },
    inject: [{ prefix: '8472.90', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8472.' }],
  },

  // ── Rule 393: BLUE_LIGHT_GLASSES_INTENT ──────────────────────────────────────
  {
    id: 'BLUE_LIGHT_GLASSES_INTENT',
    description: 'Blue light/computer glasses → 9004.10',
    pattern: {
      anyOf: ['blue light glasses', 'computer glasses', 'anti-blue light', 'screen glasses',
               'night driving glasses', 'anti-glare glasses', 'yellow lens glasses'],
    },
    inject: [{ prefix: '9004.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '9004.' }],
  },

  // ── Rule 394: LINT_ROLLER_INTENT ─────────────────────────────────────────────
  {
    id: 'LINT_ROLLER_INTENT',
    description: 'Lint roller/clothes steamer → 8509.80',
    pattern: {
      anyOf: ['lint roller', 'lint brush', 'fabric roller', 'clothes roller',
               'clothes steamer', 'garment steamer', 'handheld steamer', 'fabric steamer'],
    },
    inject: [{ prefix: '8509.80', syntheticRank: 22 }],
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 395: SHOE_POLISH_INTENT ─────────────────────────────────────────────
  {
    id: 'SHOE_POLISH_INTENT',
    description: 'Shoe polish/shoe care → 3405.10',
    pattern: {
      anyOf: ['shoe polish', 'boot polish', 'leather polish', 'shoe shine', 'shoe wax',
               'shoe cleaner', 'sneaker cleaner', 'shoe care kit'],
    },
    inject: [{ prefix: '3405.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '3405.' }],
  },

  // ── Rule 396: SHOE_INSOLE_INTENT ─────────────────────────────────────────────
  {
    id: 'SHOE_INSOLE_INTENT',
    description: 'Shoe insole/arch support → 6406.10',
    pattern: {
      anyOf: ['shoe insert', 'insole', 'foot insole', 'arch support', 'orthotic insole',
               'gel insole', 'memory foam insole'],
    },
    inject: [{ prefix: '6406.10', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '6406.' }],
  },

  // ── Rule 397: FEDORA_HAT_INTENT ───────────────────────────────────────────────
  {
    id: 'FEDORA_HAT_INTENT',
    description: 'Fedora/straw/wide brim hat → 6504.00',
    pattern: {
      anyOf: ['fedora', 'felt hat', 'straw hat', 'panama hat', 'wide brim hat',
               'bucket hat', 'fisherman hat', 'sun hat', 'boonie hat'],
    },
    inject: [{ prefix: '6504.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['65'] },
    boosts: [{ delta: 0.65, chapterMatch: '65' }],
  },

  // ── Rule 398: CLUTCH_BAG_INTENT ───────────────────────────────────────────────
  {
    id: 'CLUTCH_BAG_INTENT',
    description: 'Clutch bag/crossbody bag → 4202.22',
    pattern: {
      anyOf: ['clutch bag', 'clutch purse', 'evening clutch', 'envelope clutch', 'wristlet',
               'crossbody bag', 'crossbody purse', 'sling bag', 'shoulder crossbody'],
    },
    inject: [{ prefix: '4202.22', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, chapterMatch: '42' }],
  },

  // ── Rule 399: ANKLET_BODY_JEWELRY_INTENT ─────────────────────────────────────
  {
    id: 'ANKLET_BODY_JEWELRY_INTENT',
    description: 'Anklet/body piercing jewelry → 7117.19',
    pattern: {
      anyOf: ['anklet', 'ankle bracelet', 'foot jewelry', 'ankle chain',
               'body piercing', 'nose ring', 'belly button ring', 'septum ring',
               'cartilage ring', 'body jewelry'],
    },
    inject: [{ prefix: '7117.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.65, chapterMatch: '71' }],
  },

  // ── Rule 400: PICTURE_FRAME_DECOR_INTENT ─────────────────────────────────────
  {
    id: 'PICTURE_FRAME_DECOR_INTENT',
    description: 'Picture frame/photo frame → 4414.00',
    pattern: {
      anyOf: ['picture frame', 'photo frame', 'wall frame', 'art frame', 'shadow box',
               'collage frame', 'floating frame'],
    },
    inject: [{ prefix: '4414.00', syntheticRank: 22 }],
    boosts: [{ delta: 0.70, prefixMatch: '4414.' }],
  },

  // ── Rule 401: LEGGINGS_INTENT ────────────────────────────────────────────────
  {
    id: 'LEGGINGS_INTENT',
    description: 'Leggings/yoga pants/compression tights → ch.61 (6104.63)',
    pattern: {
      anyOf: ['leggings', 'yoga pants', 'compression tights', 'running tights',
               'workout leggings', 'athletic leggings', 'tight pants'],
    },
    inject: [{ prefix: '6104.63', syntheticRank: 22 }],
    whitelist: { allowChapters: ['61'] },
    boosts: [{ delta: 0.60, chapterMatch: '61' }],
  },

  // ── Rule 402: RAIN_JACKET_INTENT ─────────────────────────────────────────────
  {
    id: 'RAIN_JACKET_INTENT',
    description: 'Rain jacket/raincoat/windbreaker → ch.61/62 (6210.xx)',
    pattern: {
      anyOf: ['rain jacket', 'raincoat', 'waterproof jacket', 'windbreaker jacket',
               'rain shell', 'waterproof shell', 'waterproof coat', 'gore-tex jacket'],
    },
    inject: [{ prefix: '6210.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['61', '62'] },
    boosts: [{ delta: 0.55, prefixMatch: '6210.' }],
  },

  // ── Rule 403: PUFFER_JACKET_INTENT ───────────────────────────────────────────
  {
    id: 'PUFFER_JACKET_INTENT',
    description: 'Puffer jacket/down jacket/quilted jacket → ch.61/62 (6201.xx)',
    pattern: {
      anyOf: ['puffer jacket', 'down jacket', 'quilted jacket', 'puffer coat',
               'down coat', 'insulated jacket', 'bubble jacket', 'puffer vest'],
    },
    inject: [{ prefix: '6201.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['61', '62'] },
    boosts: [{ delta: 0.55, prefixMatch: '6201.' }],
  },

  // ── Rule 404: SWIMWEAR_INTENT ─────────────────────────────────────────────────
  {
    id: 'SWIMWEAR_INTENT',
    description: 'Swimsuit/bikini/swim trunks → ch.61 (6112.xx)',
    pattern: {
      anyOf: ['swimsuit', 'bathing suit', 'swimwear', 'bikini', 'swim trunks',
               'tankini', 'one piece swimsuit', 'board shorts', 'swim wear'],
    },
    inject: [{ prefix: '6112.41', syntheticRank: 22 }],
    whitelist: { allowChapters: ['61', '62'] },
    boosts: [{ delta: 0.60, prefixMatch: '6112.' }],
  },

  // ── Rule 405: HOODIE_SWEATSHIRT_INTENT ───────────────────────────────────────
  {
    id: 'HOODIE_SWEATSHIRT_INTENT',
    description: 'Hoodie/sweatshirt → ch.61 (6110.20)',
    pattern: {
      anyOf: ['hoodie', 'pullover hoodie', 'zip up hoodie', 'sweatshirt hoodie',
               'fleece hoodie', 'athletic hoodie', 'crewneck sweatshirt'],
    },
    inject: [{ prefix: '6110.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['61'] },
    boosts: [{ delta: 0.55, chapterMatch: '61' }],
  },

  // ── Rule 406: TV_STAND_FURNITURE_INTENT ──────────────────────────────────────
  {
    id: 'TV_STAND_FURNITURE_INTENT',
    description: 'TV stand/media console/entertainment center → ch.94 (9403.xx)',
    pattern: {
      anyOf: ['tv stand', 'media console', 'entertainment center', 'tv cabinet',
               'tv unit', 'media stand', 'entertainment unit', 'television stand'],
    },
    inject: [{ prefix: '9403.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 407: SHOE_RACK_FURNITURE_INTENT ─────────────────────────────────────
  {
    id: 'SHOE_RACK_FURNITURE_INTENT',
    description: 'Shoe rack/shoe shelf/shoe organizer → ch.94 (9403.xx)',
    pattern: {
      anyOf: ['shoe rack', 'shoe shelf', 'shoe organizer', 'shoe cabinet',
               'boot rack', 'shoe storage', 'entryway shoe rack'],
    },
    inject: [{ prefix: '9403.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 408: WARDROBE_FURNITURE_INTENT ──────────────────────────────────────
  {
    id: 'WARDROBE_FURNITURE_INTENT',
    description: 'Wardrobe/armoire/closet furniture → ch.94 (9403.xx)',
    pattern: {
      anyOf: ['wardrobe', 'armoire', 'clothes cabinet', 'freestanding wardrobe',
               'closet wardrobe', 'sliding wardrobe', 'clothes closet'],
    },
    inject: [{ prefix: '9403.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 409: COFFEE_TABLE_FURNITURE_INTENT ───────────────────────────────────
  {
    id: 'COFFEE_TABLE_FURNITURE_INTENT',
    description: 'Coffee table/center table/cocktail table → ch.94 (9403.30)',
    pattern: {
      anyOf: ['coffee table', 'center table', 'cocktail table', 'trunk coffee table',
               'lounge table', 'living room table'],
    },
    inject: [{ prefix: '9403.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 410: RECLINER_CHAIR_INTENT ──────────────────────────────────────────
  {
    id: 'RECLINER_CHAIR_INTENT',
    description: 'Recliner/rocker recliner/armchair → ch.94 (9401.xx)',
    pattern: {
      anyOf: ['recliner', 'recliner chair', 'power recliner', 'rocker recliner',
               'armchair', 'accent chair', 'barrel chair', 'wingback chair'],
    },
    inject: [{ prefix: '9401.61', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 411: BAR_STOOL_FURNITURE_INTENT ─────────────────────────────────────
  {
    id: 'BAR_STOOL_FURNITURE_INTENT',
    description: 'Bar stool/counter stool/kitchen stool → ch.94 (9401.xx)',
    pattern: {
      anyOf: ['bar stool', 'counter stool', 'kitchen stool', 'swivel bar stool',
               'breakfast bar stool', 'island stool'],
    },
    inject: [{ prefix: '9401.69', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 412: BABY_SWING_INTENT ───────────────────────────────────────────────
  {
    id: 'BABY_SWING_INTENT',
    description: 'Baby swing/infant swing/baby bouncer → ch.94 (9401.xx)',
    pattern: {
      anyOf: ['baby swing', 'infant swing', 'baby bouncer', 'baby rocker',
               'electric baby swing', 'portable baby swing', 'baby bouncer swing'],
    },
    inject: [{ prefix: '9401.69', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 413: HIGH_CHAIR_INTENT ───────────────────────────────────────────────
  {
    id: 'HIGH_CHAIR_INTENT',
    description: 'Baby high chair/feeding chair → ch.94 (9401.xx)',
    pattern: {
      anyOf: ['high chair', 'baby high chair', 'feeding high chair',
               'convertible high chair', 'booster feeding seat'],
    },
    inject: [{ prefix: '9401.69', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 414: BABY_STROLLER_INTENT ───────────────────────────────────────────
  {
    id: 'BABY_STROLLER_INTENT',
    description: 'Baby stroller/pram/pushchair → ch.87 (8715.00)',
    pattern: {
      anyOf: ['stroller', 'baby stroller', 'pram', 'baby pram',
               'jogging stroller', 'umbrella stroller', 'pushchair', 'travel system'],
    },
    inject: [{ prefix: '8715.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['87'] },
    boosts: [{ delta: 0.70, prefixMatch: '8715.' }],
  },

  // ── Rule 415: CAR_SEAT_CHILD_INTENT ──────────────────────────────────────────
  {
    id: 'CAR_SEAT_CHILD_INTENT',
    description: 'Child car seat/infant car seat → ch.94 (9401.20)',
    pattern: {
      anyOf: ['car seat', 'infant car seat', 'booster car seat', 'convertible car seat',
               'toddler car seat', 'child car seat'],
    },
    inject: [{ prefix: '9401.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9401.20' }],
  },

  // ── Rule 416: BABY_MONITOR_INTENT ────────────────────────────────────────────
  {
    id: 'BABY_MONITOR_INTENT',
    description: 'Baby monitor/video baby monitor → ch.85 (8525.xx)',
    pattern: {
      anyOf: ['baby monitor', 'video baby monitor', 'audio baby monitor',
               'smart baby monitor', 'wifi baby camera', 'baby cam'],
    },
    inject: [{ prefix: '8525.89', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 417: RC_CAR_TOY_INTENT ───────────────────────────────────────────────
  {
    id: 'RC_CAR_TOY_INTENT',
    description: 'Remote control car/RC car toy → ch.95 (9503.00)',
    pattern: {
      anyOf: ['remote control car', 'rc car', 'radio controlled car',
               'remote car toy', '4wd rc car', 'drift rc car', 'toy rc car'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 418: TOY_DRONE_INTENT ────────────────────────────────────────────────
  {
    id: 'TOY_DRONE_INTENT',
    description: 'Toy drone/kids drone/mini quadcopter → ch.95 (9503.00)',
    pattern: {
      anyOf: ['toy drone', 'kids drone', 'mini quadcopter toy', 'beginner drone toy',
               'indoor drone toy', 'nano drone', 'quadcopter toy'],
      noneOf: ['professional', 'commercial', 'fpv racing', 'photography drone'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 419: BOARD_GAME_INTENT ───────────────────────────────────────────────
  {
    id: 'BOARD_GAME_INTENT',
    description: 'Board game/tabletop game → ch.95 (9504.90)',
    pattern: {
      anyOf: ['board game', 'family board game', 'strategy board game',
               'tabletop game', 'party board game', 'cooperative game'],
    },
    inject: [{ prefix: '9504.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9504.' }],
  },

  // ── Rule 420: JIGSAW_PUZZLE_INTENT ────────────────────────────────────────────
  {
    id: 'JIGSAW_PUZZLE_INTENT',
    description: 'Jigsaw puzzle/floor puzzle → ch.95 (9503.00)',
    pattern: {
      anyOf: ['puzzle', 'jigsaw puzzle', '1000 piece puzzle', 'wooden puzzle',
               '500 piece puzzle', 'floor puzzle', '3d puzzle', 'jigsaw'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 421: DOLL_TOY_INTENT ─────────────────────────────────────────────────
  {
    id: 'DOLL_TOY_INTENT',
    description: 'Doll/baby doll/fashion doll → ch.95 (9502.10)',
    pattern: {
      anyOf: ['doll', 'fashion doll', 'baby doll toy', 'rag doll', 'porcelain doll',
               'barbie type doll', 'collectible doll'],
    },
    inject: [{ prefix: '9502.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9502.' }],
  },

  // ── Rule 422: STUFFED_ANIMAL_INTENT ──────────────────────────────────────────
  {
    id: 'STUFFED_ANIMAL_INTENT',
    description: 'Stuffed animal/plush toy/teddy bear → ch.95 (9503.00)',
    pattern: {
      anyOf: ['stuffed animal', 'plush toy animal', 'teddy bear', 'plush stuffed animal',
               'soft toy animal', 'stuffed bear', 'plush animal'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 423: FOUNTAIN_PEN_INTENT ─────────────────────────────────────────────
  {
    id: 'FOUNTAIN_PEN_INTENT',
    description: 'Fountain pen/calligraphy pen → ch.96 (9608.10)',
    pattern: {
      anyOf: ['fountain pen', 'ink pen calligraphy', 'nib pen', 'refillable fountain pen',
               'calligraphy fountain pen'],
    },
    inject: [{ prefix: '9608.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, prefixMatch: '9608.' }],
  },

  // ── Rule 424: MECHANICAL_PENCIL_INTENT ────────────────────────────────────────
  {
    id: 'MECHANICAL_PENCIL_INTENT',
    description: 'Mechanical pencil/propelling pencil → ch.96 (9608.40)',
    pattern: {
      anyOf: ['mechanical pencil', 'propelling pencil', 'automatic pencil',
               'click pencil', 'drafting mechanical pencil'],
    },
    inject: [{ prefix: '9608.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, prefixMatch: '9608.40' }],
  },

  // ── Rule 425: WHITEBOARD_MARKER_INTENT ────────────────────────────────────────
  {
    id: 'WHITEBOARD_MARKER_INTENT',
    description: 'Whiteboard marker/dry erase marker → ch.96 (9608.20)',
    pattern: {
      anyOf: ['whiteboard marker', 'dry erase marker', 'board marker',
               'erasable whiteboard marker', 'expo type marker'],
    },
    inject: [{ prefix: '9608.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, prefixMatch: '9608.20' }],
  },

  // ── Rule 426: SETTING_SPRAY_COSMETIC_INTENT ───────────────────────────────────
  {
    id: 'SETTING_SPRAY_COSMETIC_INTENT',
    description: 'Setting spray/makeup fixer → ch.33 (3304.99)',
    pattern: {
      anyOf: ['setting spray', 'makeup setting spray', 'face mist spray',
               'finishing spray', 'makeup fixer spray'],
    },
    inject: [{ prefix: '3304.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 427: MASCARA_COSMETIC_INTENT ────────────────────────────────────────
  {
    id: 'MASCARA_COSMETIC_INTENT',
    description: 'Mascara/lengthening mascara → ch.33 (3304.20)',
    pattern: {
      anyOf: ['mascara', 'lengthening mascara', 'volumizing mascara',
               'waterproof mascara', 'tubing mascara', 'fiber mascara'],
    },
    inject: [{ prefix: '3304.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.70, prefixMatch: '3304.20' }],
  },

  // ── Rule 428: EYE_COSMETIC_INTENT ────────────────────────────────────────────
  {
    id: 'EYE_COSMETIC_INTENT',
    description: 'Eyebrow pencil/eyeshadow/eye liner → ch.33 (3304.20)',
    pattern: {
      anyOf: ['eyebrow pencil', 'brow pencil', 'eyebrow pen', 'brow definer pencil',
               'eyeshadow', 'eyeshadow palette', 'eye shadow', 'eye liner'],
    },
    inject: [{ prefix: '3304.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 429: LIP_PRODUCT_INTENT ─────────────────────────────────────────────
  {
    id: 'LIP_PRODUCT_INTENT',
    description: 'Lip liner/lip balm/lip gloss → ch.33 (3304.10)',
    pattern: {
      anyOf: ['lip liner', 'lipliner pencil', 'lip contour pencil',
               'lip balm', 'chapstick', 'tinted lip balm', 'lip butter',
               'lip gloss', 'lip color', 'lip plumper'],
    },
    inject: [{ prefix: '3304.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, prefixMatch: '3304.10' }],
  },

  // ── Rule 430: NAIL_POLISH_COSMETIC_INTENT ─────────────────────────────────────
  {
    id: 'NAIL_POLISH_COSMETIC_INTENT',
    description: 'Nail polish/nail lacquer/gel nail → ch.33 (3304.30)',
    pattern: {
      anyOf: ['nail polish', 'nail lacquer', 'gel nail polish', 'nail varnish',
               'nail color', 'nail enamel'],
    },
    inject: [{ prefix: '3304.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.70, prefixMatch: '3304.30' }],
  },

  // ── Rule 431: BRONZER_BLUSH_INTENT ────────────────────────────────────────────
  {
    id: 'BRONZER_BLUSH_INTENT',
    description: 'Bronzer/blush/contouring → ch.33 (3304.91)',
    pattern: {
      anyOf: ['bronzer', 'face bronzer', 'contouring bronzer',
               'blush', 'cheek blush', 'powder blush', 'cream blush', 'blusher'],
    },
    inject: [{ prefix: '3304.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 432: FALSE_LASHES_INTENT ─────────────────────────────────────────────
  {
    id: 'FALSE_LASHES_INTENT',
    description: 'False lashes/fake eyelashes → ch.67 (6704.00)',
    pattern: {
      anyOf: ['false lashes', 'fake eyelashes', 'strip lashes',
               'individual lashes', 'magnetic lashes', 'lash kit'],
    },
    inject: [{ prefix: '6704.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['67'] },
    boosts: [{ delta: 0.75, prefixMatch: '6704.' }],
  },

  // ── Rule 433: KNEE_BRACE_SUPPORT_INTENT ──────────────────────────────────────
  {
    id: 'KNEE_BRACE_SUPPORT_INTENT',
    description: 'Knee brace/knee support/ankle brace → ch.90 (9021.10)',
    pattern: {
      anyOf: ['knee brace', 'knee support', 'knee stabilizer', 'patella brace',
               'knee sleeve', 'ankle brace', 'ankle support brace', 'ankle stabilizer',
               'wrist brace', 'wrist support brace', 'back brace', 'lumbar brace'],
    },
    inject: [{ prefix: '9021.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9021.' }],
  },

  // ── Rule 434: HEATING_PAD_INTENT ─────────────────────────────────────────────
  {
    id: 'HEATING_PAD_INTENT',
    description: 'Heating pad/electric heat pad → ch.85 (8516.79)',
    pattern: {
      anyOf: ['heating pad', 'electric heating pad', 'heat therapy pad',
               'heat wrap pad', 'far infrared pad', 'warming pad'],
    },
    inject: [{ prefix: '8516.79', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 435: TENS_EMS_INTENT ─────────────────────────────────────────────────
  {
    id: 'TENS_EMS_INTENT',
    description: 'TENS unit/EMS device/muscle stimulator → ch.90 (9018.90)',
    pattern: {
      anyOf: ['tens unit', 'tens machine', 'electrical muscle stimulator',
               'ems device', 'pain relief tens', 'nerve stimulator', 'ems machine'],
    },
    inject: [{ prefix: '9018.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9018.' }],
  },

  // ── Rule 436: BLOOD_PRESSURE_MONITOR_INTENT ───────────────────────────────────
  {
    id: 'BLOOD_PRESSURE_MONITOR_INTENT',
    description: 'Blood pressure monitor/BP cuff → ch.90 (9018.19)',
    pattern: {
      anyOf: ['blood pressure monitor', 'bp monitor', 'blood pressure cuff',
               'digital bp machine', 'home bp monitor', 'sphygmomanometer'],
    },
    inject: [{ prefix: '9018.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9018.' }],
  },

  // ── Rule 437: PULSE_OXIMETER_INTENT ──────────────────────────────────────────
  {
    id: 'PULSE_OXIMETER_INTENT',
    description: 'Pulse oximeter/oxygen monitor → ch.90 (9018.19)',
    pattern: {
      anyOf: ['pulse oximeter', 'oxygen monitor', 'blood oxygen meter',
               'spo2 monitor', 'fingertip pulse oximeter', 'fingertip oximeter'],
    },
    inject: [{ prefix: '9018.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9018.' }],
  },

  // ── Rule 438: STETHOSCOPE_INTENT ─────────────────────────────────────────────
  {
    id: 'STETHOSCOPE_INTENT',
    description: 'Stethoscope → ch.90 (9018.19)',
    pattern: {
      anyOf: ['stethoscope', 'medical stethoscope', 'cardiology stethoscope',
               'nurse stethoscope', 'acoustic stethoscope'],
    },
    inject: [{ prefix: '9018.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9018.19' }],
  },

  // ── Rule 439: PROJECTOR_INTENT ────────────────────────────────────────────────
  {
    id: 'PROJECTOR_INTENT',
    description: 'Projector/video projector → ch.90 (9008.60)',
    pattern: {
      anyOf: ['projector', 'video projector', 'lcd projector', 'dlp projector',
               'mini projector', 'portable projector', 'laser projector'],
    },
    inject: [{ prefix: '9008.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9008.' }],
  },

  // ── Rule 440: BARCODE_SCANNER_INTENT ─────────────────────────────────────────
  {
    id: 'BARCODE_SCANNER_INTENT',
    description: 'Barcode scanner/QR scanner → ch.84 (8471.90)',
    pattern: {
      anyOf: ['barcode scanner', 'barcode reader', 'qr code scanner', 'handheld scanner',
               'laser barcode scanner', 'pos scanner', 'barcode gun'],
    },
    inject: [{ prefix: '8471.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8471.' }],
  },

  // ── Rule 441: LABEL_MAKER_INTENT ──────────────────────────────────────────────
  {
    id: 'LABEL_MAKER_INTENT',
    description: 'Label maker/label printer → ch.84 (8472.90)',
    pattern: {
      anyOf: ['label maker', 'label machine', 'dymo type label', 'thermal label writer',
               'tape label maker', 'embossing label maker'],
    },
    inject: [{ prefix: '8472.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8472.' }],
  },

  // ── Rule 442: ROBOT_VACUUM_INTENT ─────────────────────────────────────────────
  {
    id: 'ROBOT_VACUUM_INTENT',
    description: 'Robot vacuum/robotic vacuum cleaner → ch.85 (8508.11)',
    pattern: {
      anyOf: ['robot vacuum', 'robotic vacuum', 'auto vacuum robot',
               'self emptying robot vacuum', 'vacuum robot mop', 'roomba type'],
    },
    inject: [{ prefix: '8508.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8508.' }],
  },

  // ── Rule 443: AIR_PURIFIER_INTENT ─────────────────────────────────────────────
  {
    id: 'AIR_PURIFIER_INTENT',
    description: 'Air purifier/HEPA air cleaner → ch.84 (8421.39)',
    pattern: {
      anyOf: ['air purifier', 'hepa air purifier', 'room air purifier',
               'desktop air purifier', 'air cleaner', 'ionic air purifier', 'hepa filter air'],
    },
    inject: [{ prefix: '8421.39', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8421.' }],
  },

  // ── Rule 444: SMART_PLUG_INTENT ────────────────────────────────────────────────
  {
    id: 'SMART_PLUG_INTENT',
    description: 'Smart plug/wifi plug/smart outlet → ch.85 (8536.69)',
    pattern: {
      anyOf: ['smart plug', 'wifi plug', 'smart outlet', 'wifi smart switch',
               'smart power strip', 'timer plug', 'energy monitor plug'],
    },
    inject: [{ prefix: '8536.69', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 445: SMART_BULB_INTENT ────────────────────────────────────────────────
  {
    id: 'SMART_BULB_INTENT',
    description: 'Smart bulb/wifi light bulb/color changing bulb → ch.85 (8539.xx)',
    pattern: {
      anyOf: ['smart bulb', 'led smart bulb', 'wifi light bulb', 'color changing bulb',
               'smart light bulb', 'dimmable smart bulb', 'tunable bulb'],
    },
    inject: [{ prefix: '8539.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 446: GARDEN_HOSE_INTENT ──────────────────────────────────────────────
  {
    id: 'GARDEN_HOSE_INTENT',
    description: 'Garden hose/water hose → ch.39 (3917.32)',
    pattern: {
      anyOf: ['garden hose', 'water hose', 'expandable garden hose',
               'flat hose', 'retractable garden hose', 'hose pipe'],
    },
    inject: [{ prefix: '3917.32', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.65, prefixMatch: '3917.' }],
  },

  // ── Rule 447: SPRINKLER_INTENT ────────────────────────────────────────────────
  {
    id: 'SPRINKLER_INTENT',
    description: 'Garden sprinkler/lawn sprinkler → ch.84 (8424.41)',
    pattern: {
      anyOf: ['sprinkler', 'garden sprinkler', 'oscillating sprinkler',
               'impact sprinkler', 'lawn sprinkler', 'rotating sprinkler', 'drip irrigation'],
    },
    inject: [{ prefix: '8424.41', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8424.' }],
  },

  // ── Rule 448: PLANT_POT_INTENT ────────────────────────────────────────────────
  {
    id: 'PLANT_POT_INTENT',
    description: 'Plant pot/flower pot/planter → ch.69 (6913.10)',
    pattern: {
      anyOf: ['plant pot', 'flower pot', 'planter pot', 'ceramic plant pot',
               'terracotta pot', 'hanging planter', 'window box planter'],
    },
    inject: [{ prefix: '6913.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['69'] },
    boosts: [{ delta: 0.65, prefixMatch: '6913.' }],
  },

  // ── Rule 449: FERTILIZER_INTENT ───────────────────────────────────────────────
  {
    id: 'FERTILIZER_INTENT',
    description: 'Fertilizer/plant food → ch.31 (3105.xx)',
    pattern: {
      anyOf: ['fertilizer', 'plant food', 'garden fertilizer', 'organic fertilizer',
               'slow release fertilizer', 'liquid fertilizer', 'npk fertilizer'],
    },
    inject: [{ prefix: '3105.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['31'] },
    boosts: [{ delta: 0.70, chapterMatch: '31' }],
  },

  // ── Rule 450: DOG_BED_INTENT ──────────────────────────────────────────────────
  {
    id: 'DOG_BED_INTENT',
    description: 'Dog bed/pet bed/orthopedic dog bed → ch.94 (9404.90)',
    pattern: {
      anyOf: ['dog bed', 'pet dog bed', 'orthopedic dog bed', 'calming dog bed',
               'elevated dog bed', 'washable dog bed', 'pet bed'],
    },
    inject: [{ prefix: '9404.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9404.' }],
  },

  // ── Rule 451: CAT_TREE_INTENT ─────────────────────────────────────────────────
  {
    id: 'CAT_TREE_INTENT',
    description: 'Cat tree/cat tower/cat condo → ch.44 (4421.99)',
    pattern: {
      anyOf: ['cat tree', 'cat tower', 'cat condo', 'cat climbing tree',
               'multi level cat tower', 'sisal cat tree'],
    },
    inject: [{ prefix: '4421.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['44'] },
    boosts: [{ delta: 0.65, chapterMatch: '44' }],
  },

  // ── Rule 452: FISH_TANK_INTENT ────────────────────────────────────────────────
  {
    id: 'FISH_TANK_INTENT',
    description: 'Fish tank/aquarium → ch.70 (7020.00)',
    pattern: {
      anyOf: ['fish tank', 'aquarium tank', 'fish aquarium', 'planted aquarium',
               'freshwater tank', 'nano aquarium', 'saltwater tank'],
    },
    inject: [{ prefix: '7020.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['70'] },
    boosts: [{ delta: 0.60, chapterMatch: '70' }],
  },

  // ── Rule 453: LITTER_BOX_INTENT ───────────────────────────────────────────────
  {
    id: 'LITTER_BOX_INTENT',
    description: 'Litter box/cat litter box → ch.39 (3924.90)',
    pattern: {
      anyOf: ['litter box', 'cat litter box', 'self cleaning litter box',
               'covered litter box', 'litter tray'],
    },
    inject: [{ prefix: '3924.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.65, prefixMatch: '3924.' }],
  },

  // ── Rule 454: DOG_HARNESS_INTENT ──────────────────────────────────────────────
  {
    id: 'DOG_HARNESS_INTENT',
    description: 'Dog harness/no pull harness → ch.42 (4201.00)',
    pattern: {
      anyOf: ['dog harness', 'no pull harness', 'step in harness',
               'vest harness', 'adjustable dog harness', 'puppy harness'],
    },
    inject: [{ prefix: '4201.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4201.' }],
  },

  // ── Rule 455: HAMSTER_CAGE_INTENT ─────────────────────────────────────────────
  {
    id: 'HAMSTER_CAGE_INTENT',
    description: 'Hamster cage/small animal cage → ch.73 (7323.99)',
    pattern: {
      anyOf: ['hamster cage', 'small animal cage', 'guinea pig cage',
               'rabbit hutch', 'rodent cage', 'gerbil cage'],
    },
    inject: [{ prefix: '7323.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.60, chapterMatch: '73' }],
  },

  // ── Rule 456: TABLECLOTH_INTENT ────────────────────────────────────────────────
  {
    id: 'TABLECLOTH_INTENT',
    description: 'Tablecloth/table linen → ch.63 (6302.xx)',
    pattern: {
      anyOf: ['tablecloth', 'table cover', 'dining tablecloth', 'vinyl tablecloth',
               'linen tablecloth', 'table linen'],
    },
    inject: [{ prefix: '6302.51', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6302.' }],
  },

  // ── Rule 457: CURTAIN_DRAPE_INTENT ────────────────────────────────────────────
  {
    id: 'CURTAIN_DRAPE_INTENT',
    description: 'Curtain/drapes/window curtain → ch.63 (6303.xx)',
    pattern: {
      anyOf: ['curtain', 'drapes', 'window curtain', 'blackout curtain',
               'sheer curtain', 'grommet curtain', 'velvet curtain', 'window drape'],
    },
    inject: [{ prefix: '6303.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6303.' }],
  },

  // ── Rule 458: CARPET_RUG_INTENT ────────────────────────────────────────────────
  {
    id: 'CARPET_RUG_INTENT',
    description: 'Carpet/area rug/floor rug → ch.57 (5703.xx)',
    pattern: {
      anyOf: ['carpet', 'area rug', 'floor rug', 'living room rug',
               'hall runner rug', 'shag rug', 'persian rug', 'wool rug'],
    },
    inject: [{ prefix: '5703.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['57'] },
    boosts: [{ delta: 0.70, chapterMatch: '57' }],
  },

  // ── Rule 459: DOORMAT_INTENT ──────────────────────────────────────────────────
  {
    id: 'DOORMAT_INTENT',
    description: 'Doormat/welcome mat/entry mat → ch.57 (5705.xx)',
    pattern: {
      anyOf: ['doormat', 'welcome mat', 'entry mat', 'coir doormat',
               'rubber doormat', 'outdoor doormat', 'door rug'],
    },
    inject: [{ prefix: '5705.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['57'] },
    boosts: [{ delta: 0.70, prefixMatch: '5705.' }],
  },

  // ── Rule 460: DUVET_COVER_INTENT ──────────────────────────────────────────────
  {
    id: 'DUVET_COVER_INTENT',
    description: 'Duvet cover/comforter cover/quilt cover → ch.63 (6302.21)',
    pattern: {
      anyOf: ['duvet cover', 'comforter cover', 'quilt cover', 'duvet bedding set',
               'nordic duvet cover', 'bedding duvet'],
    },
    inject: [{ prefix: '6302.21', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6302.' }],
  },

  // ── Rule 461: PILLOW_COVER_INTENT ─────────────────────────────────────────────
  {
    id: 'PILLOW_COVER_INTENT',
    description: 'Pillowcase/pillow cover/cushion cover → ch.63 (6302.31)',
    pattern: {
      anyOf: ['pillow cover', 'pillowcase', 'pillow sham', 'cushion cover',
               'throw pillow cover', 'decorative pillowcase'],
    },
    inject: [{ prefix: '6302.31', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6302.' }],
  },

  // ── Rule 462: DRILL_BIT_INTENT ────────────────────────────────────────────────
  {
    id: 'DRILL_BIT_INTENT',
    description: 'Drill bit/twist bit/masonry bit → ch.82 (8207.xx)',
    pattern: {
      anyOf: ['drill bit', 'twist drill bit', 'masonry drill bit', 'wood drill bit',
               'step drill bit', 'forstner bit', 'cobalt drill bit'],
    },
    inject: [{ prefix: '8207.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8207.' }],
  },

  // ── Rule 463: TORQUE_WRENCH_INTENT ────────────────────────────────────────────
  {
    id: 'TORQUE_WRENCH_INTENT',
    description: 'Torque wrench → ch.82 (8204.xx)',
    pattern: {
      anyOf: ['torque wrench', 'click torque wrench', 'digital torque wrench',
               'beam torque wrench', 'preset torque wrench'],
    },
    inject: [{ prefix: '8204.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8204.' }],
  },

  // ── Rule 464: IMPACT_DRIVER_INTENT ────────────────────────────────────────────
  {
    id: 'IMPACT_DRIVER_INTENT',
    description: 'Impact driver/cordless impact driver → ch.84 (8467.xx)',
    pattern: {
      anyOf: ['impact driver', 'cordless impact driver', 'impact screwdriver',
               'power impact driver', 'brushless impact driver'],
    },
    inject: [{ prefix: '8467.21', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8467.' }],
  },

  // ── Rule 465: CONVEYOR_BELT_INTENT ────────────────────────────────────────────
  {
    id: 'CONVEYOR_BELT_INTENT',
    description: 'Conveyor belt/rubber conveyor → ch.59/40 (4010.xx)',
    pattern: {
      anyOf: ['conveyor belt', 'flat belt conveyor', 'modular conveyor belt',
               'timing belt conveyor', 'rubber conveyor belt'],
    },
    inject: [{ prefix: '4010.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['40', '59'] },
    boosts: [{ delta: 0.70, chapterMatch: '40' }],
  },

  // ── Rule 466: GROW_LIGHT_INTENT ────────────────────────────────────────────────
  {
    id: 'GROW_LIGHT_INTENT',
    description: 'Grow light/LED grow light/plant light → ch.85 (8539.50)',
    pattern: {
      anyOf: ['grow light', 'plant grow light', 'led grow light',
               'full spectrum grow light', 'indoor grow lamp', 'hydroponic light'],
    },
    inject: [{ prefix: '8539.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8539.' }],
  },

  // ── Rule 467: CEILING_LIGHT_INTENT ────────────────────────────────────────────
  {
    id: 'CEILING_LIGHT_INTENT',
    description: 'Ceiling light/flush mount light → ch.94 (9405.xx)',
    pattern: {
      anyOf: ['ceiling light', 'overhead light', 'flush mount light',
               'semi flush light', 'ceiling fixture', 'ceiling lamp'],
    },
    inject: [{ prefix: '9405.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9405.' }],
  },

  // ── Rule 468: STRING_LIGHTS_INTENT ────────────────────────────────────────────
  {
    id: 'STRING_LIGHTS_INTENT',
    description: 'Fairy lights/string lights/twinkle lights → ch.94 (9405.40)',
    pattern: {
      anyOf: ['fairy lights', 'string lights', 'twinkle lights',
               'christmas string lights', 'solar string lights', 'party lights'],
    },
    inject: [{ prefix: '9405.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9405.' }],
  },

  // ── Rule 469: BREAD_FOOD_INTENT ────────────────────────────────────────────────
  {
    id: 'BREAD_FOOD_INTENT',
    description: 'Bread/baked goods → ch.19 (1905.xx)',
    pattern: {
      anyOf: ['bread', 'white bread', 'whole wheat bread', 'sourdough loaf',
               'baguette', 'dinner roll', 'pita bread', 'rye bread', 'baked bread'],
    },
    inject: [{ prefix: '1905.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['19'] },
    boosts: [{ delta: 0.70, prefixMatch: '1905.' }],
  },

  // ── Rule 470: PASTA_FOOD_INTENT ────────────────────────────────────────────────
  {
    id: 'PASTA_FOOD_INTENT',
    description: 'Pasta/spaghetti/noodles → ch.19 (1902.xx)',
    pattern: {
      anyOf: ['pasta', 'spaghetti', 'penne', 'fettuccine', 'linguine', 'rigatoni',
               'macaroni', 'egg noodles', 'vermicelli', 'dried pasta'],
    },
    inject: [{ prefix: '1902.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['19'] },
    boosts: [{ delta: 0.70, prefixMatch: '1902.' }],
  },

  // ── Rule 471: COOKING_OIL_INTENT ──────────────────────────────────────────────
  {
    id: 'COOKING_OIL_INTENT',
    description: 'Cooking oil/vegetable oil → ch.15 (1512.xx)',
    pattern: {
      anyOf: ['cooking oil', 'vegetable oil', 'sunflower oil', 'canola oil',
               'corn oil', 'palm oil', 'coconut oil'],
      noneOf: ['olive oil', 'extra virgin', 'motor oil', 'machine oil'],
    },
    inject: [{ prefix: '1512.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['15'] },
    boosts: [{ delta: 0.65, chapterMatch: '15' }],
  },

  // ── Rule 472: OLIVE_OIL_INTENT ────────────────────────────────────────────────
  {
    id: 'OLIVE_OIL_INTENT',
    description: 'Olive oil/extra virgin olive oil → ch.15 (1509.xx)',
    pattern: {
      anyOf: ['olive oil', 'extra virgin olive oil', 'light olive oil',
               'pure olive oil', 'cold pressed olive oil'],
    },
    inject: [{ prefix: '1509.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['15'] },
    boosts: [{ delta: 0.70, prefixMatch: '1509.' }],
  },

  // ── Rule 473: SAUCE_CONDIMENT_INTENT ─────────────────────────────────────────
  {
    id: 'SAUCE_CONDIMENT_INTENT',
    description: 'Sauce/condiment → ch.21 (2103.xx)',
    pattern: {
      anyOf: ['sauce', 'hot sauce', 'tomato sauce', 'soy sauce', 'barbecue sauce',
               'worcestershire sauce', 'oyster sauce', 'fish sauce', 'condiment'],
      noneOf: ['tomato paste', 'ketchup'],
    },
    inject: [{ prefix: '2103.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['21'] },
    boosts: [{ delta: 0.65, prefixMatch: '2103.' }],
  },

  // ── Rule 474: SPICE_INTENT ────────────────────────────────────────────────────
  {
    id: 'SPICE_INTENT',
    description: 'Spice/ground spices → ch.9 (0910.xx)',
    pattern: {
      anyOf: ['spice', 'ground cumin', 'paprika', 'turmeric', 'cinnamon',
               'cayenne pepper', 'garlic powder', 'onion powder', 'chili powder',
               'mixed spice', 'spice blend', 'seasoning spice'],
    },
    inject: [{ prefix: '0910.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['09'] },
    boosts: [{ delta: 0.65, chapterMatch: '09' }],
  },

  // ── Rule 475: HONEY_INTENT ────────────────────────────────────────────────────
  {
    id: 'HONEY_INTENT',
    description: 'Honey → ch.4 (0409.00)',
    pattern: {
      anyOf: ['honey', 'raw honey', 'organic honey', 'manuka honey',
               'clover honey', 'wildflower honey', 'creamed honey'],
    },
    inject: [{ prefix: '0409.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['04'] },
    boosts: [{ delta: 0.75, prefixMatch: '0409.' }],
  },

  // ── Rule 476: CHOCOLATE_FOOD_INTENT ──────────────────────────────────────────
  {
    id: 'CHOCOLATE_FOOD_INTENT',
    description: 'Chocolate/dark chocolate/cocoa → ch.18 (1806.xx)',
    pattern: {
      anyOf: ['chocolate', 'dark chocolate', 'milk chocolate', 'white chocolate',
               'cocoa powder', 'baking chocolate', 'chocolate chips', 'chocolate bar'],
    },
    inject: [{ prefix: '1806.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['18'] },
    boosts: [{ delta: 0.70, chapterMatch: '18' }],
  },

  // ── Rule 477: PROTEIN_SUPPLEMENT_INTENT ──────────────────────────────────────
  {
    id: 'PROTEIN_SUPPLEMENT_INTENT',
    description: 'Protein powder/whey protein supplement → ch.21 (2106.90)',
    pattern: {
      anyOf: ['protein powder', 'whey protein', 'plant protein', 'casein protein',
               'protein supplement', 'protein shake powder'],
    },
    inject: [{ prefix: '2106.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['21'] },
    boosts: [{ delta: 0.65, chapterMatch: '21' }],
  },

  // ── Rule 478: STORAGE_BIN_INTENT ──────────────────────────────────────────────
  {
    id: 'STORAGE_BIN_INTENT',
    description: 'Storage bin/storage box/plastic bin → ch.39 (3924.90)',
    pattern: {
      anyOf: ['storage bin', 'storage box', 'plastic storage bin',
               'stackable storage bin', 'tote bin', 'container bin'],
    },
    inject: [{ prefix: '3924.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 479: UKULELE_INTENT ──────────────────────────────────────────────────
  {
    id: 'UKULELE_INTENT',
    description: 'Ukulele → ch.92 (9202.90)',
    pattern: {
      anyOf: ['ukulele', 'soprano ukulele', 'concert ukulele',
               'tenor ukulele', 'beginner ukulele', 'hawaiian ukulele'],
    },
    inject: [{ prefix: '9202.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.75, prefixMatch: '9202.' }],
  },

  // ── Rule 480: HARMONICA_INTENT ────────────────────────────────────────────────
  {
    id: 'HARMONICA_INTENT',
    description: 'Harmonica/mouth organ → ch.92 (9205.90)',
    pattern: {
      anyOf: ['harmonica', 'mouth organ', 'harp harmonica', 'blues harmonica',
               'diatonic harmonica', 'chromatic harmonica'],
    },
    inject: [{ prefix: '9205.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.75, prefixMatch: '9205.' }],
  },

  // ── Rule 481: PIANO_KEYBOARD_INTENT ──────────────────────────────────────────
  {
    id: 'PIANO_KEYBOARD_INTENT',
    description: 'Digital piano/electric keyboard → ch.92 (9201.xx/9207.xx)',
    pattern: {
      anyOf: ['piano keyboard', 'digital piano keyboard', 'electric keyboard',
               'portable piano keyboard', 'digital piano', 'keyboard piano'],
      noneOf: ['computer keyboard', 'laptop keyboard', 'mechanical keyboard'],
    },
    inject: [{ prefix: '9207.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, chapterMatch: '92' }],
  },

  // ── Rule 482: RESISTANCE_BAND_INTENT ─────────────────────────────────────────
  {
    id: 'RESISTANCE_BAND_INTENT',
    description: 'Resistance band/exercise band/loop band → ch.40 (4016.99)',
    pattern: {
      anyOf: ['resistance band', 'exercise band', 'loop resistance band',
               'stretch band', 'therapy band', 'latex resistance band'],
    },
    inject: [{ prefix: '4016.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['40'] },
    boosts: [{ delta: 0.65, chapterMatch: '40' }],
  },

  // ── Rule 483: YOGA_BLOCK_INTENT ────────────────────────────────────────────────
  {
    id: 'YOGA_BLOCK_INTENT',
    description: 'Yoga block/foam yoga block → ch.39 (3924.90)',
    pattern: {
      anyOf: ['yoga block', 'foam yoga block', 'cork yoga block',
               'yoga prop block', 'meditation block', 'yoga brick'],
    },
    inject: [{ prefix: '3924.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 484: FOAM_ROLLER_INTENT ──────────────────────────────────────────────
  {
    id: 'FOAM_ROLLER_INTENT',
    description: 'Foam roller/massage roller → ch.39 (3926.90)',
    pattern: {
      anyOf: ['foam roller', 'muscle foam roller', 'massage foam roller',
               'trigger point roller', 'recovery foam roller'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 485: KETTLEBELL_INTENT ────────────────────────────────────────────────
  {
    id: 'KETTLEBELL_INTENT',
    description: 'Kettlebell/cast iron kettlebell → ch.73 (7326.20)',
    pattern: {
      anyOf: ['kettlebell', 'cast iron kettlebell', 'vinyl kettlebell',
               'adjustable kettlebell', 'competition kettlebell'],
    },
    inject: [{ prefix: '7326.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, prefixMatch: '7326.' }],
  },

  // ── Rule 486: MEDICINE_BALL_INTENT ────────────────────────────────────────────
  {
    id: 'MEDICINE_BALL_INTENT',
    description: 'Medicine ball/slam ball/wall ball → ch.95 (9506.62)',
    pattern: {
      anyOf: ['medicine ball', 'wall ball', 'slam ball',
               'weighted exercise ball', 'training medicine ball'],
    },
    inject: [{ prefix: '9506.62', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 487: JUMP_ROPE_INTENT ────────────────────────────────────────────────
  {
    id: 'JUMP_ROPE_INTENT',
    description: 'Jump rope/skipping rope → ch.95 (9506.91)',
    pattern: {
      anyOf: ['jump rope', 'skipping rope', 'speed jump rope',
               'weighted jump rope', 'adjustable skip rope'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 488: SECURITY_CAMERA_INTENT ─────────────────────────────────────────
  {
    id: 'SECURITY_CAMERA_INTENT',
    description: 'Security camera/CCTV/surveillance camera → ch.85 (8525.89)',
    pattern: {
      anyOf: ['security camera', 'ip camera', 'cctv camera', 'surveillance camera',
               'outdoor camera', 'dome camera', 'ptz camera', 'security cam'],
      noneOf: ['action camera', 'sports camera', 'doorbell camera'],
    },
    inject: [{ prefix: '8525.89', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 489: VIDEO_DOORBELL_INTENT ───────────────────────────────────────────
  {
    id: 'VIDEO_DOORBELL_INTENT',
    description: 'Video doorbell/smart doorbell → ch.85 (8531.10)',
    pattern: {
      anyOf: ['video doorbell', 'smart doorbell', 'wifi doorbell',
               'doorbell with camera', 'doorbell intercom camera', 'ring doorbell type'],
    },
    inject: [{ prefix: '8531.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8531.' }],
  },

  // ── Rule 490: DASH_CAM_INTENT ─────────────────────────────────────────────────
  {
    id: 'DASH_CAM_INTENT',
    description: 'Dash cam/dashboard camera → ch.85 (8525.89)',
    pattern: {
      anyOf: ['dash cam', 'dashboard camera', 'car dvr', 'driving recorder',
               'front dash camera', 'dual dash cam', 'rearview dash cam'],
    },
    inject: [{ prefix: '8525.89', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 491: LAWN_MOWER_INTENT ────────────────────────────────────────────────
  {
    id: 'LAWN_MOWER_INTENT',
    description: 'Lawn mower/grass cutter → ch.84 (8433.11)',
    pattern: {
      anyOf: ['lawn mower', 'grass cutter', 'push lawn mower', 'electric lawn mower',
               'cordless mower', 'robot lawn mower', 'riding lawn mower'],
    },
    inject: [{ prefix: '8433.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.70, prefixMatch: '8433.' }],
  },

  // ── Rule 492: CANDLE_HOME_INTENT ──────────────────────────────────────────────
  {
    id: 'CANDLE_HOME_INTENT',
    description: 'Candle/pillar candle/soy candle → ch.34 (3406.00)',
    pattern: {
      anyOf: ['candle', 'pillar candle', 'taper candle', 'votive candle',
               'tea light candle', 'jar candle', 'soy candle', 'beeswax candle'],
    },
    inject: [{ prefix: '3406.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.75, prefixMatch: '3406.' }],
  },

  // ── Rule 493: VACUUM_STORAGE_BAG_INTENT ───────────────────────────────────────
  {
    id: 'VACUUM_STORAGE_BAG_INTENT',
    description: 'Vacuum storage bag/space saver bag → ch.39 (3923.29)',
    pattern: {
      anyOf: ['vacuum storage bag', 'space saver bag', 'compression storage bag',
               'vacuum seal bag clothes', 'space bag compression'],
    },
    inject: [{ prefix: '3923.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 494: CPAP_MACHINE_INTENT ─────────────────────────────────────────────
  {
    id: 'CPAP_MACHINE_INTENT',
    description: 'CPAP machine/sleep apnea device → ch.90 (9019.20)',
    pattern: {
      anyOf: ['cpap machine', 'sleep apnea device', 'cpap device', 'bipap machine',
               'sleep therapy device', 'auto cpap', 'apap machine'],
    },
    inject: [{ prefix: '9019.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9019.' }],
  },

  // ── Rule 495: CRUTCHES_INTENT ─────────────────────────────────────────────────
  {
    id: 'CRUTCHES_INTENT',
    description: 'Crutches/walking crutches → ch.90 (9021.90)',
    pattern: {
      anyOf: ['crutches', 'underarm crutches', 'elbow crutches',
               'forearm crutches', 'walking crutches', 'crutch pair'],
    },
    inject: [{ prefix: '9021.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9021.' }],
  },

  // ── Rule 496: ELECTRIC_TOOTHBRUSH_INTENT ─────────────────────────────────────
  {
    id: 'ELECTRIC_TOOTHBRUSH_INTENT',
    description: 'Electric toothbrush/sonic toothbrush → ch.85 (8509.xx)',
    pattern: {
      anyOf: ['electric toothbrush', 'sonic toothbrush', 'rotating toothbrush',
               'rechargeable toothbrush', 'powered toothbrush'],
    },
    inject: [{ prefix: '8509.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 497: CAR_COVER_INTENT ────────────────────────────────────────────────
  {
    id: 'CAR_COVER_INTENT',
    description: 'Car cover/vehicle cover → ch.63 (6307.90)',
    pattern: {
      anyOf: ['car cover', 'vehicle cover', 'waterproof car cover',
               'auto cover', 'outdoor car cover', 'full car cover'],
    },
    inject: [{ prefix: '6307.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, chapterMatch: '63' }],
  },

  // ── Rule 498: BOOKCASE_FURNITURE_INTENT ───────────────────────────────────────
  {
    id: 'BOOKCASE_FURNITURE_INTENT',
    description: 'Bookcase/bookshelf/shelving unit → ch.94 (9403.30)',
    pattern: {
      anyOf: ['bookcase', 'bookshelf', 'shelving unit', 'etagere',
               'open bookcase', 'storage bookshelf', 'book shelves'],
    },
    inject: [{ prefix: '9403.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 499: DIAPER_INTENT ────────────────────────────────────────────────────
  {
    id: 'DIAPER_INTENT',
    description: 'Diaper/nappy/disposable diaper → ch.96 (9619.00)',
    pattern: {
      anyOf: ['diaper', 'disposable diaper', 'nappy', 'pull up diaper',
               'overnight diaper', 'newborn nappy', 'baby nappy'],
    },
    inject: [{ prefix: '9619.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.75, prefixMatch: '9619.' }],
  },

  // ── Rule 500: BABY_WIPES_INTENT ────────────────────────────────────────────────
  {
    id: 'BABY_WIPES_INTENT',
    description: 'Baby wipes/wet wipes → ch.34 (3401.19)',
    pattern: {
      anyOf: ['baby wipes', 'diaper wipes', 'wet wipes', 'unscented baby wipes',
               'sensitive baby wipes', 'biodegradable wipes'],
    },
    inject: [{ prefix: '3401.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.65, prefixMatch: '3401.' }],
  },

  // ── Rule 501: GAMING_CHAIR_INTENT ─────────────────────────────────────────────
  {
    id: 'GAMING_CHAIR_INTENT',
    description: 'Gaming chair/racing chair/esports seat → ch.94 (9401.61)',
    pattern: {
      anyOf: ['gaming chair', 'gaming seat', 'racing chair', 'ergonomic gaming chair',
               'pc gaming chair', 'esports chair'],
    },
    inject: [{ prefix: '9401.61', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, chapterMatch: '94' }],
  },

  // ── Rule 502: SMART_TV_INTENT ─────────────────────────────────────────────────
  {
    id: 'SMART_TV_INTENT',
    description: 'Smart TV/OLED TV/QLED TV → ch.85 (8528.72)',
    pattern: {
      anyOf: ['smart tv', 'android tv', 'smart television', 'qled tv', 'oled tv',
               '4k smart tv', 'fire tv', 'led smart tv'],
    },
    inject: [{ prefix: '8528.72', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8528.' }],
  },

  // ── Rule 503: EREADER_INTENT ──────────────────────────────────────────────────
  {
    id: 'EREADER_INTENT',
    description: 'E-reader/ebook reader → ch.84 (8471.30)',
    pattern: {
      anyOf: ['e-reader', 'ebook reader', 'kindle type reader', 'digital book reader',
               'e-ink reader', 'electronic book reader'],
    },
    inject: [{ prefix: '8471.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8471.' }],
  },

  // ── Rule 504: POWER_BANK_INTENT ────────────────────────────────────────────────
  {
    id: 'POWER_BANK_INTENT',
    description: 'Power bank/portable charger → ch.85 (8507.60)',
    pattern: {
      anyOf: ['power bank', 'portable charger bank', 'battery pack', 'portable power bank',
               'external battery bank', 'fast charge bank'],
    },
    inject: [{ prefix: '8507.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8507.' }],
  },

  // ── Rule 505: HARD_DRIVE_INTENT ────────────────────────────────────────────────
  {
    id: 'HARD_DRIVE_INTENT',
    description: 'Hard drive/external HDD → ch.84 (8471.70)',
    pattern: {
      anyOf: ['hard drive', 'external hard drive', 'portable hdd', 'desktop hard drive',
               'usb hard drive', 'external hdd'],
      noneOf: ['ssd', 'solid state', 'nvme', 'flash drive'],
    },
    inject: [{ prefix: '8471.70', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8471.' }],
  },

  // ── Rule 506: USB_HUB_INTENT ──────────────────────────────────────────────────
  {
    id: 'USB_HUB_INTENT',
    description: 'USB hub/USB splitter → ch.85 (8536.69)',
    pattern: {
      anyOf: ['usb hub', 'usb splitter', 'usb port hub', 'usb c hub', 'multiport usb hub',
               '4 port usb hub', '7 port usb hub'],
    },
    inject: [{ prefix: '8536.69', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 507: HDMI_CABLE_INTENT ────────────────────────────────────────────────
  {
    id: 'HDMI_CABLE_INTENT',
    description: 'HDMI cable/4K HDMI → ch.85 (8544.42)',
    pattern: {
      anyOf: ['hdmi cable', 'hdmi cord', '4k hdmi cable', 'high speed hdmi',
               'hdmi 2.1 cable', 'hdmi adapter cable'],
    },
    inject: [{ prefix: '8544.42', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8544.' }],
  },

  // ── Rule 508: AIR_FRYER_INTENT ────────────────────────────────────────────────
  {
    id: 'AIR_FRYER_INTENT',
    description: 'Air fryer → ch.85 (8516.60)',
    pattern: {
      anyOf: ['air fryer', 'air fryer oven', 'compact air fryer', 'basket air fryer',
               'digital air fryer', 'oil free fryer'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8516.' }],
  },

  // ── Rule 509: SLOW_COOKER_INTENT ──────────────────────────────────────────────
  {
    id: 'SLOW_COOKER_INTENT',
    description: 'Slow cooker/crockpot → ch.85 (8516.60)',
    pattern: {
      anyOf: ['slow cooker', 'crockpot', 'crock pot slow cooker',
               'programmable slow cooker', 'oval slow cooker'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 510: RICE_COOKER_INTENT ──────────────────────────────────────────────
  {
    id: 'RICE_COOKER_INTENT',
    description: 'Rice cooker/rice steamer → ch.85 (8516.60)',
    pattern: {
      anyOf: ['rice cooker', 'electric rice cooker', 'digital rice cooker',
               'fuzzy logic rice cooker', 'rice steamer'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 511: ELECTRIC_KETTLE_INTENT ──────────────────────────────────────────
  {
    id: 'ELECTRIC_KETTLE_INTENT',
    description: 'Electric kettle/gooseneck kettle → ch.85 (8516.40)',
    pattern: {
      anyOf: ['electric kettle', 'electric tea kettle', 'gooseneck electric kettle',
               'variable temp kettle', 'cordless electric kettle'],
    },
    inject: [{ prefix: '8516.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8516.40' }],
  },

  // ── Rule 512: COFFEE_MAKER_INTENT ─────────────────────────────────────────────
  {
    id: 'COFFEE_MAKER_INTENT',
    description: 'Coffee maker/drip coffee → ch.85 (8516.71)',
    pattern: {
      anyOf: ['coffee maker', 'drip coffee maker', 'programmable coffee maker',
               'single serve coffee maker', 'pour over coffee maker'],
    },
    inject: [{ prefix: '8516.71', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8516.71' }],
  },

  // ── Rule 513: FOOD_PROCESSOR_INTENT ───────────────────────────────────────────
  {
    id: 'FOOD_PROCESSOR_INTENT',
    description: 'Food processor/chopper → ch.85 (8509.40)',
    pattern: {
      anyOf: ['food processor', 'kitchen food processor', 'mini food processor',
               'chopper food processor', 'blender processor'],
    },
    inject: [{ prefix: '8509.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8509.' }],
  },

  // ── Rule 514: JUICER_INTENT ────────────────────────────────────────────────────
  {
    id: 'JUICER_INTENT',
    description: 'Juicer/cold press juicer → ch.85 (8509.40)',
    pattern: {
      anyOf: ['juicer', 'centrifugal juicer', 'masticating juicer', 'cold press juicer',
               'slow juicer', 'citrus squeezer juicer'],
    },
    inject: [{ prefix: '8509.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 515: FOOD_DEHYDRATOR_INTENT ──────────────────────────────────────────
  {
    id: 'FOOD_DEHYDRATOR_INTENT',
    description: 'Food dehydrator → ch.84 (8419.39)',
    pattern: {
      anyOf: ['food dehydrator', 'dehydrator machine', 'food dryer', 'jerky dehydrator',
               'fruit and vegetable dehydrator'],
    },
    inject: [{ prefix: '8419.39', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.70, prefixMatch: '8419.' }],
  },

  // ── Rule 516: CUTTING_BOARD_INTENT ────────────────────────────────────────────
  {
    id: 'CUTTING_BOARD_INTENT',
    description: 'Cutting board/chopping board → ch.44 (4419.20)',
    pattern: {
      anyOf: ['cutting board', 'chopping board', 'bamboo chopping board',
               'wooden cutting board', 'plastic cutting board'],
    },
    inject: [{ prefix: '4419.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['44'] },
    boosts: [{ delta: 0.65, prefixMatch: '4419.' }],
  },

  // ── Rule 517: KITCHEN_SCALE_INTENT ────────────────────────────────────────────
  {
    id: 'KITCHEN_SCALE_INTENT',
    description: 'Kitchen scale/food scale → ch.90 (9016.00)',
    pattern: {
      anyOf: ['kitchen scale', 'digital food scale', 'cooking scale',
               'baking kitchen scale', 'postal kitchen scale'],
    },
    inject: [{ prefix: '9016.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9016.' }],
  },

  // ── Rule 518: CAMPING_TENT_INTENT ─────────────────────────────────────────────
  {
    id: 'CAMPING_TENT_INTENT',
    description: 'Camping tent/backpacking tent → ch.63 (6306.22)',
    pattern: {
      anyOf: ['camping tent', 'backpacking tent', 'family camping tent', 'dome tent',
               'cabin tent', 'instant pop up tent', 'hiking tent'],
    },
    inject: [{ prefix: '6306.22', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.70, prefixMatch: '6306.' }],
  },

  // ── Rule 519: SLEEPING_BAG_INTENT ─────────────────────────────────────────────
  {
    id: 'SLEEPING_BAG_INTENT',
    description: 'Sleeping bag/mummy sleeping bag → ch.94 (9404.30)',
    pattern: {
      anyOf: ['sleeping bag', 'camping sleeping bag', 'mummy sleeping bag',
               'rectangular sleeping bag', 'ultralight sleeping bag'],
    },
    inject: [{ prefix: '9404.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.70, prefixMatch: '9404.30' }],
  },

  // ── Rule 520: FISHING_ROD_INTENT ──────────────────────────────────────────────
  {
    id: 'FISHING_ROD_INTENT',
    description: 'Fishing rod/fishing pole → ch.95 (9507.10)',
    pattern: {
      anyOf: ['fishing rod', 'spinning fishing rod', 'casting rod', 'fly fishing rod',
               'telescopic fishing rod', 'fishing pole'],
    },
    inject: [{ prefix: '9507.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9507.' }],
  },

  // ── Rule 521: FISHING_LINE_INTENT ─────────────────────────────────────────────
  {
    id: 'FISHING_LINE_INTENT',
    description: 'Fishing line/monofilament → ch.95 (9507.90)',
    pattern: {
      anyOf: ['fishing line', 'monofilament fishing line', 'fluorocarbon line',
               'braided fishing line', 'fishing wire'],
    },
    inject: [{ prefix: '9507.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9507.' }],
  },

  // ── Rule 522: CIRCULAR_SAW_INTENT ─────────────────────────────────────────────
  {
    id: 'CIRCULAR_SAW_INTENT',
    description: 'Circular saw/cordless saw → ch.84 (8467.21)',
    pattern: {
      anyOf: ['circular saw', 'cordless circular saw', 'worm drive saw', 'track saw',
               'corded circular saw', 'trim saw'],
    },
    inject: [{ prefix: '8467.21', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8467.' }],
  },

  // ── Rule 523: AIR_COMPRESSOR_INTENT ───────────────────────────────────────────
  {
    id: 'AIR_COMPRESSOR_INTENT',
    description: 'Air compressor/pancake compressor → ch.84 (8414.80)',
    pattern: {
      anyOf: ['air compressor', 'portable air compressor', 'pancake compressor',
               'oil free compressor', 'belt drive compressor'],
    },
    inject: [{ prefix: '8414.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8414.' }],
  },

  // ── Rule 524: MEASURING_TAPE_INTENT ───────────────────────────────────────────
  {
    id: 'MEASURING_TAPE_INTENT',
    description: 'Measuring tape/tape measure → ch.90 (9017.80)',
    pattern: {
      anyOf: ['measuring tape', 'tape measure', 'retractable tape measure',
               'steel tape measure', 'metric tape measure'],
    },
    inject: [{ prefix: '9017.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9017.' }],
  },

  // ── Rule 525: SANDPAPER_INTENT ────────────────────────────────────────────────
  {
    id: 'SANDPAPER_INTENT',
    description: 'Sandpaper/abrasive paper → ch.68 (6805.xx)',
    pattern: {
      anyOf: ['sandpaper', 'sanding paper', 'abrasive sandpaper', 'wet dry sandpaper',
               'sanding block', 'sandpaper sheets'],
    },
    inject: [{ prefix: '6805.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['68'] },
    boosts: [{ delta: 0.70, chapterMatch: '68' }],
  },

  // ── Rule 526: SOCKET_SET_INTENT ────────────────────────────────────────────────
  {
    id: 'SOCKET_SET_INTENT',
    description: 'Socket set/ratchet socket wrench → ch.82 (8204.11)',
    pattern: {
      anyOf: ['socket set', 'socket wrench set', 'ratchet socket set',
               'impact socket set', 'metric socket set'],
    },
    inject: [{ prefix: '8204.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8204.' }],
  },

  // ── Rule 527: ALLEN_WRENCH_INTENT ─────────────────────────────────────────────
  {
    id: 'ALLEN_WRENCH_INTENT',
    description: 'Allen wrench/hex key set → ch.82 (8204.20)',
    pattern: {
      anyOf: ['allen wrench', 'hex key', 'hex key set', 'allen key set',
               'ball end hex key', 'metric hex wrench'],
    },
    inject: [{ prefix: '8204.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8204.' }],
  },

  // ── Rule 528: YOGA_MAT_INTENT ─────────────────────────────────────────────────
  {
    id: 'YOGA_MAT_INTENT',
    description: 'Yoga mat/exercise mat → ch.40 (4016.99)',
    pattern: {
      anyOf: ['yoga mat', 'non slip yoga mat', 'thick yoga mat', 'exercise yoga mat',
               'rubber yoga mat', 'tpe yoga mat', 'gym yoga mat'],
    },
    inject: [{ prefix: '4016.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['40'] },
    boosts: [{ delta: 0.65, chapterMatch: '40' }],
  },

  // ── Rule 529: EXERCISE_BIKE_INTENT ────────────────────────────────────────────
  {
    id: 'EXERCISE_BIKE_INTENT',
    description: 'Exercise bike/stationary bike/spin bike → ch.95 (9506.91)',
    pattern: {
      anyOf: ['exercise bike', 'stationary bike', 'spin bike', 'indoor cycling bike',
               'recumbent exercise bike', 'upright bike'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 530: TREADMILL_INTENT ────────────────────────────────────────────────
  {
    id: 'TREADMILL_INTENT',
    description: 'Treadmill/motorized treadmill → ch.95 (9506.91)',
    pattern: {
      anyOf: ['treadmill', 'motorized treadmill', 'folding treadmill',
               'manual treadmill', 'home treadmill', 'curved treadmill'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 531: ROWING_MACHINE_INTENT ───────────────────────────────────────────
  {
    id: 'ROWING_MACHINE_INTENT',
    description: 'Rowing machine/rower → ch.95 (9506.91)',
    pattern: {
      anyOf: ['rowing machine', 'rower machine', 'water rower', 'air rowing machine',
               'magnetic rower', 'ergometer rower'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 532: BASKETBALL_INTENT ───────────────────────────────────────────────
  {
    id: 'BASKETBALL_INTENT',
    description: 'Basketball → ch.95 (9506.62)',
    pattern: {
      anyOf: ['basketball', 'indoor basketball', 'outdoor basketball',
               'rubber basketball', 'leather basketball', 'practice basketball'],
    },
    inject: [{ prefix: '9506.62', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 533: SOCCER_BALL_INTENT ──────────────────────────────────────────────
  {
    id: 'SOCCER_BALL_INTENT',
    description: 'Soccer ball/football ball → ch.95 (9506.62)',
    pattern: {
      anyOf: ['soccer ball', 'football ball', 'futsal ball', 'training soccer ball',
               'youth soccer ball', 'match ball soccer'],
    },
    inject: [{ prefix: '9506.62', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 534: GOLF_BAG_INTENT ─────────────────────────────────────────────────
  {
    id: 'GOLF_BAG_INTENT',
    description: 'Golf bag/golf stand bag → ch.42 (4202.92)',
    pattern: {
      anyOf: ['golf bag', 'golf stand bag', 'cart golf bag', 'carry golf bag', 'tour golf bag'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.' }],
  },

  // ── Rule 535: SKATEBOARD_INTENT ───────────────────────────────────────────────
  {
    id: 'SKATEBOARD_INTENT',
    description: 'Skateboard/longboard/cruiser → ch.95 (9506.70)',
    pattern: {
      anyOf: ['skateboard deck', 'complete skateboard', 'longboard skateboard',
               'cruiser skateboard', 'trick skateboard', 'skateboard'],
    },
    inject: [{ prefix: '9506.70', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.70' }],
  },

  // ── Rule 536: MOTOR_OIL_INTENT ────────────────────────────────────────────────
  {
    id: 'MOTOR_OIL_INTENT',
    description: 'Motor oil/engine oil/synthetic oil → ch.27 (2710.19)',
    pattern: {
      anyOf: ['motor oil', 'engine oil', 'synthetic motor oil', 'full synthetic oil',
               'conventional motor oil', 'high mileage oil'],
      noneOf: ['cooking oil', 'olive oil', 'vegetable oil', 'coconut oil'],
    },
    inject: [{ prefix: '2710.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['27'] },
    boosts: [{ delta: 0.70, chapterMatch: '27' }],
  },

  // ── Rule 537: BRAKE_PADS_INTENT ───────────────────────────────────────────────
  {
    id: 'BRAKE_PADS_INTENT',
    description: 'Brake pads/disc brake pads → ch.87 (8708.30)',
    pattern: {
      anyOf: ['brake pads', 'disc brake pads', 'ceramic brake pads',
               'semi metallic brake pads', 'front brake pads', 'rear brake pads'],
    },
    inject: [{ prefix: '8708.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['87'] },
    boosts: [{ delta: 0.70, prefixMatch: '8708.' }],
  },

  // ── Rule 538: CEILING_FAN_INTENT ──────────────────────────────────────────────
  {
    id: 'CEILING_FAN_INTENT',
    description: 'Ceiling fan/room fan → ch.84 (8414.51)',
    pattern: {
      anyOf: ['ceiling fan', 'room ceiling fan', 'outdoor ceiling fan',
               'ceiling fan with light', 'dc ceiling fan', 'hugger ceiling fan'],
    },
    inject: [{ prefix: '8414.51', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.70, prefixMatch: '8414.51' }],
  },

  // ── Rule 539: BOX_TOWER_FAN_INTENT ────────────────────────────────────────────
  {
    id: 'BOX_TOWER_FAN_INTENT',
    description: 'Box fan/tower fan/desk fan → ch.84 (8414.51)',
    pattern: {
      anyOf: ['box fan', 'window box fan', 'tower fan', 'oscillating tower fan',
               'slim tower fan', 'desk fan', 'personal desk fan', 'floor box fan'],
    },
    inject: [{ prefix: '8414.51', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8414.' }],
  },

  // ── Rule 540: SPACE_HEATER_INTENT ─────────────────────────────────────────────
  {
    id: 'SPACE_HEATER_INTENT',
    description: 'Space heater/ceramic heater/infrared heater → ch.85 (8516.29)',
    pattern: {
      anyOf: ['space heater', 'portable electric heater', 'ceramic space heater',
               'infrared space heater', 'oil filled radiator heater'],
    },
    inject: [{ prefix: '8516.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 541: SHOWER_CURTAIN_INTENT ───────────────────────────────────────────
  {
    id: 'SHOWER_CURTAIN_INTENT',
    description: 'Shower curtain/curtain liner → ch.63 (6303.92)',
    pattern: {
      anyOf: ['shower curtain', 'waterproof shower curtain', 'fabric shower curtain',
               'plastic shower liner', 'shower curtain liner'],
    },
    inject: [{ prefix: '6303.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6303.' }],
  },

  // ── Rule 542: TOWEL_BAR_INTENT ────────────────────────────────────────────────
  {
    id: 'TOWEL_BAR_INTENT',
    description: 'Towel bar/towel rack/heated towel rail → ch.83 (8302.41)',
    pattern: {
      anyOf: ['towel bar', 'bathroom towel rack', 'towel rail', 'heated towel bar',
               'double towel bar', 'towel holder bar'],
    },
    inject: [{ prefix: '8302.41', syntheticRank: 22 }],
    whitelist: { allowChapters: ['83'] },
    boosts: [{ delta: 0.65, chapterMatch: '83' }],
  },

  // ── Rule 543: TOILET_BRUSH_INTENT ─────────────────────────────────────────────
  {
    id: 'TOILET_BRUSH_INTENT',
    description: 'Toilet brush/bathroom scrubber → ch.96 (9603.40)',
    pattern: {
      anyOf: ['toilet brush', 'toilet bowl brush', 'silicone toilet brush',
               'bathroom bowl scrubber', 'toilet cleaning brush'],
    },
    inject: [{ prefix: '9603.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, prefixMatch: '9603.' }],
  },

  // ── Rule 544: BATHROOM_FAUCET_INTENT ──────────────────────────────────────────
  {
    id: 'BATHROOM_FAUCET_INTENT',
    description: 'Bathroom faucet/sink tap → ch.84 (8481.80)',
    pattern: {
      anyOf: ['bathroom faucet', 'bathroom sink tap', 'vessel sink faucet',
               'widespread bathroom faucet', 'single hole faucet'],
    },
    inject: [{ prefix: '8481.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8481.' }],
  },

  // ── Rule 545: KITCHEN_FAUCET_INTENT ───────────────────────────────────────────
  {
    id: 'KITCHEN_FAUCET_INTENT',
    description: 'Kitchen faucet/pull down faucet → ch.84 (8481.80)',
    pattern: {
      anyOf: ['kitchen faucet', 'pull down kitchen faucet', 'kitchen mixer tap',
               'pull out faucet', 'bridge kitchen faucet'],
    },
    inject: [{ prefix: '8481.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8481.' }],
  },

  // ── Rule 546: LAUNDRY_BASKET_INTENT ───────────────────────────────────────────
  {
    id: 'LAUNDRY_BASKET_INTENT',
    description: 'Laundry basket/hamper/clothes hamper → ch.46 (4602.xx)',
    pattern: {
      anyOf: ['laundry basket', 'clothes hamper', 'laundry hamper',
               'collapsible laundry basket', 'canvas laundry basket'],
    },
    inject: [{ prefix: '4602.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['46'] },
    boosts: [{ delta: 0.65, chapterMatch: '46' }],
  },

  // ── Rule 547: IRONING_BOARD_INTENT ────────────────────────────────────────────
  {
    id: 'IRONING_BOARD_INTENT',
    description: 'Ironing board → ch.73 (7323.99)',
    pattern: {
      anyOf: ['ironing board', 'freestanding ironing board', 'tabletop ironing board',
               'wall mount iron board', 'sleeve ironing board'],
    },
    inject: [{ prefix: '7323.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, chapterMatch: '73' }],
  },

  // ── Rule 548: BATH_BOMB_INTENT ────────────────────────────────────────────────
  {
    id: 'BATH_BOMB_INTENT',
    description: 'Bath bomb/bath fizzer → ch.33 (3307.30)',
    pattern: {
      anyOf: ['bath bomb', 'fizzy bath bomb', 'bath fizzer', 'aromatherapy bath bomb',
               'luxury bath bomb'],
    },
    inject: [{ prefix: '3307.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.70, prefixMatch: '3307.' }],
  },

  // ── Rule 549: BATH_SALTS_INTENT ───────────────────────────────────────────────
  {
    id: 'BATH_SALTS_INTENT',
    description: 'Bath salts/epsom salts → ch.33 (3307.30)',
    pattern: {
      anyOf: ['bath salts', 'epsom bath salts', 'himalayan bath salts',
               'dead sea bath salts', 'muscle soak salts'],
    },
    inject: [{ prefix: '3307.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, prefixMatch: '3307.' }],
  },

  // ── Rule 550: BODY_SCRUB_INTENT ───────────────────────────────────────────────
  {
    id: 'BODY_SCRUB_INTENT',
    description: 'Body scrub/sugar scrub/exfoliant → ch.33 (3304.99)',
    pattern: {
      anyOf: ['body scrub', 'sugar body scrub', 'coffee body scrub',
               'exfoliating body scrub', 'salt body scrub', 'brightening scrub'],
    },
    inject: [{ prefix: '3304.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, chapterMatch: '33' }],
  },

  // ── Rule 551: FACIAL_ROLLER_GUA_SHA_INTENT ────────────────────────────────────
  {
    id: 'FACIAL_ROLLER_GUA_SHA_INTENT',
    description: 'Facial roller/gua sha/jade roller → ch.68/14 (6815.99)',
    pattern: {
      anyOf: ['facial roller', 'rose quartz roller', 'jade face roller',
               'gua sha', 'facial gua sha stone', 'jade gua sha tool',
               'derma roller', 'microneedle derma roller'],
    },
    inject: [{ prefix: '6815.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['68', '90'] },
    boosts: [{ delta: 0.60, chapterMatch: '68' }],
  },

  // ── Rule 552: NAIL_CLIPPER_INTENT ─────────────────────────────────────────────
  {
    id: 'NAIL_CLIPPER_INTENT',
    description: 'Nail clipper/nail cutter → ch.82 (8214.20)',
    pattern: {
      anyOf: ['nail clipper', 'fingernail clipper', 'toenail clipper',
               'precision nail cutter', 'nail scissors clipper'],
    },
    inject: [{ prefix: '8214.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.70, prefixMatch: '8214.' }],
  },

  // ── Rule 553: NAIL_DRILL_INTENT ────────────────────────────────────────────────
  {
    id: 'NAIL_DRILL_INTENT',
    description: 'Nail drill/electric nail file → ch.85 (8509.80)',
    pattern: {
      anyOf: ['nail drill', 'electric nail file drill', 'nail sanding machine',
               'gel nail removal drill', 'nail art drill'],
    },
    inject: [{ prefix: '8509.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 554: ESSENTIAL_OIL_DIFFUSER_INTENT ───────────────────────────────────
  {
    id: 'ESSENTIAL_OIL_DIFFUSER_INTENT',
    description: 'Essential oil diffuser/aromatherapy diffuser → ch.84 (8421.39)',
    pattern: {
      anyOf: ['essential oil diffuser', 'ultrasonic aroma diffuser', 'aromatherapy diffuser',
               'cool mist diffuser', 'nebulizing diffuser'],
    },
    inject: [{ prefix: '8421.39', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, chapterMatch: '84' }],
  },

  // ── Rule 555: INCENSE_INTENT ──────────────────────────────────────────────────
  {
    id: 'INCENSE_INTENT',
    description: 'Incense sticks/incense cones → ch.33 (3307.41)',
    pattern: {
      anyOf: ['incense sticks', 'incense cone', 'sandalwood incense sticks',
               'palo santo sticks', 'scented incense', 'incense burner'],
    },
    inject: [{ prefix: '3307.41', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.75, prefixMatch: '3307.41' }],
  },

  // ── Rule 556: WAX_MELT_INTENT ─────────────────────────────────────────────────
  {
    id: 'WAX_MELT_INTENT',
    description: 'Wax melt/scented wax → ch.34 (3406.00)',
    pattern: {
      anyOf: ['wax melt', 'scented wax melt', 'wax cubes', 'fragrance wax tart',
               'soy wax melt'],
    },
    inject: [{ prefix: '3406.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.65, prefixMatch: '3406.' }],
  },

  // ── Rule 557: MEDITATION_CUSHION_INTENT ───────────────────────────────────────
  {
    id: 'MEDITATION_CUSHION_INTENT',
    description: 'Meditation cushion/zafu/yoga bolster → ch.94 (9404.90)',
    pattern: {
      anyOf: ['meditation cushion', 'zafu meditation cushion', 'yoga meditation pillow',
               'floor cushion bolster', 'yoga bolster'],
    },
    inject: [{ prefix: '9404.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9404.' }],
  },

  // ── Rule 558: BALLOON_INTENT ──────────────────────────────────────────────────
  {
    id: 'BALLOON_INTENT',
    description: 'Balloon/latex balloon/foil balloon → ch.95 (9505.90)',
    pattern: {
      anyOf: ['balloon', 'latex balloon', 'foil balloon', 'helium balloon',
               'mylar balloon', 'giant balloon', 'balloon bouquet'],
    },
    inject: [{ prefix: '9505.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 559: CHRISTMAS_TREE_INTENT ───────────────────────────────────────────
  {
    id: 'CHRISTMAS_TREE_INTENT',
    description: 'Christmas tree/artificial tree → ch.95 (9505.10)',
    pattern: {
      anyOf: ['christmas tree', 'artificial christmas tree', 'pre lit christmas tree',
               'flocked xmas tree', 'slim christmas tree', 'xmas tree'],
    },
    inject: [{ prefix: '9505.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.75, prefixMatch: '9505.10' }],
  },

  // ── Rule 560: GIFT_BOX_INTENT ─────────────────────────────────────────────────
  {
    id: 'GIFT_BOX_INTENT',
    description: 'Gift box/present box/gift packaging → ch.48 (4819.20)',
    pattern: {
      anyOf: ['gift box', 'gift packaging box', 'decorative gift box',
               'rigid gift box', 'magnetic gift box', 'present box'],
    },
    inject: [{ prefix: '4819.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['48'] },
    boosts: [{ delta: 0.65, chapterMatch: '48' }],
  },

  // ── Rule 561: WATER_BOTTLE_INTENT2 ────────────────────────────────────────────
  {
    id: 'WATER_BOTTLE_INTENT2',
    description: 'Water bottle/reusable bottle → ch.73 (7323.93)',
    pattern: {
      anyOf: ['water bottle', 'reusable water bottle', 'stainless water bottle',
               'bpa free bottle', 'sports water bottle'],
      noneOf: ['baby bottle', 'hot water bottle', 'wine bottle'],
    },
    inject: [{ prefix: '7323.93', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73', '39'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 562: THERMOS_INTENT ──────────────────────────────────────────────────
  {
    id: 'THERMOS_INTENT',
    description: 'Thermos/vacuum flask → ch.96 (9617.00)',
    pattern: {
      anyOf: ['thermos', 'thermos flask', 'hot cold thermos', 'vacuum insulated thermos',
               'stainless steel thermos'],
    },
    inject: [{ prefix: '9617.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.75, prefixMatch: '9617.' }],
  },

  // ── Rule 563: HYDRATION_PACK_INTENT ───────────────────────────────────────────
  {
    id: 'HYDRATION_PACK_INTENT',
    description: 'Hydration pack/water backpack → ch.42 (4202.92)',
    pattern: {
      anyOf: ['hydration pack', 'water backpack', 'hydration backpack',
               'running hydration vest', 'camelbak type pack'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.' }],
  },

  // ── Rule 564: TRAVEL_MUG_INTENT ────────────────────────────────────────────────
  {
    id: 'TRAVEL_MUG_INTENT',
    description: 'Travel mug/insulated tumbler → ch.73 (7323.93)',
    pattern: {
      anyOf: ['travel mug', 'insulated travel mug', 'commuter coffee mug',
               'thermos travel mug', 'tumbler travel mug'],
    },
    inject: [{ prefix: '7323.93', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73', '39'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 565: EYE_MASK_SLEEP_INTENT ──────────────────────────────────────────
  {
    id: 'EYE_MASK_SLEEP_INTENT',
    description: 'Sleep eye mask/blackout mask → ch.63 (6307.90)',
    pattern: {
      anyOf: ['eye mask', 'silk sleep eye mask', 'blackout sleep mask',
               'cooling eye mask', 'satin sleeping mask'],
    },
    inject: [{ prefix: '6307.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.60, chapterMatch: '63' }],
  },

  // ── Rule 566: DIAMOND_PAINTING_INTENT ─────────────────────────────────────────
  {
    id: 'DIAMOND_PAINTING_INTENT',
    description: 'Diamond painting/5D diamond art → ch.95 (9503.00)',
    pattern: {
      anyOf: ['diamond painting', '5d diamond painting', 'diamond art kit',
               'diamond dotz', 'diamond mosaic art', 'rhinestone painting'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, chapterMatch: '95' }],
  },

  // ── Rule 567: YARN_INTENT ─────────────────────────────────────────────────────
  {
    id: 'YARN_INTENT',
    description: 'Yarn/knitting yarn/crochet yarn → ch.55/51 (5509.xx)',
    pattern: {
      anyOf: ['yarn', 'knitting yarn', 'crochet yarn', 'wool knitting yarn',
               'acrylic yarn', 'chunky yarn', 'cotton yarn'],
    },
    inject: [{ prefix: '5509.21', syntheticRank: 22 }],
    whitelist: { allowChapters: ['55', '51', '52'] },
    boosts: [{ delta: 0.60, chapterMatch: '55' }],
  },

  // ── Rule 568: RESIN_MOLD_INTENT ───────────────────────────────────────────────
  {
    id: 'RESIN_MOLD_INTENT',
    description: 'Resin mold/silicone mold/casting mold → ch.39 (3926.90)',
    pattern: {
      anyOf: ['resin mold', 'silicone resin mold', 'epoxy casting mold',
               'uv resin mold', 'craft silicone mold'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 569: PHOTO_ALBUM_INTENT ──────────────────────────────────────────────
  {
    id: 'PHOTO_ALBUM_INTENT',
    description: 'Photo album/scrapbook album → ch.49 (4905.91)',
    pattern: {
      anyOf: ['photo album', 'scrapbook photo album', 'slip in photo album',
               'wedding photo album', 'brag book'],
    },
    inject: [{ prefix: '4905.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['49'] },
    boosts: [{ delta: 0.65, chapterMatch: '49' }],
  },

  // ── Rule 570: ALARM_CLOCK_INTENT ──────────────────────────────────────────────
  {
    id: 'ALARM_CLOCK_INTENT',
    description: 'Alarm clock/sunrise clock → ch.91 (9105.11)',
    pattern: {
      anyOf: ['alarm clock', 'digital alarm clock', 'dual alarm clock',
               'sunrise alarm clock', 'smart alarm clock', 'bedside alarm'],
    },
    inject: [{ prefix: '9105.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['91'] },
    boosts: [{ delta: 0.70, prefixMatch: '9105.' }],
  },

  // ── Rule 571: DRAWING_TABLET_INTENT ───────────────────────────────────────────
  {
    id: 'DRAWING_TABLET_INTENT',
    description: 'Drawing/graphics tablet → ch.84 (8471.60 input units)',
    pattern: {
      anyOf: ['drawing tablet', 'graphics drawing tablet', 'pen tablet',
               'wacom type tablet', 'digital drawing pad'],
    },
    inject: [{ prefix: '8471.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8471.' }],
  },

  // ── Rule 572: SMART_SPEAKER_INTENT ────────────────────────────────────────────
  {
    id: 'SMART_SPEAKER_INTENT',
    description: 'Smart/voice assistant speaker → ch.85 (8518.22)',
    pattern: {
      anyOf: ['smart speaker', 'voice assistant speaker', 'alexa speaker',
               'google home type', 'wifi smart speaker'],
    },
    inject: [{ prefix: '8518.22', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, prefixMatch: '8518.' }],
  },

  // ── Rule 573: SURGE_PROTECTOR_INTENT ──────────────────────────────────────────
  {
    id: 'SURGE_PROTECTOR_INTENT',
    description: 'Surge protector/power strip → ch.85 (8536.49)',
    pattern: {
      anyOf: ['surge protector', 'power surge protector', 'surge suppressor',
               'spike guard', 'surge strip', 'power strip', 'multi outlet strip',
               'extension power strip', 'power board'],
    },
    inject: [{ prefix: '8536.49', syntheticRank: 22 }, { prefix: '8536.30', syntheticRank: 30 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, prefixMatch: '8536.' }],
  },

  // ── Rule 574: THERMAL_PRINTER_INTENT ──────────────────────────────────────────
  {
    id: 'THERMAL_PRINTER_INTENT',
    description: 'Thermal/label printer → ch.84 (8443.32)',
    pattern: {
      anyOf: ['thermal printer', 'direct thermal printer', 'label thermal printer',
               'portable thermal printer', 'bluetooth thermal printer'],
    },
    inject: [{ prefix: '8443.32', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8443.' }],
  },

  // ── Rule 575: CPU_COOLER_INTENT ────────────────────────────────────────────────
  {
    id: 'CPU_COOLER_INTENT',
    description: 'CPU/processor cooler → ch.84 (8414.51 fans for cooling)',
    pattern: {
      anyOf: ['cpu cooler', 'processor cooler', 'cpu fan cooler',
               'liquid cpu cooler', 'aio cooler', 'tower cooler'],
    },
    inject: [{ prefix: '8414.51', syntheticRank: 22 }, { prefix: '8473.30', syntheticRank: 28 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.55, prefixMatch: '8414.' }],
  },

  // ── Rule 576: PC_CASE_INTENT ───────────────────────────────────────────────────
  {
    id: 'PC_CASE_INTENT',
    description: 'Computer/PC case/tower → ch.84 (8473.30 computer parts)',
    pattern: {
      anyOf: ['pc case', 'atx case', 'mid tower case', 'mini itx case',
               'computer tower case', 'gaming pc case'],
    },
    inject: [{ prefix: '8473.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8473.' }],
  },

  // ── Rule 577: ELECTRIC_RAZOR_INTENT ───────────────────────────────────────────
  {
    id: 'ELECTRIC_RAZOR_INTENT',
    description: 'Electric razor/shaver → ch.85 (8510.10)',
    pattern: {
      anyOf: ['electric razor', 'electric shaver razor', 'foil razor electric',
               'rotary razor', 'wet dry razor'],
    },
    inject: [{ prefix: '8510.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8510.' }],
  },

  // ── Rule 578: SUNSCREEN_PRODUCT_INTENT ────────────────────────────────────────
  {
    id: 'SUNSCREEN_PRODUCT_INTENT',
    description: 'Sunscreen/sunblock/tanning lotion → ch.33 (3304.99)',
    pattern: {
      anyOf: ['sunscreen lotion', 'sun cream', 'sun block', 'spf lotion',
               'sunscreen spf 50', 'mineral sunscreen', 'tanning lotion',
               'self tanner', 'fake tan', 'sunless tanner', 'gradual tanning lotion'],
    },
    inject: [{ prefix: '3304.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.60, prefixMatch: '3304.' }],
  },

  // ── Rule 579: FACE_CLEANSER_INTENT ────────────────────────────────────────────
  {
    id: 'FACE_CLEANSER_INTENT',
    description: 'Face wash/cleanser/micellar water → ch.33 (3401.30)',
    pattern: {
      anyOf: ['face wash', 'facial cleanser', 'foaming face wash', 'gel cleanser',
               'micellar face wash', 'gentle face wash', 'micellar water',
               'micellar cleansing water', 'makeup remover water', 'no rinse cleanser'],
    },
    inject: [{ prefix: '3401.30', syntheticRank: 22 }, { prefix: '3304.99', syntheticRank: 28 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.55, chapterMatch: '33' }],
  },

  // ── Rule 580: BEARD_CARE_INTENT ────────────────────────────────────────────────
  {
    id: 'BEARD_CARE_INTENT',
    description: 'Beard oil/balm/grooming → ch.33 (3307.90)',
    pattern: {
      anyOf: ['beard oil', 'beard balm', 'beard wax', 'beard styling balm',
               'beard conditioner balm', 'beard butter', 'beard conditioning oil',
               'moisturizing beard oil', 'jojoba beard oil'],
    },
    inject: [{ prefix: '3307.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, prefixMatch: '3307.' }],
  },

  // ── Rule 581: CONTACT_LENS_SOLUTION_INTENT ────────────────────────────────────
  {
    id: 'CONTACT_LENS_SOLUTION_INTENT',
    description: 'Contact lens/saline solution → ch.30 (3004.90)',
    pattern: {
      anyOf: ['contact lens solution', 'saline solution', 'multipurpose lens solution',
               'lens cleaning solution'],
    },
    inject: [{ prefix: '3004.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['30'] },
    boosts: [{ delta: 0.65, chapterMatch: '30' }],
  },

  // ── Rule 582: ENERGY_DRINK_INTENT ─────────────────────────────────────────────
  {
    id: 'ENERGY_DRINK_INTENT',
    description: 'Energy/sports drink → ch.22 (2202.99)',
    pattern: {
      anyOf: ['energy drink', 'sports drink', 'kombucha', 'sparkling water',
               'coconut water', 'electrolyte drink', 'vitamin water'],
    },
    inject: [{ prefix: '2202.99', syntheticRank: 22 }, { prefix: '2202.10', syntheticRank: 28 }],
    whitelist: { allowChapters: ['22'] },
    boosts: [{ delta: 0.60, prefixMatch: '2202.' }],
  },

  // ── Rule 583: PLANT_MILK_INTENT ────────────────────────────────────────────────
  {
    id: 'PLANT_MILK_INTENT',
    description: 'Plant-based milk (oat/almond/soy) → ch.22 (2202.99)',
    pattern: {
      anyOf: ['oat milk', 'almond milk', 'soy milk', 'plant milk',
               'rice milk', 'coconut milk beverage', 'cashew milk'],
    },
    inject: [{ prefix: '2202.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['22'] },
    boosts: [{ delta: 0.60, prefixMatch: '2202.' }],
  },

  // ── Rule 584: BEEF_JERKY_INTENT ────────────────────────────────────────────────
  {
    id: 'BEEF_JERKY_INTENT',
    description: 'Beef jerky/dried meat snack → ch.16 (1602.50)',
    pattern: {
      anyOf: ['beef jerky', 'meat jerky', 'dried beef', 'smoked beef strips',
               'peppered jerky', 'teriyaki beef jerky'],
    },
    inject: [{ prefix: '1602.50', syntheticRank: 22 }, { prefix: '0210.20', syntheticRank: 28 }],
    whitelist: { allowChapters: ['16', '02'] },
    boosts: [{ delta: 0.60, prefixMatch: '1602.' }],
  },

  // ── Rule 585: NUT_BUTTER_INTENT ────────────────────────────────────────────────
  {
    id: 'NUT_BUTTER_INTENT',
    description: 'Peanut/almond/nut butter → ch.20 (2008.11/2008.19)',
    pattern: {
      anyOf: ['peanut butter', 'almond butter', 'tahini', 'cashew butter',
               'sunflower butter', 'nut butter spread'],
    },
    inject: [{ prefix: '2008.11', syntheticRank: 22 }, { prefix: '2008.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['20'] },
    boosts: [{ delta: 0.65, prefixMatch: '2008.' }],
  },

  // ── Rule 586: BABY_FORMULA_INTENT ─────────────────────────────────────────────
  {
    id: 'BABY_FORMULA_INTENT',
    description: 'Baby formula/infant formula → ch.19 (1901.10)',
    pattern: {
      anyOf: ['baby formula', 'infant formula', 'follow on formula',
               'toddler formula', 'goat milk formula', 'hypoallergenic formula'],
    },
    inject: [{ prefix: '1901.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['19'] },
    boosts: [{ delta: 0.70, prefixMatch: '1901.' }],
  },

  // ── Rule 587: CANNED_SOUP_INTENT ──────────────────────────────────────────────
  {
    id: 'CANNED_SOUP_INTENT',
    description: 'Canned soup/broth/stock → ch.21 (2104.10)',
    pattern: {
      anyOf: ['canned soup', 'chicken broth', 'vegetable broth', 'beef broth',
               'chicken stock', 'bone broth', 'miso paste', 'soup mix'],
    },
    inject: [{ prefix: '2104.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['21'] },
    boosts: [{ delta: 0.60, prefixMatch: '2104.' }],
  },

  // ── Rule 588: ENERGY_BAR_INTENT ───────────────────────────────────────────────
  {
    id: 'ENERGY_BAR_INTENT',
    description: 'Energy/protein/meal replacement bar → ch.21 (2106.90)',
    pattern: {
      anyOf: ['energy bar', 'protein bar', 'meal replacement bar', 'granola bar',
               'cereal bar', 'nutrition bar', 'meal replacement shake', 'meal replacement'],
    },
    inject: [{ prefix: '2106.90', syntheticRank: 22 }, { prefix: '1904.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['21', '19'] },
    boosts: [{ delta: 0.55, prefixMatch: '2106.' }],
  },

  // ── Rule 589: BBQ_GRILL_INTENT ────────────────────────────────────────────────
  {
    id: 'BBQ_GRILL_INTENT',
    description: 'Barbecue/BBQ grill → ch.73 (7321.11)',
    pattern: {
      anyOf: ['barbecue grill', 'gas bbq grill', 'charcoal bbq', 'portable grill',
               'propane grill', 'kamado grill', 'outdoor grill', 'bbq smoker'],
    },
    inject: [{ prefix: '7321.11', syntheticRank: 22 }, { prefix: '7321.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, prefixMatch: '7321.' }],
  },

  // ── Rule 590: COMPOST_BIN_INTENT ──────────────────────────────────────────────
  {
    id: 'COMPOST_BIN_INTENT',
    description: 'Compost bin/tumbler → ch.39 (3923.10)',
    pattern: {
      anyOf: ['compost bin', 'garden compost bin', 'tumbling composter',
               'worm composter', 'kitchen composter', 'compost tumbler'],
    },
    inject: [{ prefix: '3923.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 591: LEAF_BLOWER_INTENT ──────────────────────────────────────────────
  {
    id: 'LEAF_BLOWER_INTENT',
    description: 'Leaf blower/garden blower → ch.84 (8467.81)',
    pattern: {
      anyOf: ['leaf blower', 'garden leaf blower', 'cordless leaf blower',
               'backpack leaf blower', 'electric leaf blower'],
    },
    inject: [{ prefix: '8467.81', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8467.' }],
  },

  // ── Rule 592: HEDGE_TRIMMER_INTENT ────────────────────────────────────────────
  {
    id: 'HEDGE_TRIMMER_INTENT',
    description: 'Hedge trimmer/garden trimmer → ch.84 (8508.80)',
    pattern: {
      anyOf: ['hedge trimmer', 'electric hedge trimmer', 'cordless hedge cutter',
               'garden hedge shears', 'topiary trimmer'],
    },
    inject: [{ prefix: '8508.80', syntheticRank: 22 }, { prefix: '8467.81', syntheticRank: 26 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8508.' }],
  },

  // ── Rule 593: PATIO_UMBRELLA_INTENT ───────────────────────────────────────────
  {
    id: 'PATIO_UMBRELLA_INTENT',
    description: 'Patio/garden umbrella/parasol → ch.66 (6601.99)',
    pattern: {
      anyOf: ['patio umbrella', 'garden umbrella', 'outdoor parasol',
               'cantilever umbrella', 'offset patio umbrella'],
    },
    inject: [{ prefix: '6601.99', syntheticRank: 22 }, { prefix: '6601.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['66'] },
    boosts: [{ delta: 0.65, prefixMatch: '6601.' }],
  },

  // ── Rule 594: RAISED_BED_INTENT ───────────────────────────────────────────────
  {
    id: 'RAISED_BED_INTENT',
    description: 'Raised garden bed → ch.73 (7308.90) or ch.44 (4421.90)',
    pattern: {
      anyOf: ['raised bed', 'raised garden bed', 'elevated planter bed',
               'raised planting bed', 'cedar raised bed'],
    },
    inject: [{ prefix: '7308.90', syntheticRank: 22 }, { prefix: '4421.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73', '44'] },
    boosts: [{ delta: 0.50, chapterMatch: '73' }, { delta: 0.45, chapterMatch: '44' }],
  },

  // ── Rule 595: WIRE_STRIPPER_INTENT ────────────────────────────────────────────
  {
    id: 'WIRE_STRIPPER_INTENT',
    description: 'Wire stripper/cable stripper → ch.82 (8203.20)',
    pattern: {
      anyOf: ['wire stripper', 'cable stripper', 'wire stripping tool',
               'self adjusting stripper', 'electrician stripper'],
    },
    inject: [{ prefix: '8203.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8203.' }],
  },

  // ── Rule 596: LASER_LEVEL_INTENT ──────────────────────────────────────────────
  {
    id: 'LASER_LEVEL_INTENT',
    description: 'Laser level/surveying tool → ch.90 (9015.80)',
    pattern: {
      anyOf: ['laser level', 'self leveling laser', 'cross line laser level',
               'red beam laser level', 'green laser level'],
    },
    inject: [{ prefix: '9015.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9015.' }],
  },

  // ── Rule 597: CAULKING_GUN_INTENT ─────────────────────────────────────────────
  {
    id: 'CAULKING_GUN_INTENT',
    description: 'Caulking gun/silicone gun → ch.84 (8413.20)',
    pattern: {
      anyOf: ['caulking gun', 'caulk gun', 'silicone gun', 'sausage gun',
               'manual caulk gun', 'drip free caulk gun'],
    },
    inject: [{ prefix: '8413.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8413.' }],
  },

  // ── Rule 598: TILE_CUTTER_INTENT ──────────────────────────────────────────────
  {
    id: 'TILE_CUTTER_INTENT',
    description: 'Tile cutter/tile saw → ch.82 (8205.59)',
    pattern: {
      anyOf: ['tile cutter', 'manual tile cutter', 'tile saw',
               'wet tile saw', 'porcelain cutter'],
    },
    inject: [{ prefix: '8205.59', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82', '84'] },
    boosts: [{ delta: 0.55, prefixMatch: '8205.' }],
  },

  // ── Rule 599: HACKSAW_INTENT ───────────────────────────────────────────────────
  {
    id: 'HACKSAW_INTENT',
    description: 'Hacksaw/metal saw → ch.82 (8202.99)',
    pattern: {
      anyOf: ['hacksaw', 'metal hacksaw', 'junior hacksaw', 'mini hacksaw',
               'bow saw metal'],
    },
    inject: [{ prefix: '8202.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8202.' }],
  },

  // ── Rule 600: SMOKE_ALARM_INTENT ──────────────────────────────────────────────
  {
    id: 'SMOKE_ALARM_INTENT',
    description: 'Smoke alarm/fire detector → ch.85 (8531.10)',
    pattern: {
      anyOf: ['smoke alarm', 'smoke detector alarm', 'fire smoke alarm',
               'photoelectric alarm', 'combination alarm', 'ionization alarm'],
    },
    inject: [{ prefix: '8531.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8531.' }],
  },

  // ── Rule 601: CO_DETECTOR_INTENT ──────────────────────────────────────────────
  {
    id: 'CO_DETECTOR_INTENT',
    description: 'Carbon monoxide/CO detector → ch.85 (8531.10)',
    pattern: {
      anyOf: ['carbon monoxide alarm', 'co alarm', 'carbon monoxide detector',
               'co detector', 'co gas alarm'],
    },
    inject: [{ prefix: '8531.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8531.' }],
  },

  // ── Rule 602: HOME_SAFE_INTENT ────────────────────────────────────────────────
  {
    id: 'HOME_SAFE_INTENT',
    description: 'Home safe/fireproof safe → ch.83 (8303.00)',
    pattern: {
      anyOf: ['home safe', 'fireproof safe', 'floor safe', 'wall safe',
               'digital safe', 'steel home safe', 'gun safe', 'valuables safe'],
    },
    inject: [{ prefix: '8303.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['83'] },
    boosts: [{ delta: 0.75, prefixMatch: '8303.' }],
  },

  // ── Rule 603: FILING_CABINET_INTENT ───────────────────────────────────────────
  {
    id: 'FILING_CABINET_INTENT',
    description: 'Filing cabinet/office cabinet → ch.94 (9403.10)',
    pattern: {
      anyOf: ['filing cabinet', 'metal filing cabinet', 'lateral file cabinet',
               'two drawer cabinet', 'pedestal cabinet'],
    },
    inject: [{ prefix: '9403.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.65, prefixMatch: '9403.' }],
  },

  // ── Rule 604: SHIPPING_SUPPLIES_INTENT ────────────────────────────────────────
  {
    id: 'SHIPPING_SUPPLIES_INTENT',
    description: 'Shipping envelope/mailer/poly bag → ch.48 (4819.40)',
    pattern: {
      anyOf: ['shipping envelope', 'bubble mailer', 'padded envelope',
               'poly mailer', 'jiffy envelope', 'kraft envelope'],
    },
    inject: [{ prefix: '4819.40', syntheticRank: 22 }, { prefix: '4819.20', syntheticRank: 26 }],
    whitelist: { allowChapters: ['48', '39'] },
    boosts: [{ delta: 0.55, prefixMatch: '4819.' }],
  },

  // ── Rule 605: STAMP_PAD_INTENT ────────────────────────────────────────────────
  {
    id: 'STAMP_PAD_INTENT',
    description: 'Stamp pad/ink pad → ch.96 (9612.10)',
    pattern: {
      anyOf: ['stamp pad', 'ink pad', 'rubber stamp pad', 'felt stamp pad',
               'archival ink pad', 'reinker pad'],
    },
    inject: [{ prefix: '9612.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, prefixMatch: '9612.' }],
  },

  // ── Rule 606: BABY_GYM_INTENT ─────────────────────────────────────────────────
  {
    id: 'BABY_GYM_INTENT',
    description: 'Baby gym/activity gym/play arch → ch.95 (9503.00)',
    pattern: {
      anyOf: ['baby gym', 'activity gym', 'play gym mat', 'infant activity gym',
               'tummy time gym', 'baby play arch'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9503.' }],
  },

  // ── Rule 607: PLAY_TENT_INTENT ────────────────────────────────────────────────
  {
    id: 'PLAY_TENT_INTENT',
    description: 'Kids play tent/teepee → ch.95 (9503.00)',
    pattern: {
      anyOf: ['play tent', 'kids play tent', 'teepee tent kids', 'pop up play tent',
               'indoor tent kids', 'princess tent'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9503.' }],
  },

  // ── Rule 608: CRAYONS_INTENT ──────────────────────────────────────────────────
  {
    id: 'CRAYONS_INTENT',
    description: 'Crayons/wax crayons → ch.96 (9609.10)',
    pattern: {
      anyOf: ['crayons', 'wax crayons', 'jumbo crayons', 'twist crayons',
               'washable crayons', 'colored crayons set'],
    },
    inject: [{ prefix: '9609.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.70, prefixMatch: '9609.' }],
  },

  // ── Rule 609: SLIME_KIT_INTENT ────────────────────────────────────────────────
  {
    id: 'SLIME_KIT_INTENT',
    description: 'Slime kit/toy slime → ch.95 (9503.00)',
    pattern: {
      anyOf: ['slime kit', 'slime making kit', 'diy slime set', 'fluffy slime',
               'glitter slime kit', 'unicorn slime'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9503.' }],
  },

  // ── Rule 610: SANDBOX_INTENT ──────────────────────────────────────────────────
  {
    id: 'SANDBOX_INTENT',
    description: 'Kids sandbox/sand pit → ch.95 (9503.00)',
    pattern: {
      anyOf: ['sandbox', 'sand pit', 'kids sandbox', 'backyard sandbox',
               'covered sandbox', 'plastic sandbox'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9503.' }],
  },

  // ── Rule 611: TRAMPOLINE_INTENT ───────────────────────────────────────────────
  {
    id: 'TRAMPOLINE_INTENT',
    description: 'Trampoline/garden trampoline → ch.95 (9506.99)',
    pattern: {
      anyOf: ['trampoline', 'garden trampoline', 'backyard trampoline',
               'rectangular trampoline', 'trampoline with net', 'mini trampoline'],
    },
    inject: [{ prefix: '9506.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 612: TENNIS_BALL_INTENT ──────────────────────────────────────────────
  {
    id: 'TENNIS_BALL_INTENT',
    description: 'Tennis ball → ch.95 (9506.61)',
    pattern: {
      anyOf: ['tennis ball', 'pressurized tennis ball', 'practice tennis ball',
               'foam tennis ball', 'bulk tennis balls'],
    },
    inject: [{ prefix: '9506.61', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.70, prefixMatch: '9506.61' }],
  },

  // ── Rule 613: BADMINTON_INTENT ────────────────────────────────────────────────
  {
    id: 'BADMINTON_INTENT',
    description: 'Badminton set/shuttlecock → ch.95 (9506.59)',
    pattern: {
      anyOf: ['badminton set', 'badminton racket set', 'shuttlecock set',
               'badminton net set', 'outdoor badminton', 'shuttlecock'],
    },
    inject: [{ prefix: '9506.59', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 614: CLIMBING_HARNESS_INTENT ─────────────────────────────────────────
  {
    id: 'CLIMBING_HARNESS_INTENT',
    description: 'Climbing harness/belay harness → ch.63 (6307.90)',
    pattern: {
      anyOf: ['climbing harness', 'rock climbing harness', 'sport harness',
               'belay harness', 'full body harness'],
    },
    inject: [{ prefix: '6307.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.60, prefixMatch: '6307.' }],
  },

  // ── Rule 615: RAIN_BOOTS_INTENT ───────────────────────────────────────────────
  {
    id: 'RAIN_BOOTS_INTENT',
    description: 'Rain boots/wellies/rubber boots → ch.64 (6401.99)',
    pattern: {
      anyOf: ['rain boots', 'rubber boots', 'wellies', 'wellington boots',
               'waterproof boots', 'gum boots'],
    },
    inject: [{ prefix: '6401.99', syntheticRank: 22 }, { prefix: '6401.92', syntheticRank: 26 }],
    whitelist: { allowChapters: ['64'] },
    boosts: [{ delta: 0.65, prefixMatch: '6401.' }],
  },

  // ── Rule 616: WORK_BOOTS_INTENT ───────────────────────────────────────────────
  {
    id: 'WORK_BOOTS_INTENT',
    description: 'Work/safety boots → ch.64 (6403.40)',
    pattern: {
      anyOf: ['work boots', 'steel toe boots', 'safety boots',
               'composite toe boots', 'leather work boots'],
    },
    inject: [{ prefix: '6403.40', syntheticRank: 22 }, { prefix: '6402.91', syntheticRank: 26 }],
    whitelist: { allowChapters: ['64'] },
    boosts: [{ delta: 0.60, prefixMatch: '6403.' }],
  },

  // ── Rule 617: CHELSEA_BOOTS_INTENT ────────────────────────────────────────────
  {
    id: 'CHELSEA_BOOTS_INTENT',
    description: 'Chelsea/ankle boots → ch.64 (6403.99)',
    pattern: {
      anyOf: ['chelsea boots', 'ankle chelsea boots', 'leather chelsea boots',
               'slip on chelsea boots'],
    },
    inject: [{ prefix: '6403.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['64'] },
    boosts: [{ delta: 0.55, prefixMatch: '6403.' }],
  },

  // ── Rule 618: LOAFERS_INTENT ──────────────────────────────────────────────────
  {
    id: 'LOAFERS_INTENT',
    description: 'Loafers/penny loafers/moccasins → ch.64 (6403.59)',
    pattern: {
      anyOf: ['loafers', 'slip on loafers', 'penny loafer', 'leather loafer',
               'driving loafer', 'moccasin loafer'],
    },
    inject: [{ prefix: '6403.59', syntheticRank: 22 }],
    whitelist: { allowChapters: ['64'] },
    boosts: [{ delta: 0.55, prefixMatch: '6403.' }],
  },

  // ── Rule 619: ELECTRIC_SCOOTER_INTENT ─────────────────────────────────────────
  {
    id: 'ELECTRIC_SCOOTER_INTENT',
    description: 'Electric scooter/e-scooter → ch.87 (8714.99)',
    pattern: {
      anyOf: ['electric scooter', 'e scooter', 'adult electric scooter',
               'folding electric scooter', 'kick scooter electric'],
    },
    inject: [{ prefix: '8714.99', syntheticRank: 22 }, { prefix: '8714.92', syntheticRank: 26 }],
    whitelist: { allowChapters: ['87'] },
    boosts: [{ delta: 0.65, prefixMatch: '8714.' }],
  },

  // ── Rule 620: HOVERBOARD_INTENT ───────────────────────────────────────────────
  {
    id: 'HOVERBOARD_INTENT',
    description: 'Hoverboard/self-balancing scooter → ch.87 (8714.99)',
    pattern: {
      anyOf: ['hoverboard', 'self balancing board', 'balance board hoverboard',
               'electric hoverboard', 'segway type'],
    },
    inject: [{ prefix: '8714.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['87'] },
    boosts: [{ delta: 0.65, prefixMatch: '8714.' }],
  },

  // ── Rule 621: MOTORCYCLE_HELMET_INTENT ────────────────────────────────────────
  {
    id: 'MOTORCYCLE_HELMET_INTENT',
    description: 'Motorcycle/motorbike helmet → ch.65 (6506.10)',
    pattern: {
      anyOf: ['motorcycle helmet', 'full face helmet', 'half face helmet',
               'motorbike helmet', 'dirt bike helmet', 'open face helmet'],
    },
    inject: [{ prefix: '6506.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['65'] },
    boosts: [{ delta: 0.70, prefixMatch: '6506.10' }],
    penalties: [{ delta: -0.60, prefixMatch: '9506.' }],
  },

  // ── Rule 622: BICYCLE_LOCK_INTENT ─────────────────────────────────────────────
  {
    id: 'BICYCLE_LOCK_INTENT',
    description: 'Bicycle/bike lock → ch.83 (8301.20)',
    pattern: {
      anyOf: ['bicycle lock', 'bike lock', 'chain bike lock', 'u lock bike',
               'folding bike lock', 'cable bike lock'],
    },
    inject: [{ prefix: '8301.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['83'] },
    boosts: [{ delta: 0.65, prefixMatch: '8301.' }],
  },

  // ── Rule 623: WAFFLE_MAKER_INTENT ─────────────────────────────────────────────
  {
    id: 'WAFFLE_MAKER_INTENT',
    description: 'Waffle maker/waffle iron → ch.85 (8516.60)',
    pattern: {
      anyOf: ['waffle maker', 'waffle iron', 'belgian waffle maker',
               'mini waffle maker', 'flip waffle iron'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 624: BREAD_MAKER_INTENT ──────────────────────────────────────────────
  {
    id: 'BREAD_MAKER_INTENT',
    description: 'Bread maker/bread machine → ch.85 (8516.60)',
    pattern: {
      anyOf: ['bread maker', 'bread machine', 'automatic bread maker',
               'programmable bread machine', 'home bread maker'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 625: PASTA_MAKER_INTENT ──────────────────────────────────────────────
  {
    id: 'PASTA_MAKER_INTENT',
    description: 'Pasta maker/pasta machine → ch.84 (8509.40)',
    pattern: {
      anyOf: ['pasta maker', 'pasta machine', 'manual pasta maker', 'pasta roller',
               'lasagna maker', 'pasta rolling machine'],
    },
    inject: [{ prefix: '8509.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8509.' }],
  },

  // ── Rule 626: MEAT_THERMOMETER_INTENT ─────────────────────────────────────────
  {
    id: 'MEAT_THERMOMETER_INTENT',
    description: 'Meat/kitchen/BBQ thermometer → ch.90 (9025.19)',
    pattern: {
      anyOf: ['meat thermometer', 'instant read thermometer', 'wireless thermometer',
               'probe thermometer', 'bbq thermometer', 'kitchen thermometer'],
    },
    inject: [{ prefix: '9025.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9025.' }],
  },

  // ── Rule 627: MANDOLINE_SLICER_INTENT ─────────────────────────────────────────
  {
    id: 'MANDOLINE_SLICER_INTENT',
    description: 'Mandoline/vegetable slicer → ch.82 (8210.00)',
    pattern: {
      anyOf: ['mandoline slicer', 'adjustable mandoline', 'vegetable mandoline',
               'japanese mandoline', 'safety mandoline', 'vegetable spiralizer',
               'spiral slicer', 'veggie slicer noodle'],
    },
    inject: [{ prefix: '8210.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8210.' }],
  },

  // ── Rule 628: KITCHEN_TORCH_INTENT ────────────────────────────────────────────
  {
    id: 'KITCHEN_TORCH_INTENT',
    description: 'Kitchen/culinary torch/brulee torch → ch.82 (8205.40)',
    pattern: {
      anyOf: ['kitchen torch', 'culinary torch', 'brulee torch',
               'blow torch kitchen', 'creme brulee torch'],
    },
    inject: [{ prefix: '8205.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8205.' }],
  },

  // ── Rule 629: AIR_MATTRESS_INTENT ─────────────────────────────────────────────
  {
    id: 'AIR_MATTRESS_INTENT',
    description: 'Air mattress/inflatable bed → ch.94 (9404.29)',
    pattern: {
      anyOf: ['air mattress', 'inflatable mattress', 'camping air bed',
               'blow up mattress', 'self inflating mat', 'guest air bed'],
    },
    inject: [{ prefix: '9404.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, prefixMatch: '9404.' }],
  },

  // ── Rule 630: MATTRESS_TOPPER_INTENT ──────────────────────────────────────────
  {
    id: 'MATTRESS_TOPPER_INTENT',
    description: 'Mattress topper/pad/protector → ch.94 (9404.29)',
    pattern: {
      anyOf: ['mattress topper', 'memory foam topper', 'latex topper',
               'featherbed topper', 'cooling topper', 'mattress protector',
               'waterproof mattress cover', 'mattress encasement'],
    },
    inject: [{ prefix: '9404.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, prefixMatch: '9404.' }],
  },

  // ── Rule 631: GROW_BAG_INTENT ─────────────────────────────────────────────────
  {
    id: 'GROW_BAG_INTENT',
    description: 'Fabric grow bag/planting bag → ch.39 (3923.29)',
    pattern: {
      anyOf: ['grow bag', 'fabric grow bag', 'planting grow bag',
               'tomato grow bag', 'potato grow bag'],
    },
    inject: [{ prefix: '3923.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39', '63'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 632: GREENHOUSE_INTENT ───────────────────────────────────────────────
  {
    id: 'GREENHOUSE_INTENT',
    description: 'Garden greenhouse/cold frame → ch.76 (7610.90)',
    pattern: {
      anyOf: ['greenhouse', 'mini greenhouse', 'walk in greenhouse',
               'cold frame greenhouse', 'portable greenhouse'],
    },
    inject: [{ prefix: '7610.90', syntheticRank: 22 }, { prefix: '7308.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['76', '73', '39'] },
    boosts: [{ delta: 0.50, chapterMatch: '76' }, { delta: 0.45, chapterMatch: '73' }],
  },

  // ── Rule 633: SELF_WATERING_PLANTER_INTENT ────────────────────────────────────
  {
    id: 'SELF_WATERING_PLANTER_INTENT',
    description: 'Self-watering planter/pot → ch.39 (3924.90)',
    pattern: {
      anyOf: ['self watering planter', 'self watering pot', 'reservoir planter',
               'wicking planter', 'indoor self water pot'],
    },
    inject: [{ prefix: '3924.90', syntheticRank: 22 }, { prefix: '6911.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '69'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 634: DUMPLING_PRESS_INTENT ───────────────────────────────────────────
  {
    id: 'DUMPLING_PRESS_INTENT',
    description: 'Dumpling/tortilla press/mold → ch.73 (7323.99)',
    pattern: {
      anyOf: ['dumpling press', 'dumpling maker', 'empanada press', 'gyoza maker',
               'pierogi maker', 'ravioli stamp', 'tortilla press', 'tortilla maker press',
               'corn tortilla press'],
    },
    inject: [{ prefix: '7323.99', syntheticRank: 22 }, { prefix: '3924.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73', '39'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 635: MORTAR_PESTLE_INTENT ────────────────────────────────────────────
  {
    id: 'MORTAR_PESTLE_INTENT',
    description: 'Mortar and pestle/grinding bowl → ch.68 (6815.10)',
    pattern: {
      anyOf: ['mortar and pestle', 'granite mortar pestle', 'ceramic mortar',
               'stone mortar', 'grinding mortar'],
    },
    inject: [{ prefix: '6815.10', syntheticRank: 22 }, { prefix: '8210.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['68', '82', '69'] },
    boosts: [{ delta: 0.60, chapterMatch: '68' }],
  },

  // ── Rule 636: SECURITY_LIGHT_INTENT ───────────────────────────────────────────
  {
    id: 'SECURITY_LIGHT_INTENT',
    description: 'Security/motion sensor floodlight → ch.85 (8531.80)',
    pattern: {
      anyOf: ['security light', 'motion sensor floodlight', 'outdoor security light',
               'solar security light', 'led floodlight', 'flood light'],
    },
    inject: [{ prefix: '8531.80', syntheticRank: 22 }, { prefix: '9405.49', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85', '94'] },
    boosts: [{ delta: 0.55, prefixMatch: '8531.' }],
  },

  // ── Rule 637: VOLTAGE_TESTER_INTENT ───────────────────────────────────────────
  {
    id: 'VOLTAGE_TESTER_INTENT',
    description: 'Voltage/circuit tester → ch.90 (9030.33)',
    pattern: {
      anyOf: ['voltage tester', 'electrical tester tool', 'non contact tester',
               'current tester', 'circuit tester', 'outlet tester'],
    },
    inject: [{ prefix: '9030.33', syntheticRank: 22 }, { prefix: '9030.89', syntheticRank: 26 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.60, prefixMatch: '9030.' }],
  },

  // ── Rule 638: WOOD_CHISEL_INTENT ──────────────────────────────────────────────
  {
    id: 'WOOD_CHISEL_INTENT',
    description: 'Wood chisel/carving chisel/hand plane → ch.82 (8205.20)',
    pattern: {
      anyOf: ['wood chisel', 'firmer chisel', 'mortise chisel', 'bench chisel',
               'bevel edge chisel', 'carving chisel', 'hand plane', 'block plane',
               'smoothing plane', 'jack plane'],
    },
    inject: [{ prefix: '8205.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8205.' }],
  },

  // ── Rule 639: BOW_TIE_INTENT ───────────────────────────────────────────────────
  {
    id: 'BOW_TIE_INTENT',
    description: 'Bow tie/tie clip/suspenders → ch.62 (6215.20)',
    pattern: {
      anyOf: ['bow tie', 'pre tied bow tie', 'self tie bow tie', 'silk bow tie',
               'tie clip', 'tie bar', 'necktie clip', 'tie pin', 'suspenders',
               'braces suspenders', 'clip on suspenders'],
    },
    inject: [{ prefix: '6215.20', syntheticRank: 22 }, { prefix: '6215.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['62', '83'] },
    boosts: [{ delta: 0.55, chapterMatch: '62' }],
  },

  // ── Rule 640: KAYAK_PADDLE_INTENT ─────────────────────────────────────────────
  {
    id: 'KAYAK_PADDLE_INTENT',
    description: 'Kayak/canoe paddle → ch.95 (9506.29)',
    pattern: {
      anyOf: ['kayak paddle', 'canoe paddle', 'kayaking paddle', 'carbon paddle',
               'lightweight paddle', 'split paddle'],
    },
    inject: [{ prefix: '9506.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9506.' }],
  },

  // ── Rule 641: FLIP_CHART_INTENT ───────────────────────────────────────────────
  {
    id: 'FLIP_CHART_INTENT',
    description: 'Flip chart/presentation pad/easel pad → ch.48 (4820.20)',
    pattern: {
      anyOf: ['flip chart', 'flip chart pad', 'easel paper pad',
               'presentation paper pad', 'meeting flip chart'],
    },
    inject: [{ prefix: '4820.20', syntheticRank: 22 }, { prefix: '4820.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['48'] },
    boosts: [{ delta: 0.60, prefixMatch: '4820.' }],
  },

  // ── Rule 642: ROW_COVER_INTENT ────────────────────────────────────────────────
  {
    id: 'ROW_COVER_INTENT',
    description: 'Row cover/frost cloth/garden fleece → ch.59 (5911.90)',
    pattern: {
      anyOf: ['row cover', 'frost cloth', 'garden fleece', 'plant cover frost',
               'floating row cover', 'garden netting', 'plant netting', 'crop protection net'],
    },
    inject: [{ prefix: '5911.90', syntheticRank: 22 }, { prefix: '6307.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['59', '63'] },
    boosts: [{ delta: 0.55, chapterMatch: '59' }],
  },

  // ── Rule 643: BANJO_INTENT ─────────────────────────────────────────────────────
  {
    id: 'BANJO_INTENT',
    description: 'Banjo/bluegrass banjo → ch.92 (9202.90)',
    pattern: {
      anyOf: ['banjo', '5 string banjo', 'bluegrass banjo', 'tenor banjo',
               'open back banjo', 'resonator banjo'],
    },
    inject: [{ prefix: '9202.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, prefixMatch: '9202.' }],
  },

  // ── Rule 644: DJEMBE_PERCUSSION_INTENT ────────────────────────────────────────
  {
    id: 'DJEMBE_PERCUSSION_INTENT',
    description: 'Djembe/bongo drum/hand percussion → ch.92 (9206.00)',
    pattern: {
      anyOf: ['djembe', 'hand drum djembe', 'african djembe', 'bongo drum',
               'bongo drums', 'percussion bongo', 'latin bongo set'],
    },
    inject: [{ prefix: '9206.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.70, prefixMatch: '9206.' }],
  },

  // ── Rule 645: CLARINET_OBOE_INTENT ────────────────────────────────────────────
  {
    id: 'CLARINET_OBOE_INTENT',
    description: 'Clarinet/oboe/recorder → ch.92 (9205.90)',
    pattern: {
      anyOf: ['clarinet', 'bb clarinet', 'bass clarinet', 'student clarinet',
               'oboe', 'student oboe', 'recorder', 'soprano recorder', 'alto recorder',
               'plastic recorder', 'baroque recorder', 'mandolin', 'acoustic mandolin'],
    },
    inject: [{ prefix: '9205.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.65, prefixMatch: '9205.' }],
  },

  // ── Rule 646: METRONOME_INTENT ────────────────────────────────────────────────
  {
    id: 'METRONOME_INTENT',
    description: 'Metronome/tuning fork → ch.92 (9209.99)',
    pattern: {
      anyOf: ['metronome', 'digital metronome', 'mechanical metronome',
               'clip on metronome', 'tuning fork', 'a440 tuning fork', 'pitch fork tuning'],
    },
    inject: [{ prefix: '9209.99', syntheticRank: 22 }, { prefix: '9209.91', syntheticRank: 26 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.65, prefixMatch: '9209.' }],
  },

  // ── Rule 647: CAMERA_LENS_INTENT ──────────────────────────────────────────────
  {
    id: 'CAMERA_LENS_INTENT',
    description: 'Camera lens/photography lens → ch.90 (9002.11)',
    pattern: {
      anyOf: ['camera lens', 'dslr lens', 'mirrorless lens', 'telephoto lens',
               'wide angle lens', 'prime lens', 'polarizing filter', 'circular polarizer',
               'cpl filter'],
    },
    inject: [{ prefix: '9002.11', syntheticRank: 22 }, { prefix: '9002.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9002.' }],
  },

  // ── Rule 648: RING_LIGHT_INTENT ───────────────────────────────────────────────
  {
    id: 'RING_LIGHT_INTENT',
    description: 'Ring light/LED video/studio light → ch.85 (8543.70)',
    pattern: {
      anyOf: ['ring light', 'selfie ring light', 'led ring light', 'beauty ring light',
               'clip on ring light', 'led video light', 'video panel light', 'led fill light',
               'bi color led panel', 'studio backdrop', 'photography backdrop',
               'green screen', 'chroma key backdrop'],
    },
    inject: [{ prefix: '9405.49', syntheticRank: 22 }, { prefix: '8543.70', syntheticRank: 26 }],
    whitelist: { allowChapters: ['94', '85'] },
    boosts: [{ delta: 0.55, chapterMatch: '94' }],
  },

  // ── Rule 649: GAMING_MONITOR_INTENT ───────────────────────────────────────────
  {
    id: 'GAMING_MONITOR_INTENT',
    description: 'Gaming monitor/display → ch.85 (8528.52)',
    pattern: {
      anyOf: ['gaming monitor', '144hz monitor', 'curved gaming monitor',
               '4k gaming monitor', 'freesync monitor', 'gsync monitor'],
    },
    inject: [{ prefix: '8528.52', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8528.' }],
  },

  // ── Rule 650: GAME_CONTROLLER_INTENT ──────────────────────────────────────────
  {
    id: 'GAME_CONTROLLER_INTENT',
    description: 'Game controller/joystick/racing wheel → ch.95 (9504.50)',
    pattern: {
      anyOf: ['game controller', 'wireless controller', 'gamepad controller',
               'usb game controller', 'pc controller', 'joystick', 'flight joystick',
               'arcade joystick', 'steering wheel controller', 'racing wheel',
               'gaming steering wheel', 'force feedback wheel'],
    },
    inject: [{ prefix: '9504.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95', '85'] },
    boosts: [{ delta: 0.65, prefixMatch: '9504.' }],
  },

  // ── Rule 651: SMART_LOCK_INTENT ───────────────────────────────────────────────
  {
    id: 'SMART_LOCK_INTENT',
    description: 'Smart lock/keyless lock → ch.83 (8301.40)',
    pattern: {
      anyOf: ['smart lock', 'keyless door lock', 'wifi smart lock',
               'bluetooth door lock', 'digital door lock', 'fingerprint lock'],
    },
    inject: [{ prefix: '8301.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['83'] },
    boosts: [{ delta: 0.65, prefixMatch: '8301.' }],
  },

  // ── Rule 652: NEEDLE_FELT_CRAFT_INTENT ────────────────────────────────────────
  {
    id: 'NEEDLE_FELT_CRAFT_INTENT',
    description: 'Needle felting kit/craft → ch.56 (5601.29)',
    pattern: {
      anyOf: ['needle felt', 'needle felting kit', 'wool felt needle', 'felting needle set',
               'starter felting kit'],
    },
    inject: [{ prefix: '5601.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['56', '63'] },
    boosts: [{ delta: 0.55, chapterMatch: '56' }],
  },

  // ── Rule 653: CRAFT_KIT_INTENT ────────────────────────────────────────────────
  {
    id: 'CRAFT_KIT_INTENT',
    description: 'Craft kit (cross stitch, macrame, candle, soap, jewelry) → ch.95 (9503.00)',
    pattern: {
      anyOf: ['cross stitch kit', 'counted cross stitch', 'macrame kit', 'macrame starter kit',
               'candle making kit', 'soap making kit', 'jewelry making kit', 'loom',
               'weaving loom', 'peg loom'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }, { prefix: '6307.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['95', '63'] },
    boosts: [{ delta: 0.55, prefixMatch: '9503.' }],
  },

  // ── Rule 654: POTTERY_CLAY_INTENT ─────────────────────────────────────────────
  {
    id: 'POTTERY_CLAY_INTENT',
    description: 'Pottery/modeling/sculpting clay → ch.68 (6810.11)',
    pattern: {
      anyOf: ['pottery clay', 'air dry clay', 'kiln fire clay', 'self hardening clay',
               'modeling clay', 'sculpting clay', 'non drying clay', 'plasticine',
               'oil based clay'],
    },
    inject: [{ prefix: '6810.11', syntheticRank: 22 }, { prefix: '3407.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['68', '34'] },
    boosts: [{ delta: 0.55, chapterMatch: '68' }],
  },

  // ── Rule 655: ART_PAINT_INTENT ────────────────────────────────────────────────
  {
    id: 'ART_PAINT_INTENT',
    description: 'Watercolor/oil paint/art supplies → ch.32 (3213.10)',
    pattern: {
      anyOf: ['watercolor paint', 'watercolor set', 'watercolour paints', 'tube watercolor',
               'oil paint', 'artist oil paint', 'oil painting set', 'oil colour tubes',
               'paint palette', 'mixing palette', 'chalk pastel', 'soft pastels',
               'oil pastels set'],
    },
    inject: [{ prefix: '3213.10', syntheticRank: 22 }, { prefix: '3213.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['32'] },
    boosts: [{ delta: 0.65, prefixMatch: '3213.' }],
  },

  // ── Rule 656: EASEL_INTENT ─────────────────────────────────────────────────────
  {
    id: 'EASEL_INTENT',
    description: 'Easel/art stand → ch.44 (4421.90) or ch.73 (7326.90)',
    pattern: {
      anyOf: ['easel', 'tabletop easel', 'studio easel', 'tripod easel',
               'a frame easel', 'french easel'],
    },
    inject: [{ prefix: '4421.90', syntheticRank: 22 }, { prefix: '7326.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['44', '73'] },
    boosts: [{ delta: 0.55, chapterMatch: '44' }],
  },

  // ── Rule 657: MASSAGE_GUN_INTENT ──────────────────────────────────────────────
  {
    id: 'MASSAGE_GUN_INTENT',
    description: 'Massage gun/percussion massager → ch.90 (9019.10)',
    pattern: {
      anyOf: ['massage gun', 'percussion massager', 'deep tissue massager',
               'muscle gun massager', 'fascia gun'],
    },
    inject: [{ prefix: '9019.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9019.' }],
  },

  // ── Rule 658: FOOT_MASSAGER_INTENT ────────────────────────────────────────────
  {
    id: 'FOOT_MASSAGER_INTENT',
    description: 'Foot massager/foot spa → ch.90 (9019.10)',
    pattern: {
      anyOf: ['foot massager', 'electric foot spa', 'shiatsu foot massager',
               'foot bath massager', 'plantar massager'],
    },
    inject: [{ prefix: '9019.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9019.' }],
  },

  // ── Rule 659: NECK_MASSAGER_INTENT ────────────────────────────────────────────
  {
    id: 'NECK_MASSAGER_INTENT',
    description: 'Neck/shoulder massager → ch.90 (9019.10)',
    pattern: {
      anyOf: ['neck massager', 'shiatsu neck massager', 'electric neck pillow',
               'shoulder neck massager', 'cervical massager'],
    },
    inject: [{ prefix: '9019.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9019.' }],
  },

  // ── Rule 660: POSTURE_CORRECTOR_INTENT ────────────────────────────────────────
  {
    id: 'POSTURE_CORRECTOR_INTENT',
    description: 'Posture corrector/brace → ch.90 (9021.10)',
    pattern: {
      anyOf: ['posture corrector', 'back posture corrector', 'posture brace support',
               'clavicle brace', 'shoulder posture'],
    },
    inject: [{ prefix: '9021.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9021.' }],
  },

  // ── Rule 661: HOT_WATER_BOTTLE_INTENT ─────────────────────────────────────────
  {
    id: 'HOT_WATER_BOTTLE_INTENT',
    description: 'Hot water bottle/heat pack → ch.39 (3926.90)',
    pattern: {
      anyOf: ['hot water bottle', 'rubber hot water bottle', 'heat therapy bottle',
               'cold pack', 'ice pack gel', 'reusable cold pack', 'flexible ice pack',
               'cold therapy pack', 'gel heat pack'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }, { prefix: '4014.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '40'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 662: COMPRESSION_SLEEVE_INTENT ───────────────────────────────────────
  {
    id: 'COMPRESSION_SLEEVE_INTENT',
    description: 'Compression sleeve/support → ch.63 (6307.90)',
    pattern: {
      anyOf: ['compression sleeve', 'knee compression sleeve', 'arm compression sleeve',
               'calf sleeve compression', 'elbow sleeve'],
    },
    inject: [{ prefix: '6307.90', syntheticRank: 22 }, { prefix: '6115.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['63', '61'] },
    boosts: [{ delta: 0.55, chapterMatch: '63' }],
  },

  // ── Rule 663: BLOOD_GLUCOSE_MONITOR_INTENT ────────────────────────────────────
  {
    id: 'BLOOD_GLUCOSE_MONITOR_INTENT',
    description: 'Blood glucose monitor/glucometer → ch.90 (9027.80)',
    pattern: {
      anyOf: ['blood glucose monitor', 'glucometer', 'blood sugar monitor',
               'glucose meter', 'diabetes monitor'],
    },
    inject: [{ prefix: '9027.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9027.' }],
  },

  // ── Rule 664: WHEY_PROTEIN_INTENT ─────────────────────────────────────────────
  {
    id: 'WHEY_PROTEIN_INTENT',
    description: 'Whey protein/sports supplement → ch.21 (2106.90)',
    pattern: {
      anyOf: ['whey protein', 'whey protein powder', 'isolate protein', 'concentrate whey',
               'creatine', 'creatine monohydrate', 'creatine powder', 'micronized creatine',
               'bcaa', 'branched chain amino acid', 'amino acid supplement', 'bcaa powder'],
    },
    inject: [{ prefix: '2106.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['21'] },
    boosts: [{ delta: 0.60, prefixMatch: '2106.' }],
  },

  // ── Rule 665: VITAMIN_SUPPLEMENT_INTENT ───────────────────────────────────────
  {
    id: 'VITAMIN_SUPPLEMENT_INTENT',
    description: 'Vitamin/supplement (multivitamin, C, melatonin) → ch.30 (3004.50)',
    pattern: {
      anyOf: ['multivitamin', 'multivitamin tablet', 'daily vitamin', 'vitamin c',
               'vitamin c supplement', 'chewable vitamin c', 'melatonin',
               'melatonin supplement', 'magnesium', 'magnesium glycinate',
               'ashwagandha', 'elderberry', 'elderberry syrup', 'omega 3',
               'fish oil omega 3', 'omega 3 capsules'],
    },
    inject: [{ prefix: '3004.50', syntheticRank: 22 }, { prefix: '2106.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['30', '21'] },
    boosts: [{ delta: 0.60, chapterMatch: '30' }],
  },

  // ── Rule 666: SCREEN_PROTECTOR_INTENT ─────────────────────────────────────────
  {
    id: 'SCREEN_PROTECTOR_INTENT',
    description: 'Screen protector/tempered glass → ch.39 (3920.61)',
    pattern: {
      anyOf: ['screen protector', 'tempered glass protector', 'phone screen guard',
               'anti scratch film', 'privacy screen protector'],
    },
    inject: [{ prefix: '3920.61', syntheticRank: 22 }, { prefix: '7007.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '70'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 667: TABLET_STAND_INTENT ─────────────────────────────────────────────
  {
    id: 'TABLET_STAND_INTENT',
    description: 'Tablet stand/holder → ch.39 (3926.90)',
    pattern: {
      anyOf: ['tablet stand', 'adjustable tablet holder', 'ipad stand',
               'tablet desk stand', 'foldable tablet stand'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }, { prefix: '7326.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '73'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 668: DESK_PAD_INTENT ─────────────────────────────────────────────────
  {
    id: 'DESK_PAD_INTENT',
    description: 'Desk pad/large mouse pad/desk mat → ch.39 (3926.90)',
    pattern: {
      anyOf: ['desk pad', 'large mouse pad', 'desk mat', 'leather desk pad',
               'gaming desk pad', 'xl desk pad'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 669: CAMP_STOVE_INTENT ───────────────────────────────────────────────
  {
    id: 'CAMP_STOVE_INTENT',
    description: 'Camp stove/backpacking stove → ch.73 (7321.12)',
    pattern: {
      anyOf: ['camp stove', 'portable camp stove', 'backpacking stove',
               'gas camp stove', 'butane stove camping'],
    },
    inject: [{ prefix: '7321.12', syntheticRank: 22 }, { prefix: '7321.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, prefixMatch: '7321.' }],
  },

  // ── Rule 670: SLEEPING_PAD_INTENT ─────────────────────────────────────────────
  {
    id: 'SLEEPING_PAD_INTENT',
    description: 'Sleeping pad/camping mat → ch.94 (9404.29)',
    pattern: {
      anyOf: ['sleeping pad', 'foam sleeping pad', 'inflatable sleeping pad',
               'ultralight pad', 'insulated sleeping mat'],
    },
    inject: [{ prefix: '9404.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, prefixMatch: '9404.' }],
  },

  // ── Rule 671: MULTI_TOOL_INTENT ────────────────────────────────────────────────
  {
    id: 'MULTI_TOOL_INTENT',
    description: 'Multi-tool/pocket tool → ch.82 (8211.93)',
    pattern: {
      anyOf: ['multi tool', 'pocket multi tool', 'leatherman type', 'folding multi tool',
               'stainless multi tool'],
    },
    inject: [{ prefix: '8211.93', syntheticRank: 22 }, { prefix: '8206.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8211.' }],
  },

  // ── Rule 672: FIRE_STARTER_INTENT ─────────────────────────────────────────────
  {
    id: 'FIRE_STARTER_INTENT',
    description: 'Fire starter/ferro rod/survival equipment → ch.36 (3606.90)',
    pattern: {
      anyOf: ['fire starter', 'ferrocerium rod', 'flint fire starter',
               'waterproof matches', 'magnesium fire starter'],
    },
    inject: [{ prefix: '3606.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['36', '82'] },
    boosts: [{ delta: 0.60, chapterMatch: '36' }],
  },

  // ── Rule 673: DRY_BAG_INTENT ───────────────────────────────────────────────────
  {
    id: 'DRY_BAG_INTENT',
    description: 'Dry bag/waterproof bag → ch.42 (4202.92)',
    pattern: {
      anyOf: ['dry bag', 'waterproof dry bag', 'roll top bag', 'kayak dry bag',
               'outdoor dry sack'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.92' }],
  },

  // ── Rule 674: CAT_SCRATCHER_INTENT ────────────────────────────────────────────
  {
    id: 'CAT_SCRATCHER_INTENT',
    description: 'Cat scratcher/scratch post → ch.95 (9503.00)',
    pattern: {
      anyOf: ['cat scratcher', 'cat scratch post', 'cardboard scratcher',
               'sisal scratcher', 'cat scratching pad', 'cat tunnel',
               'collapsible cat tunnel', 'crinkle tunnel cat'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9503.' }],
  },

  // ── Rule 675: DOG_CRATE_INTENT ────────────────────────────────────────────────
  {
    id: 'DOG_CRATE_INTENT',
    description: 'Dog crate/kennel → ch.73 (7323.99)',
    pattern: {
      anyOf: ['dog crate', 'wire dog crate', 'folding dog crate',
               'heavy duty dog crate', 'dog kennel crate'],
    },
    inject: [{ prefix: '7323.99', syntheticRank: 22 }, { prefix: '4421.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73', '44'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 676: SMALL_ANIMAL_CAGE_INTENT ────────────────────────────────────────
  {
    id: 'SMALL_ANIMAL_CAGE_INTENT',
    description: 'Guinea pig/hamster cage → ch.73 (7323.99)',
    pattern: {
      anyOf: ['guinea pig cage', 'small animal cage', 'guinea pig enclosure',
               'rabbit cage hutch', 'ferret cage', 'hamster wheel',
               'silent spinner wheel', 'exercise wheel hamster'],
    },
    inject: [{ prefix: '7323.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 677: AQUARIUM_HEATER_INTENT ──────────────────────────────────────────
  {
    id: 'AQUARIUM_HEATER_INTENT',
    description: 'Aquarium heater/fish tank heater → ch.85 (8516.50)',
    pattern: {
      anyOf: ['aquarium heater', 'fish tank heater', 'submersible heater',
               'digital aquarium heater', 'titanium heater'],
    },
    inject: [{ prefix: '8516.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 678: PET_FOOD_INTENT ─────────────────────────────────────────────────
  {
    id: 'PET_FOOD_INTENT',
    description: 'Pet food (fish/cat/dog food) → ch.23 (2309.10)',
    pattern: {
      anyOf: ['fish food', 'tropical fish flakes', 'betta fish food', 'goldfish food',
               'cat food', 'dry cat food', 'wet cat food', 'grain free cat food',
               'kitten food'],
    },
    inject: [{ prefix: '2309.10', syntheticRank: 22 }, { prefix: '2309.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['23'] },
    boosts: [{ delta: 0.65, prefixMatch: '2309.' }],
  },

  // ── Rule 679: REPTILE_LAMP_INTENT ─────────────────────────────────────────────
  {
    id: 'REPTILE_LAMP_INTENT',
    description: 'Reptile/terrarium lamp → ch.85 (8539.21)',
    pattern: {
      anyOf: ['reptile lamp', 'uvb reptile light', 'basking bulb',
               'terrarium heat lamp', 'ceramic heat emitter'],
    },
    inject: [{ prefix: '8539.21', syntheticRank: 22 }, { prefix: '8543.70', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, prefixMatch: '8539.' }],
  },

  // ── Rule 680: CAR_VACUUM_INTENT ────────────────────────────────────────────────
  {
    id: 'CAR_VACUUM_INTENT',
    description: 'Car vacuum/portable vacuum → ch.85 (8508.19)',
    pattern: {
      anyOf: ['car vacuum', 'handheld car vacuum', 'cordless car vac',
               '12v car vacuum', 'portable car cleaner'],
    },
    inject: [{ prefix: '8508.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8508.' }],
  },

  // ── Rule 681: CAR_WAX_DETAILING_INTENT ────────────────────────────────────────
  {
    id: 'CAR_WAX_DETAILING_INTENT',
    description: 'Car wax/clay bar/detailing → ch.34 (3405.20)',
    pattern: {
      anyOf: ['car wax', 'paste car wax', 'spray car wax', 'liquid wax car',
               'carnuba wax', 'ceramic wax', 'clay bar', 'detailing clay bar',
               'synthetic clay bar'],
    },
    inject: [{ prefix: '3405.20', syntheticRank: 22 }, { prefix: '3405.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.60, prefixMatch: '3405.' }],
  },

  // ── Rule 682: JUMP_STARTER_INTENT ─────────────────────────────────────────────
  {
    id: 'JUMP_STARTER_INTENT',
    description: 'Jump starter/battery booster → ch.85 (8507.60)',
    pattern: {
      anyOf: ['jump starter', 'portable jump starter', 'car battery booster',
               'emergency jump pack', 'lithium jump starter'],
    },
    inject: [{ prefix: '8507.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8507.' }],
  },

  // ── Rule 683: TIRE_INFLATOR_INTENT ────────────────────────────────────────────
  {
    id: 'TIRE_INFLATOR_INTENT',
    description: 'Tire inflator/portable compressor → ch.84 (8414.80)',
    pattern: {
      anyOf: ['tire inflator', 'portable air compressor', 'digital tire pump',
               '12v tire inflator', 'electric pump tyre'],
    },
    inject: [{ prefix: '8414.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8414.' }],
  },

  // ── Rule 684: MICROFIBER_CLOTH_INTENT ─────────────────────────────────────────
  {
    id: 'MICROFIBER_CLOTH_INTENT',
    description: 'Microfiber cloth/polishing cloth → ch.63 (6307.10)',
    pattern: {
      anyOf: ['microfiber cloth', 'microfibre cloth', 'cleaning microfiber',
               'polishing cloth', 'detailing cloth'],
    },
    inject: [{ prefix: '6307.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6307.' }],
  },

  // ── Rule 685: DESCALER_INTENT ─────────────────────────────────────────────────
  {
    id: 'DESCALER_INTENT',
    description: 'Descaler/limescale remover → ch.34 (3402.90)',
    pattern: {
      anyOf: ['descaler', 'kettle descaler', 'limescale remover', 'descaling solution',
               'coffee machine descaler', 'washing machine cleaner', 'washer cleaner tablet',
               'grout cleaner', 'tile grout cleaner', 'enzyme cleaner'],
    },
    inject: [{ prefix: '3402.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34', '38'] },
    boosts: [{ delta: 0.55, chapterMatch: '34' }],
  },

  // ── Rule 686: HAIR_CLAW_INTENT ────────────────────────────────────────────────
  {
    id: 'HAIR_CLAW_INTENT',
    description: 'Hair claw/bobby pin/headband → ch.96 (9615.11)',
    pattern: {
      anyOf: ['hair claw', 'claw clip', 'jaw clip hair', 'butterfly clip',
               'large hair claw', 'mini claw clips', 'bobby pin', 'hair grip',
               'kirby grip', 'invisible hair pins', 'headband', 'elastic headband',
               'wide headband', 'velvet headband'],
    },
    inject: [{ prefix: '9615.11', syntheticRank: 22 }, { prefix: '9615.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.65, prefixMatch: '9615.' }],
  },

  // ── Rule 687: ELASTIC_CORD_SEWING_INTENT ──────────────────────────────────────
  {
    id: 'ELASTIC_CORD_SEWING_INTENT',
    description: 'Elastic cord/iron-on patch/seam ripper → ch.59 (5906.99)',
    pattern: {
      anyOf: ['elastic cord', 'elastic band sewing', 'stretch cord', 'round elastic',
               'flat elastic', 'iron on patch', 'heat transfer patch',
               'seam ripper', 'stitch remover', 'unpicker tool',
               'bias tape', 'bias binding', 'double fold tape',
               'snap fastener', 'press stud', 'metal snap button'],
    },
    inject: [{ prefix: '5906.99', syntheticRank: 22 }, { prefix: '5809.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['59', '58', '96'] },
    boosts: [{ delta: 0.50, chapterMatch: '59' }],
  },

  // ── Rule 688: COOKING_SPRAY_INTENT ────────────────────────────────────────────
  {
    id: 'COOKING_SPRAY_INTENT',
    description: 'Cooking spray/baking spray → ch.15 (1517.90)',
    pattern: {
      anyOf: ['cooking spray', 'non stick spray', 'baking spray', 'olive oil spray',
               'coconut oil spray'],
    },
    inject: [{ prefix: '1517.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['15'] },
    boosts: [{ delta: 0.65, prefixMatch: '1517.' }],
  },

  // ── Rule 689: BAKING_INGREDIENT_INTENT ────────────────────────────────────────
  {
    id: 'BAKING_INGREDIENT_INTENT',
    description: 'Baking powder/vanilla extract/maple syrup → ch.21 (2102.30)',
    pattern: {
      anyOf: ['baking powder', 'baking raising agent', 'vanilla extract', 'vanilla essence',
               'pure vanilla extract', 'vanilla bean paste', 'maple syrup',
               'pure maple syrup', 'organic maple syrup', 'nutritional yeast',
               'nooch yeast', 'instant coffee', 'instant coffee granules', 'freeze dried coffee'],
    },
    inject: [{ prefix: '2102.30', syntheticRank: 22 }, { prefix: '2106.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['21', '09', '17'] },
    boosts: [{ delta: 0.50, chapterMatch: '21' }],
  },

  // ── Rule 690: QUILT_COMFORTER_INTENT ──────────────────────────────────────────
  {
    id: 'QUILT_COMFORTER_INTENT',
    description: 'Quilt/comforter/duvet insert → ch.94 (9404.90)',
    pattern: {
      anyOf: ['quilt', 'patchwork quilt', 'cotton quilt', 'king quilt',
               'comforter', 'down comforter', 'duvet insert', 'all season comforter',
               'electric blanket', 'heated throw', 'electric bed warmer'],
    },
    inject: [{ prefix: '9404.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, prefixMatch: '9404.' }],
  },

  // ── Rule 691: CORK_BOARD_INTENT ───────────────────────────────────────────────
  {
    id: 'CORK_BOARD_INTENT',
    description: 'Cork board/bulletin board/notice board → ch.45 (4504.10)',
    pattern: {
      anyOf: ['cork board', 'pin board', 'notice board cork', 'bulletin board',
               'memo board cork'],
    },
    inject: [{ prefix: '4504.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['45', '44'] },
    boosts: [{ delta: 0.70, prefixMatch: '4504.' }],
  },

  // ── Rule 692: SOUS_VIDE_INTENT ────────────────────────────────────────────────
  {
    id: 'SOUS_VIDE_INTENT',
    description: 'Sous vide/immersion circulator → ch.84 (8419.89)',
    pattern: {
      anyOf: ['sous vide', 'sous vide cooker', 'immersion circulator',
               'precision cooker', 'water bath cooker'],
    },
    inject: [{ prefix: '8419.89', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.70, prefixMatch: '8419.' }],
  },

  // ── Rule 693: IMMERSION_BLENDER_INTENT ────────────────────────────────────────
  {
    id: 'IMMERSION_BLENDER_INTENT',
    description: 'Immersion/hand/stick blender → ch.85 (8509.40)',
    pattern: {
      anyOf: ['immersion blender', 'hand blender', 'stick blender',
               'boat motor blender', 'cordless hand blender'],
    },
    inject: [{ prefix: '8509.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 694: PANINI_PRESS_INTENT ─────────────────────────────────────────────
  {
    id: 'PANINI_PRESS_INTENT',
    description: 'Panini press/sandwich press → ch.85 (8516.60)',
    pattern: {
      anyOf: ['panini press', 'sandwich press', 'panini maker',
               'contact grill', 'george foreman type'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 695: ICE_MAKER_INTENT ────────────────────────────────────────────────
  {
    id: 'ICE_MAKER_INTENT',
    description: 'Ice maker/ice machine → ch.84 (8418.69)',
    pattern: {
      anyOf: ['ice maker', 'portable ice maker', 'countertop ice machine',
               'bullet ice maker', 'nugget ice maker'],
    },
    inject: [{ prefix: '8418.69', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.70, prefixMatch: '8418.' }],
  },

  // ── Rule 696: VEGGIE_CHOPPER_INTENT ───────────────────────────────────────────
  {
    id: 'VEGGIE_CHOPPER_INTENT',
    description: 'Vegetable chopper/manual food chopper → ch.82 (8210.00)',
    pattern: {
      anyOf: ['veggie chopper', 'food chopper', 'manual vegetable chopper',
               'onion dicer chopper', 'pull string chopper'],
    },
    inject: [{ prefix: '8210.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.60, prefixMatch: '8210.' }],
  },

  // ── Rule 697: WETSUIT_INTENT ───────────────────────────────────────────────────
  {
    id: 'WETSUIT_INTENT',
    description: 'Wetsuit/neoprene suit → ch.39 (3926.20)',
    pattern: {
      anyOf: ['wetsuit', 'full wetsuit', 'shorty wetsuit', 'neoprene wetsuit'],
    },
    inject: [{ prefix: '3926.20', syntheticRank: 22 }, { prefix: '6211.11', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '62'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 698: POOL_FLOAT_INTENT ────────────────────────────────────────────────
  {
    id: 'POOL_FLOAT_INTENT',
    description: 'Pool float/inflatable pool → ch.39 (3926.90)',
    pattern: {
      anyOf: ['pool float', 'inflatable pool float', 'pool lounger float',
               'swimming ring float', 'inflatable pool', 'paddling pool', 'kids splash pool'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }, { prefix: '9506.29', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '95'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 699: PADDLEBOARD_INTENT ──────────────────────────────────────────────
  {
    id: 'PADDLEBOARD_INTENT',
    description: 'Paddleboard/SUP board → ch.95 (9506.29)',
    pattern: {
      anyOf: ['paddleboard', 'stand up paddleboard', 'inflatable sup board',
               'sup paddle board', 'isup paddleboard'],
    },
    inject: [{ prefix: '9506.29', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 700: HAIR_DRYER_INTENT ───────────────────────────────────────────────
  {
    id: 'HAIR_DRYER_INTENT',
    description: 'Hair dryer/blow dryer/curling wand → ch.85 (8516.31)',
    pattern: {
      anyOf: ['hair dryer', 'blow dryer', 'ionic hair dryer', 'travel hair dryer',
               'professional hair dryer', 'curling wand', 'hair curling wand',
               'wand curler', 'clip less wand', 'diffuser attachment', 'hair diffuser'],
    },
    inject: [{ prefix: '8516.31', syntheticRank: 22 }, { prefix: '8516.32', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8516.3' }],
  },

  // ── Rule 701: EYESHADOW_PALETTE_INTENT ────────────────────────────────────────
  {
    id: 'EYESHADOW_PALETTE_INTENT',
    description: 'Eyeshadow palette/contour/setting powder → ch.33 (3304.20)',
    pattern: {
      anyOf: ['eyeshadow palette', 'eye shadow palette', 'neutral palette',
               'glitter palette', 'contour kit', 'highlight contour kit',
               'setting powder', 'powder foundation', 'pressed powder foundation'],
    },
    inject: [{ prefix: '3304.20', syntheticRank: 22 }, { prefix: '3304.99', syntheticRank: 26 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.60, prefixMatch: '3304.' }],
  },

  // ── Rule 702: LIP_GLOSS_INTENT ────────────────────────────────────────────────
  {
    id: 'LIP_GLOSS_INTENT',
    description: 'Lip gloss/lip tint/brow gel → ch.33 (3304.10)',
    pattern: {
      anyOf: ['lip gloss', 'clear lip gloss', 'plumping gloss', 'tinted lip gloss',
               'lip tint', 'lip stain', 'korean lip tint', 'water lip tint',
               'brow gel', 'clear brow gel', 'tinted brow gel', 'fiber brow gel'],
    },
    inject: [{ prefix: '3304.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, prefixMatch: '3304.' }],
  },

  // ── Rule 703: BODYSUIT_CROP_TOP_INTENT ────────────────────────────────────────
  {
    id: 'BODYSUIT_CROP_TOP_INTENT',
    description: 'Bodysuit/crop top → ch.61 (6114.20)',
    pattern: {
      anyOf: ['bodysuit', 'long sleeve bodysuit', 'snap bodysuit', 'leotard bodysuit',
               'crop top', 'cropped top', 'belly top', 'crop tank top', 'ribbed crop top'],
    },
    inject: [{ prefix: '6114.20', syntheticRank: 22 }, { prefix: '6109.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['61'] },
    boosts: [{ delta: 0.55, chapterMatch: '61' }],
  },

  // ── Rule 704: SWIM_TRUNKS_INTENT ──────────────────────────────────────────────
  {
    id: 'SWIM_TRUNKS_INTENT',
    description: 'Swim trunks/board shorts → ch.62 (6211.11)',
    pattern: {
      anyOf: ['swim trunks', 'board shorts', 'mens swim shorts', 'quick dry trunks',
               'surf trunks', 'beach trunks'],
    },
    inject: [{ prefix: '6211.11', syntheticRank: 22 }],
    whitelist: { allowChapters: ['62'] },
    boosts: [{ delta: 0.65, prefixMatch: '6211.' }],
  },

  // ── Rule 705: MENS_UNDERWEAR_INTENT ───────────────────────────────────────────
  {
    id: 'MENS_UNDERWEAR_INTENT',
    description: 'Boxers/briefs/shapewear → ch.61 (6107.11)',
    pattern: {
      anyOf: ['boxers', 'boxer shorts', 'boxer underwear', 'cotton boxers',
               'briefs', 'mens briefs', 'hipster briefs', 'sport briefs',
               'shapewear', 'body shaper', 'tummy control', 'waist cincher'],
    },
    inject: [{ prefix: '6107.11', syntheticRank: 22 }, { prefix: '6107.12', syntheticRank: 26 }],
    whitelist: { allowChapters: ['61'] },
    boosts: [{ delta: 0.55, chapterMatch: '61' }],
  },

  // ── Rule 706: CHINOS_CARGO_INTENT ─────────────────────────────────────────────
  {
    id: 'CHINOS_CARGO_INTENT',
    description: 'Chinos/cargo shorts/khakis → ch.62 (6203.42)',
    pattern: {
      anyOf: ['chinos', 'chino pants', 'slim chinos', 'cotton chinos', 'khaki chinos',
               'cargo shorts', 'mens cargo shorts', 'tactical shorts', 'utility shorts'],
    },
    inject: [{ prefix: '6203.42', syntheticRank: 22 }, { prefix: '6203.49', syntheticRank: 26 }],
    whitelist: { allowChapters: ['62'] },
    boosts: [{ delta: 0.55, chapterMatch: '62' }],
  },

  // ── Rule 707: TABLE_RUNNER_INTENT ─────────────────────────────────────────────
  {
    id: 'TABLE_RUNNER_INTENT',
    description: 'Table runner/place mat/cloth napkin → ch.63 (6302.53)',
    pattern: {
      anyOf: ['table runner', 'dining table runner', 'linen table runner',
               'place mat', 'dining place mat', 'woven placemat', 'silicone placemat',
               'cloth napkin', 'linen napkin', 'dinner napkin cloth'],
    },
    inject: [{ prefix: '6302.53', syntheticRank: 22 }, { prefix: '6302.59', syntheticRank: 26 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.55, chapterMatch: '63' }],
  },

  // ── Rule 708: OVEN_GLOVE_INTENT ───────────────────────────────────────────────
  {
    id: 'OVEN_GLOVE_INTENT',
    description: 'Oven mitt/glove → ch.63 (6307.90)',
    pattern: {
      anyOf: ['oven glove', 'oven mitt', 'heat resistant glove',
               'silicone oven mitt', 'oven mitten pair'],
    },
    inject: [{ prefix: '6307.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.60, prefixMatch: '6307.' }],
  },

  // ── Rule 709: JEWELRY_ORGANIZER_INTENT ────────────────────────────────────────
  {
    id: 'JEWELRY_ORGANIZER_INTENT',
    description: 'Jewelry organizer/earring display → ch.83 (8306.29)',
    pattern: {
      anyOf: ['jewelry organizer', 'jewelry box organizer', 'earring display',
               'ring holder', 'jewelry tray organizer'],
    },
    inject: [{ prefix: '8306.29', syntheticRank: 22 }, { prefix: '4819.20', syntheticRank: 26 }],
    whitelist: { allowChapters: ['83', '48'] },
    boosts: [{ delta: 0.55, chapterMatch: '83' }],
  },

  // ── Rule 710: STEAM_MOP_INTENT ────────────────────────────────────────────────
  {
    id: 'STEAM_MOP_INTENT',
    description: 'Steam mop/floor steam cleaner → ch.85 (8509.80)',
    pattern: {
      anyOf: ['steam mop', 'floor steam mop', 'steam cleaner mop',
               'steam floor cleaner', 'microfiber steam mop'],
    },
    inject: [{ prefix: '8509.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 711: TOILET_PLUNGER_INTENT ───────────────────────────────────────────
  {
    id: 'TOILET_PLUNGER_INTENT',
    description: 'Toilet/sink plunger → ch.39 (3924.90)',
    pattern: {
      anyOf: ['toilet plunger', 'sink plunger', 'cup plunger', 'flange plunger',
               'accordion plunger', 'heavy duty plunger'],
    },
    inject: [{ prefix: '3924.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.60, chapterMatch: '39' }],
  },

  // ── Rule 712: BELT_SANDER_INTENT ──────────────────────────────────────────────
  {
    id: 'BELT_SANDER_INTENT',
    description: 'Belt sander/orbital sander → ch.84 (8467.21)',
    pattern: {
      anyOf: ['belt sander', 'electric belt sander', 'portable belt sander',
               'orbital sander', 'random orbital sander', 'palm sander',
               'detail sander', 'finishing sander'],
    },
    inject: [{ prefix: '8467.21', syntheticRank: 22 }, { prefix: '8467.29', syntheticRank: 26 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8467.' }],
  },

  // ── Rule 713: ROUTER_TOOL_INTENT ──────────────────────────────────────────────
  {
    id: 'ROUTER_TOOL_INTENT',
    description: 'Wood router tool/router bit → ch.84 (8467.81)',
    pattern: {
      anyOf: ['router tool', 'wood router', 'plunge router', 'trim router',
               'fixed base router', 'compact router', 'router bit', 'router bit set',
               'carbide router bit', 'flush trim bit'],
    },
    inject: [{ prefix: '8467.81', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8467.' }],
    penalties: [{ delta: -0.50, prefixMatch: '8517.' }],
  },

  // ── Rule 714: WASHI_TAPE_INTENT ───────────────────────────────────────────────
  {
    id: 'WASHI_TAPE_INTENT',
    description: 'Washi tape/decorative tape → ch.48 (4823.90)',
    pattern: {
      anyOf: ['washi tape', 'decorative tape', 'japanese washi tape',
               'patterned masking tape', 'craft tape washi'],
    },
    inject: [{ prefix: '4823.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['48'] },
    boosts: [{ delta: 0.65, prefixMatch: '4823.' }],
  },

  // ── Rule 715: KRAFT_PAPER_INTENT ──────────────────────────────────────────────
  {
    id: 'KRAFT_PAPER_INTENT',
    description: 'Kraft paper/bubble wrap/tissue paper → ch.48 (4804.11)',
    pattern: {
      anyOf: ['kraft paper', 'brown kraft paper', 'wrapping kraft paper',
               'bubble wrap', 'protective bubble wrap', 'large bubble wrap',
               'tissue paper', 'gift tissue paper', 'wrapping tissue'],
    },
    inject: [{ prefix: '4804.11', syntheticRank: 22 }, { prefix: '4819.40', syntheticRank: 26 }],
    whitelist: { allowChapters: ['48', '39'] },
    boosts: [{ delta: 0.55, prefixMatch: '4804.' }],
  },

  // ── Rule 716: WALLPAPER_PASTE_INTENT ──────────────────────────────────────────
  {
    id: 'WALLPAPER_PASTE_INTENT',
    description: 'Wallpaper paste/adhesive → ch.35 (3506.10)',
    pattern: {
      anyOf: ['wallpaper paste', 'wallpaper adhesive', 'paste the wall glue',
               'ready mixed paste', 'grout', 'tile grout', 'epoxy grout',
               'wood putty', 'wood filler', 'wood repair putty'],
    },
    inject: [{ prefix: '3506.10', syntheticRank: 22 }, { prefix: '3824.99', syntheticRank: 26 }],
    whitelist: { allowChapters: ['35', '38', '32'] },
    boosts: [{ delta: 0.55, chapterMatch: '35' }],
  },

  // ── Rule 717: LUGGAGE_STRAP_INTENT ────────────────────────────────────────────
  {
    id: 'LUGGAGE_STRAP_INTENT',
    description: 'Luggage strap/scale/travel organizer → ch.39 (3926.90)',
    pattern: {
      anyOf: ['luggage strap', 'suitcase strap', 'luggage belt strap',
               'tsa luggage strap', 'luggage scale', 'digital luggage scale',
               'travel organizer', 'travel cable organizer', 'travel pouch organizer'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39', '42'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 718: RFID_WALLET_INTENT ──────────────────────────────────────────────
  {
    id: 'RFID_WALLET_INTENT',
    description: 'RFID wallet/blocking card holder → ch.42 (4202.31)',
    pattern: {
      anyOf: ['rfid wallet', 'rfid blocking wallet', 'rfid card holder',
               'identity theft wallet', 'anti rfid purse'],
    },
    inject: [{ prefix: '4202.31', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.' }],
  },

  // ── Rule 719: RESISTANCE_TUBE_INTENT ──────────────────────────────────────────
  {
    id: 'RESISTANCE_TUBE_INTENT',
    description: 'Resistance tube/gymnastic rings/weighted vest → ch.95 (9506.91)',
    pattern: {
      anyOf: ['resistance tube', 'resistance bands tube', 'exercise tube',
               'gymnastic rings', 'wooden gym rings', 'pull up rings',
               'weighted vest', 'training vest weight', 'adjustable weighted vest'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9506.' }],
  },

  // ── Rule 720: PIPE_WRENCH_INTENT ──────────────────────────────────────────────
  {
    id: 'PIPE_WRENCH_INTENT',
    description: 'Pipe wrench/plumbing tools → ch.82 (8204.11)',
    pattern: {
      anyOf: ['pipe wrench', 'plumbing wrench', 'stilson wrench',
               'adjustable wrench pipe', 'heavy duty pipe wrench'],
    },
    inject: [{ prefix: '8204.11', syntheticRank: 22 }, { prefix: '8204.20', syntheticRank: 26 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8204.' }],
  },

  // ── Rule 721: BALL_VALVE_INTENT ───────────────────────────────────────────────
  {
    id: 'BALL_VALVE_INTENT',
    description: 'Ball valve/shut-off valve/plumbing fittings → ch.84 (8481.20)',
    pattern: {
      anyOf: ['ball valve', 'brass ball valve', 'pvc ball valve', 'shut off valve',
               'gate valve', 'check valve', 'pvc cement', 'solvent cement',
               'faucet aerator', 'tap aerator', 'water saver aerator'],
    },
    inject: [{ prefix: '8481.20', syntheticRank: 22 }, { prefix: '8481.80', syntheticRank: 26 }],
    whitelist: { allowChapters: ['84', '39'] },
    boosts: [{ delta: 0.55, prefixMatch: '8481.' }],
  },

  // ── Rule 722: WIRE_CONNECTOR_INTENT ───────────────────────────────────────────
  {
    id: 'WIRE_CONNECTOR_INTENT',
    description: 'Wire connector/junction box → ch.85 (8536.90)',
    pattern: {
      anyOf: ['wire connector', 'wire nut', 'lever connector', 'wago connector',
               'push in connector', 'butt connector', 'junction box',
               'electrical junction box', 'outdoor junction box'],
    },
    inject: [{ prefix: '8536.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, prefixMatch: '8536.' }],
  },

  // ── Rule 723: DIMMER_SWITCH_INTENT ────────────────────────────────────────────
  {
    id: 'DIMMER_SWITCH_INTENT',
    description: 'Dimmer switch/smart switch → ch.85 (8536.50)',
    pattern: {
      anyOf: ['dimmer switch', 'led dimmer', 'rotary dimmer', 'smart dimmer switch',
               'trailing edge dimmer', 'smart switch', 'wifi light switch',
               'smart wall switch'],
    },
    inject: [{ prefix: '8536.50', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, prefixMatch: '8536.' }],
  },

  // ── Rule 724: WINE_COOLER_INTENT ──────────────────────────────────────────────
  {
    id: 'WINE_COOLER_INTENT',
    description: 'Wine cooler/fridge → ch.84 (8418.40)',
    pattern: {
      anyOf: ['wine cooler', 'wine fridge', 'wine chiller',
               'thermoelectric wine cooler', 'dual zone wine cooler'],
    },
    inject: [{ prefix: '8418.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8418.' }],
  },

  // ── Rule 725: MINI_FRIDGE_INTENT ──────────────────────────────────────────────
  {
    id: 'MINI_FRIDGE_INTENT',
    description: 'Mini fridge/bar fridge → ch.84 (8418.21)',
    pattern: {
      anyOf: ['mini fridge', 'compact fridge', 'bar fridge', 'dorm fridge',
               'personal fridge', 'countertop fridge'],
    },
    inject: [{ prefix: '8418.21', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8418.' }],
  },

  // ── Rule 726: CHEST_FREEZER_INTENT ────────────────────────────────────────────
  {
    id: 'CHEST_FREEZER_INTENT',
    description: 'Chest/deep freezer → ch.84 (8418.40)',
    pattern: {
      anyOf: ['chest freezer', 'deep freezer', 'upright freezer',
               'garage freezer', 'compact freezer'],
    },
    inject: [{ prefix: '8418.40', syntheticRank: 22 }, { prefix: '8418.30', syntheticRank: 26 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8418.' }],
  },

  // ── Rule 727: AMPLIFIER_INTENT ────────────────────────────────────────────────
  {
    id: 'AMPLIFIER_INTENT',
    description: 'Stereo/power amplifier/DAC → ch.85 (8543.70)',
    pattern: {
      anyOf: ['amplifier', 'stereo amplifier', 'power amplifier', 'integrated amplifier',
               'class d amplifier', 'dac', 'usb dac', 'audio dac', 'headphone dac',
               'portable dac amp'],
    },
    inject: [{ prefix: '8543.70', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, prefixMatch: '8543.' }],
  },

  // ── Rule 728: TURNTABLE_CARTRIDGE_INTENT ──────────────────────────────────────
  {
    id: 'TURNTABLE_CARTRIDGE_INTENT',
    description: 'Turntable cartridge/stylus/record needle → ch.85 (8522.10)',
    pattern: {
      anyOf: ['turntable cartridge', 'phono cartridge', 'stylus replacement',
               'record needle', 'mm cartridge'],
    },
    inject: [{ prefix: '8522.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8522.' }],
  },

  // ── Rule 729: CAR_SEAT_CUSHION_INTENT ─────────────────────────────────────────
  {
    id: 'CAR_SEAT_CUSHION_INTENT',
    description: 'Car seat cushion/organizer/trunk → ch.94/39',
    pattern: {
      anyOf: ['car seat cushion', 'driving seat cushion', 'cooling car seat pad',
               'car organizer', 'trunk organizer', 'back seat organizer',
               'car trunk storage', 'seat back organizer'],
    },
    inject: [{ prefix: '9401.99', syntheticRank: 22 }, { prefix: '3924.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['94', '39'] },
    boosts: [{ delta: 0.50, chapterMatch: '94' }],
  },

  // ── Rule 730: REVERSE_CAMERA_INTENT ───────────────────────────────────────────
  {
    id: 'REVERSE_CAMERA_INTENT',
    description: 'Reverse/backup camera/parking sensor → ch.85 (8525.89)',
    pattern: {
      anyOf: ['reverse camera', 'backup camera', 'rear view camera', 'reversing camera',
               'parking camera', 'parking sensor', 'reverse sensor', 'backup sensor'],
    },
    inject: [{ prefix: '8525.89', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8525.' }],
  },

  // ── Rule 731: WELDING_MACHINE_INTENT ──────────────────────────────────────────
  {
    id: 'WELDING_MACHINE_INTENT',
    description: 'Welding machine/MIG/TIG welder → ch.85 (8515.21)',
    pattern: {
      anyOf: ['welding machine', 'mig welder', 'tig welder', 'arc welder',
               'stick welder', 'inverter welder'],
    },
    inject: [{ prefix: '8515.21', syntheticRank: 22 }, { prefix: '8515.31', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8515.' }],
  },

  // ── Rule 732: LASER_CUTTER_INTENT ─────────────────────────────────────────────
  {
    id: 'LASER_CUTTER_INTENT',
    description: 'Laser cutter/engraver/plasma cutter → ch.84 (8456.40)',
    pattern: {
      anyOf: ['laser cutter', 'co2 laser cutter', 'desktop laser engraver',
               'diode laser cutter', 'plasma cutter', 'electric plasma cutter',
               'portable plasma cutter'],
    },
    inject: [{ prefix: '8456.40', syntheticRank: 22 }, { prefix: '8456.50', syntheticRank: 26 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8456.' }],
  },

  // ── Rule 733: MESH_NETWORK_INTENT ─────────────────────────────────────────────
  {
    id: 'MESH_NETWORK_INTENT',
    description: 'Mesh WiFi/powerline adapter → ch.85 (8517.62)',
    pattern: {
      anyOf: ['mesh network', 'mesh wifi system', 'whole home wifi', 'tri band mesh',
               'powerline adapter', 'ethernet over power', 'homeplug adapter'],
    },
    inject: [{ prefix: '8517.62', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, prefixMatch: '8517.' }],
  },

  // ── Rule 734: OXYGEN_CONCENTRATOR_INTENT ──────────────────────────────────────
  {
    id: 'OXYGEN_CONCENTRATOR_INTENT',
    description: 'Oxygen concentrator → ch.90 (9019.20)',
    pattern: {
      anyOf: ['oxygen concentrator', 'portable oxygen concentrator',
               'home oxygen machine', 'continuous flow oxygen'],
    },
    inject: [{ prefix: '9019.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.75, prefixMatch: '9019.' }],
  },

  // ── Rule 735: BLOOD_PRESSURE_CUFF_INTENT ──────────────────────────────────────
  {
    id: 'BLOOD_PRESSURE_CUFF_INTENT',
    description: 'Blood pressure cuff/monitor → ch.90 (9018.90)',
    pattern: {
      anyOf: ['blood pressure cuff', 'bp monitor cuff', 'sphygmomanometer',
               'upper arm bp cuff', 'digital bp cuff'],
    },
    inject: [{ prefix: '9018.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.70, prefixMatch: '9018.' }],
  },

  // ── Rule 736: GRAB_BAR_INTENT ─────────────────────────────────────────────────
  {
    id: 'GRAB_BAR_INTENT',
    description: 'Grab bar/bathroom rail → ch.73 (7326.90)',
    pattern: {
      anyOf: ['grab bar', 'bathroom grab rail', 'shower grab bar',
               'safety grab bar', 'stainless grab bar', 'raised toilet seat',
               'toilet raiser', 'elevated toilet seat'],
    },
    inject: [{ prefix: '7326.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.60, prefixMatch: '7326.' }],
  },

  // ── Rule 737: SAFETY_GLASSES_INTENT ───────────────────────────────────────────
  {
    id: 'SAFETY_GLASSES_INTENT',
    description: 'Safety/protective glasses → ch.90 (9004.90)',
    pattern: {
      anyOf: ['safety glasses', 'protective eyewear', 'impact resistant glasses',
               'anti fog safety glasses', 'ansi glasses'],
    },
    inject: [{ prefix: '9004.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9004.' }],
  },

  // ── Rule 738: LUXURY_WATCH_INTENT ─────────────────────────────────────────────
  {
    id: 'LUXURY_WATCH_INTENT',
    description: 'Dress/automatic/luxury watch → ch.91 (9101.11)',
    pattern: {
      anyOf: ['luxury watch', 'dress watch', 'automatic watch', 'swiss watch',
               'sapphire crystal watch'],
    },
    inject: [{ prefix: '9101.11', syntheticRank: 22 }, { prefix: '9102.11', syntheticRank: 26 }],
    whitelist: { allowChapters: ['91'] },
    boosts: [{ delta: 0.65, prefixMatch: '91' }],
  },

  // ── Rule 739: GOLD_CHAIN_INTENT ────────────────────────────────────────────────
  {
    id: 'GOLD_CHAIN_INTENT',
    description: 'Gold chain/necklace → ch.71 (7113.19)',
    pattern: {
      anyOf: ['gold chain', 'gold necklace chain', '14k gold chain',
               'rope chain gold', 'cuban link chain'],
    },
    inject: [{ prefix: '7113.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['71'] },
    boosts: [{ delta: 0.65, prefixMatch: '7113.' }],
  },

  // ── Rule 740: WALL_CLOCK_INTENT ────────────────────────────────────────────────
  {
    id: 'WALL_CLOCK_INTENT',
    description: 'Wall clock/decorative clock → ch.91 (9105.91)',
    pattern: {
      anyOf: ['wall clock', 'decorative wall clock', 'silent wall clock',
               'large wall clock', 'modern wall clock'],
    },
    inject: [{ prefix: '9105.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['91'] },
    boosts: [{ delta: 0.65, prefixMatch: '9105.9' }],
  },

  // ── Rule 741: PENDANT_LIGHT_INTENT ────────────────────────────────────────────
  {
    id: 'PENDANT_LIGHT_INTENT',
    description: 'Pendant light/hanging light → ch.94 (9405.11)',
    pattern: {
      anyOf: ['pendant light', 'hanging pendant light', 'ceiling pendant',
               'kitchen island pendant', 'dome pendant', 'track lighting',
               'track light system', 'rail lighting', 'wall sconce',
               'bathroom sconce', 'bedside wall light', 'plug in sconce'],
    },
    inject: [{ prefix: '9405.11', syntheticRank: 22 }, { prefix: '9405.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, prefixMatch: '9405.' }],
  },

  // ── Rule 742: OUTDOOR_SOLAR_LIGHT_INTENT ──────────────────────────────────────
  {
    id: 'OUTDOOR_SOLAR_LIGHT_INTENT',
    description: 'Outdoor solar/path/garden light → ch.85 (8539.40)',
    pattern: {
      anyOf: ['outdoor solar light', 'solar garden light', 'solar path light',
               'solar stake light', 'solar landscape light'],
    },
    inject: [{ prefix: '8539.40', syntheticRank: 22 }, { prefix: '9405.49', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85', '94'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 743: LED_STRIP_LIGHT_INTENT ──────────────────────────────────────────
  {
    id: 'LED_STRIP_LIGHT_INTENT',
    description: 'LED strip light/bias lighting → ch.85 (8539.50)',
    pattern: {
      anyOf: ['led strip light', 'rgb strip light', 'bias lighting strip',
               'tv backlight strip', 'under cabinet led'],
    },
    inject: [{ prefix: '8539.50', syntheticRank: 22 }, { prefix: '8536.49', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, prefixMatch: '8539.' }],
  },

  // ── Rule 744: VOLLEYBALL_INTENT ────────────────────────────────────────────────
  {
    id: 'VOLLEYBALL_INTENT',
    description: 'Volleyball/rugby ball/sport ball → ch.95 (9506.62)',
    pattern: {
      anyOf: ['volleyball', 'beach volleyball', 'indoor volleyball', 'training volleyball',
               'rugby ball', 'match rugby ball', 'training rugby ball'],
    },
    inject: [{ prefix: '9506.62', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.65, prefixMatch: '9506.' }],
  },

  // ── Rule 745: WEIGHT_BELT_INTENT ──────────────────────────────────────────────
  {
    id: 'WEIGHT_BELT_INTENT',
    description: 'Weight lifting belt/knee sleeve/lifting straps → ch.95 (9506.91)',
    pattern: {
      anyOf: ['weight lifting belt', 'powerlifting belt', 'gym belt', 'lever belt',
               'neoprene belt', 'knee sleeve', 'powerlifting knee sleeve',
               'lifting straps', 'wrist wrap straps', 'deadlift straps'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }, { prefix: '6307.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['95', '63'] },
    boosts: [{ delta: 0.55, chapterMatch: '95' }],
  },

  // ── Rule 746: BALLET_FLATS_INTENT ─────────────────────────────────────────────
  {
    id: 'BALLET_FLATS_INTENT',
    description: 'Ballet flats/mules/flat shoes → ch.64 (6403.59)',
    pattern: {
      anyOf: ['ballet flats', 'flat pumps', 'ballerina shoes', 'pointed flat shoes',
               'comfort flats', 'mules', 'backless mules', 'slide mule shoes',
               'heeled mules'],
    },
    inject: [{ prefix: '6403.59', syntheticRank: 22 }, { prefix: '6404.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['64'] },
    boosts: [{ delta: 0.55, chapterMatch: '64' }],
  },

  // ── Rule 747: PLATFORM_SHOES_INTENT ───────────────────────────────────────────
  {
    id: 'PLATFORM_SHOES_INTENT',
    description: 'Platform shoes/heels → ch.64 (6402.99)',
    pattern: {
      anyOf: ['platform shoes', 'platform sneakers', 'chunky platform',
               'wedge platform shoes', 'platform heels', 'ankle strap heels',
               'strappy heels', 'block heel strappy', 't strap heels'],
    },
    inject: [{ prefix: '6402.99', syntheticRank: 22 }, { prefix: '6403.99', syntheticRank: 26 }],
    whitelist: { allowChapters: ['64'] },
    boosts: [{ delta: 0.55, chapterMatch: '64' }],
  },

  // ── Rule 748: SCIENCE_KIT_INTENT ──────────────────────────────────────────────
  {
    id: 'SCIENCE_KIT_INTENT',
    description: 'Science/chemistry/STEM kit → ch.95 (9503.00)',
    pattern: {
      anyOf: ['science kit', 'chemistry set', 'stem kit', 'experiment kit',
               'volcano kit', 'crystal growing kit', 'puppet', 'hand puppet',
               'finger puppet', 'fidget cube', 'anxiety cube', 'stress relief cube'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9503.' }],
  },

  // ── Rule 749: BASSINET_INTENT ─────────────────────────────────────────────────
  {
    id: 'BASSINET_INTENT',
    description: 'Bassinet/Moses basket/baby bouncer → ch.94 (9403.89)',
    pattern: {
      anyOf: ['bassinet', 'bedside bassinet', 'rocking bassinet',
               'portable bassinet', 'moses basket', 'baby bouncer',
               'infant bouncer', 'vibrating bouncer'],
    },
    inject: [{ prefix: '9403.89', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 750: BREAST_PUMP_INTENT ──────────────────────────────────────────────
  {
    id: 'BREAST_PUMP_INTENT',
    description: 'Breast pump/bottle warmer → ch.90 (9018.90)',
    pattern: {
      anyOf: ['breast pump', 'electric breast pump', 'double pump breast',
               'portable breast pump', 'wearable pump', 'nursing pillow',
               'breastfeeding pillow', 'bottle warmer', 'baby bottle warmer'],
    },
    inject: [{ prefix: '9018.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9018.' }],
  },

  // ── Rule 751: SOY_CANDLE_INTENT ────────────────────────────────────────────────
  {
    id: 'SOY_CANDLE_INTENT',
    description: 'Soy/beeswax/taper candle → ch.34 (3406.00)',
    pattern: {
      anyOf: ['soy candle', 'soy wax candle', 'natural soy candle', 'scented soy candle',
               'beeswax candle', 'pure beeswax candle', 'taper candle', 'long taper candle',
               'wooden wick candle', 'wood wick crackling candle'],
    },
    inject: [{ prefix: '3406.00', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.70, prefixMatch: '3406.' }],
  },

  // ── Rule 752: AROMA_DIFFUSER_INTENT ───────────────────────────────────────────
  {
    id: 'AROMA_DIFFUSER_INTENT',
    description: 'Aroma/mist diffuser → ch.85 (8509.80)',
    pattern: {
      anyOf: ['aroma diffuser', 'ultrasonic diffuser', 'mist diffuser',
               'aromatherapy humidifier', 'nebulizing diffuser'],
    },
    inject: [{ prefix: '8509.80', syntheticRank: 22 }, { prefix: '8516.79', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 753: LAPTOP_SLEEVE_INTENT ────────────────────────────────────────────
  {
    id: 'LAPTOP_SLEEVE_INTENT',
    description: 'Laptop sleeve/neoprene case → ch.42 (4202.12)',
    pattern: {
      anyOf: ['laptop sleeve', 'neoprene laptop sleeve', 'felt laptop sleeve',
               'slim laptop case', 'macbook sleeve'],
    },
    inject: [{ prefix: '4202.12', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.65, prefixMatch: '4202.12' }],
  },

  // ── Rule 754: ERGONOMIC_KEYBOARD_INTENT ───────────────────────────────────────
  {
    id: 'ERGONOMIC_KEYBOARD_INTENT',
    description: 'Ergonomic/split keyboard/vertical mouse → ch.84 (8471.60)',
    pattern: {
      anyOf: ['ergonomic keyboard', 'split keyboard', 'curved keyboard',
               'wrist friendly keyboard', 'vertical mouse', 'ergonomic vertical mouse',
               'vertical grip mouse'],
    },
    inject: [{ prefix: '8471.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.60, prefixMatch: '8471.' }],
  },

  // ── Rule 755: MUSLIN_FABRIC_INTENT ────────────────────────────────────────────
  {
    id: 'MUSLIN_FABRIC_INTENT',
    description: 'Muslin/gauze/craft fabric → ch.52 (5208.21)',
    pattern: {
      anyOf: ['muslin fabric', 'unbleached muslin', 'cotton muslin cloth',
               'gauze fabric', 'felt fabric', 'craft felt sheet', 'wool felt fabric',
               'fleece fabric', 'polar fleece', 'anti pill fleece', 'microfleece',
               'mesh fabric', 'athletic mesh', 'power mesh'],
    },
    inject: [{ prefix: '5208.21', syntheticRank: 22 }, { prefix: '5603.11', syntheticRank: 26 }],
    whitelist: { allowChapters: ['52', '56', '60'] },
    boosts: [{ delta: 0.50, chapterMatch: '52' }],
  },

  // ── Rule 756: LAUNDRY_PODS_INTENT ─────────────────────────────────────────────
  {
    id: 'LAUNDRY_PODS_INTENT',
    description: 'Laundry pods/dryer balls → ch.34 (3402.20)',
    pattern: {
      anyOf: ['laundry pods', 'laundry detergent pods', 'washing pods',
               'all in one pods', 'eco pods', 'wool dryer balls', 'dryer balls',
               'reusable dryer balls', 'natural dryer balls'],
    },
    inject: [{ prefix: '3402.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['34'] },
    boosts: [{ delta: 0.60, prefixMatch: '3402.' }],
  },

  // ── Rule 757: FIRE_PIT_INTENT ─────────────────────────────────────────────────
  {
    id: 'FIRE_PIT_INTENT',
    description: 'Outdoor fire pit/patio fire → ch.73 (7321.90)',
    pattern: {
      anyOf: ['fire pit', 'outdoor fire pit', 'propane fire pit',
               'wood burning fire pit', 'portable fire pit'],
    },
    inject: [{ prefix: '7321.90', syntheticRank: 22 }, { prefix: '7321.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, prefixMatch: '7321.' }],
  },

  // ── Rule 758: OUTDOOR_HEATER_INTENT ───────────────────────────────────────────
  {
    id: 'OUTDOOR_HEATER_INTENT',
    description: 'Outdoor/patio heater → ch.73 (7321.90)',
    pattern: {
      anyOf: ['outdoor heater', 'patio heater', 'infrared outdoor heater',
               'propane heater patio', 'electric patio heater'],
    },
    inject: [{ prefix: '7321.90', syntheticRank: 22 }, { prefix: '8516.21', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73', '85'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 759: BIRD_BATH_INTENT ────────────────────────────────────────────────
  {
    id: 'BIRD_BATH_INTENT',
    description: 'Bird bath/garden statue/wind spinner → ch.69 (6913.10)',
    pattern: {
      anyOf: ['bird bath', 'garden bird bath', 'pedestal bird bath',
               'ceramic bird bath', 'garden statue', 'outdoor garden statue',
               'lawn ornament', 'wind spinner', 'garden wind spinner',
               'kinetic wind sculpture'],
    },
    inject: [{ prefix: '6913.10', syntheticRank: 22 }, { prefix: '6913.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['69', '73'] },
    boosts: [{ delta: 0.55, chapterMatch: '69' }],
  },

  // ── Rule 760: WATER_FLOSSER_INTENT ────────────────────────────────────────────
  {
    id: 'WATER_FLOSSER_INTENT',
    description: 'Water flosser/oral irrigator → ch.85 (8509.80)',
    pattern: {
      anyOf: ['water flosser', 'oral irrigator', 'electric water flosser',
               'teeth flosser water'],
    },
    inject: [{ prefix: '8509.80', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 761: NAIL_LAMP_INTENT ────────────────────────────────────────────────
  {
    id: 'NAIL_LAMP_INTENT',
    description: 'UV/LED nail lamp → ch.85 (8543.70)',
    pattern: {
      anyOf: ['nail lamp', 'uv nail lamp', 'led gel nail lamp', 'nail curing lamp',
               'nail dryer lamp', 'wax warmer', 'hair removal wax warmer',
               'depilatory wax heater'],
    },
    inject: [{ prefix: '8543.70', syntheticRank: 22 }, { prefix: '8516.79', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 762: EPILATOR_INTENT ─────────────────────────────────────────────────
  {
    id: 'EPILATOR_INTENT',
    description: 'Epilator/electric hair removal → ch.85 (8510.20)',
    pattern: {
      anyOf: ['epilator', 'electric epilator', 'cordless epilator',
               'wet dry epilator', 'facial epilator'],
    },
    inject: [{ prefix: '8510.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8510.' }],
  },

  // ── Rule 763: SAFETY_RAZOR_INTENT ─────────────────────────────────────────────
  {
    id: 'SAFETY_RAZOR_INTENT',
    description: 'Safety/double-edge razor → ch.82 (8212.20)',
    pattern: {
      anyOf: ['safety razor', 'double edge razor', 'de razor', 'wet shave razor',
               'classic safety razor', 'shaving brush', 'badger shaving brush',
               'shaving bowl', 'lather bowl'],
    },
    inject: [{ prefix: '8212.20', syntheticRank: 22 }, { prefix: '8212.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.65, prefixMatch: '8212.' }],
  },

  // ── Rule 764: GEL_NAIL_POLISH_INTENT ──────────────────────────────────────────
  {
    id: 'GEL_NAIL_POLISH_INTENT',
    description: 'Gel nail polish/UV gel → ch.33 (3304.30)',
    pattern: {
      anyOf: ['nail gel polish', 'gel nail colour', 'soak off gel',
               'uv gel polish', 'shellac gel polish', 'lash serum',
               'eyelash growth serum', 'lash boost serum'],
    },
    inject: [{ prefix: '3304.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['33'] },
    boosts: [{ delta: 0.65, prefixMatch: '3304.' }],
  },

  // ── Rule 765: MOKA_POT_INTENT ─────────────────────────────────────────────────
  {
    id: 'MOKA_POT_INTENT',
    description: 'Moka pot/stovetop espresso maker → ch.73 (7323.94)',
    pattern: {
      anyOf: ['moka pot', 'stovetop espresso maker', 'italian coffee maker',
               'bialetti type', 'espresso moka'],
    },
    inject: [{ prefix: '7323.94', syntheticRank: 22 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.65, prefixMatch: '7323.' }],
  },

  // ── Rule 766: FRENCH_PRESS_INTENT ─────────────────────────────────────────────
  {
    id: 'FRENCH_PRESS_INTENT',
    description: 'French press/cafetiere → ch.70 (7013.99)',
    pattern: {
      anyOf: ['french press', 'coffee press', 'cafetiere', 'plunger coffee',
               'double wall french press'],
    },
    inject: [{ prefix: '7013.99', syntheticRank: 22 }, { prefix: '7323.94', syntheticRank: 26 }],
    whitelist: { allowChapters: ['70', '73'] },
    boosts: [{ delta: 0.60, chapterMatch: '70' }],
  },

  // ── Rule 767: POUR_OVER_COFFEE_INTENT ─────────────────────────────────────────
  {
    id: 'POUR_OVER_COFFEE_INTENT',
    description: 'Pour-over/cold brew coffee maker → ch.69/70 (6911.10)',
    pattern: {
      anyOf: ['pour over coffee', 'pour over dripper', 'v60 coffee dripper',
               'chemex type', 'filter drip coffee', 'cold brew maker',
               'cold brew coffee maker', 'cold brew pitcher', 'immersion cold brew'],
    },
    inject: [{ prefix: '6911.10', syntheticRank: 22 }, { prefix: '7013.99', syntheticRank: 26 }],
    whitelist: { allowChapters: ['69', '70', '73'] },
    boosts: [{ delta: 0.55, chapterMatch: '69' }],
  },

  // ── Rule 768: MILK_FROTHER_INTENT ─────────────────────────────────────────────
  {
    id: 'MILK_FROTHER_INTENT',
    description: 'Milk frother → ch.85 (8509.40)',
    pattern: {
      anyOf: ['milk frother', 'electric frother', 'handheld frother',
               'steam frother wand', 'battery frother'],
    },
    inject: [{ prefix: '8509.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 769: YOGURT_MAKER_INTENT ─────────────────────────────────────────────
  {
    id: 'YOGURT_MAKER_INTENT',
    description: 'Yogurt/fermentation maker → ch.85 (8516.60)',
    pattern: {
      anyOf: ['yogurt maker', 'electric yogurt maker', 'fermentation maker',
               'greek yogurt maker', 'dairy fermentor'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8516.' }],
  },

  // ── Rule 770: SALAD_SPINNER_INTENT ────────────────────────────────────────────
  {
    id: 'SALAD_SPINNER_INTENT',
    description: 'Salad spinner/garlic press/kitchen gadgets → ch.39/82 (3924.10)',
    pattern: {
      anyOf: ['salad spinner', 'salad washing spinner', 'garlic press',
               'garlic crusher', 'avocado slicer', 'cherry pitter', 'olive pitter',
               'citrus juicer', 'lemon squeezer', 'manual citrus press'],
    },
    inject: [{ prefix: '3924.10', syntheticRank: 22 }, { prefix: '8210.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '82'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 771: PAINT_SPRAYER_INTENT ────────────────────────────────────────────
  {
    id: 'PAINT_SPRAYER_INTENT',
    description: 'Paint sprayer/spray gun → ch.84 (8424.20)',
    pattern: {
      anyOf: ['paint sprayer', 'hvlp paint sprayer', 'electric spray gun', 'airless sprayer'],
    },
    inject: [{ prefix: '8424.20', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8424.' }],
  },

  // ── Rule 772: WINDOW_BLIND_INTENT ─────────────────────────────────────────────
  {
    id: 'WINDOW_BLIND_INTENT',
    description: 'Window blind/roller blind → ch.39 (3921.90) or ch.63 (6303.12)',
    pattern: {
      anyOf: ['window blind', 'roller blind', 'venetian blind', 'blackout roller blind',
               'zebra blind', 'solar film', 'window tint film', 'privacy window film',
               'frosted window film'],
    },
    inject: [{ prefix: '6303.12', syntheticRank: 22 }, { prefix: '6303.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['63', '39'] },
    boosts: [{ delta: 0.60, chapterMatch: '63' }],
  },

  // ── Rule 773: CAR_SUNSHADE_INTENT ─────────────────────────────────────────────
  {
    id: 'CAR_SUNSHADE_INTENT',
    description: 'Car sunshade/windshield sun protector → ch.39 (3926.90)',
    pattern: {
      anyOf: ['car sunshade', 'windshield sunshade', 'front window shade',
               'foldable sunshade', 'uv sun protector'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 774: ROOF_RACK_INTENT ────────────────────────────────────────────────
  {
    id: 'ROOF_RACK_INTENT',
    description: 'Roof rack/cargo carrier → ch.87 (8716.90)',
    pattern: {
      anyOf: ['roof rack', 'car roof rack', 'roof cargo carrier', 'roof luggage rack',
               'crossbar roof rack', 'bike rack', 'car bike rack', 'hitch bike rack',
               'trunk bike rack'],
    },
    inject: [{ prefix: '8716.90', syntheticRank: 22 }, { prefix: '8714.99', syntheticRank: 26 }],
    whitelist: { allowChapters: ['87'] },
    boosts: [{ delta: 0.60, chapterMatch: '87' }],
  },

  // ── Rule 775: VIOLIN_ROSIN_INTENT ─────────────────────────────────────────────
  {
    id: 'VIOLIN_ROSIN_INTENT',
    description: 'Violin/bow rosin → ch.92 (9209.99)',
    pattern: {
      anyOf: ['violin rosin', 'bow rosin', 'light rosin', 'dark rosin', 'cello rosin',
               'guitar case', 'acoustic guitar case', 'hard shell guitar case', 'gig bag guitar',
               'keyboard stand', 'x stand keyboard', 'drum throne', 'drum stool'],
    },
    inject: [{ prefix: '9209.99', syntheticRank: 22 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.65, prefixMatch: '9209.' }],
  },

  // ── Rule 776: POND_PUMP_INTENT ────────────────────────────────────────────────
  {
    id: 'POND_PUMP_INTENT',
    description: 'Pond/fountain pump → ch.84 (8413.70)',
    pattern: {
      anyOf: ['pond pump', 'water pump pond', 'submersible pond pump',
               'fountain pump', 'waterfall pump', 'solar fountain',
               'solar water fountain', 'floating solar fountain'],
    },
    inject: [{ prefix: '8413.70', syntheticRank: 22 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.65, prefixMatch: '8413.' }],
  },

  // ── Rule 777: WEED_PULLER_INTENT ──────────────────────────────────────────────
  {
    id: 'WEED_PULLER_INTENT',
    description: 'Weed puller/soaker hose/garden tool → ch.82 (8201.30)',
    pattern: {
      anyOf: ['weed puller', 'stand up weed puller', 'weed twister',
               'dandelion puller', 'root remover tool', 'soaker hose',
               'garden soaker hose', 'drip hose soaker'],
    },
    inject: [{ prefix: '8201.30', syntheticRank: 22 }],
    whitelist: { allowChapters: ['82', '39'] },
    boosts: [{ delta: 0.55, prefixMatch: '8201.' }],
  },

  // ── Rule 778: COCONUT_OIL_INTENT ──────────────────────────────────────────────
  {
    id: 'COCONUT_OIL_INTENT',
    description: 'Coconut oil/ghee/specialty food oils → ch.15 (1513.11)',
    pattern: {
      anyOf: ['coconut oil', 'virgin coconut oil', 'organic coconut oil',
               'refined coconut oil', 'ghee', 'clarified butter ghee',
               'grass fed ghee', 'organic ghee'],
    },
    inject: [{ prefix: '1513.11', syntheticRank: 22 }, { prefix: '0405.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['15', '04'] },
    boosts: [{ delta: 0.60, prefixMatch: '1513.' }],
  },

  // ── Rule 779: LAPTOP_BACKPACK_INTENT ──────────────────────────────────────────
  {
    id: 'LAPTOP_BACKPACK_INTENT',
    description: 'Laptop/computer backpack → ch.42 (4202.92)',
    pattern: {
      anyOf: ['laptop backpack', 'computer backpack', 'work backpack',
               '15 inch laptop bag', 'business backpack', 'anti theft backpack',
               'slash proof bag', 'lockable backpack'],
    },
    inject: [{ prefix: '4202.92', syntheticRank: 22 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.60, prefixMatch: '4202.92' }],
  },

  // ── Rule 780: TOILETRY_BAG_INTENT ─────────────────────────────────────────────
  {
    id: 'TOILETRY_BAG_INTENT',
    description: 'Toiletry bag/dopp kit/cosmetic bag → ch.42 (4202.12)',
    pattern: {
      anyOf: ['toiletry bag', 'dopp kit', 'wash bag travel', 'grooming bag',
               'cosmetic bag', 'makeup pouch', 'beauty bag', 'clear cosmetic bag'],
    },
    inject: [{ prefix: '4202.12', syntheticRank: 22 }, { prefix: '4202.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['42'] },
    boosts: [{ delta: 0.60, prefixMatch: '4202.' }],
  },

  // ── Rule 781: GPS_TRACKER_INTENT ──────────────────────────────────────────────
  {
    id: 'GPS_TRACKER_INTENT',
    description: 'GPS tracker/location device → ch.85 (8526.91)',
    pattern: {
      anyOf: ['gps tracker', 'vehicle gps tracker', 'asset tracker',
               'location tracker', 'magnetic gps'],
    },
    inject: [{ prefix: '8526.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.70, prefixMatch: '8526.' }],
  },

  // ── Rule 782: PORTABLE_PROJECTOR_INTENT ───────────────────────────────────────
  {
    id: 'PORTABLE_PROJECTOR_INTENT',
    description: 'Portable/mini projector → ch.90 (9008.10)',
    pattern: {
      anyOf: ['portable projector', 'mini projector portable', 'pocket projector',
               'pico projector', 'led mini projector', 'smart display',
               'smart screen', 'echo show type'],
    },
    inject: [{ prefix: '9008.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, prefixMatch: '9008.' }],
  },

  // ── Rule 783: ACUPRESSURE_MAT_INTENT ──────────────────────────────────────────
  {
    id: 'ACUPRESSURE_MAT_INTENT',
    description: 'Acupressure mat/spike mat → ch.39 (3926.90)',
    pattern: {
      anyOf: ['acupressure mat', 'spike mat', 'acupuncture mat',
               'pranamat type', 'lotus mat acupressure'],
    },
    inject: [{ prefix: '3926.90', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 784: INVERSION_TABLE_INTENT ──────────────────────────────────────────
  {
    id: 'INVERSION_TABLE_INTENT',
    description: 'Inversion table/gravity table → ch.95 (9506.91)',
    pattern: {
      anyOf: ['inversion table', 'back inversion table', 'gravity table',
               'inverter therapy table'],
    },
    inject: [{ prefix: '9506.91', syntheticRank: 22 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, prefixMatch: '9506.' }],
  },

  // ── Rule 785: WEIGHTED_BLANKET_INTENT ─────────────────────────────────────────
  {
    id: 'WEIGHTED_BLANKET_INTENT',
    description: 'Weighted/gravity blanket → ch.63 (6301.40)',
    pattern: {
      anyOf: ['weighted blanket', 'gravity blanket', 'heavy blanket',
               '15lb weighted blanket', 'calming blanket', 'sauna blanket',
               'infrared sauna blanket', 'portable infrared sauna'],
    },
    inject: [{ prefix: '6301.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['63'] },
    boosts: [{ delta: 0.65, prefixMatch: '6301.' }],
  },

  // ── Rule 786: STORAGE_OTTOMAN_INTENT ──────────────────────────────────────────
  {
    id: 'STORAGE_OTTOMAN_INTENT',
    description: 'Storage ottoman/bench → ch.94 (9401.61)',
    pattern: {
      anyOf: ['storage ottoman', 'ottoman storage box', 'bench ottoman storage',
               'round storage ottoman'],
    },
    inject: [{ prefix: '9401.61', syntheticRank: 22 }],
    whitelist: { allowChapters: ['94'] },
    boosts: [{ delta: 0.60, chapterMatch: '94' }],
  },

  // ── Rule 787: SIPPY_CUP_INTENT ────────────────────────────────────────────────
  {
    id: 'SIPPY_CUP_INTENT',
    description: 'Sippy cup/toddler cup → ch.39 (3924.10)',
    pattern: {
      anyOf: ['sippy cup', 'toddler sippy cup', 'spout cup baby',
               'straw sippy cup', '360 cup toddler'],
    },
    inject: [{ prefix: '3924.10', syntheticRank: 22 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.65, prefixMatch: '3924.' }],
  },

  // ── Rule 788: BABY_FOOD_MAKER_INTENT ──────────────────────────────────────────
  {
    id: 'BABY_FOOD_MAKER_INTENT',
    description: 'Baby food maker/blender → ch.85 (8509.40)',
    pattern: {
      anyOf: ['baby food maker', 'baby food processor', 'infant food steamer blender',
               'baby blender'],
    },
    inject: [{ prefix: '8509.40', syntheticRank: 22 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.65, prefixMatch: '8509.' }],
  },

  // ── Rule 789: KIMCHI_FERMENTED_INTENT ─────────────────────────────────────────
  {
    id: 'KIMCHI_FERMENTED_INTENT',
    description: 'Kimchi/fermented food → ch.20 (2005.99)',
    pattern: {
      anyOf: ['kimchi', 'korean kimchi', 'fermented cabbage', 'kimchi jar',
               'vegan kimchi', 'dried mushroom', 'shiitake dried',
               'porcini dried', 'mushroom powder'],
    },
    inject: [{ prefix: '2005.99', syntheticRank: 22 }, { prefix: '0712.39', syntheticRank: 26 }],
    whitelist: { allowChapters: ['20', '07'] },
    boosts: [{ delta: 0.55, chapterMatch: '20' }],
  },

  // ── Batch 11 Rules (790–839) ──────────────────────────────────────────────────

  // ── Rule 790: FIRE_PIT_INTENT ─────────────────────────────────────────────────
  {
    id: 'FIRE_PIT_INTENT',
    description: 'Fire pit / chiminea → ch.73 (7321.11) cast iron outdoor heater',
    pattern: {
      anyOf: ['fire pit', 'chiminea', 'fire bowl', 'outdoor fire pit', 'propane fire pit',
               'wood burning fire pit', 'tabletop fire pit'],
    },
    inject: [{ prefix: '7321.11', syntheticRank: 20 }, { prefix: '7321.19', syntheticRank: 24 }],
    whitelist: { allowChapters: ['73'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 791: GAZEBO_PERGOLA_INTENT ──────────────────────────────────────────
  {
    id: 'GAZEBO_PERGOLA_INTENT',
    description: 'Gazebo / pergola → ch.73/94 (9406.90 prefabricated building)',
    pattern: {
      anyOf: ['gazebo', 'pergola', 'garden gazebo', 'patio pergola', 'pop up gazebo',
               'hardtop gazebo', 'canopy gazebo', 'pergola kit'],
    },
    inject: [{ prefix: '9406.90', syntheticRank: 20 }, { prefix: '7308.90', syntheticRank: 25 }],
    whitelist: { allowChapters: ['94', '73'] },
    boosts: [{ delta: 0.55, chapterMatch: '94' }],
  },

  // ── Rule 792: POOL_FLOAT_INTENT ───────────────────────────────────────────────
  {
    id: 'POOL_FLOAT_INTENT',
    description: 'Pool float / inflatable pool toy → ch.95 (9506.29)',
    pattern: {
      anyOf: ['pool float', 'inflatable pool float', 'pool ring', 'pool lounger',
               'swimming pool float', 'pool toy float', 'pool noodle', 'inflatable ring pool'],
    },
    inject: [{ prefix: '9506.29', syntheticRank: 20 }, { prefix: '3926.90', syntheticRank: 28 }],
    whitelist: { allowChapters: ['95', '39'] },
    boosts: [{ delta: 0.55, chapterMatch: '95' }],
  },

  // ── Rule 793: MANDOLINE_SLICER_INTENT ────────────────────────────────────────
  {
    id: 'MANDOLINE_SLICER_INTENT',
    description: 'Mandoline slicer → ch.82 (8210.00 hand kitchen appliance)',
    pattern: {
      anyOf: ['mandoline slicer', 'vegetable mandoline', 'food slicer mandoline', 'v-slicer',
               'adjustable mandoline', 'mandoline grater'],
    },
    inject: [{ prefix: '8210.00', syntheticRank: 20 }, { prefix: '8205.51', syntheticRank: 28 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.55, chapterMatch: '82' }],
  },

  // ── Rule 794: BREAD_MAKER_INTENT ──────────────────────────────────────────────
  {
    id: 'BREAD_MAKER_INTENT',
    description: 'Bread maker / bread machine → ch.85 (8516.60 electrothermic appliance)',
    pattern: {
      anyOf: ['bread maker', 'bread machine', 'breadmaker', 'automatic bread maker',
               'home bread maker', 'bread baking machine'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 20 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 795: PASTA_MAKER_INTENT ──────────────────────────────────────────────
  {
    id: 'PASTA_MAKER_INTENT',
    description: 'Pasta maker / pasta machine → ch.84 (8417.20 / 8210.00)',
    pattern: {
      anyOf: ['pasta maker', 'pasta machine', 'pasta roller', 'electric pasta maker',
               'noodle maker machine', 'pasta extruder'],
    },
    inject: [{ prefix: '8417.20', syntheticRank: 22 }, { prefix: '8210.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['84', '82'] },
    boosts: [{ delta: 0.50, chapterMatch: '84' }],
  },

  // ── Rule 796: ICE_MAKER_INTENT ────────────────────────────────────────────────
  {
    id: 'ICE_MAKER_INTENT',
    description: 'Ice maker / countertop ice machine → ch.84 (8418.69)',
    pattern: {
      anyOf: ['ice maker', 'portable ice maker', 'countertop ice maker', 'nugget ice maker',
               'ice machine', 'ice cube maker'],
    },
    inject: [{ prefix: '8418.69', syntheticRank: 20 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.55, chapterMatch: '84' }],
  },

  // ── Rule 797: WAFFLE_MAKER_INTENT ─────────────────────────────────────────────
  {
    id: 'WAFFLE_MAKER_INTENT',
    description: 'Waffle maker / waffle iron → ch.85 (8516.60)',
    pattern: {
      anyOf: ['waffle maker', 'waffle iron', 'belgian waffle maker', 'mini waffle maker',
               'waffle machine', 'waffle baker'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 20 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 798: PANINI_PRESS_INTENT ─────────────────────────────────────────────
  {
    id: 'PANINI_PRESS_INTENT',
    description: 'Panini press / sandwich press → ch.85 (8516.60 / 8516.72)',
    pattern: {
      anyOf: ['panini press', 'sandwich press', 'panini grill', 'contact grill panini',
               'press toaster', 'sandwich maker electric'],
    },
    inject: [{ prefix: '8516.60', syntheticRank: 22 }, { prefix: '8516.72', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 799: FOOD_VACUUM_SEALER_INTENT ──────────────────────────────────────
  {
    id: 'FOOD_VACUUM_SEALER_INTENT',
    description: 'Food vacuum sealer → ch.84 (8422.30)',
    pattern: {
      anyOf: ['food vacuum sealer', 'vacuum sealer machine', 'food sealer', 'bag sealer',
               'sous vide vacuum sealer', 'vacuum bag sealer'],
    },
    inject: [{ prefix: '8422.30', syntheticRank: 20 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.55, chapterMatch: '84' }],
  },

  // ── Rule 800: USB_C_HUB_INTENT ────────────────────────────────────────────────
  {
    id: 'USB_C_HUB_INTENT',
    description: 'USB-C hub / multiport adapter → ch.85 (8536.49)',
    pattern: {
      anyOf: ['usb c hub', 'usb-c hub', 'type c hub', 'multiport hub usb c',
               'usb c docking station', 'usb c adapter hub', 'multiport adapter'],
    },
    inject: [{ prefix: '8536.49', syntheticRank: 20 }, { prefix: '8471.80', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 801: EXTERNAL_SSD_INTENT ─────────────────────────────────────────────
  {
    id: 'EXTERNAL_SSD_INTENT',
    description: 'External SSD / portable SSD → ch.84 (8471.70)',
    pattern: {
      anyOf: ['external ssd', 'portable ssd', 'external solid state drive', 'usb ssd',
               'pocket ssd drive', 'nvme drive', 'm.2 nvme ssd', 'nvme solid state'],
    },
    inject: [{ prefix: '8471.70', syntheticRank: 20 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.55, chapterMatch: '84' }],
  },

  // ── Rule 802: SURGE_PROTECTOR_INTENT ─────────────────────────────────────────
  {
    id: 'SURGE_PROTECTOR_INTENT',
    description: 'Surge protector / power strip → ch.85 (8536.30)',
    pattern: {
      anyOf: ['surge protector', 'power surge protector', 'surge suppressor',
               'power strip', 'extension power strip', 'smart power strip', 'usb power strip',
               'multi outlet strip', 'outlet protector'],
    },
    inject: [{ prefix: '8536.30', syntheticRank: 20 }, { prefix: '8536.49', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 803: SCREEN_PROTECTOR_INTENT ────────────────────────────────────────
  {
    id: 'SCREEN_PROTECTOR_INTENT',
    description: 'Screen protector / tempered glass → ch.70 (7007.19) or ch.39 (3919.90)',
    pattern: {
      anyOf: ['screen protector', 'tempered glass screen', 'phone screen protector',
               'ipad screen protector', 'anti glare film', 'privacy screen protector'],
    },
    inject: [{ prefix: '7007.19', syntheticRank: 20 }, { prefix: '3919.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['70', '39'] },
    boosts: [{ delta: 0.55, chapterMatch: '70' }],
  },

  // ── Rule 804: SMART_THERMOSTAT_INTENT ────────────────────────────────────────
  {
    id: 'SMART_THERMOSTAT_INTENT',
    description: 'Smart thermostat / programmable thermostat → ch.90 (9032.10)',
    pattern: {
      anyOf: ['smart thermostat', 'wifi thermostat', 'programmable thermostat smart',
               'nest thermostat', 'ecobee', 'learning thermostat', 'digital thermostat'],
    },
    inject: [{ prefix: '9032.10', syntheticRank: 20 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.60, chapterMatch: '90' }],
  },

  // ── Rule 805: HAIR_CLAW_CLIP_INTENT ──────────────────────────────────────────
  {
    id: 'HAIR_CLAW_CLIP_INTENT',
    description: 'Hair claw clip / jaw clip → ch.96 (9615.11)',
    pattern: {
      anyOf: ['hair claw clip', 'claw clip hair', 'jaw clip', 'large claw clip',
               'shark clip hair', 'octopus hair clip', 'butterfly clip hair'],
    },
    inject: [{ prefix: '9615.11', syntheticRank: 20 }, { prefix: '9615.19', syntheticRank: 26 }],
    whitelist: { allowChapters: ['96'] },
    boosts: [{ delta: 0.55, chapterMatch: '96' }],
  },

  // ── Rule 806: SILK_SCARF_INTENT ───────────────────────────────────────────────
  {
    id: 'SILK_SCARF_INTENT',
    description: 'Silk / satin scarf → ch.62 (6214.10)',
    pattern: {
      anyOf: ['silk scarf', 'satin scarf', 'square silk scarf', 'head silk scarf',
               'printed silk scarf', 'silk headscarf'],
    },
    inject: [{ prefix: '6214.10', syntheticRank: 20 }],
    whitelist: { allowChapters: ['62', '61'] },
    boosts: [{ delta: 0.60, chapterMatch: '62' }],
  },

  // ── Rule 807: TIE_CLIP_INTENT ─────────────────────────────────────────────────
  {
    id: 'TIE_CLIP_INTENT',
    description: 'Tie clip / tie bar → ch.71 (7117.19) or ch.83 (8308.90)',
    pattern: {
      anyOf: ['tie clip', 'tie bar', 'necktie clip', 'tie pin', 'tie fastener', 'collar pin tie'],
    },
    inject: [{ prefix: '7117.19', syntheticRank: 20 }, { prefix: '8308.90', syntheticRank: 26 }],
    whitelist: { allowChapters: ['71', '83'] },
    boosts: [{ delta: 0.55, chapterMatch: '71' }],
  },

  // ── Rule 808: WATCH_WINDER_INTENT ─────────────────────────────────────────────
  {
    id: 'WATCH_WINDER_INTENT',
    description: 'Watch winder / watch box → ch.91 (9114.90) or ch.42 (4202.91)',
    pattern: {
      anyOf: ['watch winder', 'automatic watch winder', 'watch winder box',
               'watch rotation winder', 'dual watch winder'],
    },
    inject: [{ prefix: '9114.90', syntheticRank: 20 }, { prefix: '4202.91', syntheticRank: 26 }],
    whitelist: { allowChapters: ['91', '42'] },
    boosts: [{ delta: 0.55, chapterMatch: '91' }],
  },

  // ── Rule 809: TENNIS_RACKET_INTENT ────────────────────────────────────────────
  {
    id: 'TENNIS_RACKET_INTENT',
    description: 'Tennis racket / badminton racket / squash racket → ch.95 (9506.51/9506.59)',
    pattern: {
      anyOf: ['tennis racket', 'tennis racquet', 'badminton racket', 'badminton racquet',
               'squash racket', 'squash racquet', 'badminton set'],
    },
    inject: [{ prefix: '9506.51', syntheticRank: 20 }, { prefix: '9506.59', syntheticRank: 26 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 810: TABLE_TENNIS_INTENT ─────────────────────────────────────────────
  {
    id: 'TABLE_TENNIS_INTENT',
    description: 'Table tennis paddle / ping pong → ch.95 (9506.40)',
    pattern: {
      anyOf: ['table tennis paddle', 'ping pong paddle', 'table tennis bat', 'tt paddle',
               'ping pong racket', 'ping pong table', 'table tennis table'],
    },
    inject: [{ prefix: '9506.40', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 811: DISC_SPORT_INTENT ───────────────────────────────────────────────
  {
    id: 'DISC_SPORT_INTENT',
    description: 'Frisbee / flying disc → ch.95 (9506.99)',
    pattern: {
      anyOf: ['frisbee', 'flying disc', 'ultimate frisbee', 'sport disc',
               'disc golf frisbee', 'disc golf driver', 'disc golf putter'],
    },
    inject: [{ prefix: '9506.99', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.55, chapterMatch: '95' }],
  },

  // ── Rule 812: VOLLEYBALL_INTENT ───────────────────────────────────────────────
  {
    id: 'VOLLEYBALL_INTENT',
    description: 'Volleyball → ch.95 (9506.62)',
    pattern: {
      anyOf: ['volleyball', 'volleyball ball', 'beach volleyball', 'indoor volleyball',
               'official volleyball', 'volleyball net set'],
    },
    inject: [{ prefix: '9506.62', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 813: SKI_POLES_INTENT ────────────────────────────────────────────────
  {
    id: 'SKI_POLES_INTENT',
    description: 'Ski poles → ch.95 (9506.11)',
    pattern: {
      anyOf: ['ski poles', 'alpine ski poles', 'downhill ski poles', 'carbon ski poles',
               'adjustable ski poles', 'ski walking poles'],
    },
    inject: [{ prefix: '9506.11', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 814: CYCLING_GLOVES_INTENT ──────────────────────────────────────────
  {
    id: 'CYCLING_GLOVES_INTENT',
    description: 'Cycling gloves / bike gloves → ch.62 (6216.00)',
    pattern: {
      anyOf: ['cycling gloves', 'bike gloves', 'bicycle gloves', 'cycling mitts',
               'gel cycling gloves', 'fingerless cycling gloves'],
    },
    inject: [{ prefix: '6216.00', syntheticRank: 20 }],
    whitelist: { allowChapters: ['62', '61'] },
    boosts: [{ delta: 0.60, chapterMatch: '62' }],
  },

  // ── Rule 815: CAJON_INTENT ────────────────────────────────────────────────────
  {
    id: 'CAJON_INTENT',
    description: 'Cajon / djembe / bongo drums → ch.92 (9206.00)',
    pattern: {
      anyOf: ['cajon drum', 'cajon box drum', 'wooden cajon', 'flamenco cajon',
               'djembe', 'djembe drum', 'african djembe', 'bongo drums', 'bongos', 'bongo set'],
    },
    inject: [{ prefix: '9206.00', syntheticRank: 20 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.60, chapterMatch: '92' }],
  },

  // ── Rule 816: KALIMBA_INTENT ──────────────────────────────────────────────────
  {
    id: 'KALIMBA_INTENT',
    description: 'Kalimba / thumb piano / mbira → ch.92 (9207.90)',
    pattern: {
      anyOf: ['kalimba', 'thumb piano', 'mbira', '17 key kalimba', '10 key kalimba',
               'finger piano', 'tongued metal instrument'],
    },
    inject: [{ prefix: '9207.90', syntheticRank: 20 }, { prefix: '9206.00', syntheticRank: 26 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.60, chapterMatch: '92' }],
  },

  // ── Rule 817: METRONOME_INTENT ────────────────────────────────────────────────
  {
    id: 'METRONOME_INTENT',
    description: 'Metronome → ch.92 (9209.30)',
    pattern: {
      anyOf: ['metronome', 'digital metronome', 'clip on metronome', 'mechanical metronome',
               'metronome tuner', 'electronic metronome'],
    },
    inject: [{ prefix: '9209.30', syntheticRank: 20 }],
    whitelist: { allowChapters: ['92'] },
    boosts: [{ delta: 0.60, chapterMatch: '92' }],
  },

  // ── Rule 818: AIRBRUSH_KIT_INTENT ─────────────────────────────────────────────
  {
    id: 'AIRBRUSH_KIT_INTENT',
    description: 'Airbrush kit / airbrush gun → ch.84 (8424.20)',
    pattern: {
      anyOf: ['airbrush kit', 'airbrush set', 'mini airbrush compressor', 'dual action airbrush',
               'airbrush gun', 'gravity feed airbrush'],
    },
    inject: [{ prefix: '8424.20', syntheticRank: 20 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.55, chapterMatch: '84' }],
  },

  // ── Rule 819: POLYMER_CLAY_INTENT ─────────────────────────────────────────────
  {
    id: 'POLYMER_CLAY_INTENT',
    description: 'Polymer clay / oven bake clay → ch.39 (3907.20)',
    pattern: {
      anyOf: ['polymer clay', 'oven bake clay', 'fimo clay', 'sculpey clay',
               'modeling clay oven', 'air dry clay', 'self hardening clay'],
    },
    inject: [{ prefix: '3907.20', syntheticRank: 20 }, { prefix: '3824.99', syntheticRank: 28 }],
    whitelist: { allowChapters: ['39'] },
    boosts: [{ delta: 0.55, chapterMatch: '39' }],
  },

  // ── Rule 820: WEAVING_LOOM_INTENT ─────────────────────────────────────────────
  {
    id: 'WEAVING_LOOM_INTENT',
    description: 'Weaving loom / tapestry loom → ch.84 (8446.10)',
    pattern: {
      anyOf: ['weaving loom', 'tapestry loom', 'rigid heddle loom', 'frame loom',
               'peg loom weaving', 'hand weaving loom', 'lap loom weaving'],
    },
    inject: [{ prefix: '8446.10', syntheticRank: 20 }],
    whitelist: { allowChapters: ['84'] },
    boosts: [{ delta: 0.55, chapterMatch: '84' }],
  },

  // ── Rule 821: RESIN_PIGMENT_INTENT ────────────────────────────────────────────
  {
    id: 'RESIN_PIGMENT_INTENT',
    description: 'Resin pigment / mica powder / epoxy dye → ch.32 (3212.10)',
    pattern: {
      anyOf: ['resin pigment', 'epoxy pigment powder', 'mica powder resin', 'color pigment epoxy',
               'resin dye', 'alcohol ink', 'fluid art alcohol', 'mica pigment powder'],
    },
    inject: [{ prefix: '3212.10', syntheticRank: 20 }, { prefix: '3206.49', syntheticRank: 26 }],
    whitelist: { allowChapters: ['32'] },
    boosts: [{ delta: 0.55, chapterMatch: '32' }],
  },

  // ── Rule 822: LED_HEADLIGHT_INTENT ────────────────────────────────────────────
  {
    id: 'LED_HEADLIGHT_INTENT',
    description: 'LED headlight bulb / automotive LED → ch.85 (8512.20)',
    pattern: {
      anyOf: ['led headlight', 'led headlight bulb', 'h7 led headlight', 'h11 led bulb',
               'automotive led headlight', 'car led headlights', 'h4 led bulb'],
    },
    inject: [{ prefix: '8512.20', syntheticRank: 20 }, { prefix: '8539.50', syntheticRank: 26 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.55, chapterMatch: '85' }],
  },

  // ── Rule 823: OBD2_SCANNER_INTENT ─────────────────────────────────────────────
  {
    id: 'OBD2_SCANNER_INTENT',
    description: 'OBD2 scanner / car diagnostic tool → ch.90 (9031.49)',
    pattern: {
      anyOf: ['obd2 scanner', 'obd ii scanner', 'car diagnostic scanner', 'elm327 bluetooth',
               'obdii reader', 'car diagnostic tool', 'vehicle fault reader'],
    },
    inject: [{ prefix: '9031.49', syntheticRank: 20 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.60, chapterMatch: '90' }],
  },

  // ── Rule 824: JUMP_STARTER_INTENT ─────────────────────────────────────────────
  {
    id: 'JUMP_STARTER_INTENT',
    description: 'Jump starter / battery booster → ch.85 (8507.60)',
    pattern: {
      anyOf: ['jump starter', 'portable jump starter', 'battery booster pack',
               'car jump starter pack', 'lithium jump starter', 'jump start pack'],
    },
    inject: [{ prefix: '8507.60', syntheticRank: 20 }],
    whitelist: { allowChapters: ['85'] },
    boosts: [{ delta: 0.60, chapterMatch: '85' }],
  },

  // ── Rule 825: BLOOD_GLUCOSE_MONITOR_INTENT ───────────────────────────────────
  {
    id: 'BLOOD_GLUCOSE_MONITOR_INTENT',
    description: 'Blood glucose monitor / glucometer → ch.90 (9027.80)',
    pattern: {
      anyOf: ['blood glucose monitor', 'glucose meter', 'glucometer', 'blood sugar monitor',
               'diabetes meter', 'glucose test strip', 'continuous glucose monitor'],
    },
    inject: [{ prefix: '9027.80', syntheticRank: 20 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.65, chapterMatch: '90' }],
  },

  // ── Rule 826: BACK_MASSAGER_INTENT ────────────────────────────────────────────
  {
    id: 'BACK_MASSAGER_INTENT',
    description: 'Back massager / shiatsu massager → ch.90 (9019.10)',
    pattern: {
      anyOf: ['back massager', 'percussion back massager', 'shiatsu back massager',
               'heated back massager', 'foot massager', 'electric foot massager',
               'shiatsu foot massager', 'foot spa massager', 'eye massager',
               'electric eye massager', 'heated eye massager'],
    },
    inject: [{ prefix: '9019.10', syntheticRank: 20 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.60, chapterMatch: '90' }],
  },

  // ── Rule 827: POSTURE_CORRECTOR_INTENT ───────────────────────────────────────
  {
    id: 'POSTURE_CORRECTOR_INTENT',
    description: 'Posture corrector / posture brace → ch.90 (9021.10)',
    pattern: {
      anyOf: ['posture corrector', 'back posture brace', 'posture support',
               'spine corrector brace', 'shoulder posture brace', 'posture trainer'],
    },
    inject: [{ prefix: '9021.10', syntheticRank: 20 }],
    whitelist: { allowChapters: ['90'] },
    boosts: [{ delta: 0.60, chapterMatch: '90' }],
  },

  // ── Rule 828: PLAY_KITCHEN_INTENT ─────────────────────────────────────────────
  {
    id: 'PLAY_KITCHEN_INTENT',
    description: 'Play kitchen / toy kitchen → ch.95 (9503.00)',
    pattern: {
      anyOf: ['play kitchen', 'kids play kitchen', 'pretend kitchen toy', 'toy kitchen set',
               'wooden play kitchen', 'toy kitchen stove', 'pretend play kitchen'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 829: DOLLHOUSE_INTENT ────────────────────────────────────────────────
  {
    id: 'DOLLHOUSE_INTENT',
    description: 'Dollhouse → ch.95 (9503.00)',
    pattern: {
      anyOf: ['dollhouse', 'doll house', 'kids dollhouse', 'wooden dollhouse', 'barbie dollhouse',
               'dolls house furniture', 'miniature dollhouse'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 830: WOODEN_TRAIN_INTENT ─────────────────────────────────────────────
  {
    id: 'WOODEN_TRAIN_INTENT',
    description: 'Wooden train set / kids train track → ch.95 (9503.00)',
    pattern: {
      anyOf: ['wooden train set', 'toy train set wood', 'kids railway set', 'toddler train track',
               'wooden train track', 'toy train track', 'wooden toy train'],
    },
    inject: [{ prefix: '9503.00', syntheticRank: 20 }],
    whitelist: { allowChapters: ['95'] },
    boosts: [{ delta: 0.60, chapterMatch: '95' }],
  },

  // ── Rule 831: TAHINI_PASTE_INTENT ─────────────────────────────────────────────
  {
    id: 'TAHINI_PASTE_INTENT',
    description: 'Tahini / sesame paste → ch.20 (2008.19)',
    pattern: {
      anyOf: ['tahini', 'sesame paste', 'tahini paste', 'sesame tahini', 'hulled sesame tahini'],
    },
    inject: [{ prefix: '2008.19', syntheticRank: 22 }],
    whitelist: { allowChapters: ['20', '12'] },
    boosts: [{ delta: 0.55, chapterMatch: '20' }],
  },

  // ── Rule 832: MISO_PASTE_INTENT ───────────────────────────────────────────────
  {
    id: 'MISO_PASTE_INTENT',
    description: 'Miso paste / fermented soybean → ch.21 (2103.90)',
    pattern: {
      anyOf: ['miso paste', 'white miso', 'red miso paste', 'japanese miso', 'soybean miso',
               'tempeh', 'soy tempeh', 'organic tempeh', 'fermented soy tempeh'],
    },
    inject: [{ prefix: '2103.90', syntheticRank: 20 }, { prefix: '2106.10', syntheticRank: 26 }],
    whitelist: { allowChapters: ['21', '20'] },
    boosts: [{ delta: 0.55, chapterMatch: '21' }],
  },

  // ── Rule 833: OATMILK_PLANT_MILK_INTENT ──────────────────────────────────────
  {
    id: 'OATMILK_PLANT_MILK_INTENT',
    description: 'Oat milk / almond milk / coconut milk / plant-based milk → ch.22 (2202.99)',
    pattern: {
      anyOf: ['oat milk', 'barista oat milk', 'almond milk', 'unsweetened almond milk',
               'coconut milk', 'full fat coconut milk', 'plant based milk', 'rice milk',
               'soy milk', 'oat drink'],
    },
    inject: [{ prefix: '2202.99', syntheticRank: 20 }],
    whitelist: { allowChapters: ['22', '04'] },
    boosts: [{ delta: 0.55, chapterMatch: '22' }],
  },

  // ── Rule 834: BONE_BROTH_INTENT ───────────────────────────────────────────────
  {
    id: 'BONE_BROTH_INTENT',
    description: 'Bone broth / collagen broth → ch.21 (2104.10)',
    pattern: {
      anyOf: ['bone broth', 'chicken bone broth', 'beef bone broth', 'collagen broth',
               'bone broth powder', 'liquid bone broth'],
    },
    inject: [{ prefix: '2104.10', syntheticRank: 20 }],
    whitelist: { allowChapters: ['21'] },
    boosts: [{ delta: 0.55, chapterMatch: '21' }],
  },

  // ── Rule 835: CASHMERE_MERINO_INTENT ─────────────────────────────────────────
  {
    id: 'CASHMERE_MERINO_INTENT',
    description: 'Cashmere / merino wool sweater → ch.61 (6110.12/6110.11)',
    pattern: {
      anyOf: ['cashmere sweater', 'cashmere knit', 'pure cashmere pullover', 'cashmere cardigan',
               'merino wool', 'merino jumper', 'merino t shirt', 'merino base layer'],
    },
    inject: [{ prefix: '6110.12', syntheticRank: 20 }, { prefix: '6110.11', syntheticRank: 26 }],
    whitelist: { allowChapters: ['61', '62'] },
    boosts: [{ delta: 0.60, chapterMatch: '61' }],
  },

  // ── Rule 836: WEATHER_STRIPPING_INTENT ───────────────────────────────────────
  {
    id: 'WEATHER_STRIPPING_INTENT',
    description: 'Weather stripping / door sweep / draft stopper → ch.39 (3925.90) or ch.40 (4016.95)',
    pattern: {
      anyOf: ['weather stripping', 'door weather seal', 'window weather strip', 'foam weather stripping',
               'door seal strip', 'door sweep', 'draft door sweep', 'under door seal',
               'draft stopper', 'door draft excluder', 'door gap stopper'],
    },
    inject: [{ prefix: '3925.90', syntheticRank: 22 }, { prefix: '4016.95', syntheticRank: 26 }],
    whitelist: { allowChapters: ['39', '40'] },
    boosts: [{ delta: 0.50, chapterMatch: '39' }],
  },

  // ── Rule 837: WIRE_STRIPPER_CRIMPER_INTENT ───────────────────────────────────
  {
    id: 'WIRE_STRIPPER_CRIMPER_INTENT',
    description: 'Wire stripper / crimping tool → ch.82 (8203.20)',
    pattern: {
      anyOf: ['wire stripper', 'electrical wire stripper', 'cable stripper tool',
               'automatic wire stripper', 'stripping pliers', 'crimping tool', 'wire crimper',
               'cable crimper', 'electrical crimping tool', 'ratchet crimper'],
    },
    inject: [{ prefix: '8203.20', syntheticRank: 20 }],
    whitelist: { allowChapters: ['82'] },
    boosts: [{ delta: 0.55, chapterMatch: '82' }],
  },

  // ── Rule 838: CAMP_STOVE_INTENT ───────────────────────────────────────────────
  {
    id: 'CAMP_STOVE_INTENT',
    description: 'Camp stove / backpacking stove → ch.73 (7321.12) or ch.84 (8419.89)',
    pattern: {
      anyOf: ['camp stove', 'camping gas stove', 'backpacking stove', 'camp burner',
               'portable camp stove', 'propane camp stove', 'butane camp stove'],
    },
    inject: [{ prefix: '7321.12', syntheticRank: 20 }, { prefix: '8419.89', syntheticRank: 26 }],
    whitelist: { allowChapters: ['73', '84'] },
    boosts: [{ delta: 0.55, chapterMatch: '73' }],
  },

  // ── Rule 839: SLEEPING_PAD_INTENT ─────────────────────────────────────────────
  {
    id: 'SLEEPING_PAD_INTENT',
    description: 'Sleeping pad / camp sleeping mat → ch.94 (9404.29) or ch.39 (3926.90)',
    pattern: {
      anyOf: ['sleeping pad', 'foam sleeping pad', 'inflatable sleeping pad',
               'backpacking sleeping mat', 'camp sleeping pad', 'bivvy bag', 'bivy sack',
               'ultralight bivy', 'sleeping bag liner bivy'],
    },
    inject: [{ prefix: '9404.29', syntheticRank: 20 }, { prefix: '3926.90', syntheticRank: 28 }],
    whitelist: { allowChapters: ['94', '39'] },
    boosts: [{ delta: 0.55, chapterMatch: '94' }],
  },
];
