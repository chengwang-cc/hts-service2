import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface RerankCandidate {
  /** Unique identifier — htsNumber in our case */
  id: string;
  /**
   * Pre-built candidate text passed to the cross-encoder.
   * Recommended format: "HTSNUM | title | parent heading title | note excerpt (≤200 chars)"
   */
  text: string;
}

export interface RankedResult {
  id: string;
  /** Relevance score from cross-encoder sigmoid, 0..1 */
  score: number;
}

interface RerankResponse {
  results: RankedResult[];
  count: number;
  duration_ms: number;
}

/**
 * DGX Reranker Service
 *
 * Stub that will call the cross-encoder reranker once it is trained and
 * deployed on the DGX Spark machine (Phase 4).
 *
 * Until then, isEnabled returns false and the SearchService falls back to
 * its existing hand-tuned scoring logic.
 */
@Injectable()
export class DgxRerankerService {
  private readonly log = new Logger(DgxRerankerService.name);
  private readonly enabled: boolean;
  private readonly rerankPath: string;
  private readonly maxCandidates: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.enabled =
      config.get<string>('DGX_RERANKER_ENABLED', 'false') === 'true';
    this.rerankPath = config.get<string>('DGX_RERANK_PATH', '/rerank');
    this.maxCandidates = config.get<number>('DGX_RERANKER_MAX_CANDIDATES', 150);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get maxCandidatesCount(): number {
    return this.maxCandidates;
  }

  /**
   * Rerank candidates using the DGX cross-encoder.
   * Returns results sorted by score descending.
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
  ): Promise<RankedResult[]> {
    const capped = candidates.slice(0, this.maxCandidates);
    const t0 = Date.now();

    const { data } = await firstValueFrom(
      this.http.post<RerankResponse>(this.rerankPath, {
        query,
        candidates: capped,
      }),
    );

    this.log.log(
      `DGX rerank: ${capped.length} candidates in ${Date.now() - t0}ms (service: ${data.duration_ms.toFixed(0)}ms)`,
    );

    return data.results.sort((a, b) => b.score - a.score);
  }

  async checkHealth(): Promise<{ status: string; model_loaded: boolean }> {
    const { data } = await firstValueFrom(
      this.http.get<{ status: string; model_loaded: boolean }>('/rerank/health'),
    );
    return data;
  }
}
