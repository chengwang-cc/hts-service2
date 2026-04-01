import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiService } from '../../../core/services/openai.service';

export interface RerankCandidate {
  htsNumber: string;
  description: string;
  fullDescription?: string[] | null;
  score?: number;
  similarity?: number;
}

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  private readonly openAiTimeoutMs: number;

  constructor(
    private readonly openAiService: OpenAiService,
    private readonly configService: ConfigService,
  ) {
    this.openAiTimeoutMs = this.configService.get<number>(
      'LOOKUP_RERANK_OPENAI_TIMEOUT_MS',
      8000,
    );
  }

  /**
   * Rerank HTS candidates using gpt-4.1-nano for a given user query.
   * Falls back to original order on any error.
   */
  async rerank(query: string, candidates: RerankCandidate[]): Promise<RerankCandidate[]> {
    if (candidates.length <= 1) return candidates;

    return this.tryOpenAiRerank(query, candidates);
  }

  private async tryOpenAiRerank(
    query: string,
    candidates: RerankCandidate[],
  ): Promise<RerankCandidate[]> {
    const candidateList = candidates.map((c, i) => ({
      index: i,
      htsNumber: c.htsNumber,
      description: this.buildCandidateDescription(c),
    }));

    // json_object format requires the word "json" in the input
    const input = `User query: "${query}"

HTS candidates to rank (json):
${JSON.stringify(candidateList)}

Return a JSON object with key "ranked" containing an array of candidate indices ordered from most to least relevant to the user query. Example: {"ranked":[2,0,1]}`;

    try {
      const res = await this.withTimeout(
        this.openAiService.response(input, {
          model: 'gpt-5.4-nano',
          instructions:
            'You are an HTS (Harmonized Tariff Schedule) classification expert. ' +
            'Reorder the given HTS candidates from most to least relevant for the user query. ' +
            '\n\n' +
            'MOST IMPORTANT RULE — WRONG TYPE PENALTY: ' +
            'If a candidate description explicitly names a product/entity that is DIFFERENT from what the user asked for, ' +
            'that candidate MUST rank below any generic or catch-all description, regardless of specificity. ' +
            'A generic "other" or "nesoi" code that could include the queried product always beats a specific code that names the wrong product. ' +
            'Examples of wrong-type mismatches: ' +
            '"bicycle helmet" query → "Motorcycle helmets" is WRONG (bicycle=non-motorized, motorcycle=motorized; different products). Rank "Athletic, recreational and sporting headgear" ABOVE "Motorcycle helmets". ' +
            '"dog food" query → "Cat food" is WRONG. Rank "Animal food nesoi" above "Cat food". ' +
            '"cotton shirt" query → "Polyester shirts" is WRONG material. ' +
            '\n\n' +
            'After applying the wrong-type rule, rank remaining candidates by: ' +
            '(1) MATERIAL match — composition must match exactly. ' +
            '(2) SPECIES/VARIETY — for food/animals/plants: specific species over generic. ' +
            '(3) PROCESSING STATE — fresh≠frozen≠smoked≠dried≠canned. ' +
            '(4) FORM — fillet≠whole, powder≠liquid. ' +
            '(5) SPECIFICITY — most specific matching code over "other"/"nesoi" when type matches. ' +
            '(6) USE CASE — functional purpose and end use. ' +
            'Return only a JSON object with key "ranked" containing the array of indices.',
          text: { format: { type: 'json_object' } },
          // NOTE: do NOT set max_output_tokens for reasoning models (gpt-4.1-nano)
        }),
        this.openAiTimeoutMs,
        'OpenAI rerank timed out',
      );

      const parsed = JSON.parse(res.output_text || '{}') as { ranked?: unknown };
      const indices = parsed.ranked;

      if (!Array.isArray(indices)) {
        this.logger.warn('Rerank: unexpected response shape, using original order');
        return candidates;
      }

      const reranked: RerankCandidate[] = [];
      const seen = new Set<number>();

      for (const idx of indices) {
        const i = typeof idx === 'number' ? idx : parseInt(String(idx), 10);
        if (Number.isInteger(i) && i >= 0 && i < candidates.length && !seen.has(i)) {
          reranked.push(candidates[i]);
          seen.add(i);
        }
      }

      // Append any candidates the model did not mention
      for (let i = 0; i < candidates.length; i++) {
        if (!seen.has(i)) reranked.push(candidates[i]);
      }

      this.logger.log(
        `Reranked ${candidates.length} candidates for query "${query}": [${(indices as number[]).slice(0, 5).join(',')}${indices.length > 5 ? '...' : ''}]`,
      );

      return reranked;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Rerank failed (returning original order): ${msg}`);
      return candidates;
    }
  }

  private buildCandidateDescription(candidate: RerankCandidate): string {
    return candidate.fullDescription?.slice(-3).join(' > ') || candidate.description;
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
