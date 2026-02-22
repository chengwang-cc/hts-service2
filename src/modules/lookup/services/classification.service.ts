import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiService, EmbeddingService, HtsEntity } from '@hts/core';
import { ProductClassificationEntity } from '../entities/product-classification.entity';

export interface ClassificationResult {
  htsCode: string;
  description: string;
  confidence: number;
  reasoning: string;
  chapter: string | null;
  candidates: Array<{ htsCode: string; description: string; score: number }>;
  alternatives?: Array<{ htsCode: string; description: string; score: number }>;
  needsReview?: boolean;
}

interface HeadingCandidate {
  htsNumber: string;
  description: string;
  /** Full ancestor breadcrumb from HtsEntity.fullDescription — used in prompt so AI sees
   *  the full hierarchy path, not just a bare "Other" or similar uninformative leaf label. */
  fullDescription?: string[] | null;
  rank: number;
  /** True when this candidate came from the AI's own HTS knowledge (not DB retrieval).
   *  Shown in a separate "primary guidance" section in the prompt and exempt from dedup. */
  isAiKnowledge?: boolean;
}

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);
  private readonly REVIEW_CONFIDENCE_THRESHOLD = 0.62;
  private readonly ESCALATE_CONFIDENCE_THRESHOLD = 0.45;
  private readonly RRF_K = 40;
  private readonly GENERIC_LEAF_LABELS = new Set([
    'other',
    'other:',
    'other.',
    'nesoi',
    'n.e.s.o.i.',
    'n.e.s.i.',
    'not elsewhere specified',
  ]);

  constructor(
    @InjectRepository(ProductClassificationEntity)
    private readonly classificationRepository: Repository<ProductClassificationEntity>,
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly openAiService: OpenAiService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async classifyProduct(
    description: string,
    organizationId: string,
  ): Promise<ClassificationResult> {
    try {
      // Step 1: Run DB search + AI knowledge prediction in parallel (no added latency)
      const { dbCandidates, aiPredictions } =
        await this.searchHeadingsForContext(description, 20);

      // Step 2: Build prompt — AI knowledge section first, then DB candidates
      const { input, instructions } = this.buildPrompt(
        description,
        dbCandidates,
        aiPredictions,
      );

      // Step 3: Pick heading with model routing (nano first, escalate to mini when low confidence)
      let aiResult = await this.requestHeadingSelection(
        input,
        instructions,
        'gpt-5-nano',
      );
      if (aiResult.confidence < this.ESCALATE_CONFIDENCE_THRESHOLD) {
        const escalated = await this.requestHeadingSelection(
          input,
          instructions,
          'gpt-5-mini',
        );
        if (escalated.confidence >= aiResult.confidence) {
          aiResult = escalated;
        }
      }

      // Step 4: Resolve the AI-picked code to actual 8/10-digit DB entries
      const candidates = await this.resolveToLeafEntries(
        aiResult.htsCode,
        description,
      );

      // Step 5: Use AI to pick the best leaf entry (avoids FTS scoring artifacts
      // where word repetition in a description causes wrong entry to rank #1,
      // e.g. "Bibles, prayer books and other religious books" winning for "comic books"
      // because "books" appears twice).
      const shouldEscalateLeafPicker =
        aiResult.confidence < this.REVIEW_CONFIDENCE_THRESHOLD ||
        candidates.length >= 5;
      const leafPickerModel = shouldEscalateLeafPicker
        ? 'gpt-5-mini'
        : 'gpt-5-nano';
      const bestMatch = candidates.length > 1
        ? await this.pickBestLeafEntry(
            description,
            candidates,
            aiResult.reasoning,
            leafPickerModel,
          )
        : candidates[0];

      const resolvedHts = bestMatch?.htsCode ?? aiResult.htsCode;
      const needsReview =
        aiResult.confidence < this.REVIEW_CONFIDENCE_THRESHOLD ||
        candidates.length === 0 ||
        this.isGenericLeafDescription(bestMatch?.description || '');
      const result: ClassificationResult = {
        htsCode: resolvedHts,
        description: bestMatch?.description ?? '',
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        chapter: resolvedHts.substring(0, 2) || null,
        candidates,
        alternatives: candidates.slice(0, 3),
        needsReview,
      };

      // Persist for authenticated organizations only
      if (organizationId) {
        const entity = this.classificationRepository.create({
          organizationId,
          productName: description.substring(0, 500),
          description,
          suggestedHts: result.htsCode,
          confidence: result.confidence,
          status: 'PENDING_CONFIRMATION',
          aiSuggestions: [aiResult, ...candidates.slice(0, 5)],
        });
        await this.classificationRepository.save(entity);
      }

      return result;
    } catch (error) {
      this.logger.error(`Classification failed: ${error.message}`);
      throw error;
    }
  }

  private async requestHeadingSelection(
    input: string,
    instructions: string,
    model: 'gpt-5-nano' | 'gpt-5-mini',
  ): Promise<{ htsCode: string; confidence: number; reasoning: string }> {
    const response = await this.openAiService.response(input, {
      model,
      instructions,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          json_schema: {
            name: 'classification_response',
            schema: {
              type: 'object',
              properties: {
                htsCode: { type: 'string' },
                confidence: { type: 'number' },
                reasoning: { type: 'string' },
              },
              required: ['htsCode', 'confidence', 'reasoning'],
              additionalProperties: false,
            },
            strict: true,
          },
        },
      },
    });

    const outputText = (response as any).output_text || '';
    if (!outputText) {
      throw new Error(`OpenAI returned empty response for model ${model}`);
    }

    return JSON.parse(outputText) as {
      htsCode: string;
      confidence: number;
      reasoning: string;
    };
  }

  /**
   * Search the DB for heading-level (4-digit) and subheading-level (6-digit/8-digit)
   * HTS entries that match the product description, AND run an AI knowledge prediction
   * in parallel.
   *
   * Strategy (all three run in parallel — no added latency):
   *  1. AI knowledge prediction: gpt-5-nano predicts the correct 4-digit HTS heading
   *     from its own training knowledge, completely independent of DB retrieval.
   *     This acts as the primary anchor — fixes cases where DB retrieval misses the
   *     correct chapter (e.g. "electric rice cooker" → embedding misses 8516 entirely).
   *  2. Semantic search via pgvector on 8/10-digit leaf entries.
   *     Bridges vocabulary gaps: "espresso machine" → 8516 "coffee or tea makers".
   *  3. FTS on search_vector (exact word matches — catches literal terms).
   *
   * Returns both DB candidates and AI predictions separately so buildPrompt can
   * display them in distinct sections.
   */
  private async searchHeadingsForContext(
    description: string,
    limit: number,
  ): Promise<{ dbCandidates: HeadingCandidate[]; aiPredictions: HeadingCandidate[] }> {
    // Run all three in parallel
    const [ftsResults, semanticResults, aiPredictions] = await Promise.all([
      this.ftsHeadingSearch(description, limit),
      this.semanticHeadingSearch(description, limit),
      this.aiKnowledgeHeadingPrediction(description),
    ]);

    // Verify AI knowledge predictions against DB: replace AI-generated descriptions
    // with actual DB descriptions. This prevents the AI from showing wrong descriptions
    // (e.g. "8516.72 = mixers/blenders" when DB says "8516.72 = Toasters") that
    // could mislead the heading picker into choosing incorrect codes.
    const verifiedAiPredictions = await this.verifyPredictionsAgainstDb(aiPredictions);

    // Fetch DB subheadings under AI-predicted headings to ensure specific codes
    // for the correct chapter are always in context.
    // E.g. if AI predicts 8516.60, fetch all 8516.60.xx entries so the final AI can
    // pick 8516.60.60.00 (Other cooking appliances) for a rice cooker.
    const aiGuidedSubheadings =
      verifiedAiPredictions.length > 0
        ? await this.fetchSubheadingsForHeadings(
            verifiedAiPredictions.map((p) => p.htsNumber),
          )
        : [];

    // Merge DB results: AI-guided subheadings first (rank 1.9), then semantic (rank 1.0+), then FTS
    const merged = new Map<string, HeadingCandidate>();
    for (const r of aiGuidedSubheadings) {
      merged.set(r.htsNumber, r);
    }
    for (const r of semanticResults) {
      if (!merged.has(r.htsNumber)) merged.set(r.htsNumber, r);
    }
    for (const r of ftsResults) {
      if (!merged.has(r.htsNumber)) merged.set(r.htsNumber, r);
    }

    const dbCandidates = Array.from(merged.values())
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);

    return { dbCandidates, aiPredictions: verifiedAiPredictions };
  }

  /**
   * Ask gpt-5-nano to predict the most likely 4-digit HTS heading(s) from its own
   * training knowledge — completely independent of DB retrieval.
   *
   * This runs in parallel with DB search and its results are shown as the PRIMARY
   * guidance section in the classification prompt. It fixes the most common failure
   * mode: products whose names never appear in HTS text cause retrieval to miss the
   * correct chapter entirely (e.g. "electric rice cooker" → embeddings land on
   * 8509 "blenders" instead of 8516 "cooking appliances").
   */
  private async aiKnowledgeHeadingPrediction(
    description: string,
  ): Promise<HeadingCandidate[]> {
    try {
      const response = await this.openAiService.response(
        `What are the most likely HTS (US Harmonized Tariff Schedule) codes for this product: "${description}"?

Provide 1-3 predictions ordered by confidence.
Return 6-digit subheading codes when you know the specific subheading; otherwise return 4-digit heading codes.

CRITICAL DISTINCTIONS to get right:
- Chapter 8509 = ELECTROMECHANICAL domestic appliances (with self-contained electric motor that drives a blade/grinder): blenders, food processors, food mixers, juicers, coffee grinders, can openers, hair clippers
- Chapter 8516 = ELECTROTHERMIC domestic appliances (that heat something): water heaters, space heaters, hair dryers, electric irons, toasters, coffee MAKERS, rice COOKERS, microwave ovens, waffle makers

Examples (correct classifications):
- "blender" → 8509.40 (electromechanical blenders, NOT 8516)
- "food processor" → 8509.40 (electromechanical food grinders, NOT 8516)
- "electric rice cooker" → 8516.60 (electrothermic cooking appliance)
- "espresso machine" → 8516.71 (coffee or tea makers)
- "drip coffee maker" → 8516.71 (coffee or tea makers)
- "microwave oven" → 8516.50 (microwave ovens)
- "stuffed animal teddy bear" → 9503 (toys)
- "olive oil" → 1509 (olive oil)
- "household dishwasher" → 8422.11 (household dishwashers)
- "fresh roasted coffee beans" → 0901.21 (roasted coffee, not decaffeinated)`,
        {
          model: 'gpt-5-nano',
          instructions:
            'You are a US Harmonized Tariff Schedule expert. Return 1-3 most likely HTS codes (4 or 6 digit) from your training knowledge. Pay special attention to the distinction between 8509 (electromechanical — motor-driven: blenders, food processors) and 8516 (electrothermic — heating: coffee makers, rice cookers, irons).',
          store: false,
          text: {
            format: {
              type: 'json_schema',
              json_schema: {
                name: 'heading_predictions',
                schema: {
                  type: 'object',
                  properties: {
                    predictions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          htsCode: { type: 'string' },
                          description: { type: 'string' },
                          confidence: { type: 'number' },
                        },
                        required: ['htsCode', 'description', 'confidence'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['predictions'],
                  additionalProperties: false,
                },
                strict: true,
              },
            },
          },
        },
      );

      const outputText = (response as any).output_text || '';
      if (!outputText) return [];

      const parsed = JSON.parse(outputText) as {
        predictions: Array<{
          htsCode: string;
          description: string;
          confidence: number;
        }>;
      };

      return (parsed.predictions ?? []).slice(0, 3).map((p) => {
        const raw = p.htsCode.trim();
        // Accept 4-digit "XXXX" or 6-digit "XXXX.XX" codes; strip anything longer
        const parts = raw.split('.');
        const htsNumber =
          parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{2}$/.test(parts[1])
            ? `${parts[0]}.${parts[1]}` // preserve 6-digit
            : parts[0].substring(0, 4); // fallback to 4-digit
        return {
          htsNumber,
          description: p.description,
          rank: 2.0 + (p.confidence ?? 0),
          isAiKnowledge: true,
        };
      });
    } catch (err) {
      this.logger.warn(`AI knowledge heading prediction failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Semantic heading search via leaf entries.
   *
   * Key insight: 8/10-digit leaf entries are enriched with full_description
   * (parent hierarchy text concatenated), giving them richer embeddings than
   * 4/6-digit heading entries which only encode formal tariff language.
   *
   * For example, "espresso machine":
   *  - 4-digit heading 8516 embedding ≈ "Electric water heaters, hairdressing apparatus..."
   *    (low similarity to "espresso machine")
   *  - 8-digit leaf 8516.71.00 embedding ≈ "Coffee or tea makers" → high similarity
   *
   * Strategy:
   *  1. Run pgvector cosine search on leaf entries (8/10-digit).
   *  2. Extract unique 4-digit and 6-digit prefix codes from top hits.
   *  3. Fetch the actual heading/subheading descriptions from DB.
   *  4. Return as candidates with a rank proportional to the leaf similarity.
   */
  private async semanticHeadingSearch(
    description: string,
    limit: number,
  ): Promise<HeadingCandidate[]> {
    try {
      const embedding =
        await this.embeddingService.generateEmbedding(description);

      // Step 1: Top leaf entries by cosine similarity (include description for orphan fallback)
      const leafRows = await this.htsRepository
        .createQueryBuilder('hts')
        .select('hts.htsNumber', 'htsNumber')
        .addSelect('hts.description', 'description')
        .addSelect('1 - (hts.embedding <=> :embedding)', 'similarity')
        .where('hts.isActive = :active', { active: true })
        .andWhere('hts.embedding IS NOT NULL')
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .setParameter('embedding', JSON.stringify(embedding))
        .orderBy('similarity', 'DESC')
        .limit(20)
        .getRawMany();

      // Step 2: Extract 4-digit, 6-digit, and 8-digit ancestor codes from each leaf.
      //
      // USITC HTS structure is NOT a uniform 4→6→8→10 hierarchy. Many headings jump
      // directly from 4-digit to 8-digit (e.g. 8516 → 8516.71.00 with no 8516.71).
      // We therefore extract all three prefix levels and let step 3 resolve only the
      // ones that actually exist in the database.
      //
      // Prefix extraction by splitting on '.':
      //   "8516.71.00.20" → parts = ["8516","71","00","20"]
      //     p4 = "8516"        (always present)
      //     p6 = "8516.71"     (may not exist in DB)
      //     p8 = "8516.71.00"  (exists in DB as the real subheading)
      const prefixScores = new Map<string, number>();
      for (const row of leafRows) {
        const code = row.htsNumber as string;
        const sim = Number(row.similarity) || 0;
        const parts = code.split('.');
        const p4 = parts[0];
        const p6 = parts.length >= 2 ? parts.slice(0, 2).join('.') : null;
        const p8 = parts.length >= 3 ? parts.slice(0, 3).join('.') : null;

        const update = (key: string) => {
          if (!prefixScores.has(key) || prefixScores.get(key)! < sim) {
            prefixScores.set(key, sim);
          }
        };
        update(p4);
        if (p6) update(p6);
        if (p8) update(p8);
      }

      if (prefixScores.size === 0) return [];

      // Step 3: Fetch heading/subheading descriptions for those prefixes.
      // Include digit lengths 4, 6, AND 8 because some USITC subheadings live at
      // the 8-digit level (e.g. 8516.71.00 "Coffee or tea makers") with no 6-digit
      // intermediate. Filtering to only those in prefixList keeps the result set small.
      const prefixList = [...prefixScores.keys()];
      const headings = await this.htsRepository
        .createQueryBuilder('hts')
        .select(['hts.htsNumber', 'hts.description', 'hts.fullDescription'])
        .where('hts.isActive = :active', { active: true })
        .andWhere('hts.htsNumber IN (:...prefixList)', { prefixList })
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (4, 6, 8)")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .getMany();

      // Step 4: Build candidate list from found headings.
      const foundP4s = new Set(
        headings.map((h) => h.htsNumber.split('.')[0]),
      );

      // Step 4b: Orphan leaves — leaf entries whose 4-digit parent heading does NOT
      // exist in the DB (e.g. 4903.00.00.00 exists but 4903 does not).
      // Include the leaf itself as a context candidate so the AI can pick it.
      // Only add one representative leaf per orphan heading (highest similarity).
      const seenOrphanP4s = new Set<string>();
      const orphanLeaves: HeadingCandidate[] = [];
      for (const row of leafRows) {
        const code = row.htsNumber as string;
        const p4 = code.split('.')[0];
        if (!foundP4s.has(p4) && !seenOrphanP4s.has(p4)) {
          seenOrphanP4s.add(p4);
          orphanLeaves.push({
            htsNumber: code,
            description: row.description ?? '',
            rank: 1.0 + (Number(row.similarity) || 0),
          });
        }
      }

      const allCandidates = [
        ...headings.map((h) => ({
          htsNumber: h.htsNumber,
          description: h.description ?? '',
          fullDescription: h.fullDescription,
          rank: 1.0 + (prefixScores.get(h.htsNumber) ?? 0),
        })),
        ...orphanLeaves,
      ];

      return allCandidates;
    } catch (err) {
      this.logger.warn(`Semantic heading search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Verify AI knowledge predictions against the actual DB descriptions.
   * The AI sometimes returns incorrect descriptions for valid HTS codes
   * (e.g. "8516.72 = mixers/blenders" when the DB shows "8516.72 = Toasters").
   *
   * This method looks up each predicted code in the DB and replaces the AI's
   * description with the actual DB description, including the full hierarchy
   * breadcrumb. This prevents the heading picker from being misled by wrong
   * AI descriptions into choosing an inappropriate code.
   *
   * If the predicted code is NOT in the DB at the 4/6-digit level, the prediction
   * is kept as-is (AI knowledge section still useful as a chapter anchor).
   */
  private async verifyPredictionsAgainstDb(
    predictions: HeadingCandidate[],
  ): Promise<HeadingCandidate[]> {
    if (predictions.length === 0) return predictions;

    const codes = predictions.map((p) => p.htsNumber);
    const dbRows = await this.htsRepository
      .createQueryBuilder('hts')
      .select(['hts.htsNumber', 'hts.description', 'hts.fullDescription'])
      .where('hts.isActive = :active', { active: true })
      .andWhere('hts.htsNumber IN (:...codes)', { codes })
      .getMany();

    const dbMap = new Map<string, HtsEntity>(dbRows.map((r) => [r.htsNumber, r]));

    return predictions.map((p) => {
      const dbRow = dbMap.get(p.htsNumber);
      if (!dbRow) return p; // not in DB, keep AI description as-is
      return {
        ...p,
        description: dbRow.description ?? p.description,
        fullDescription: dbRow.fullDescription ?? p.fullDescription,
      };
    });
  }

  /**
   * Fetch all heading/subheading (4/6/8-digit) entries from the DB under the given
   * 4-digit heading codes. Used to ensure that when the AI knowledge predicts a chapter,
   * ALL its subheadings are in context — not just the ones that happened to surface
   * via semantic or FTS search.
   *
   * Example: AI predicts "8516" (electrothermic appliances). Without this, DB retrieval
   * might only surface "8516.71" (coffee makers). With this, we fetch ALL 8516.xx entries
   * including "8516.60" (cooking appliances) so the AI can pick the right one.
   */
  private async fetchSubheadingsForHeadings(
    headingCodes: string[],
  ): Promise<HeadingCandidate[]> {
    if (headingCodes.length === 0) return [];

    // Support both 4-digit and 6-digit prefixes from AI knowledge predictions.
    // - 4-digit (e.g. "8516"): fetch 4/6/8-digit entries only (subtree can be large)
    // - 6-digit (e.g. "8516.60"): fetch 6/8/10-digit entries (narrower subtree,
    //   safe to include 10-digit leaves so AI sees "Other cooking appliances")
    const cleanCodes = [
      ...new Set(
        headingCodes
          .map((c) => {
            const t = c.trim();
            // Keep up to 2 dot-groups (6-digit "XXXX.XX") if present; else just 4-digit
            const parts = t.split('.');
            if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{2}$/.test(parts[1])) {
              return `${parts[0]}.${parts[1]}`; // 6-digit: "8516.60"
            }
            return parts[0]; // 4-digit: "8516"
          })
          .filter((c) => /^\d{4}(\.\d{2})?$/.test(c)),
      ),
    ];
    if (cleanCodes.length === 0) return [];

    const results: HeadingCandidate[] = [];
    for (const code of cleanCodes) {
      const is6Digit = code.includes('.');
      const lengthFilter = is6Digit
        ? "LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (6, 8, 10)" // narrow subtree: include leaves
        : "LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (4, 6, 8)"; // broad subtree: headings only

      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select(['hts.htsNumber', 'hts.description', 'hts.fullDescription'])
        .where('hts.isActive = :active', { active: true })
        .andWhere(lengthFilter)
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere(
          'hts.htsNumber = :code OR hts.htsNumber LIKE :pattern',
          { code, pattern: `${code}.%` },
        )
        .limit(30) // cap per prediction to avoid context explosion
        .getMany();

      for (const row of rows) {
        results.push({
          htsNumber: row.htsNumber,
          description: row.description ?? '',
          fullDescription: row.fullDescription,
          rank: 1.9, // slightly below orphan leaves (2.0+) but above semantic (1.0+)
        });
      }
    }
    return results;
  }

  /**
   * FTS heading search — fast, reliable for products whose names appear
   * literally in HTS descriptions (e.g. "tripod", "cotton", "book").
   */
  private async ftsHeadingSearch(
    description: string,
    limit: number,
  ): Promise<HeadingCandidate[]> {
    const words = description
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    if (words.length === 0) return [];

    // 1. AND of all words first (most precise)
    const andQuery = words.map((w) => `${w}:*`).join(' & ');
    try {
      const rows = await this.runFtsHeadingQuery(andQuery, limit);
      if (rows.length >= 3) return rows;
    } catch {
      // stop words or parse error
    }

    // 2. OR of all words (catches products where only some words match)
    const orQuery = words.map((w) => `${w}:*`).join(' | ');
    try {
      return await this.runFtsHeadingQuery(orQuery, limit);
    } catch {
      return [];
    }
  }

  private async runFtsHeadingQuery(
    tsquery: string,
    limit: number,
  ): Promise<HeadingCandidate[]> {
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('hts.fullDescription', 'fullDescription')
      .addSelect(
        `ts_rank(hts.searchVector, to_tsquery('english', :tsquery))`,
        'rank',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (4, 6)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
      .setParameters({ tsquery })
      .orderBy('rank', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((r) => ({
      htsNumber: r.htsNumber,
      description: r.description ?? '',
      fullDescription: Array.isArray(r.fullDescription)
        ? r.fullDescription
        : typeof r.fullDescription === 'string'
          ? (JSON.parse(r.fullDescription) as string[])
          : null,
      rank: Number(r.rank) || 0,
    }));
  }

  /**
   * Build the AI prompt with two distinct sections:
   *
   * 1. "AI HTS Knowledge" — the parallel gpt-5-nano prediction from its own training.
   *    Shown first as PRIMARY guidance. This anchors the AI to the correct chapter even
   *    when the DB retrieval fails to surface it (e.g. "electric rice cooker" retrieval
   *    returns 8509/blenders instead of 8516/cooking appliances).
   *    These candidates are NOT deduplicated — they're always shown as top-level guidance.
   *
   * 2. "Database Verified Codes" — deduplicated DB candidates (semantic + FTS).
   *    Deduplication: remove any code if a more specific descendant (starts with it + '.')
   *    is present, so the AI always picks the most specific DB subheading available.
   *    The AI should prefer a DB code when it falls under the correct chapter from section 1.
   */
  private buildPrompt(
    description: string,
    dbCandidates: HeadingCandidate[],
    aiPredictions: HeadingCandidate[],
  ): { input: string; instructions: string } {
    const instructions =
      'You are an expert HTS tariff classifier with deep knowledge of the ' +
      'Harmonized Tariff Schedule. Use the "AI HTS Knowledge" section as a chapter ' +
      'guide, but always verify against the product description. If a "Database ' +
      'Verified Code" clearly and specifically matches the product (e.g. "Blenders" ' +
      'for a blender, "Smartphones" for a smartphone), prefer it even if AI knowledge ' +
      'suggests a different chapter. The AI knowledge section corrects retrieval ' +
      'failures; it does not override clearly matching DB codes.';

    // Deduplicate DB candidates: remove any code if a more specific descendant
    // (starts with it + '.') is already in the list.
    //   "8516" removed when "8516.71.00" is present → AI picks more specific
    //   "8516.71" removed when "8516.71.00" is present
    //   "4903" kept when no "4903.xxx" is present (standalone leaf)
    const deduped = dbCandidates.filter(
      (h) =>
        !dbCandidates.some(
          (other) =>
            other.htsNumber !== h.htsNumber &&
            other.htsNumber.startsWith(h.htsNumber + '.'),
        ),
    );

    // Format helper: use full hierarchy breadcrumb when available so the AI sees
    // "Newspapers, journals and periodicals › Other › Other" instead of just "Other".
    const formatEntry = (h: HeadingCandidate): string => {
      const label =
        h.fullDescription && h.fullDescription.length > 0
          ? h.fullDescription.join(' › ')
          : h.description;
      return `  ${h.htsNumber} — ${label}`;
    };

    const aiSection =
      aiPredictions.length > 0
        ? `=== AI HTS Knowledge (primary guidance — from training) ===\n` +
          aiPredictions.map(formatEntry).join('\n')
        : '';

    const dbSection =
      deduped.length > 0
        ? `=== Database Verified Codes (prefer these when chapter matches above) ===\n` +
          deduped.map(formatEntry).join('\n')
        : '';

    const hasAny = aiSection || dbSection;

    if (!hasAny) {
      return {
        input: `Classify this product into an HTS heading or subheading code: "${description}".
Return JSON: { htsCode, confidence, reasoning }.`,
        instructions,
      };
    }

    const contextBlock = [aiSection, dbSection].filter(Boolean).join('\n\n');

    const input = `Product to classify: "${description}"

${contextBlock}

Instructions:
1. Confirm the product category using both sections above. The AI HTS Knowledge section provides likely chapters; the Database Verified Codes provide specific verified entries.
2. If a DB code description clearly and specifically matches the product (e.g. "Blenders" for a blender, "Smartphones" for a smartphone, "Coffee or tea makers" for an espresso machine), pick that DB code — even if it differs from the AI knowledge chapter.
3. If DB candidates are from the wrong chapter (e.g. retrieval returned blenders for a rice cooker), trust the AI HTS Knowledge section instead and pick the best DB code under that chapter.
4. PREFER a named subheading (e.g. "8516.71 — Coffee or tea makers") over a generic "Other" (e.g. "8516.29 — Other") when the product clearly matches the named category.
5. HTS expertise reminders: comic books/manga → 4902 (periodicals); stuffed toys → 9503; blenders/food processors → 8509.40; rice cooker/coffee maker → 8516.
6. If neither list has an accurate code, return the correct HTS code from your training knowledge.

Return JSON: { htsCode, confidence, reasoning }.`;

    return { input, instructions };
  }

  /**
   * Given an AI-suggested HTS code (possibly heading/subheading level),
   * find the actual 8/10-digit entries in the DB.
   * Tries prefixes from most specific to least.
   */
  private async resolveToLeafEntries(
    aiCode: string,
    description: string,
  ): Promise<Array<{ htsCode: string; description: string; score: number }>> {
    const prefixes = this.buildPrefixCandidates(aiCode);
    const embedding = await this.generateOptionalEmbedding(description);

    for (const prefix of prefixes) {
      const candidates = await this.findLeafEntriesByPrefix(
        prefix,
        description,
        embedding,
      );
      if (candidates.length > 0) {
        return candidates;
      }
    }

    return [];
  }

  private buildPrefixCandidates(aiCode: string): string[] {
    const code = aiCode.trim().replace(/[^\d.]/g, '');
    if (!code) {
      return [];
    }

    const dotParts = code.split('.').filter((part) => /^\d+$/.test(part));
    const normalized =
      dotParts.length > 0 ? dotParts.join('.') : code.replace(/[^\d]/g, '');

    const candidates: string[] = [];
    const compact = normalized.replace(/[^\d]/g, '');

    if (dotParts.length >= 3) {
      candidates.push(dotParts.slice(0, 3).join('.'));
    }
    if (dotParts.length >= 2) {
      candidates.push(dotParts.slice(0, 2).join('.'));
    }
    if (dotParts.length >= 1) {
      candidates.push(dotParts[0]);
    }

    if (compact.length >= 8) {
      candidates.push(
        `${compact.substring(0, 4)}.${compact.substring(4, 6)}.${compact.substring(6, 8)}`,
      );
    }
    if (compact.length >= 6) {
      candidates.push(`${compact.substring(0, 4)}.${compact.substring(4, 6)}`);
    }
    if (compact.length >= 4) {
      candidates.push(compact.substring(0, 4));
    }

    return [...new Set(candidates)];
  }

  private async generateOptionalEmbedding(
    description: string,
  ): Promise<number[] | null> {
    const text = description.trim();
    if (text.length < 4) {
      return null;
    }
    try {
      return await this.embeddingService.generateEmbedding(text);
    } catch (err) {
      this.logger.warn(
        `Leaf semantic embedding failed, falling back to lexical-only: ${err.message}`,
      );
      return null;
    }
  }

  private async findLeafEntriesByPrefix(
    prefix: string,
    description: string,
    embedding: number[] | null,
  ): Promise<Array<{ htsCode: string; description: string; score: number }>> {
    if (!prefix || prefix.length < 4) return [];

    const words = this.tokenizeText(description);
    const [lexicalRows, semanticRows] = await Promise.all([
      this.lexicalLeafCandidatesByPrefix(prefix, words),
      this.semanticLeafCandidatesByPrefix(prefix, embedding),
    ]);

    const fused = this.fuseLeafCandidates(
      prefix,
      words,
      lexicalRows,
      semanticRows,
    );
    if (fused.length > 0) {
      return fused;
    }

    // Fallback when both lexical and semantic evidence are sparse
    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select(['hts.htsNumber', 'hts.description'])
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere('hts.htsNumber = :prefix OR hts.htsNumber LIKE :pattern', {
        prefix,
        pattern: `${prefix}.%`,
      })
      .orderBy('hts.htsNumber', 'ASC')
      .limit(10)
      .getMany();

    return rows.map((row, index) => ({
      htsCode: row.htsNumber,
      description: row.description ?? '',
      score: 1 / (this.RRF_K + index + 1),
    }));
  }

  private async lexicalLeafCandidatesByPrefix(
    prefix: string,
    words: string[],
  ): Promise<Array<{ htsCode: string; description: string; score: number }>> {
    if (words.length === 0) {
      return [];
    }

    const tsquery = this.buildTsQuery(words, '|');
    if (!tsquery) {
      return [];
    }

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect(
        `ts_rank_cd(hts.searchVector, to_tsquery('english', :tsquery))`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere('hts.htsNumber = :prefix OR hts.htsNumber LIKE :pattern', {
        prefix,
        pattern: `${prefix}.%`,
      })
      .andWhere('hts.searchVector @@ to_tsquery(\'english\', :tsquery)')
      .setParameters({ tsquery })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(20)
      .getRawMany();

    return rows.map((row) => ({
      htsCode: row.htsNumber,
      description: row.description ?? '',
      score: Number(row.score) || 0,
    }));
  }

  private async semanticLeafCandidatesByPrefix(
    prefix: string,
    embedding: number[] | null,
  ): Promise<Array<{ htsCode: string; description: string; score: number }>> {
    if (!embedding) {
      return [];
    }

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect('1 - (hts.embedding <=> :embedding)', 'score')
      .where('hts.isActive = :active', { active: true })
      .andWhere('hts.embedding IS NOT NULL')
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere('hts.htsNumber = :prefix OR hts.htsNumber LIKE :pattern', {
        prefix,
        pattern: `${prefix}.%`,
      })
      .setParameter('embedding', JSON.stringify(embedding))
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(20)
      .getRawMany();

    return rows.map((row) => ({
      htsCode: row.htsNumber,
      description: row.description ?? '',
      score: Number(row.score) || 0,
    }));
  }

  private fuseLeafCandidates(
    prefix: string,
    words: string[],
    lexical: Array<{ htsCode: string; description: string; score: number }>,
    semantic: Array<{ htsCode: string; description: string; score: number }>,
  ): Array<{ htsCode: string; description: string; score: number }> {
    const fused = new Map<
      string,
      {
        htsCode: string;
        description: string;
        score: number;
        lexicalRank?: number;
        semanticRank?: number;
      }
    >();

    lexical.forEach((row, index) => {
      const existing = fused.get(row.htsCode);
      if (existing) {
        existing.score += 1 / (this.RRF_K + index + 1);
        existing.lexicalRank = index;
      } else {
        fused.set(row.htsCode, {
          ...row,
          score: 1 / (this.RRF_K + index + 1),
          lexicalRank: index,
        });
      }
    });

    semantic.forEach((row, index) => {
      const existing = fused.get(row.htsCode);
      if (existing) {
        existing.score += 1 / (this.RRF_K + index + 1);
        existing.semanticRank = index;
      } else {
        fused.set(row.htsCode, {
          ...row,
          score: 1 / (this.RRF_K + index + 1),
          semanticRank: index,
        });
      }
    });

    return [...fused.values()]
      .map((row) => {
        const finalScore = this.scoreLeafCandidate(
          prefix,
          words,
          row.htsCode,
          row.description,
          row.score,
          row.lexicalRank !== undefined && row.semanticRank !== undefined,
        );
        return {
          htsCode: row.htsCode,
          description: row.description,
          score: finalScore,
        };
      })
      .sort((a, b) =>
        b.score === a.score
          ? a.htsCode.localeCompare(b.htsCode)
          : b.score - a.score,
      )
      .slice(0, 10);
  }

  private scoreLeafCandidate(
    prefix: string,
    words: string[],
    htsCode: string,
    description: string,
    baseScore: number,
    hasBothSignals: boolean,
  ): number {
    const text = (description || '').toLowerCase();
    const coverage =
      words.length === 0
        ? 0
        : words.filter((word) => text.includes(word)).length / words.length;
    const genericPenalty =
      this.isGenericLeafDescription(description) && coverage < 0.7 ? 0.2 : 0;
    const prefixBoost = htsCode.startsWith(prefix) ? 0.05 : 0;
    const signalBoost = hasBothSignals ? 0.06 : 0;
    return baseScore + coverage * 0.6 + prefixBoost + signalBoost - genericPenalty;
  }

  /**
   * When FTS leaf resolution returns multiple candidates, use a cheap AI call
   * to pick the most semantically appropriate one.
   * This avoids artifacts where word-repetition in a description (e.g. "prayer books
   * and other religious books") scores higher than the actually correct entry.
   */
  private async pickBestLeafEntry(
    productDescription: string,
    candidates: Array<{ htsCode: string; description: string; score: number }>,
    headingReasoning: string,
    model: 'gpt-5-nano' | 'gpt-5-mini' = 'gpt-5-nano',
  ): Promise<{ htsCode: string; description: string; score: number } | undefined> {
    if (candidates.length === 0) return undefined;

    const list = candidates
      .map((c, i) => `  ${i + 1}. ${c.htsCode} — ${c.description}`)
      .join('\n');

    try {
      const response = await this.openAiService.response(
        `Product: "${productDescription}"
Classification reasoning: ${headingReasoning}

Choose the single best HTS code from these options:
${list}

Return JSON: { "index": <1-based number> }`,
        {
          model,
          instructions:
            'You are an HTS tariff expert. Pick the most accurate leaf-level HTS code for the given product. ' +
            'Return only the 1-based index of the best option as JSON.',
          store: false,
          text: {
            format: {
              type: 'json_schema',
              json_schema: {
                name: 'leaf_pick',
                schema: {
                  type: 'object',
                  properties: { index: { type: 'number' } },
                  required: ['index'],
                  additionalProperties: false,
                },
                strict: true,
              },
            },
          },
        },
      );

      const outputText = (response as any).output_text || '';
      if (!outputText) {
        return candidates[0];
      }
      const parsed = JSON.parse(outputText) as { index: number };
      const idx = Math.round(parsed.index) - 1;
      if (idx >= 0 && idx < candidates.length) {
        return candidates[idx];
      }
    } catch (err) {
      this.logger.warn(`Leaf picker fallback to top candidate: ${err.message}`);
    }

    return candidates[0];
  }

  private tokenizeText(input: string): string[] {
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

    const matches = (input || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    return [...new Set(matches.filter((token) => token.length > 1 && !stopWords.has(token)))];
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

  private isGenericLeafDescription(description: string): boolean {
    const normalized = (description || '').trim().toLowerCase();
    return (
      this.GENERIC_LEAF_LABELS.has(normalized) || normalized.startsWith('other')
    );
  }
}
