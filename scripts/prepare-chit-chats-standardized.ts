#!/usr/bin/env ts-node
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { parse as csvParse } from 'csv-parse/sync';
import { stringify as csvStringify } from 'csv-stringify/sync';

interface RawCsvRow {
  hts_code?: string;
  hts_number?: string;
  custom_description?: string;
  description?: string;
  query?: string;
}

interface StandardizedRow {
  queryId: string;
  canonicalHtsNumber: string;
  canonicalHtsDigits: string;
  originalDescription: string;
  standardizedDescription: string;
  standardizedQuery: string;
  noiseFlags: string[];
  noiseScore: number;
  qualityFlags: string[];
  qualityScore: number;
  evalEligible: boolean;
}

interface EvalRow {
  queryId: string;
  standardizedQuery: string;
  representativeDescription: string;
  expectedHtsNumber: string;
  acceptableHtsNumbers: string[];
  expectedChapter: string;
  ambiguity: 'single_label' | 'multi_label';
  contributingStandardizedRows: number;
  maxNoiseScore: number;
}

interface RowQualityAssessment {
  qualityFlags: string[];
  qualityScore: number;
  evalEligible: boolean;
}

interface HtsDetail {
  description?: string;
  fullDescription?: string[] | null;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'used',
  'with',
]);

const MATERIAL_TOKENS = new Set([
  'acrylic',
  'aluminum',
  'aluminium',
  'cotton',
  'gold',
  'iron',
  'metal',
  'nylon',
  'plastic',
  'polyester',
  'silver',
  'steel',
  'wool',
]);

const ARTICLE_TOKENS = new Set([
  'apron',
  'bag',
  'bags',
  'belt',
  'belts',
  'blank',
  'blanket',
  'blankets',
  'bottle',
  'bottles',
  'bracelet',
  'bra',
  'bras',
  'cap',
  'caps',
  'card',
  'cards',
  'case',
  'cases',
  'cd',
  'cds',
  'chain',
  'chains',
  'cloth',
  'comic',
  'comics',
  'cord',
  'dress',
  'dresses',
  'dishcloth',
  'dvd',
  'dvds',
  'earring',
  'earrings',
  'fabric',
  'footwear',
  'glove',
  'gloves',
  'hoodie',
  'hose',
  'jewelry',
  'jacket',
  'keychain',
  'keychains',
  'leggings',
  'mat',
  'mats',
  'mug',
  'mugs',
  'necklace',
  'necklaces',
  'pants',
  'panties',
  'patch',
  'patches',
  'pillow',
  'pillows',
  'plaque',
  'poster',
  'posters',
  'poplin',
  'rivet',
  'rivets',
  'ring',
  'rings',
  'rope',
  'scarf',
  'sandals',
  'shirt',
  'shirts',
  'shoes',
  'shoe',
  'shorts',
  'skirt',
  'skirts',
  'sneaker',
  'sneakers',
  'sock',
  'socks',
  'strap',
  'straps',
  'sweater',
  'sweaters',
  'thread',
  'threads',
  'towel',
  'towels',
  'toy',
  'toys',
  'trousers',
  'wig',
  'wigs',
  'yarn',
]);

const GENERIC_VARIANT_TOKENS = new Set([
  'assorted',
  'black',
  'blue',
  'brown',
  'coastal',
  'cream',
  'dark',
  'gold',
  'green',
  'grey',
  'ivory',
  'khaki',
  'lavender',
  'light',
  'limited',
  'mini',
  'natural',
  'new',
  'orange',
  'pink',
  'purple',
  'red',
  'sample',
  'samples',
  'silver',
  'small',
  'tall',
  'teal',
  'vintage',
  'white',
  'yellow',
]);

const TOKEN_SYNONYMS: Record<string, string[]> = {
  baby: ['infant', 'infants'],
  babies: ['infant', 'infants'],
  bag: ['bags'],
  bags: ['bag'],
  cord: ['cords', 'rope', 'ropes', 'twine'],
  fabric: ['fabrics', 'woven'],
  fabrics: ['fabric', 'woven'],
  glove: ['gloves'],
  gloves: ['glove'],
  infants: ['infant', 'baby'],
  infant: ['infants', 'baby'],
  pants: ['trousers'],
  shoes: ['shoe', 'footwear'],
  shoe: ['shoes', 'footwear'],
  strap: ['straps', 'webbing'],
  straps: ['strap', 'webbing'],
  thread: ['threads', 'cord'],
  yarn: ['yarns'],
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHtsDigits(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function formatHtsNumber(value: string): string {
  if (value.length !== 10) {
    return value;
  }
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}.${value.slice(8, 10)}`;
}

function detectNoiseFlags(originalDescription: string): string[] {
  const flags: string[] = [];
  if (/<[^>]+>/.test(originalDescription)) {
    flags.push('html');
  }
  if (/\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre)\b/i.test(originalDescription)) {
    flags.push('measure');
  }
  if (/\b\d+\s*(?:count|ct|pk|pcs?|pieces?|servings?)\b/i.test(originalDescription)) {
    flags.push('count');
  }
  if (/[\/|]/.test(originalDescription)) {
    flags.push('options');
  }
  return flags;
}

function dedupeAdjacentSegments(value: string): string {
  const parts = value
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return value;
  }

  const deduped: string[] = [];
  for (const part of parts) {
    if (deduped[deduped.length - 1] !== part) {
      deduped.push(part);
    }
  }
  return deduped.join(' - ');
}

function standardizeDescription(value: string): string {
  return dedupeAdjacentSegments(
    stripHtml(value)
      .replace(/[–—]/g, '-')
      .replace(/\s*\/\s*/g, ' / ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function standardizeQuery(value: string): string {
  const noHtml = standardizeDescription(value);
  const normalized = noHtml
    .toLowerCase()
    .replace(/\b\d+\s*-\s*\d+\s*(?:months?|mos?|years?|yrs?)\b/gi, ' ')
    .replace(/\b\d+\s*(?:months?|mos?|years?|yrs?)\b/gi, ' ')
    .replace(/^\s*\d+\s*(?:x|pairs?|pcs?|pieces?)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?(?:mm|cm|m|ft|in|inch|inches|yd|yard|yards)?\b/gi, ' ')
    .replace(/\((?:[^)]*\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre|count|ct|pk|pcs?|pieces?|servings?)\b[^)]*)\)/gi, ' ')
    .replace(/\b(?:box|pack|set|bundle)\s+of\s+\d+\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*%\s*/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre|count|ct|pk|pcs?|pieces?|servings?)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|meter|meters|ft|feet|inch|inches|in|yd|yds|yard|yards)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?\b/gi, ' ')
    .replace(/\b(?:whole bean|ground|grind size|roast level)\b\s*:\s*/gi, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/[&+]/g, ' and ')
    .replace(/[^a-z0-9%/\-.,' ]+/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/^\d+\s+(?=[a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,.' -]+|[,.' -]+$/g, '')
    .trim();

  const tokens = normalized.split(' ').filter(Boolean);
  const dedupedTokens: string[] = [];
  const trimmedTokens = tokens.filter((token) => !/^\d+(?:[.,]\d+)?$/.test(token));
  while (trimmedTokens.length > 0 && STOP_WORDS.has(trimmedTokens[0])) {
    trimmedTokens.shift();
  }
  while (
    trimmedTokens.length > 0 &&
    (STOP_WORDS.has(trimmedTokens[trimmedTokens.length - 1]) ||
      /^\d+(?:[.,]\d+)?$/.test(trimmedTokens[trimmedTokens.length - 1]))
  ) {
    trimmedTokens.pop();
  }

  for (const token of trimmedTokens) {
    if (dedupedTokens[dedupedTokens.length - 1] !== token) {
      dedupedTokens.push(token);
    }
  }
  return dedupedTokens.join(' ');
}

function isLowInformationQuery(value: string): boolean {
  const query = value.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);

  if (!query || query.length < 4) {
    return true;
  }

  if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
    return true;
  }

  if (
    [
      'book',
      'books',
      'card',
      'cards',
      'document',
      'gift',
      'item',
      'magazine',
      'photo',
      'product',
      'sample',
      'samples',
      'sticker',
      'stickers',
    ].includes(query)
  ) {
    return true;
  }

  return false;
}

function extractTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .split(/[^a-z]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function buildExpandedTokenSet(tokens: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    for (const synonym of TOKEN_SYNONYMS[token] || []) {
      expanded.add(synonym);
    }
  }
  return expanded;
}

function isMaterialOnlyQuery(tokens: string[]): boolean {
  const nonMaterial = tokens.filter((token) => !MATERIAL_TOKENS.has(token));
  return nonMaterial.length === 0;
}

function hasModelNumberPattern(query: string): boolean {
  return /\b[a-z]*\d[a-z0-9-]*\b/i.test(query);
}

function assessRowQuality(
  row: StandardizedRow,
  detail: HtsDetail | undefined,
): RowQualityAssessment {
  if (!detail) {
    return {
      qualityFlags: ['missing_hts_detail'],
      qualityScore: 0,
      evalEligible: false,
    };
  }

  const queryTokens = extractTokens(row.standardizedQuery);
  const detailTokens = new Set(
    extractTokens(
      `${detail.description || ''} ${(detail.fullDescription || []).join(' ')}`.trim(),
    ),
  );
  const expandedQueryTokens = buildExpandedTokenSet(queryTokens);
  const overlapTokens = [...expandedQueryTokens].filter((token) => detailTokens.has(token));
  const overlapNonMaterialCount = overlapTokens.filter(
    (token) => !MATERIAL_TOKENS.has(token),
  ).length;
  const nonMaterialTokens = queryTokens.filter((token) => !MATERIAL_TOKENS.has(token));
  const hasArticleToken = queryTokens.some((token) => ARTICLE_TOKENS.has(token));
  const onlyGenericVariantTokens =
    nonMaterialTokens.length > 0 &&
    nonMaterialTokens.every((token) => GENERIC_VARIANT_TOKENS.has(token));

  const qualityFlags: string[] = [];

  if (queryTokens.length < 2) {
    qualityFlags.push('low_token_count');
  }

  if (isMaterialOnlyQuery(queryTokens)) {
    qualityFlags.push('material_only');
  }

  if (hasModelNumberPattern(row.standardizedQuery)) {
    qualityFlags.push('model_number');
  }

  if (overlapNonMaterialCount === 0) {
    qualityFlags.push('no_semantic_overlap');
  }

  if (!hasArticleToken && queryTokens.length <= 4 && overlapNonMaterialCount < 2) {
    qualityFlags.push('weak_catalog_fragment');
  }

  if (onlyGenericVariantTokens) {
    qualityFlags.push('variant_only');
  }

  let qualityScore = 100;
  for (const flag of qualityFlags) {
    switch (flag) {
      case 'low_token_count':
        qualityScore -= 45;
        break;
      case 'material_only':
        qualityScore -= 45;
        break;
      case 'model_number':
        qualityScore -= 25;
        break;
      case 'no_semantic_overlap':
        qualityScore -= 45;
        break;
      case 'weak_catalog_fragment':
        qualityScore -= 30;
        break;
      case 'variant_only':
        qualityScore -= 30;
        break;
      default:
        qualityScore -= 10;
        break;
    }
  }

  qualityScore = Math.max(0, qualityScore);

  const evalEligible =
    queryTokens.length >= 2 &&
    !isMaterialOnlyQuery(queryTokens) &&
    overlapNonMaterialCount >= 1 &&
    !(hasModelNumberPattern(row.standardizedQuery) && overlapNonMaterialCount < 2) &&
    !(!hasArticleToken && queryTokens.length <= 4 && overlapNonMaterialCount < 2) &&
    !onlyGenericVariantTokens &&
    qualityScore >= 60;

  return {
    qualityFlags,
    qualityScore,
    evalEligible,
  };
}

function isEvalEligible(query: string, detail: HtsDetail | undefined): boolean {
  if (!detail) {
    return false;
  }

  const queryTokens = extractTokens(query);
  if (queryTokens.length < 2 || isMaterialOnlyQuery(queryTokens)) {
    return false;
  }

  const detailTokens = new Set(
    extractTokens(
      `${detail.description || ''} ${(detail.fullDescription || []).join(' ')}`.trim(),
    ),
  );
  const expandedQueryTokens = buildExpandedTokenSet(queryTokens);
  const overlapTokens = [...expandedQueryTokens].filter((token) => detailTokens.has(token));
  const overlapCount = overlapTokens.length;
  const overlapNonMaterialCount = overlapTokens.filter(
    (token) => !MATERIAL_TOKENS.has(token),
  ).length;
  const hasArticleToken = queryTokens.some((token) => ARTICLE_TOKENS.has(token));
  const nonMaterialCount = queryTokens.filter((token) => !MATERIAL_TOKENS.has(token)).length;

  if (overlapCount >= 2) {
    return true;
  }

  if (overlapNonMaterialCount >= 1 && hasArticleToken) {
    return true;
  }

  return overlapNonMaterialCount >= 1 && nonMaterialCount >= 3;
}

async function fetchHtsDetails(
  baseUrl: string,
  codes: string[],
): Promise<Map<string, HtsDetail>> {
  const details = new Map<string, HtsDetail>();
  const concurrency = 8;

  for (let index = 0; index < codes.length; index += concurrency) {
    const chunk = codes.slice(index, index + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (code) => {
        const response = await fetch(`${baseUrl}/lookup/hts/${encodeURIComponent(code)}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as HtsDetail;
        return [code, payload] as const;
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        details.set(result.value[0], result.value[1]);
      }
    }
  }

  return details;
}

function chooseExpectedHtsNumber(codes: string[]): string {
  return [...codes].sort((a, b) => a.localeCompare(b))[0];
}

function pickEvalRows(
  standardizedRows: StandardizedRow[],
  maxPerCode: number,
): EvalRow[] {
  const byCode = new Map<string, StandardizedRow[]>();
  for (const row of standardizedRows) {
    if (!byCode.has(row.canonicalHtsNumber)) {
      byCode.set(row.canonicalHtsNumber, []);
    }
    byCode.get(row.canonicalHtsNumber)!.push(row);
  }

  const selected = new Map<string, StandardizedRow>();

  for (const [code, rows] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ordered = [...rows].sort((a, b) => {
      if (a.noiseScore !== b.noiseScore) {
        return a.noiseScore - b.noiseScore;
      }
      if (a.standardizedQuery.length !== b.standardizedQuery.length) {
        return a.standardizedQuery.length - b.standardizedQuery.length;
      }
      return md5(`${code}:${a.standardizedQuery}`).localeCompare(md5(`${code}:${b.standardizedQuery}`));
    });

    const picks: StandardizedRow[] = [];
    if (ordered[0]) {
      picks.push(ordered[0]);
    }
    const noisy = [...ordered].reverse().find((row) => row.standardizedQuery !== picks[0]?.standardizedQuery);
    if (noisy) {
      picks.push(noisy);
    }
    const longest = [...ordered]
      .sort((a, b) => b.standardizedQuery.length - a.standardizedQuery.length)
      .find((row) => !picks.some((item) => item.standardizedQuery === row.standardizedQuery));
    if (longest) {
      picks.push(longest);
    }
    for (const row of ordered) {
      if (picks.length >= maxPerCode) {
        break;
      }
      if (!picks.some((item) => item.standardizedQuery === row.standardizedQuery)) {
        picks.push(row);
      }
    }

    for (const row of picks.slice(0, maxPerCode)) {
      selected.set(row.standardizedQuery, row);
    }
  }

  const grouped = new Map<string, StandardizedRow[]>();
  for (const row of standardizedRows) {
    if (!selected.has(row.standardizedQuery)) {
      continue;
    }
    if (!grouped.has(row.standardizedQuery)) {
      grouped.set(row.standardizedQuery, []);
    }
    grouped.get(row.standardizedQuery)!.push(row);
  }

  const evalRows: EvalRow[] = [];
  let sequence = 1;
  for (const [query, rows] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (isLowInformationQuery(query)) {
      continue;
    }

    const acceptableHtsNumbers = [...new Set(rows.map((row) => row.canonicalHtsNumber))].sort();
    const expectedHtsNumber = chooseExpectedHtsNumber(acceptableHtsNumbers);
    const representative = [...rows].sort((a, b) => {
      if (a.noiseScore !== b.noiseScore) {
        return a.noiseScore - b.noiseScore;
      }
      return a.originalDescription.length - b.originalDescription.length;
    })[0];

    evalRows.push({
      queryId: `cc-${String(sequence).padStart(5, '0')}`,
      standardizedQuery: query,
      representativeDescription: representative.originalDescription,
      expectedHtsNumber,
      acceptableHtsNumbers,
      expectedChapter: expectedHtsNumber.slice(0, 2),
      ambiguity: acceptableHtsNumbers.length > 1 ? 'multi_label' : 'single_label',
      contributingStandardizedRows: rows.length,
      maxNoiseScore: Math.max(...rows.map((row) => row.noiseScore)),
    });
    sequence++;
  }

  return evalRows;
}

async function main(): Promise<void> {
  const input = resolve(
    process.cwd(),
    parseArg('in') || '/Users/cheng/Downloads/Chit Chats HTS Codes and Descriptions.csv',
  );
  const standardizedOut = resolve(
    process.cwd(),
    parseArg('out') || 'docs/evaluation/chit-chats-standardized.csv',
  );
  const evalOut = resolve(
    process.cwd(),
    parseArg('eval-out') || 'docs/evaluation/chit-chats-live-eval.csv',
  );
  const rejectedOut = resolve(
    process.cwd(),
    parseArg('rejected-out') || 'docs/evaluation/chit-chats-standardized-rejected.csv',
  );
  const statsOut = resolve(
    process.cwd(),
    parseArg('stats-out') || 'docs/evaluation/chit-chats-standardized.stats.json',
  );
  const baseUrl =
    parseArg('base-url') || process.env.BASE_URL || 'https://api.usahts.com/api/v1';
  const maxPerCode = Math.max(parseInt(parseArg('max-per-code') || '3', 10) || 3, 1);

  const raw = await readFile(input);
  const rows = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as RawCsvRow[];

  const standardizedMap = new Map<string, StandardizedRow>();
  const stats = {
    input,
    totalRows: rows.length,
    invalidHtsRows: 0,
    emptyDescriptionRows: 0,
    uniqueStandardizedRows: 0,
    uniqueStandardizedQueries: 0,
    uniqueHtsNumbers: 0,
    ambiguousQueries: 0,
    rowsWithHtml: 0,
    rowsWithMeasure: 0,
    rowsWithCount: 0,
    rowsWithOptions: 0,
    retainedStandardizedRows: 0,
    rejectedStandardizedRows: 0,
    retainedStandardizedQueries: 0,
    qualityFlagCounts: {} as Record<string, number>,
    evalRowsBeforeValidation: 0,
    evalRows: 0,
  };

  for (const row of rows) {
    const rawHts = row.hts_code || row.hts_number || '';
    const rawDescription = row.custom_description || row.description || row.query || '';
    const htsDigits = normalizeHtsDigits(rawHts);
    if (htsDigits.length !== 10) {
      stats.invalidHtsRows++;
      continue;
    }

    const standardizedDescription = standardizeDescription(rawDescription);
    const standardizedQuery = standardizeQuery(rawDescription);
    if (!standardizedDescription || !standardizedQuery) {
      stats.emptyDescriptionRows++;
      continue;
    }

    const noiseFlags = detectNoiseFlags(rawDescription);
    if (noiseFlags.includes('html')) stats.rowsWithHtml++;
    if (noiseFlags.includes('measure')) stats.rowsWithMeasure++;
    if (noiseFlags.includes('count')) stats.rowsWithCount++;
    if (noiseFlags.includes('options')) stats.rowsWithOptions++;

    const canonicalHtsNumber = formatHtsNumber(htsDigits);
    const key = `${canonicalHtsNumber}\t${standardizedQuery}`;
    if (!standardizedMap.has(key)) {
      standardizedMap.set(key, {
        queryId: `std-${md5(key).slice(0, 12)}`,
        canonicalHtsNumber,
        canonicalHtsDigits: htsDigits,
        originalDescription: stripHtml(rawDescription),
        standardizedDescription,
        standardizedQuery,
        noiseFlags,
        noiseScore: noiseFlags.length,
        qualityFlags: [],
        qualityScore: 0,
        evalEligible: false,
      });
    }
  }

  const standardizedRows = [...standardizedMap.values()].sort((a, b) => {
    if (a.canonicalHtsNumber !== b.canonicalHtsNumber) {
      return a.canonicalHtsNumber.localeCompare(b.canonicalHtsNumber);
    }
    return a.standardizedQuery.localeCompare(b.standardizedQuery);
  });

  const queryToCodes = new Map<string, Set<string>>();
  for (const row of standardizedRows) {
    if (!queryToCodes.has(row.standardizedQuery)) {
      queryToCodes.set(row.standardizedQuery, new Set());
    }
    queryToCodes.get(row.standardizedQuery)!.add(row.canonicalHtsNumber);
  }

  const htsDetails = await fetchHtsDetails(
    baseUrl,
    [...new Set(standardizedRows.map((row) => row.canonicalHtsNumber))],
  );

  const assessedRows = standardizedRows.map((row) => {
    const assessment = assessRowQuality(row, htsDetails.get(row.canonicalHtsNumber));
    return {
      ...row,
      qualityFlags: assessment.qualityFlags,
      qualityScore: assessment.qualityScore,
      evalEligible: assessment.evalEligible &&
        isEvalEligible(row.standardizedQuery, htsDetails.get(row.canonicalHtsNumber)),
    };
  });

  const retainedRows = assessedRows.filter((row) => row.qualityScore >= 60);
  const rejectedRows = assessedRows.filter((row) => row.qualityScore < 60);
  const eligibleRows = assessedRows.filter((row) => row.evalEligible);
  const evalRows = pickEvalRows(eligibleRows, maxPerCode);

  for (const row of assessedRows) {
    for (const flag of row.qualityFlags) {
      stats.qualityFlagCounts[flag] = (stats.qualityFlagCounts[flag] || 0) + 1;
    }
  }

  stats.uniqueStandardizedRows = standardizedRows.length;
  stats.uniqueStandardizedQueries = queryToCodes.size;
  stats.uniqueHtsNumbers = new Set(standardizedRows.map((row) => row.canonicalHtsNumber)).size;
  stats.ambiguousQueries = [...queryToCodes.values()].filter((codes) => codes.size > 1).length;
  stats.retainedStandardizedRows = retainedRows.length;
  stats.rejectedStandardizedRows = rejectedRows.length;
  stats.retainedStandardizedQueries = new Set(retainedRows.map((row) => row.standardizedQuery)).size;
  stats.evalRowsBeforeValidation = pickEvalRows(retainedRows, maxPerCode).length;
  stats.evalRows = evalRows.length;

  await mkdir(dirname(standardizedOut), { recursive: true });
  await mkdir(dirname(evalOut), { recursive: true });
  await mkdir(dirname(rejectedOut), { recursive: true });
  await mkdir(dirname(statsOut), { recursive: true });

  const standardizedCsv = csvStringify(
    retainedRows.map((row) => ({
      query_id: row.queryId,
      canonical_hts_number: row.canonicalHtsNumber,
      canonical_hts_digits: row.canonicalHtsDigits,
      original_description: row.originalDescription,
      standardized_description: row.standardizedDescription,
      standardized_query: row.standardizedQuery,
      noise_flags: row.noiseFlags.join('|'),
      noise_score: row.noiseScore,
      quality_flags: row.qualityFlags.join('|'),
      quality_score: row.qualityScore,
      eval_eligible: row.evalEligible,
    })),
    { header: true },
  );

  const rejectedCsv = csvStringify(
    rejectedRows.map((row) => ({
      query_id: row.queryId,
      canonical_hts_number: row.canonicalHtsNumber,
      canonical_hts_digits: row.canonicalHtsDigits,
      original_description: row.originalDescription,
      standardized_description: row.standardizedDescription,
      standardized_query: row.standardizedQuery,
      noise_flags: row.noiseFlags.join('|'),
      noise_score: row.noiseScore,
      quality_flags: row.qualityFlags.join('|'),
      quality_score: row.qualityScore,
      eval_eligible: row.evalEligible,
    })),
    { header: true },
  );

  const evalCsv = csvStringify(
    evalRows.map((row) => ({
      query_id: row.queryId,
      standardized_query: row.standardizedQuery,
      representative_description: row.representativeDescription,
      expected_hts_number: row.expectedHtsNumber,
      acceptable_hts_numbers: row.acceptableHtsNumbers.join('|'),
      expected_chapter: row.expectedChapter,
      ambiguity: row.ambiguity,
      contributing_standardized_rows: row.contributingStandardizedRows,
      max_noise_score: row.maxNoiseScore,
    })),
    { header: true },
  );

  await writeFile(standardizedOut, standardizedCsv, 'utf-8');
  await writeFile(evalOut, evalCsv, 'utf-8');
  await writeFile(rejectedOut, rejectedCsv, 'utf-8');
  await writeFile(statsOut, `${JSON.stringify(stats, null, 2)}\n`, 'utf-8');

  console.log(
    JSON.stringify(
      {
        standardizedOut,
        evalOut,
        rejectedOut,
        statsOut,
        stats,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
