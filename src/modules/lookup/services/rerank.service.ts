import { Injectable, Logger } from '@nestjs/common';
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

  constructor(private readonly openAiService: OpenAiService) {}

  /**
   * Rerank HTS candidates using gpt-5-nano for a given user query.
   * Falls back to original order on any error.
   */
  async rerank(query: string, candidates: RerankCandidate[]): Promise<RerankCandidate[]> {
    if (candidates.length <= 1) return candidates;

    const candidateList = candidates.map((c, i) => ({
      index: i,
      htsNumber: c.htsNumber,
      description: c.fullDescription?.slice(-3).join(' > ') || c.description,
    }));

    // json_object format requires the word "json" in the input
    const input = `User query: "${query}"

HTS candidates to rank (json):
${JSON.stringify(candidateList)}

Return a JSON object with key "ranked" containing an array of candidate indices ordered from most to least relevant to the user query. Example: {"ranked":[2,0,1]}`;

    try {
      const res = await this.openAiService.response(input, {
        model: 'gpt-5-nano',
        instructions:
          'You are an HTS (Harmonized Tariff Schedule) classification expert. ' +
          'Rank the given HTS candidates by how precisely they match the user query. ' +
          'Apply these rules in order: ' +
          '(1) MATERIAL — composition must match (cotton≠synthetic, steel≠aluminum, plastic≠rubber). ' +
          '(2) SPECIES/VARIETY — for food, animals, plants: prefer the specific species over generic (Atlantic salmon > fish > nesoi). ' +
          '(3) PROCESSING STATE — fresh≠frozen≠smoked≠dried≠canned. ' +
          '(4) FORM — fillet≠whole, cut≠uncut, powder≠liquid. ' +
          '(5) SPECIFICITY — always prefer the most specific matching code over "other", "nesoi", or "not elsewhere specified". ' +
          '(6) USE CASE — functional purpose and end use must match the query intent. ' +
          'Return only a JSON object with key "ranked" containing the array of indices.',
        text: { format: { type: 'json_object' } },
        // NOTE: do NOT set max_output_tokens for reasoning models (gpt-5-nano)
      });

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
}
