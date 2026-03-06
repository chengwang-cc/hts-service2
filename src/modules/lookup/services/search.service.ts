import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { HtsEntity, EmbeddingService, EmbeddingProviderConfig } from '@hts/core';

type QueryIntent = 'code' | 'text' | 'mixed';

interface SemanticCandidate {
  htsNumber: string;
  similarity: number;
}

interface KeywordCandidate {
  htsNumber: string;
  score: number;
}

interface CandidateEntry {
  htsNumber: string;
  description: string;
  chapter: string;
  indent: number;
  fullDescription?: string[] | null;
}

interface QuerySignals {
  hasMediaIntent: boolean;
  hasComicIntent: boolean;
  hasTransformerToken: boolean;
  hasManufacturingToken: boolean;
  hasApparelIntent: boolean;
  hasTshirtIntent: boolean;
  hasCottonToken: boolean;
  /** True when query describes a phone/device accessory (case, stand, holder)
   *  → should resolve to plastic articles (ch.39), NOT luggage (ch.42) or audio (ch.85). */
  hasPhoneAccessoryIntent: boolean;
  /** True when query contains "keychain"/"keychains" with metal material (not plastic/acrylic)
   *  → ch.73 (other articles of iron/steel), NOT ch.83 (padlocks). */
  hasKeychainIntent: boolean;
  /** True when query contains "keychain" with plastic/acrylic material → ch.39 (3926.40). */
  hasAcrylicKeychainIntent: boolean;
  /** True when query contains "socks"/"sock" (non-compression) → ch.61 cotton hosiery (6115.95). */
  hasSockIntent: boolean;
  /** True when query contains compression/support socks → 6115.10 (support hosiery). */
  hasCompressionSockIntent: boolean;
  /** True when query contains earbuds/earphones → ch.85 (8518.30 headphones/earphones). */
  hasEarbudIntent: boolean;
  /** True when query contains "plated" → imitation jewelry 7117, NOT precious metal 7113. */
  hasPlatedIntent: boolean;
  /** True when query has laptop/notebook + sleeve/case/bag → ch.42 (4202.12). */
  hasLaptopCaseIntent: boolean;
  /** True when query has tote/shopping bag → ch.42 textile bags (4202.92). */
  hasShoppingBagIntent: boolean;
  /** True when query has bottle/flask → ch.73 household articles (7323). */
  hasWaterBottleIntent: boolean;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly MAX_LIMIT = 100;
  private readonly RRF_K = 50;
  private readonly GENERIC_LABELS = new Set([
    'other',
    'other:',
    'other.',
    'nesoi',
    'n.e.s.o.i.',
    'n.e.s.i.',
    'not elsewhere specified',
  ]);

  private readonly QUERY_SYNONYMS: Record<string, string[]> = {
    comic: ['comics', 'manga', 'graphic', 'periodical', 'book', 'books'],
    comics: ['comic', 'manga', 'graphic', 'periodical', 'book', 'books'],
    manga: ['comic', 'comics', 'graphic', 'periodical', 'book', 'books'],
    periodical: ['journal', 'magazine', 'serial'],
    journal: ['periodical', 'magazine'],
    magazine: ['periodical', 'journal'],
    book: ['books', 'comic', 'comics', 'periodical', 'journal'],
    books: ['book', 'comic', 'comics', 'periodical', 'journal'],
    transformer: ['transformers'],
    transformers: ['transformer'],
    transfomer: ['transformer', 'transformers'],
    tshirt: ['tshirts', 'shirt', 'shirts', 'tee', 'apparel'],
    tshirts: ['tshirt', 'shirt', 'shirts', 'tee', 'apparel'],
    shirt: ['shirts', 'tshirt', 'tshirts', 'apparel'],
    shirts: ['shirt', 'tshirt', 'tshirts', 'apparel'],
    // HTS vocabulary: "electric" is the standard term in HTS headings
    electronic: ['electric', 'electrical'],
    electronics: ['electric', 'electrical'],
    electrical: ['electric', 'electronic'],
    // Common product descriptions
    maker: ['machine', 'apparatus'],
    makers: ['machine', 'apparatus'],
    dryer: ['drying'],
    dryers: ['drying'],
    washer: ['washing'],
    washers: ['washing'],
    freezer: ['freezing', 'refrigerating'],
    freezers: ['freezing', 'refrigerating'],
    cooler: ['cooling', 'refrigerating'],
    heater: ['heating'],
    heaters: ['heating'],
    blender: ['mixing'],
    grinder: ['grinding'],
    grinders: ['grinding'],
    printer: ['printing'],
    printers: ['printing'],
    scanner: ['scanning'],
    computer: ['computers', 'computing', 'data processing'],
    computers: ['computer', 'computing', 'data processing'],
    laptop: ['portable', 'computer', 'computers'],
    laptops: ['portable', 'computer', 'computers'],
    phone: ['telephone', 'telephones'],
    phones: ['telephone', 'telephones'],
    smartphone: ['telephone', 'cellular', 'mobile'],
    smartphones: ['telephone', 'cellular', 'mobile'],
    tv: ['television', 'televisions'],
    television: ['televisions', 'tv'],
    televisions: ['television', 'tv'],
    headphone: ['headphones', 'earphone'],
    headphones: ['headphone', 'earphone'],
    earphone: ['earphones', 'headphone'],
    earphones: ['earphone', 'headphone'],
    speaker: ['speakers', 'loudspeaker'],
    speakers: ['speaker', 'loudspeaker'],
    camera: ['cameras', 'photographic'],
    cameras: ['camera', 'photographic'],
    watch: ['watches', 'timepiece', 'wristwatch'],
    watches: ['watch', 'timepiece', 'wristwatch'],
    shoe: ['shoes', 'footwear'],
    shoes: ['shoe', 'footwear'],
    // "luggage" removed from bag: it was pulling canvas totes into 4202.12 (travel cases).
    // 4202.92 (shopping/sports bags of textile) is the correct heading for tote bags.
    bag: ['bags', 'handbag', 'tote'],
    bags: ['bag', 'handbag', 'tote'],
    tote: ['bag', 'bags', 'shopping'],
    // ── USB / charging cables → chapter 85 (insulated conductors, fitted with connectors) ──
    // "connectors"/"fitted" target the 8544.42 subheading "Fitted with connectors" specifically.
    usb: ['electric', 'electrical', 'conductor', 'connectors', 'fitted'],
    charging: ['electric', 'electrical', 'power', 'connectors'],
    charger: ['electric', 'electrical', 'power', 'connectors', 'fitted'],
    chargers: ['electric', 'electrical', 'power', 'connectors', 'fitted'],
    cable: ['cables', 'conductor', 'wire', 'connectors'],
    cables: ['cable', 'conductor', 'wire'],
    // ── Pokémon / trading cards → chapter 95 (playing cards / games) ───────────────────
    pokemon: ['playing', 'card', 'game', 'trading'],
    trading: ['card', 'game', 'playing'],
    card: ['cards', 'playing', 'game'],
    cards: ['card', 'playing', 'game'],
    // ── Plush / stuffed toys → chapter 95 ───────────────────────────────────────────────
    plush: ['stuffed', 'toy', 'toys', 'dolls'],
    stuffed: ['plush', 'toy', 'toys'],
    toy: ['toys', 'plaything', 'dolls'],
    toys: ['toy', 'plaything', 'dolls'],
    // ── Vinyl sticker / printed decorative items → chapter 49 (printed matter 4911.91) ─────
    // "adhesive"/"label"/"self-adhesive" point to 4821 (paper labels) — removed.
    // "pictorial"/"picture"/"design" target 4911.91 "Printed pictures, designs and photographs".
    sticker: ['printed', 'pictorial', 'picture', 'design'],
    stickers: ['printed', 'pictorial', 'picture', 'design'],
    vinyl: ['printed', 'pictorial', 'design'],
    // ── Keychain / metal accessories → chapter 73 (7326 articles of iron/steel) ──────────
    // "key" removed — it matches padlocks/locks (chapter 83); keychains go in chapter 73.
    // "iron"/"steel"/"chain" removed — they match unrelated laminated goods / roller chains.
    // "ornament" removed — matches 8306 (base metal bells/ornaments of ch.83).
    // "wire" targets 7326.20 "Articles of iron or steel wire" (key rings are wire articles).
    keychain: ['fob', 'wire', 'metal', 'accessory'],
    keychains: ['fob', 'wire', 'metal', 'accessory'],
    // ── Laptop sleeve → chapter 42 (bags/cases, not apparel) ────────────────────────────
    sleeve: ['bag', 'case', 'holder', 'protective'],
    sleeves: ['bag', 'case', 'holder', 'protective'],
    // ── Hair scrunchie → 6117.80 (other knitted clothing accessories: ponytail holders) ──
    // "hair" removed — "hair" matches "hair-nets" in chapter 65 (headgear/hats).
    // "ponytail" and "holders" target 6117.80.30.10 / 6117.80.85.00 descriptions directly.
    scrunchie: ['elastic', 'knitted', 'textile', 'ponytail', 'holders', 'headband'],
    scrunchies: ['elastic', 'knitted', 'textile', 'ponytail', 'holders', 'headband'],
    // ── Bottle opener / can opener → chapter 82 (8210 hand-operated mechanical appliances) ──
    // "mechanical" and "appliance"/"appliances" target 8210's description directly:
    // "Hand-operated mechanical appliances, weighing 10 kg or less, used in the preparation..."
    opener: ['mechanical', 'appliance', 'appliances', 'hand', 'operated'],
    openers: ['mechanical', 'appliance', 'appliances', 'hand', 'operated'],
    // ── Costume jewelry / necklace → chapter 71 (imitation jewelry) ─────────────────────
    necklace: ['jewelry', 'jewellery', 'imitation', 'ornament'],
    necklaces: ['jewelry', 'jewellery', 'imitation'],
    jewelry: ['jewellery', 'imitation', 'ornament'],
    jewellery: ['jewelry', 'imitation', 'ornament'],
    costume: ['imitation', 'jewelry', 'jewellery'],
    // ── Baseball cap / headwear → chapter 65 ────────────────────────────────────────────
    cap: ['hat', 'headwear', 'headgear', 'hats'],
    caps: ['hat', 'headwear', 'headgear', 'hats'],
    hat: ['cap', 'headwear', 'headgear'],
    hats: ['cap', 'headwear', 'headgear'],
    baseball: ['sports', 'sport', 'game', 'headgear'],
    // ── Wallet / purse → chapter 42 ──────────────────────────────────────────────────────
    wallet: ['purse', 'leather', 'pocketbook'],
    wallets: ['purse', 'leather', 'pocketbook'],
    purse: ['wallet', 'leather', 'handbag'],
    // ── Scarf → chapter 61/62 ─────────────────────────────────────────────────────────────
    scarf: ['shawl', 'apparel', 'knit', 'woven', 'muffler'],
    scarves: ['shawl', 'apparel', 'knit', 'woven'],
    // ── Socks / hosiery → chapter 61 ─────────────────────────────────────────────────────
    sock: ['socks', 'hosiery', 'knit'],
    socks: ['sock', 'hosiery', 'knit'],
    // ── Dice / game accessories → chapter 95 ─────────────────────────────────────────────
    dice: ['game', 'gaming', 'play', 'toys'],
    die: ['dice', 'game', 'play'],
    // ── Notebook / stationery → chapter 48 ───────────────────────────────────────────────
    notebook: ['book', 'stationery', 'paper', 'journal'],
    notebooks: ['book', 'stationery', 'paper'],
    // ── Silicone / plastic articles → chapter 39 ─────────────────────────────────────────
    silicone: ['plastic', 'rubber', 'elastomeric'],
    // ── Stand / holder (non-audio) ────────────────────────────────────────────────────────
    stand: ['holder', 'support', 'mount'],
    // ── Canvas → textile bags (4202.92) not suitcases (4202.12) ─────────────────────────
    // "outer" and "surface" appear ONLY in the 4202.92 subheading text:
    // "With outer surface of sheeting of plastics or of textile materials"
    // They do NOT appear in 4202.12 subheading, so they disambiguate the two subheadings.
    canvas: ['woven', 'cotton', 'textile', 'outer', 'surface'],
    // ── Cotton socks/hosiery → 6115.95 (cotton) not 6115.10 (support/compression) ────────
    hosiery: ['knit', 'knitted', 'socks', 'stockings'],
    knit: ['knitted', 'hosiery', 'textile'],
    knitted: ['knit', 'hosiery', 'textile'],
    // ── Earbuds / earphones → chapter 85 (8518.30 headphones/earphones) ─────────────────
    earbud: ['earphone', 'earphones', 'headphone', 'headphones'],
    earbuds: ['earbud', 'earphone', 'earphones', 'headphone', 'headphones'],
    // ── Wireless / Bluetooth → radio, cordless (avoids matching ch.85 telephones broadly) ─
    wireless: ['cordless', 'radio'],
    bluetooth: ['wireless', 'cordless'],
    // ── Water bottle / flask → chapter 73 (7323 table/kitchen/household articles) ─────────
    bottle: ['container', 'flask', 'vessel', 'thermos'],
    bottles: ['bottle', 'container', 'flask', 'vessel'],
    flask: ['bottle', 'vessel', 'thermos'],
  };

  private readonly MEDIA_INTENT_TOKENS = new Set([
    'comic',
    'comics',
    'manga',
    'book',
    'books',
    'periodical',
    'periodicals',
    'journal',
    'magazine',
    'newspaper',
    'graphic',
  ]);

  private readonly COMIC_INTENT_TOKENS = new Set([
    'comic',
    'comics',
    'manga',
    'graphic',
  ]);

  private readonly MEDIA_RESULT_HINTS = new Set([
    'comic',
    'comics',
    'manga',
    'book',
    'books',
    'periodical',
    'periodicals',
    'journal',
    'magazine',
    'newspaper',
    'paperbound',
    'hardbound',
  ]);

  private readonly COMIC_RESULT_HINTS = new Set([
    'comic',
    'comics',
    'manga',
    'graphic',
    'pages',
    'covers',
    'periodical',
    'periodicals',
  ]);

  private readonly COMIC_PAGE_HINTS = new Set([
    'page',
    'pages',
    'excluding',
    'covers',
  ]);

  private readonly STATIONERY_HINTS = new Set([
    'diaries',
    'diary',
    'address',
    'exercise',
    'composition',
    'notebook',
    'notebooks',
  ]);

  private readonly MACHINERY_HINTS = new Set([
    'machinery',
    'machine',
    'parts',
    'printing',
    'binding',
    'bind',
  ]);

  private readonly ELECTRICAL_TRANSFORMER_HINTS = new Set([
    'transformer',
    'transformers',
    'electrical',
    'voltage',
    'coil',
    'core',
    'wound',
    'stacked',
  ]);

  private readonly APPAREL_INTENT_TOKENS = new Set([
    'tshirt',
    'tshirts',
    'shirt',
    'shirts',
    'tee',
    'apparel',
    'garment',
    'clothing',
  ]);

  private readonly MANUFACTURING_TOKENS = new Set([
    'machine',
    'machinery',
    'printer',
    'printing',
    'equipment',
    'industrial',
  ]);

  private readonly APPAREL_RESULT_HINTS = new Set([
    'tshirt',
    'tshirts',
    'shirt',
    'shirts',
    'tee',
    'apparel',
    'garment',
    'pullover',
    'jersey',
    'undershirt',
    'singlet',
  ]);

  private readonly TSHIRT_RESULT_HINTS = new Set([
    'tshirt',
    'tshirts',
    'tee',
    'crew',
    'neckline',
    'undershirt',
  ]);

  private readonly YARN_RESULT_HINTS = new Set([
    'yarn',
    'spun',
    'thread',
    'fiber',
    'fibers',
    'filament',
  ]);

  constructor(
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    @Optional() private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Fast keyword-only HTS search — no embedding, no DGX rerank.
   * Used by the OpenAI agent path where sub-second search latency matters.
   * Runs PostgreSQL full-text search + scoring and returns top results.
   */
  async fastTextSearch(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (!normalizedQuery) return [];

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const signals = this.buildQuerySignals(queryTokens);
    const lexicalTokens = this.buildLexicalTokens(queryTokens, signals);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);

    const keywordCandidates = await this.searchByKeyword(
      normalizedQuery,
      Math.min(this.MAX_LIMIT, safeLimit * 4),
      expandedTokens,
    );
    if (keywordCandidates.length === 0) return [];

    const htsNumbers = keywordCandidates.map((r) => r.htsNumber);
    const entries = await this.htsRepository.find({
      where: { htsNumber: In(htsNumbers), isActive: true },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(entries.map((e) => [e.htsNumber, e]));

    const scored = keywordCandidates
      .map((r) => {
        const entry = entryByHts.get(r.htsNumber);
        if (!entry) return null;
        const coverage = this.computeCoverageScore(queryTokens, this.buildEntryText(entry));
        const phraseBoost = this.computePhraseBoost(normalizedQuery, this.buildEntryText(entry));
        const specificityBoost = this.computeSpecificityBoost(entry.htsNumber);
        const genericPenalty = this.computeGenericPenalty(entry.description, coverage);
        const tokenSet = this.buildEntryTokenSet(entry);
        const intentBoost = this.computeIntentBoost(signals, entry, tokenSet);
        const intentPenalty = this.computeIntentPenalty(signals, entry, tokenSet);
        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          fullDescription: entry.fullDescription ?? null,
          score: r.score + coverage * 0.7 + phraseBoost + specificityBoost - genericPenalty + intentBoost - intentPenalty,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.score === a.score ? a.htsNumber.localeCompare(b.htsNumber) : b.score - a.score));

    return scored.slice(0, safeLimit);
  }

  async hybridSearch(query: string, limit: number = 20): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 20);
    if (!normalizedQuery) {
      return [];
    }

    const queryTokens = this.tokenizeQuery(normalizedQuery);
    const signals = this.buildQuerySignals(queryTokens);
    const lexicalTokens = this.buildLexicalTokens(queryTokens, signals);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);

    const candidateLimit = Math.min(this.MAX_LIMIT, safeLimit * 4);

    const [keywordResults, semanticResults] = await Promise.all([
      this.searchByKeyword(normalizedQuery, candidateLimit, expandedTokens),
      this.semanticSearch(normalizedQuery, candidateLimit),
    ]);

    const combined = this.combineResults(
      semanticResults,
      keywordResults,
      candidateLimit,
    );
    if (combined.length === 0) {
      return [];
    }

    const htsNumbers = combined.map((result) => result.htsNumber);
    const entries = await this.htsRepository.find({
      where: {
        htsNumber: In(htsNumbers),
        isActive: true,
      },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(
      entries.map((entry) => [entry.htsNumber, entry]),
    );

    const reranked = combined
      .map((result) => {
        const entry = entryByHts.get(result.htsNumber);
        if (!entry) {
          return null;
        }

        const coverage = this.computeCoverageScore(
          queryTokens,
          this.buildEntryText(entry),
        );
        const phraseBoost = this.computePhraseBoost(
          normalizedQuery,
          this.buildEntryText(entry),
        );
        const specificityBoost = this.computeSpecificityBoost(entry.htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );
        const tokenSet = this.buildEntryTokenSet(entry);
        if (
          signals.hasComicIntent &&
          !signals.hasManufacturingToken &&
          entry.chapter === '84'
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter !== '49' &&
          !this.hasTokenOverlap(tokenSet, this.MEDIA_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter === '48' &&
          this.hasTokenOverlap(tokenSet, this.STATIONERY_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter === '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter !== '61' &&
          entry.chapter !== '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        const intentBoost = this.computeIntentBoost(signals, entry, tokenSet);
        const intentPenalty = this.computeIntentPenalty(
          signals,
          entry,
          tokenSet,
        );

        const score =
          result.score +
          coverage * 0.7 +
          phraseBoost +
          specificityBoost -
          genericPenalty +
          intentBoost -
          intentPenalty;

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: entry.indent,
          fullDescription: entry.fullDescription ?? null,
          score,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    const diversifiedRows = this.applyChapterDiversity(
      reranked,
      safeLimit,
      expandedTokens.length >= 3,
    );

    // Normalize hand-tuned scores relative to the top result so the UI shows
    // meaningful percentages (top = 100%, others proportionally lower).
    // Clamping negatives to 0 before dividing keeps all display values in [0, 1].
    const finalRows = diversifiedRows.slice(0, safeLimit);
    const maxScore = finalRows.length > 0 ? Math.max(...finalRows.map((r) => r.score)) : 0;
    if (maxScore <= 0) {
      return finalRows;
    }
    return finalRows.map((r) => ({
      ...r,
      score: Math.max(r.score, 0) / maxScore,
    }));
  }

  async autocomplete(query: string, limit: number = 10): Promise<any[]> {
    const normalizedQuery = this.normalizeQuery(query);
    const safeLimit = this.clampLimit(limit, 10);
    if (normalizedQuery.length < 2) {
      return [];
    }

    const intent = this.classifyQueryIntent(normalizedQuery);
    if (intent === 'code') {
      // Use pattern matching for HTS code queries
      return this.autocompleteByCode(normalizedQuery, safeLimit);
    }

    return this.autocompleteByTextHybrid(
      normalizedQuery,
      safeLimit,
      intent === 'mixed',
    );
  }

  /**
   * Autocomplete by HTS code pattern matching
   */
  private async autocompleteByCode(
    query: string,
    limit: number,
  ): Promise<any[]> {
    const normalizedCode = query.replace(/[^\d]/g, '');
    const containsQuery = `%${query}%`;
    const prefixQuery = `${query}%`;
    const normalizedPrefix = `${normalizedCode}%`;
    const normalizedContains = `%${normalizedCode}%`;

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.chapter', 'chapter')
      .addSelect('hts.indent', 'indent')
      .addSelect(
        `CASE
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') = :normalizedCode THEN 1.0
          WHEN hts.htsNumber ILIKE :prefixQuery THEN 0.96
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedPrefix THEN 0.94
          WHEN hts.htsNumber ILIKE :containsQuery THEN 0.5
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains THEN 0.45
          ELSE 0
        END`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")

      .andWhere(
        new Brackets((qb) => {
          qb.where('hts.htsNumber ILIKE :containsQuery', { containsQuery });
          if (normalizedCode) {
            qb.orWhere(
              "REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains",
              {
                normalizedContains,
              },
            );
          }
        }),
      )
      .setParameters({
        normalizedCode,
        prefixQuery,
        normalizedPrefix,
        containsQuery,
        normalizedContains,
      })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      description: row.description,
      chapter: row.chapter,
      indent: Number(row.indent) || 0,
      score: Number(row.score) || 0,
    }));
  }

  /**
   * Semantic search using pgvector cosine similarity.
   * Automatically selects the correct column based on the active embedding provider:
   *   SEARCH_EMBEDDING_PROVIDER=dgx    → hts.embedding (vector(1024))
   *   SEARCH_EMBEDDING_PROVIDER=openai → hts.embedding_openai (vector(1536))
   *
   * Errors are caught and logged — semantic failure degrades to keyword-only gracefully.
   */
  private async semanticSearch(
    query: string,
    limit: number,
  ): Promise<SemanticCandidate[]> {
    if (!this.embeddingService) return [];
    try {
      // column   = snake_case DB column name — used in raw SQL addSelect expressions
      // property = camelCase TypeORM property name — used in andWhere/orderBy so
      //            TypeORM resolves it through the NamingStrategy correctly.
      //            Using the snake_case column name in andWhere throws:
      //            TypeError: Cannot read properties of undefined (reading 'databaseName')
      const { column, property }: EmbeddingProviderConfig = this.embeddingService.providerInfo;
      const embedding = await this.embeddingService.generateEmbedding(query);
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect(`1 - (hts.${column} <=> :embedding)`, 'similarity')
        .where('hts.isActive = :active', { active: true })
        .andWhere(`hts.${property} IS NOT NULL`)
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .limit(limit)
        .getRawMany<{ htsNumber: string; similarity: string }>();
      return rows.map((r) => ({
        htsNumber: r.htsNumber,
        similarity: parseFloat(r.similarity),
      }));
    } catch (err) {
      this.logger.warn(
        `Semantic search failed (provider=${this.embeddingService?.providerInfo.provider}), skipping: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async autocompleteByTextHybrid(
    query: string,
    limit: number,
    includeCodeCandidates: boolean,
  ): Promise<any[]> {
    const baseTokens = this.tokenizeQuery(query);
    const signals = this.buildQuerySignals(baseTokens);
    const lexicalTokens = this.buildLexicalTokens(baseTokens, signals);
    const expandedTokens = this.expandQueryTokens(lexicalTokens);
    const candidateLimit = Math.min(this.MAX_LIMIT, Math.max(limit * 5, 30));

    const lexicalPromise = this.autocompleteByFullText(
      query,
      candidateLimit,
      expandedTokens,
    );
    const codePromise = includeCodeCandidates
      ? this.autocompleteByCode(query, Math.min(candidateLimit, 20))
      : Promise.resolve([] as any[]);
    const semanticPromise = this.semanticSearch(
      query,
      candidateLimit,
    );

    const [lexicalRows, codeRows, semanticRows] = await Promise.all([
      lexicalPromise,
      codePromise,
      semanticPromise,
    ]);

    const fused = new Map<string, number>();
    lexicalRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    codeRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });
    semanticRows.forEach((row, index) => {
      fused.set(row.htsNumber, (fused.get(row.htsNumber) || 0) + this.rrf(index));
    });

    if (fused.size === 0) {
      return [];
    }

    // For specific intents, the correct entries may not surface in the semantic/lexical
    // candidate pools (due to vocabulary mismatch). Inject them with a synthetic baseline
    // RRF score so they can receive intent boosts and compete in the final ranking.
    const syntheticRank = 40; // equivalent to rank 40 in a 50-RRF_K scheme → small base score
    if (signals.hasPhoneAccessoryIntent) {
      // 3926.90.xx — other articles of plastics (phone cases/covers go here)
      await this.injectCandidates(fused, '3926.90', syntheticRank);
    }
    if (signals.hasKeychainIntent) {
      // 7326.20.xx — wire articles of iron/steel (key rings), 7326.90.xx — other articles
      await this.injectCandidates(fused, '7326.20', syntheticRank);
      await this.injectCandidates(fused, '7326.90', syntheticRank + 5);
    }
    if (signals.hasAcrylicKeychainIntent) {
      // 3926.40.xx — statuettes and other ornamental articles of plastics
      await this.injectCandidates(fused, '3926.40', syntheticRank);
    }

    const htsNumbers = [...fused.keys()];
    const entries = await this.htsRepository.find({
      where: { htsNumber: In(htsNumbers), isActive: true },
      select: ['htsNumber', 'description', 'chapter', 'indent', 'fullDescription'],
    });
    const entryByHts = new Map(entries.map((entry) => [entry.htsNumber, entry]));

    const ranked = htsNumbers
      .map((htsNumber) => {
        const entry = entryByHts.get(htsNumber);
        if (!entry) {
          return null;
        }
        const base = fused.get(htsNumber) || 0;
        const text = this.buildEntryText(entry);
        // Use expandedTokens for coverage so that synonym-expanded HTS vocabulary terms
        // (e.g. "usb"→"electric","conductor") raise the coverage against entries whose
        // fullDescription contains HTS terms but not the original consumer product word.
        // This prevents computeGenericPenalty from unfairly penalising correct "Other"
        // leaf codes (e.g. 8544.42.90.90) when the query includes terms like "USB charging".
        const coverage = this.computeCoverageScore(expandedTokens, text);
        const phraseBoost = this.computePhraseBoost(query, text);
        const specificityBoost = this.computeSpecificityBoost(htsNumber);
        const genericPenalty = this.computeGenericPenalty(
          entry.description,
          coverage,
        );
        const tokenSet = this.buildEntryTokenSet(entry);
        if (
          signals.hasComicIntent &&
          !signals.hasManufacturingToken &&
          entry.chapter === '84'
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter !== '49' &&
          !this.hasTokenOverlap(tokenSet, this.MEDIA_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasComicIntent &&
          entry.chapter === '48' &&
          this.hasTokenOverlap(tokenSet, this.STATIONERY_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter === '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        if (
          signals.hasTshirtIntent &&
          entry.chapter !== '61' &&
          entry.chapter !== '62' &&
          !this.hasTokenOverlap(tokenSet, this.TSHIRT_RESULT_HINTS)
        ) {
          return null;
        }
        // Phone case/accessory intent: only 3926.xx (manufactured plastic articles) are relevant.
        // All other chapters dominate lexical search with wrong results: ch.42 (bag "cases"),
        // ch.85 8517 (smartphones), ch.91 (watch cases), ch.40 (rubber), ch.28/29 (chemicals).
        // Hard-filter to only allow ch.39 articles (3926.xx) so semantic results can surface.
        if (signals.hasPhoneAccessoryIntent && !entry.htsNumber.startsWith('3926.')) {
          return null;
        }
        // Laptop sleeve → 4202.12 (computer/briefcase cases). 4202.92 (shopping/travel bags) is wrong.
        if (signals.hasLaptopCaseIntent && entry.htsNumber.startsWith('4202.92')) {
          return null;
        }
        // Shopping tote bag → 4202.92. 4202.12 (hard cases/briefcases) is wrong.
        if (signals.hasShoppingBagIntent && entry.htsNumber.startsWith('4202.12')) {
          return null;
        }
        // Water bottle → 7323 (household articles). 7324 (sanitary/bath ware) is wrong.
        if (signals.hasWaterBottleIntent && entry.htsNumber.startsWith('7324.')) {
          return null;
        }
        // Earbuds → 8518 (headphones/earphones). 8517 (telephones/handsets) is wrong.
        if (signals.hasEarbudIntent && entry.htsNumber.startsWith('8517.')) {
          return null;
        }
        // Acrylic keychain → 3926.40 (plastic ornamental articles).
        // "acrylic" in HTS lexically matches 3906 (acrylic polymer chemicals) and
        // "ornament" from keychain synonym matches 8306 (base metal bells/ornaments).
        // Hard-restrict to ch.39/3926.xx only since acrylic keychain is clearly a plastic article.
        if (signals.hasAcrylicKeychainIntent && !entry.htsNumber.startsWith('3926.')) {
          return null;
        }
        const intentBoost = this.computeIntentBoost(signals, entry, tokenSet);
        const intentPenalty = this.computeIntentPenalty(signals, entry, tokenSet);

        return {
          htsNumber: entry.htsNumber,
          description: entry.description ?? '',
          chapter: entry.chapter,
          indent: Number(entry.indent) || 0,
          fullDescription: entry.fullDescription ?? null,
          score:
            base +
            coverage * 0.85 +
            phraseBoost +
            specificityBoost -
            genericPenalty +
            intentBoost -
            intentPenalty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      );

    if (ranked.length === 0) {
      return [];
    }

    // Normalize scores relative to the top result (top = 100%, others proportional).
    // The 0.5 filter keeps only results within 50% of the best match.
    const maxScore = Math.max(...ranked.map((r) => r.score));
    if (maxScore <= 0) {
      return [];
    }
    const normalized = ranked
      .map((r) => ({ ...r, score: Math.max(r.score, 0) / maxScore }))
      .filter((r) => r.score >= 0.35);

    const diversified = this.applyChapterDiversity(
      normalized,
      limit,
      expandedTokens.length >= 3,
    );

    return diversified.slice(0, limit);
  }

  /**
   * Autocomplete by full-text search.
   * Strategy:
   *  1. Try AND of all words (most precise).
   *  2. Fallback: OR of all words — ts_rank scores by how many words match,
   *     so "comic books" entries outrank "transformer"-only entries.
   *     This avoids the progressive-drop pitfall where "transformer comic books"
   *     degenerates to just "books" or "transformer" alone.
   */
  private async autocompleteByFullText(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<any[]> {
    const words =
      expandedTokens && expandedTokens.length > 0
        ? expandedTokens
        : this.expandQueryTokens(this.tokenizeQuery(query));
    if (words.length === 0) return [];

    const andQuery = this.buildTsQuery(words, '&');
    const orQuery = this.buildTsQuery(words, '|');
    const results = new Map<string, any>();

    if (andQuery) {
      try {
        const rows = await this.executeFullTextQuery(andQuery, limit);
        for (const row of rows) {
          results.set(row.htsNumber, row);
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    if (orQuery) {
      try {
        const rows = await this.executeFullTextQuery(orQuery, limit);
        for (const row of rows) {
          const existing = results.get(row.htsNumber);
          if (!existing || row.score > existing.score) {
            results.set(row.htsNumber, row);
          }
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    return [...results.values()]
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      )
      .slice(0, limit);
  }

  private async executeFullTextQuery(
    tsquery: string,
    limit: number,
  ): Promise<any[]> {
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.chapter', 'chapter')
      .addSelect('hts.indent', 'indent')
      .addSelect(
        `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
      .setParameters({ tsquery })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      description: row.description,
      chapter: row.chapter,
      indent: Number(row.indent) || 0,
      score: Number(row.score) || 0,
    }));
  }

  private async searchByKeyword(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<KeywordCandidate[]> {
    // Check if query is HTS code or description search
    const isHtsCodeQuery = this.isLikelyHtsCodeQuery(query);

    if (isHtsCodeQuery) {
      return this.searchByCode(query, limit);
    }

    return this.searchByFullText(query, limit, expandedTokens);
  }

  /**
   * Search by HTS code pattern matching
   */
  private async searchByCode(
    query: string,
    limit: number,
  ): Promise<KeywordCandidate[]> {
    const normalizedCode = query.replace(/[^\d]/g, '');
    const containsQuery = `%${query}%`;
    const prefixQuery = `${query}%`;
    const normalizedPrefix = `${normalizedCode}%`;
    const normalizedContains = `%${normalizedCode}%`;

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect(
        `CASE
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') = :normalizedCode THEN 1.0
          WHEN hts.htsNumber ILIKE :prefixQuery THEN 0.95
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedPrefix THEN 0.93
          WHEN hts.htsNumber ILIKE :containsQuery THEN 0.5
          WHEN :normalizedCode <> '' AND REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains THEN 0.45
          ELSE 0
        END`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")

      .andWhere(
        new Brackets((qb) => {
          qb.where('hts.htsNumber ILIKE :containsQuery', { containsQuery });
          if (normalizedCode) {
            qb.orWhere(
              "REPLACE(hts.htsNumber, '.', '') LIKE :normalizedContains",
              {
                normalizedContains,
              },
            );
          }
        }),
      )
      .setParameters({
        normalizedCode,
        prefixQuery,
        normalizedPrefix,
        containsQuery,
        normalizedContains,
      })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      htsNumber: row.htsNumber,
      score: Number(row.score) || 0,
    }));
  }

  /**
   * Search by full-text search with ranking.
   * Strategy:
   *  1. Try AND of all words (most precise).
   *  2. Fallback: OR of all words — ts_rank_cd scores by how many words match,
   *     preserving multi-word context over single-word degeneration.
   */
  private async searchByFullText(
    query: string,
    limit: number,
    expandedTokens?: string[],
  ): Promise<KeywordCandidate[]> {
    const words =
      expandedTokens && expandedTokens.length > 0
        ? expandedTokens
        : this.expandQueryTokens(this.tokenizeQuery(query));
    if (words.length === 0) return [];

    const runQuery = async (
      tsquery: string,
    ): Promise<KeywordCandidate[]> => {
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect(
          `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
          'score',
        )
        .where('hts.isActive = :active', { active: true })
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
        .setParameters({ tsquery })
        .orderBy('score', 'DESC')
        .addOrderBy('hts.htsNumber', 'ASC')
        .limit(limit)
        .getRawMany();
      return rows.map((row) => ({
        htsNumber: row.htsNumber,
        score: Number(row.score) || 0,
      }));
    };

    const results = new Map<string, KeywordCandidate>();
    const andQuery = this.buildTsQuery(words, '&');
    const orQuery = this.buildTsQuery(words, '|');

    if (andQuery) {
      try {
        const rows = await runQuery(andQuery);
        for (const row of rows) {
          results.set(row.htsNumber, row);
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    if (orQuery) {
      try {
        const rows = await runQuery(orQuery);
        for (const row of rows) {
          const existing = results.get(row.htsNumber);
          if (!existing || row.score > existing.score) {
            results.set(row.htsNumber, row);
          }
        }
      } catch {
        // ignore invalid tsquery
      }
    }

    return [...results.values()]
      .sort((a, b) =>
        b.score === a.score
          ? a.htsNumber.localeCompare(b.htsNumber)
          : b.score - a.score,
      )
      .slice(0, limit);
  }

  async findByHtsNumber(htsNumber: string): Promise<HtsEntity | null> {
    return this.htsRepository.findOne({
      where: { htsNumber, isActive: true },
      select: [
        'htsNumber', 'chapter', 'heading', 'subheading', 'statisticalSuffix',
        'indent', 'description', 'parentHtsNumber', 'parentHtses', 'fullDescription',
        'hasChildren', 'isActive', 'unitOfQuantity',
        'general', 'generalRate', 'rateFormula', 'rateVariables',
        'other', 'otherRate', 'otherRateFormula', 'otherRateVariables',
        'specialRates', 'chapter99', 'chapter99Links', 'chapter99ApplicableCountries',
        'adjustedFormula', 'adjustedFormulaVariables',
        'effectiveDate', 'expirationDate', 'sourceVersion', 'importDate',
        'confirmed', 'requiredReview', 'requiredReviewComment',
        'metadata', 'createdAt', 'updatedAt',
      ],
    });
  }

  private normalizeQuery(query: string): string {
    const normalized = (query ?? '').trim().replace(/\s+/g, ' ');
    return normalized
      .replace(/\btransfomer\b/gi, 'transformer')
      .replace(/\btranformer\b/gi, 'transformer')
      .replace(/\bcomic[\s-]?books?\b/gi, 'comic book')
      .replace(/\bt[\s-]?shirts?\b/gi, 'tshirt')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private clampLimit(limit: number, fallback: number): number {
    if (!Number.isFinite(limit)) {
      return fallback;
    }
    return Math.max(1, Math.min(this.MAX_LIMIT, Math.floor(limit)));
  }

  private isLikelyHtsCodeQuery(query: string): boolean {
    const normalized = query.replace(/\s+/g, '');
    return (
      /^[\d.]+$/.test(normalized) ||
      /^\d{2,4}(\.\d{0,2}){0,3}$/.test(normalized)
    );
  }

  private classifyQueryIntent(query: string): QueryIntent {
    const compact = query.replace(/\s+/g, '');
    if (this.isLikelyHtsCodeQuery(compact)) {
      return 'code';
    }

    const hasAlpha = /[a-z]/i.test(query);
    const hasDigit = /\d/.test(query);
    if (hasAlpha && hasDigit) {
      return 'mixed';
    }
    return 'text';
  }

  private tokenizeQuery(query: string): string[] {
    const raw = (query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    const stopWords = new Set([
      'a',
      'an',
      'the',
      'for',
      'and',
      'with',
      'to',
      'of',
      'in',
      'on',
      'by',
      'or',
      'at',
      'from',
    ]);

    const corrected = raw.map((token) => {
      if (token === 'transfomer' || token === 'tranformer') {
        return 'transformer';
      }
      return token;
    });

    return [
      ...new Set(
        corrected.filter((token) => token.length > 1 && !stopWords.has(token)),
      ),
    ];
  }

  private expandQueryTokens(tokens: string[]): string[] {
    const expanded = new Set<string>();
    for (const token of tokens) {
      expanded.add(token);
      for (const synonym of this.QUERY_SYNONYMS[token] || []) {
        expanded.add(synonym);
      }
    }
    return [...expanded];
  }

  private sanitizeTsToken(token: string): string {
    return token.replace(/[^a-zA-Z0-9]/g, '');
  }

  private buildTsQuery(tokens: string[], operator: '&' | '|'): string {
    const safeTokens = tokens
      .map((token) => this.sanitizeTsToken(token))
      .filter((token) => token.length > 0);
    if (safeTokens.length === 0) {
      return '';
    }

    return safeTokens.map((token) => `${token}:*`).join(` ${operator} `);
  }

  private buildEntryText(entry: CandidateEntry): string {
    const hierarchy = (entry.fullDescription || []).join(' ');
    return `${entry.description || ''} ${hierarchy}`.trim().toLowerCase();
  }

  private buildEntryTokenSet(entry: CandidateEntry): Set<string> {
    const text = this.buildEntryText(entry);
    return new Set(text.match(/[a-z0-9]+/g) || []);
  }

  private computeCoverageScore(tokens: string[], text: string): number {
    if (tokens.length === 0 || !text) {
      return 0;
    }

    let covered = 0;
    for (const token of tokens) {
      if (token.length < 2) {
        continue;
      }
      if (text.includes(token)) {
        covered += 1;
      }
    }

    return covered / tokens.length;
  }

  private computePhraseBoost(query: string, text: string): number {
    const needle = query.trim().toLowerCase();
    if (!needle || needle.length < 4) {
      return 0;
    }

    return text.includes(needle) ? 0.2 : 0;
  }

  private computeSpecificityBoost(htsNumber: string): number {
    // Reward more specific (longer) HTS codes so that 10-digit leaf entries
    // outrank ambiguous 4-digit headings when both surface in the same search.
    const digits = htsNumber.replace(/\./g, '').length;
    if (digits >= 10) return 0.12;
    if (digits >= 8) return 0.08;
    if (digits >= 6) return 0.04;
    return 0;
  }

  private computeGenericPenalty(description: string, coverage: number): number {
    const normalized = (description || '').trim().toLowerCase();
    const isGeneric =
      this.GENERIC_LABELS.has(normalized) || normalized.startsWith('other');
    if (!isGeneric) {
      return 0;
    }

    return coverage >= 0.66 ? 0.05 : 0.28;
  }

  private rrf(rankIndex: number): number {
    return 1 / (this.RRF_K + rankIndex + 1);
  }

  /**
   * Inject 10-digit leaf HTS codes matching `prefix` into the fused candidate map
   * with a synthetic RRF score (as if they ranked at `syntheticRank`).
   * Only injects entries not already in the map (existing entries keep their higher scores).
   * Used to ensure intent-boosted entries always appear in the scoring pass even when
   * they don't rank in the top-N of semantic or lexical search.
   */
  private async injectCandidates(
    fused: Map<string, number>,
    prefix: string,
    syntheticRank: number,
  ): Promise<void> {
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .where('hts.isActive = :active', { active: true })
      .andWhere('hts.htsNumber LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) = 10")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .getRawMany<{ htsNumber: string }>();

    const syntheticScore = this.rrf(syntheticRank);
    for (const { htsNumber } of rows) {
      if (!fused.has(htsNumber)) {
        fused.set(htsNumber, syntheticScore);
      }
    }
  }

  private applyChapterDiversity<T extends { chapter?: string }>(
    rows: T[],
    limit: number,
    enabled: boolean,
  ): T[] {
    if (!enabled || rows.length <= limit) {
      return rows;
    }

    const perChapterCap = 3;
    const counts = new Map<string, number>();
    const selected: T[] = [];
    const deferred: T[] = [];

    for (const row of rows) {
      const chapter = row.chapter || 'unknown';
      const current = counts.get(chapter) || 0;
      if (current < perChapterCap) {
        selected.push(row);
        counts.set(chapter, current + 1);
      } else {
        deferred.push(row);
      }
    }

    const merged = [...selected, ...deferred];
    return merged.slice(0, limit);
  }

  private buildQuerySignals(tokens: string[]): QuerySignals {
    const tokenSet = new Set(tokens);

    const hasAny = (source: Set<string>): boolean => {
      for (const token of source) {
        if (tokenSet.has(token)) {
          return true;
        }
      }
      return false;
    };

    // Phone accessory: "phone" + case/stand/holder/grip/mount/cover → plastic article (ch.39)
    const PHONE_ACCESSORY_TERMS = new Set(['case', 'stand', 'holder', 'grip', 'mount', 'cover', 'silicone']);
    const hasPhoneAccessoryIntent =
      (tokenSet.has('phone') || tokenSet.has('smartphone') || tokenSet.has('iphone')) &&
      [...PHONE_ACCESSORY_TERMS].some((t) => tokenSet.has(t));

    // Plastic material in query: acrylic, resin, etc. → prevents metal keychain boost
    const hasPlasticMaterialToken =
      tokenSet.has('acrylic') || tokenSet.has('resin') || tokenSet.has('pvc') ||
      (tokenSet.has('plastic') && !hasPhoneAccessoryIntent);

    const hasKeychainToken = tokenSet.has('keychain') || tokenSet.has('keychains');

    // Compression socks: "compression" or "support" with socks → 6115.10
    const hasSockToken = tokenSet.has('sock') || tokenSet.has('socks');
    const hasCompressionToken = tokenSet.has('compression') || tokenSet.has('support') || tokenSet.has('therapeutic');

    return {
      hasMediaIntent: hasAny(this.MEDIA_INTENT_TOKENS),
      hasComicIntent: hasAny(this.COMIC_INTENT_TOKENS),
      hasTransformerToken:
        tokenSet.has('transformer') || tokenSet.has('transformers'),
      hasManufacturingToken: hasAny(this.MANUFACTURING_TOKENS),
      hasApparelIntent: hasAny(this.APPAREL_INTENT_TOKENS),
      hasTshirtIntent: tokenSet.has('tshirt') || tokenSet.has('tshirts'),
      hasCottonToken: tokenSet.has('cotton'),
      hasPhoneAccessoryIntent,
      // hasKeychainIntent only for metal/unspecified keychains (not acrylic/plastic)
      hasKeychainIntent: hasKeychainToken && !hasPlasticMaterialToken,
      // hasAcrylicKeychainIntent for plastic/acrylic keychains → 3926.40
      hasAcrylicKeychainIntent: hasKeychainToken && hasPlasticMaterialToken,
      // hasSockIntent only for plain socks (not compression/support hosiery)
      hasSockIntent: hasSockToken && !hasCompressionToken,
      // hasCompressionSockIntent for support hosiery → 6115.10
      hasCompressionSockIntent: hasSockToken && hasCompressionToken,
      // hasEarbudIntent: earbuds/earphones → 8518.30 (headphones/earphones), NOT 8517 (phones)
      hasEarbudIntent:
        tokenSet.has('earbud') || tokenSet.has('earbuds') ||
        tokenSet.has('earphone') || tokenSet.has('earphones'),
      // hasPlatedIntent: "plated" → imitation jewelry (7117), NOT precious metal (7113)
      hasPlatedIntent: tokenSet.has('plated'),
      // hasLaptopCaseIntent: laptop/notebook + sleeve/case/bag → 4202.12 (computer cases)
      hasLaptopCaseIntent:
        (tokenSet.has('laptop') || tokenSet.has('notebooks')) &&
        (tokenSet.has('sleeve') || tokenSet.has('case') || tokenSet.has('bag') || tokenSet.has('holder')),
      // hasShoppingBagIntent: tote/shopping bags → 4202.92 (textile shopping/travel bags)
      hasShoppingBagIntent:
        (tokenSet.has('tote') || tokenSet.has('shopping')) &&
        (tokenSet.has('bag') || tokenSet.has('bags')),
      // hasWaterBottleIntent: bottle/flask → 7323 (table/kitchen/household articles)
      hasWaterBottleIntent: tokenSet.has('bottle') || tokenSet.has('bottles') || tokenSet.has('flask'),
    };
  }

  private buildLexicalTokens(
    queryTokens: string[],
    signals: QuerySignals,
  ): string[] {
    // When media+transformer intent is detected, strip transformer to avoid ch.85 electrical matches
    if (signals.hasMediaIntent && signals.hasTransformerToken) {
      const filtered = queryTokens.filter(
        (token) => token !== 'transformer' && token !== 'transformers',
      );
      return filtered.length > 0 ? filtered : queryTokens;
    }

    // When phone accessory intent is detected, remove "phone", "case" from lexical tokens:
    // - "phone" → expands to "telephone" which floods candidates with ch.85 handsets
    // - "case" → matches ch.42 attache/briefcases that dominate the lexical search
    // Only the material terms (silicone/plastic) remain to find ch.39 plastic article entries.
    if (signals.hasPhoneAccessoryIntent) {
      const filtered = queryTokens.filter(
        (token) => !['phone', 'phones', 'smartphone', 'smartphones', 'iphone', 'case'].includes(token),
      );
      return filtered.length > 0 ? filtered : queryTokens;
    }

    return queryTokens;
  }

  private computeIntentBoost(
    signals: QuerySignals,
    entry: CandidateEntry,
    entryTokens: Set<string>,
  ): number {
    let boost = 0;

    if (signals.hasMediaIntent) {
      if (entry.chapter === '49') {
        boost += 0.38;
      }
      if (this.hasTokenOverlap(entryTokens, this.MEDIA_RESULT_HINTS)) {
        boost += 0.42;
      }
    }

    if (signals.hasComicIntent) {
      if (
        entry.htsNumber.startsWith('4901.99.00.9') ||
        entry.htsNumber.startsWith('4902.')
      ) {
        boost += 0.48;
      }
      if (this.hasTokenOverlap(entryTokens, this.COMIC_RESULT_HINTS)) {
        boost += 0.35;
      }
      if (this.hasTokenOverlap(entryTokens, this.COMIC_PAGE_HINTS)) {
        boost += 0.18;
      }
    }

    if (signals.hasApparelIntent) {
      if (entry.chapter === '61' || entry.chapter === '62') {
        boost += 0.35;
      }
      if (this.hasTokenOverlap(entryTokens, this.APPAREL_RESULT_HINTS)) {
        boost += 0.3;
      }
      if (signals.hasCottonToken && (entry.chapter === '61' || entry.chapter === '62')) {
        boost += 0.08;
      }
    }

    if (signals.hasTshirtIntent) {
      if (entry.htsNumber.startsWith('6109.')) {
        boost += 0.55;
      }
      if (this.hasTokenOverlap(entryTokens, this.TSHIRT_RESULT_HINTS)) {
        boost += 0.3;
      }
    }

    // Phone accessory (case, stand, holder, silicone phone mount) → plastic articles ch.39
    if (signals.hasPhoneAccessoryIntent) {
      if (entry.chapter === '39') {
        boost += 0.55;
      }
      // Extra boost for 3926.90 specifically (other articles of plastics — the catch-all)
      if (entry.htsNumber.startsWith('3926.90')) {
        boost += 0.45;
      }
    }

    // Keychain (metal) → other articles of iron/steel (7326), not kitchen/household (7323)
    if (signals.hasKeychainIntent) {
      if (entry.htsNumber.startsWith('7326.')) {
        boost += 0.55;
      }
      // 7326.20 = wire articles (key rings are wire articles) — extra boost for specificity
      if (entry.htsNumber.startsWith('7326.20')) {
        boost += 0.3;
      }
    }

    // Acrylic/plastic keychain → plastic articles (3926.40)
    if (signals.hasAcrylicKeychainIntent) {
      if (entry.htsNumber.startsWith('3926.40')) {
        boost += 0.65;
      }
      if (entry.chapter === '39') {
        boost += 0.25;
      }
    }

    // Socks → cotton hosiery (6115.95), not support/compression hosiery (6115.10)
    if (signals.hasSockIntent) {
      if (entry.htsNumber.startsWith('6115.9')) {
        boost += 0.4;
      }
    }

    // Compression socks → support hosiery (6115.10), not plain cotton socks (6115.9x)
    if (signals.hasCompressionSockIntent) {
      if (entry.htsNumber.startsWith('6115.10')) {
        boost += 0.55;
      }
    }

    // Earbuds → 8518.30 (headphones/earphones), not 8517 (phones — already hard-filtered)
    if (signals.hasEarbudIntent) {
      if (entry.htsNumber.startsWith('8518.30')) {
        boost += 0.55;
      }
      if (entry.chapter === '85' && entry.htsNumber.startsWith('8518.')) {
        boost += 0.25;
      }
    }

    // Plated jewelry (gold plated, silver plated) → imitation jewelry 7117, NOT precious metal 7113
    if (signals.hasPlatedIntent) {
      if (entry.htsNumber.startsWith('7117.')) {
        boost += 0.65;
      }
      if (entry.chapter === '71' && !entry.htsNumber.startsWith('7113.')) {
        boost += 0.2;
      }
    }

    // Laptop sleeve/case → 4202.12 (briefcase-style computer cases)
    if (signals.hasLaptopCaseIntent) {
      if (entry.htsNumber.startsWith('4202.12')) {
        boost += 0.55;
      }
    }

    // Shopping tote bag → 4202.92 (textile shopping/travel bags)
    if (signals.hasShoppingBagIntent) {
      if (entry.htsNumber.startsWith('4202.92')) {
        boost += 0.55;
      }
    }

    // Water bottle/flask → 7323 (table, kitchen or household articles of iron/steel)
    if (signals.hasWaterBottleIntent) {
      if (entry.htsNumber.startsWith('7323.')) {
        boost += 0.55;
      }
    }

    return boost;
  }

  private computeIntentPenalty(
    signals: QuerySignals,
    entry: CandidateEntry,
    entryTokens: Set<string>,
  ): number {
    let penalty = 0;

    if (signals.hasMediaIntent && signals.hasTransformerToken) {
      if (entry.chapter === '85' && this.hasTokenOverlap(entryTokens, this.ELECTRICAL_TRANSFORMER_HINTS)) {
        penalty += 1.05;
      }
    }

    if (signals.hasComicIntent) {
      if (
        entry.chapter === '48' &&
        this.hasTokenOverlap(entryTokens, this.STATIONERY_HINTS)
      ) {
        penalty += 0.7;
      }
      if (
        entry.chapter === '84' &&
        this.hasTokenOverlap(entryTokens, this.MACHINERY_HINTS)
      ) {
        penalty += 0.8;
      }

      if (
        entry.chapter !== '49' &&
        !this.hasTokenOverlap(entryTokens, this.MEDIA_RESULT_HINTS)
      ) {
        penalty += 0.35;
      }
    }

    if (signals.hasApparelIntent) {
      if (entry.chapter === '52' && this.hasTokenOverlap(entryTokens, this.YARN_RESULT_HINTS)) {
        penalty += 0.45;
      }
    }

    if (signals.hasTshirtIntent) {
      const description = (entry.description || '').toLowerCase();
      if (description.includes('subject to cotton restraints')) {
        penalty += 0.55;
      }
      if (
        entry.chapter === '62' &&
        !this.hasTokenOverlap(entryTokens, this.TSHIRT_RESULT_HINTS)
      ) {
        penalty += 0.75;
      }
    }

    // Phone accessory → penalize luggage (ch.42) and audio equipment (ch.85),
    // and penalize raw plastic primary forms/sheets (3910, 3920) — want 3926.90 articles.
    if (signals.hasPhoneAccessoryIntent) {
      if (entry.chapter === '42') {
        penalty += 0.65;
      }
      if (entry.chapter === '85' && (entryTokens.has('loudspeaker') || entryTokens.has('microphone') || entryTokens.has('amplifier'))) {
        penalty += 0.55;
      }
      // Penalise raw plastic materials (3910 silicones in primary forms, 3920 sheets/film/foil)
      // that surface due to "silicone"/"plastic" tokens but are not manufactured articles.
      if (entry.chapter === '39' && !entry.htsNumber.startsWith('3926.90')) {
        const fullText = this.buildEntryText(entry);
        if (fullText.includes('primary form') || fullText.includes('sheet') || fullText.includes('film') || fullText.includes('foil') || fullText.includes('plate')) {
          penalty += 0.55;
        }
      }
    }

    // Keychain (metal) → penalize kitchen/household steel articles (7323) — want other articles (7326)
    if (signals.hasKeychainIntent) {
      if (entry.htsNumber.startsWith('7323.') || entry.htsNumber.startsWith('8301.')) {
        penalty += 0.65;
      }
    }

    // Acrylic/plastic keychain → penalize metal articles (7326)
    if (signals.hasAcrylicKeychainIntent) {
      if (entry.htsNumber.startsWith('7326.') || entry.htsNumber.startsWith('8302.')) {
        penalty += 0.65;
      }
    }

    // Socks → penalize support/compression hosiery (6115.10) — want plain cotton hosiery (6115.95)
    if (signals.hasSockIntent) {
      if (entry.htsNumber.startsWith('6115.10') || entry.htsNumber.startsWith('6115.29')) {
        penalty += 0.5;
      }
    }

    // Compression socks → penalize plain cotton hosiery (6115.9x) — want support hosiery (6115.10)
    if (signals.hasCompressionSockIntent) {
      if (entry.htsNumber.startsWith('6115.9')) {
        penalty += 0.45;
      }
    }

    // Earbuds → no additional penalty needed (8517 already hard-filtered in autocompleteByTextHybrid)

    // Plated jewelry → penalize precious metal jewelry (7113) — want imitation jewelry (7117)
    if (signals.hasPlatedIntent) {
      if (entry.htsNumber.startsWith('7113.')) {
        penalty += 0.7;
      }
    }

    // Laptop sleeve → penalize 4202.92 (shopping bags) — already hard-filtered, but add penalty too
    if (signals.hasLaptopCaseIntent) {
      if (entry.htsNumber.startsWith('4202.92')) {
        penalty += 0.55;
      }
    }

    // Shopping bag → penalize 4202.12 (hard cases/briefcases) — already hard-filtered
    if (signals.hasShoppingBagIntent) {
      if (entry.htsNumber.startsWith('4202.12')) {
        penalty += 0.55;
      }
    }

    // Water bottle → penalize sanitary ware (7324 — sinks/baths/bidets)
    if (signals.hasWaterBottleIntent) {
      if (entry.htsNumber.startsWith('7324.')) {
        penalty += 0.7;
      }
    }

    return penalty;
  }

  private hasTokenOverlap(tokenSet: Set<string>, reference: Set<string>): boolean {
    for (const token of reference) {
      if (tokenSet.has(token)) {
        return true;
      }
    }
    return false;
  }

  private combineResults(
    semantic: SemanticCandidate[],
    keyword: KeywordCandidate[],
    limit: number,
  ): Array<{ htsNumber: string; score: number }> {
    const combined = new Map<
      string,
      {
        htsNumber: string;
        score: number;
        inSemantic: boolean;
        inKeyword: boolean;
      }
    >();

    semantic.forEach((result, index) => {
      combined.set(result.htsNumber, {
        htsNumber: result.htsNumber,
        score: this.rrf(index),
        inSemantic: true,
        inKeyword: false,
      });
    });

    keyword.forEach((result, index) => {
      const existing = combined.get(result.htsNumber);
      if (existing) {
        existing.score += this.rrf(index);
        existing.inKeyword = true;
      } else {
        combined.set(result.htsNumber, {
          htsNumber: result.htsNumber,
          score: this.rrf(index),
          inSemantic: false,
          inKeyword: true,
        });
      }
    });

    return Array.from(combined.values())
      .map((row) => ({
        htsNumber: row.htsNumber,
        score: row.score + (row.inKeyword && row.inSemantic ? 0.06 : 0),
      }))
      .sort((a, b) => {
        if (b.score === a.score) {
          return a.htsNumber.localeCompare(b.htsNumber);
        }
        return b.score - a.score;
      })
      .slice(0, limit);
  }
}
