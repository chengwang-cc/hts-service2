import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiService, HtsEntity } from '@hts/core';
import { ProductClassificationEntity } from '../entities/product-classification.entity';

export interface ClassificationResult {
  htsCode: string;
  description: string;
  confidence: number;
  reasoning: string;
  chapter: string | null;
  candidates: Array<{ htsCode: string; description: string; score: number }>;
}

interface HeadingCandidate {
  htsNumber: string;
  description: string;
  rank: number;
}

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @InjectRepository(ProductClassificationEntity)
    private readonly classificationRepository: Repository<ProductClassificationEntity>,
    @InjectRepository(HtsEntity)
    private readonly htsRepository: Repository<HtsEntity>,
    private readonly openAiService: OpenAiService,
  ) {}

  async classifyProduct(
    description: string,
    organizationId: string,
  ): Promise<ClassificationResult> {
    try {
      // Step 1: Search DB for heading-level candidates to ground the AI
      const headingCandidates = await this.searchHeadingsForContext(
        description,
        20,
      );

      // Step 2: Build prompt — with DB context when available
      const { input, instructions } = this.buildPrompt(
        description,
        headingCandidates,
      );

      // Step 3: Call AI to pick the best heading from DB candidates
      const response = await this.openAiService.response(input, {
        model: 'gpt-4o',
        instructions,
        temperature: 0,
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
        throw new Error('OpenAI returned empty response');
      }

      const aiResult = JSON.parse(outputText) as {
        htsCode: string;
        confidence: number;
        reasoning: string;
      };

      // Step 4: Resolve the AI-picked code to actual 8/10-digit DB entries
      const candidates = await this.resolveToLeafEntries(
        aiResult.htsCode,
        description,
      );

      const bestMatch = candidates[0];
      const result: ClassificationResult = {
        htsCode: bestMatch?.htsCode ?? aiResult.htsCode,
        description: bestMatch?.description ?? '',
        confidence: aiResult.confidence,
        reasoning: aiResult.reasoning,
        chapter: (bestMatch?.htsCode ?? aiResult.htsCode).substring(0, 2) || null,
        candidates,
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

  /**
   * Search the DB for heading-level (4-digit) and subheading-level (6-digit)
   * HTS entries that match the product description.
   * These become the RAG context for the AI prompt.
   *
   * Strategy:
   *  1. FTS on search_vector (exact word matches — fast, reliable)
   *  2. If < 5 FTS hits, broaden with ILIKE on description (partial match fallback)
   *  Deduplicate and return top `limit` results ordered by relevance.
   */
  private async searchHeadingsForContext(
    description: string,
    limit: number,
  ): Promise<HeadingCandidate[]> {
    const words = description
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1);

    const results: HeadingCandidate[] = [];

    // --- FTS: try AND first, then progressively drop words from the front ---
    for (let startIdx = 0; startIdx < words.length; startIdx++) {
      const currentWords = words.slice(startIdx);
      const tsquery = currentWords.map((w) => `${w}:*`).join(' & ');

      try {
        const rows = await this.htsRepository
          .createQueryBuilder('hts')
          .select('hts.htsNumber', 'htsNumber')
          .addSelect('hts.description', 'description')
          .addSelect(
            `ts_rank(hts.searchVector, to_tsquery('english', :tsquery))`,
            'rank',
          )
          .where('hts.isActive = :active', { active: true })
          .andWhere(
            "LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (4, 6)",
          )
          .andWhere("hts.chapter NOT IN ('98', '99')")
          .andWhere(`hts.searchVector @@ to_tsquery('english', :tsquery)`)
          .setParameters({ tsquery })
          .orderBy('rank', 'DESC')
          .limit(limit)
          .getRawMany();

        if (rows.length >= 3) {
          return rows.map((r) => ({
            htsNumber: r.htsNumber,
            description: r.description ?? '',
            rank: Number(r.rank) || 0,
          }));
        }

        // Merge partial results if we have some
        for (const r of rows) {
          if (!results.find((x) => x.htsNumber === r.htsNumber)) {
            results.push({
              htsNumber: r.htsNumber,
              description: r.description ?? '',
              rank: Number(r.rank) || 0,
            });
          }
        }
      } catch {
        // Invalid tsquery (stop words only), try next relaxation
      }
    }

    if (results.length >= 3) {
      return results.slice(0, limit);
    }

    // --- Fallback: OR tsquery across all words ---
    if (words.length > 0) {
      const orQuery = words.map((w) => `${w}:*`).join(' | ');
      try {
        const rows = await this.htsRepository
          .createQueryBuilder('hts')
          .select('hts.htsNumber', 'htsNumber')
          .addSelect('hts.description', 'description')
          .addSelect(
            `ts_rank(hts.searchVector, to_tsquery('english', :orQuery))`,
            'rank',
          )
          .where('hts.isActive = :active', { active: true })
          .andWhere(
            "LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (4, 6)",
          )
          .andWhere("hts.chapter NOT IN ('98', '99')")
          .andWhere(`hts.searchVector @@ to_tsquery('english', :orQuery)`)
          .setParameters({ orQuery })
          .orderBy('rank', 'DESC')
          .limit(limit)
          .getRawMany();

        for (const r of rows) {
          if (!results.find((x) => x.htsNumber === r.htsNumber)) {
            results.push({
              htsNumber: r.htsNumber,
              description: r.description ?? '',
              rank: Number(r.rank) || 0,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    // --- Last resort: ILIKE across description for each word ---
    if (results.length === 0 && words.length > 0) {
      const ilikeTerm = `%${words.join('%')}%`;
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select(['hts.htsNumber', 'hts.description'])
        .where('hts.isActive = :active', { active: true })
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (4, 6)")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere('hts.description ILIKE :ilike', { ilike: ilikeTerm })
        .orderBy('hts.htsNumber', 'ASC')
        .limit(limit)
        .getMany();

      for (const r of rows) {
        results.push({
          htsNumber: r.htsNumber,
          description: r.description ?? '',
          rank: 0,
        });
      }
    }

    return results
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);
  }

  /**
   * Build the AI prompt.
   * When DB candidates are available, the AI is constrained to pick from them.
   * When none are found, the AI falls back to its own HTS knowledge.
   */
  private buildPrompt(
    description: string,
    headingCandidates: HeadingCandidate[],
  ): { input: string; instructions: string } {
    if (headingCandidates.length === 0) {
      return {
        input: `Classify this product into an HTS heading code: "${description}".
Return JSON: { htsCode, confidence, reasoning }.`,
        instructions:
          'You are an expert HTS classifier. Return the most appropriate HTS heading code.',
      };
    }

    const contextList = headingCandidates
      .map((h) => `  ${h.htsNumber} — ${h.description}`)
      .join('\n');

    const input = `Product to classify: "${description}"

The following HTS headings exist in our database (ranked by relevance to your query):
${contextList}

Choose the single best HTS code from the list above that most accurately classifies this product.
You MUST pick a code from the list. Return JSON: { htsCode, confidence, reasoning }.`;

    const instructions =
      'You are an expert HTS tariff classifier. ' +
      'You will be given a list of real HTS headings from a live database. ' +
      'You MUST select htsCode from the provided list — do not invent or use codes outside it. ' +
      'Pick the most specific and accurate heading based on HTS classification rules.';

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

    for (const prefix of prefixes) {
      const candidates = await this.findLeafEntriesByPrefix(prefix, description);
      if (candidates.length > 0) {
        return candidates;
      }
    }

    return [];
  }

  private buildPrefixCandidates(aiCode: string): string[] {
    const code = aiCode.trim();
    const candidates: string[] = [];

    if (code.length >= 10) candidates.push(code.substring(0, 10));
    if (code.length >= 7) candidates.push(code.substring(0, 7));
    if (code.length >= 4) candidates.push(code.substring(0, 4));

    return [...new Set(candidates)];
  }

  private async findLeafEntriesByPrefix(
    prefix: string,
    description: string,
  ): Promise<Array<{ htsCode: string; description: string; score: number }>> {
    if (!prefix || prefix.length < 4) return [];

    const words = description
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) {
      const rows = await this.htsRepository
        .createQueryBuilder('hts')
        .select(['hts.htsNumber', 'hts.description'])
        .where('hts.isActive = :active', { active: true })
        .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
        .andWhere("hts.chapter NOT IN ('98', '99')")
        .andWhere('hts.htsNumber LIKE :pattern', { pattern: `${prefix}.%` })
        .orderBy('hts.htsNumber', 'ASC')
        .limit(10)
        .getMany();

      return rows.map((r, i) => ({
        htsCode: r.htsNumber,
        description: r.description ?? '',
        score: 1 - i * 0.05,
      }));
    }

    const tsquery = words.map((w) => `${w}:*`).join(' | ');

    const rows = await this.htsRepository
      .createQueryBuilder('hts')
      .select('hts.htsNumber', 'htsNumber')
      .addSelect('hts.description', 'description')
      .addSelect(
        `ts_rank(hts.searchVector, to_tsquery('english', :tsquery))`,
        'score',
      )
      .where('hts.isActive = :active', { active: true })
      .andWhere("LENGTH(REPLACE(hts.htsNumber, '.', '')) IN (8, 10)")
      .andWhere("hts.chapter NOT IN ('98', '99')")
      .andWhere('hts.htsNumber LIKE :pattern', { pattern: `${prefix}.%` })
      .setParameters({ tsquery })
      .orderBy('score', 'DESC')
      .addOrderBy('hts.htsNumber', 'ASC')
      .limit(10)
      .getRawMany();

    return rows.map((r) => ({
      htsCode: r.htsNumber,
      description: r.description ?? '',
      score: Number(r.score) || 0,
    }));
  }
}
