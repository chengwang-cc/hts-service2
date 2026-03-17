import { Injectable, Logger } from '@nestjs/common';
import { OpenAiService } from '../../../core/services/openai.service';

export interface SearchQueryNormalization {
  normalizedQuery: string;
  searchPhrases: string[];
  keyTerms: string[];
  headingHints: string[];
  ignoreTerms: string[];
}

interface CacheEntry {
  expiresAt: number;
  value: SearchQueryNormalization;
}

@Injectable()
export class QueryNormalizationService {
  private readonly logger = new Logger(QueryNormalizationService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 30 * 60 * 1000;
  private readonly timeoutMs = 1200;
  private readonly boundaryStopwords = new Set([
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
    'with',
  ]);
  private readonly colorTerms = new Set([
    'black',
    'white',
    'blue',
    'navy',
    'red',
    'pink',
    'powder',
    'yellow',
    'green',
    'purple',
    'orange',
    'brown',
    'beige',
    'gray',
    'grey',
    'multicolor',
    'multicolour',
  ]);
  private readonly sizeTerms = new Set([
    'xs',
    's',
    'sm',
    'small',
    'medium',
    'med',
    'large',
    'lg',
    'xl',
    'xlarge',
    'xxl',
    'xxxl',
    'plus',
    'petite',
    'tall',
  ]);
  private readonly marketingTerms = new Set([
    'vintage',
    'retro',
    'boho',
    'minimalist',
    'perfect',
    'gift',
    'gifts',
    'custom',
    'customized',
    'personalized',
    'handmade',
    'handcrafted',
    'decor',
    'decorative',
    'office',
    'nursery',
    'theme',
    'style',
    'stylish',
    'casual',
    'workout',
    'lounge',
    'travel',
    'wall',
    'art',
    'party',
    'birthday',
    'christmas',
    'wedding',
  ]);
  private readonly adminNoiseTerms = new Set([
    'country',
    'origin',
    'manufacturer',
    'manufacture',
    'qualifies',
    'qualify',
    'sales',
    'value',
    'total',
    'unit',
    'sample',
    'samples',
    'promotional',
    'resale',
    'commercial',
    'creation',
    'only',
    'canada',
    'canadian',
    'cad',
    'sku',
    'code',
    'hts',
  ]);
  private readonly categoryNoiseTerms = new Set([
    'floral',
    'print',
    'prints',
    'poster',
    'posters',
    'office',
    'boho',
    'theme',
    'powder',
    'pink',
    'navy',
  ]);

  constructor(private readonly openAiService: OpenAiService) {}

  async normalize(
    rawQuery: string,
  ): Promise<SearchQueryNormalization | null> {
    const query = rawQuery.trim();
    if (!this.shouldNormalize(query)) {
      return null;
    }

    const heuristic = this.buildHeuristicNormalization(query);
    if (!this.shouldUseAi(query)) {
      return heuristic;
    }

    const cached = this.cache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const response = await this.withTimeout(
        this.openAiService.response(
          `User query: "${query}"`,
          {
            model: 'gpt-5-nano',
            instructions:
              'You normalize importer product descriptions into HTS-friendly search terms. ' +
              'Keep the legally meaningful commodity identity, material, processing state, and product form. ' +
              'Delete SKU fragments, fit/size ranges, years, dimensions, pack counts, and model numbers unless they are classification-critical. ' +
              'Down-rank packaging, quantity, colors, and marketing language unless they are classification-critical. ' +
              'Return compact search phrases that resemble tariff vocabulary. ' +
              'If you have a strong signal, include likely 4-digit heading hints. ' +
              'Example: "200 grams of roasted ground coffee packaged in a glass jar" should emphasize prepared coffee and retail-sale terms over glassware terms, and may justify phrases like "coffee extracts essences concentrates" or "packaged for retail sale" if they are plausible. ' +
              'Return JSON only.',
            text: {
              format: {
                type: 'json_schema',
                json_schema: {
                  name: 'search_query_normalization',
                  strict: true,
                  schema: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'normalizedQuery',
                      'searchPhrases',
                      'keyTerms',
                      'headingHints',
                      'ignoreTerms',
                    ],
                    properties: {
                      normalizedQuery: { type: 'string' },
                      searchPhrases: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 5,
                      },
                      keyTerms: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 12,
                      },
                      headingHints: {
                        type: 'array',
                        items: {
                          type: 'string',
                          pattern: '^[0-9]{4}$',
                        },
                        maxItems: 4,
                      },
                      ignoreTerms: {
                        type: 'array',
                        items: { type: 'string' },
                        maxItems: 8,
                      },
                    },
                  },
                },
              },
            },
          },
        ),
        this.timeoutMs,
        'Query normalization timed out',
      );

      const parsed = JSON.parse(
        response.output_text || '{}',
      ) as Partial<SearchQueryNormalization>;

      const normalized = this.sanitize(parsed, query);
      if (!normalized) {
        return heuristic;
      }

      this.cache.set(query, {
        expiresAt: Date.now() + this.cacheTtlMs,
        value: normalized,
      });
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Query normalization skipped: ${message}`);
      return heuristic;
    }
  }

  private shouldNormalize(query: string): boolean {
    const tokens = query.match(/[a-z0-9]+/gi) || [];
    if (tokens.length < 3) {
      return false;
    }

    return (
      tokens.length >= 5 ||
      query.length >= 28 ||
      /\d/.test(query) ||
      /\b(with|containing|made of|packaged|prepared|roasted|ground|frozen|fresh)\b/i.test(
        query,
      )
    );
  }

  private shouldUseAi(query: string): boolean {
    const lower = query.toLowerCase();
    const noisyCatalogSignals =
      /(?:^|\s)\d{2,}(?:\s|$)/.test(lower) ||
      /[a-z]+\d+[a-z0-9]*/i.test(lower) ||
      /\b\d+(?:[./-]\d+)+(?:\b|$)/.test(lower);
    const tokenCount = (lower.match(/[a-z0-9]+/g) || []).length;
    const descriptiveSignals =
      /\b(packaged|containing|made of|made from|prepared|roasted|ground|fresh|frozen|sample|promotional|for resale|not for resale|retail|combustible|flash point|country of origin|manufacturer|unit value|not for resale)\b/i.test(
        lower,
      ) || /[.,:;%()]/.test(query);
    const verboseQuery = tokenCount >= 10 || query.length >= 80;

    if (noisyCatalogSignals && !descriptiveSignals) {
      return false;
    }

    return descriptiveSignals || verboseQuery;
  }

  private buildHeuristicNormalization(
    query: string,
  ): SearchQueryNormalization | null {
    const normalizedQuery = query
      .toLowerCase()
      .replace(/\b\d+(?:[./-]\d+)+(?:\b|$)/g, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:mm|cm|in|inch|inches|oz|ounce|ounces|lb|lbs|kg|g|gram|grams|ml|cl|l|liter|litre|ga|yd|yards?|months?|mos?|years?|yrs?)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*%\s*/gi, ' ')
      .replace(/[|/]/g, ' ')
      .replace(/[^a-z0-9% -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = normalizedQuery
      .split(/\s+/)
      .filter(Boolean);
    const ignoreTerms = tokens.filter(
      (token) =>
        this.isHeuristicNoiseToken(token) || this.boundaryStopwords.has(token),
    );
    const keyTerms = tokens
      .filter(
        (token) =>
          token.length > 1 &&
          !/^\d+$/.test(token) &&
          !/^[a-z]+\d+[a-z0-9]*$/i.test(token) &&
          !this.boundaryStopwords.has(token) &&
          !this.isHeuristicNoiseToken(token),
      )
      .slice(0, 12);
    const searchPhrases = this.buildHeuristicSearchPhrases(keyTerms);
    const condensedQuery = this.cleanPhrase(
      keyTerms.length > 0 ? keyTerms.join(' ') : normalizedQuery,
    );

    if (!normalizedQuery || keyTerms.length === 0) {
      return null;
    }

    return {
      normalizedQuery: condensedQuery,
      searchPhrases,
      keyTerms,
      headingHints: this.inferHeuristicHeadingHints(keyTerms),
      ignoreTerms: [...new Set(ignoreTerms)].slice(0, 8),
    };
  }

  private sanitize(
    parsed: Partial<SearchQueryNormalization>,
    fallbackQuery: string,
  ): SearchQueryNormalization | null {
    const normalizedQuery = this.cleanPhrase(parsed.normalizedQuery || fallbackQuery);
    const searchPhrases = this.uniqueCleanPhrases(parsed.searchPhrases || []);
    const keyTerms = this.uniqueCleanTerms(parsed.keyTerms || []);
    const headingHints = this.uniqueHeadingHints(parsed.headingHints || []);
    const ignoreTerms = this.uniqueCleanTerms(parsed.ignoreTerms || []);

    if (!normalizedQuery && searchPhrases.length === 0 && keyTerms.length === 0) {
      return null;
    }

    return {
      normalizedQuery: normalizedQuery || fallbackQuery,
      searchPhrases,
      keyTerms,
      headingHints,
      ignoreTerms,
    };
  }

  private uniqueCleanPhrases(values: string[]): string[] {
    const seen = new Set<string>();
    const phrases: string[] = [];
    for (const value of values) {
      const cleaned = this.cleanPhrase(value);
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      phrases.push(cleaned);
    }
    return phrases;
  }

  private uniqueCleanTerms(values: string[]): string[] {
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const value of values) {
      const cleaned = this.cleanPhrase(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .trim();
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      terms.push(cleaned);
    }
    return terms;
  }

  private uniqueHeadingHints(values: string[]): string[] {
    const seen = new Set<string>();
    const hints: string[] = [];
    for (const value of values) {
      const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
      if (digits.length !== 4 || seen.has(digits)) {
        continue;
      }
      seen.add(digits);
      hints.push(digits);
    }
    return hints;
  }

  private cleanPhrase(value: string): string {
    const cleaned = String(value || '')
      .trim()
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|gram|grams|kg|oz|ounce|ounces|lb|lbs|pound|pounds|ml|cl|l|liter|litre|count|ct|pk|pcs?|pieces?|servings?)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:months?|mos?|years?|yrs?)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*%\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^["']+|["']+$/g, '');

    const tokens = cleaned.split(/\s+/).filter(Boolean);
    while (tokens.length > 0 && this.boundaryStopwords.has(tokens[0].toLowerCase())) {
      tokens.shift();
    }
    while (
      tokens.length > 0 &&
      this.boundaryStopwords.has(tokens[tokens.length - 1].toLowerCase())
    ) {
      tokens.pop();
    }

    return tokens.join(' ');
  }

  private isHeuristicNoiseToken(token: string): boolean {
    if (
      this.colorTerms.has(token) ||
      this.sizeTerms.has(token) ||
      this.marketingTerms.has(token) ||
      this.adminNoiseTerms.has(token)
    ) {
      return true;
    }

    if (/^(?:x+)?l$/.test(token) || /^x{0,3}s$/.test(token)) {
      return true;
    }

    return false;
  }

  private buildHeuristicSearchPhrases(keyTerms: string[]): string[] {
    if (keyTerms.length === 0) {
      return [];
    }

    const phrases = new Set<string>();
    const joined = keyTerms.join(' ');
    phrases.add(joined);

    const apparelTokens = [
      'dress',
      'shirt',
      'pants',
      'jeans',
      'skirt',
      'jacket',
      'coat',
      'sock',
      'socks',
      'glove',
      'gloves',
      'blazer',
      'hoodie',
      'sweater',
    ];
    const homeTextileTokens = [
      'sheet',
      'sheets',
      'blanket',
      'curtain',
      'pillow',
      'cushion',
      'rug',
      'carpet',
      'lace',
      'trim',
    ];

    if (keyTerms.some((token) => apparelTokens.includes(token))) {
      phrases.add(
        keyTerms.filter((token) => !this.categoryNoiseTerms.has(token)).join(' '),
      );
    }

    if (keyTerms.includes('sheet') || keyTerms.includes('sheets')) {
      phrases.add(
        keyTerms.filter((token) => token !== 'set').concat(['bed', 'linen']).join(' '),
      );
      phrases.add('bed linen');
    }

    if (keyTerms.includes('rug') || keyTerms.includes('carpet')) {
      phrases.add(
        keyTerms.filter((token) => !['desk', 'decor'].includes(token)).join(' '),
      );
      if (keyTerms.includes('woven')) {
        phrases.add('woven rug');
      }
    }

    if (keyTerms.includes('earrings') || keyTerms.includes('earring')) {
      phrases.add(
        keyTerms.filter((token) => token !== 'plated').join(' '),
      );
      if (keyTerms.includes('sterling') || keyTerms.includes('silver')) {
        phrases.add('silver jewelry earrings');
      }
    }

    if (keyTerms.includes('keychain')) {
      phrases.add('key chain');
      phrases.add('key ring');
      phrases.add(
        keyTerms.filter((token) => token !== 'alloy').join(' '),
      );
    }

    if (keyTerms.includes('lace') && keyTerms.includes('trim')) {
      phrases.add('lace trim');
      phrases.add('lace fabric');
    }

    if (
      keyTerms.includes('transformers') &&
      keyTerms.some((token) => ['cover', 'idw', 'sub', 'comic'].includes(token))
    ) {
      phrases.add('comic book');
    }

    if (keyTerms.includes('toothbrush')) {
      phrases.add(
        keyTerms.filter((token) => token !== 'oral').join(' '),
      );
      if (keyTerms.includes('electric') || keyTerms.includes('battery')) {
        phrases.add('electro mechanical toothbrush');
      }
    }

    if (
      keyTerms.includes('coffee') &&
      keyTerms.some((token) =>
        ['packaged', 'jar', 'bottle', 'can', 'pouch', 'bag'].includes(token),
      ) &&
      !keyTerms.some((token) =>
        ['bean', 'beans', 'maker', 'mug', 'cup', 'grinder'].includes(token),
      )
    ) {
      phrases.add('coffee extracts essences concentrates');
      phrases.add('packaged for retail sale');
      phrases.add('instant coffee packaged for retail sale');
    }

    if (keyTerms.some((token) => homeTextileTokens.includes(token))) {
      phrases.add(
        keyTerms.filter((token) => !['gift', 'decor', 'vintage'].includes(token)).join(' '),
      );
    }

    return [...phrases]
      .map((phrase) => phrase.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 5);
  }

  private inferHeuristicHeadingHints(keyTerms: string[]): string[] {
    const hints = new Set<string>();
    const has = (token: string): boolean => keyTerms.includes(token);

    if ((has('rug') || has('carpet')) && has('woven')) {
      hints.add('5702');
    }

    if (has('sheet') || has('sheets')) {
      hints.add('6302');
    }

    if (
      has('coffee') &&
      keyTerms.some((token) =>
        ['packaged', 'jar', 'bottle', 'can', 'pouch', 'bag'].includes(token),
      ) &&
      !keyTerms.some((token) =>
        ['bean', 'beans', 'maker', 'mug', 'cup', 'grinder'].includes(token),
      )
    ) {
      hints.add('2101');
    }

    if (has('lace') && has('trim')) {
      hints.add('5804');
    }

    if (has('toothbrush') && (has('electric') || has('battery'))) {
      hints.add('8509');
    }

    if (has('keychain') && has('zinc')) {
      hints.add('7907');
    }

    if (
      (has('earring') || has('earrings')) &&
      (has('sterling') || has('silver'))
    ) {
      hints.add('7113');
    }

    if (
      has('transformers') &&
      keyTerms.some((token) => ['cover', 'idw', 'sub', 'comic'].includes(token))
    ) {
      hints.add('4901');
    }

    if (has('inline') && has('boots')) {
      hints.add('9506');
    }

    return [...hints].slice(0, 4);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(message)), timeoutMs),
      ),
    ]);
  }
}
