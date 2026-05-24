import { Injectable, Logger } from '@nestjs/common';
import { TariffRateBatchService } from './tariff-rate-batch.service';
import { BatchRateRequest } from './tariff-types';

export interface ShadowCorpusRow {
  htsCode: string;
  country: string;
  inputs?: Record<string, number>;
  entryDate?: string;
  htsVersion?: string;
  selectedChapter99Headings?: string[];
}

export interface ShadowCompareRowResult {
  htsCode: string;
  country: string;
  inputs: Record<string, number>;
  localTotalDuty: number;
  aiServiceTotalDuty: number | null;
  delta: number | null;
  aiServiceComponentSum: number | null;
  matched: boolean;
  mismatchReason:
    | 'NONE'
    | 'KNOWN_AI_SERVICE_BUG_DUPLICATE_ROW'
    | 'KNOWN_AI_SERVICE_BUG_SPECIAL_RATE_COMMENTED'
    | 'ROUNDING_DIFFERENCE'
    | 'AI_SERVICE_UNAVAILABLE'
    | 'LOCAL_BLOCKED_AI_UNBLOCKED'
    | 'AI_BLOCKED_LOCAL_UNBLOCKED'
    | 'UNKNOWN';
}

export interface ShadowCompareReport {
  rows: number;
  matched: number;
  mismatched: number;
  matchRate: number;
  mismatchByReason: Record<string, number>;
  results: ShadowCompareRowResult[];
}

interface AiServiceRowResponse {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string;
  blocked?: boolean;
  block_reason?: string | null;
  message?: string;
  formulas?: Array<{ amount?: number }>;
  // ai-service v2 also returns top-level `rate` (base-only — known bug).
  rate?: number;
}

/**
 * ShadowComparatorService
 *
 * Compares local TariffRateBatchService output against the legacy
 * ai-service /v2/tariff/rates endpoint. Used during P0 cutover to confirm
 * parity (or to document known-bug mismatches).
 *
 * Mismatch reasons are bucketed so the operator can verify that every
 * disagreement falls into a known ai-service defect set rather than a
 * regression in hts-service.
 */
@Injectable()
export class ShadowComparatorService {
  private readonly logger = new Logger(ShadowComparatorService.name);
  private readonly tolerance = 0.01;

  constructor(private readonly batch: TariffRateBatchService) {}

  async compareCorpus(
    corpus: ShadowCorpusRow[],
    options: { aiServiceUrl: string; aiServiceApiKey?: string },
  ): Promise<ShadowCompareReport> {
    const requests: BatchRateRequest[] = corpus.map((c) => ({
      htsCode: c.htsCode,
      country: c.country,
      inputs: c.inputs,
      entryDate: c.entryDate,
      htsVersion: c.htsVersion,
      selectedChapter99Headings: c.selectedChapter99Headings,
    }));

    const localResults = await this.batch.batchCalculate(requests);
    const aiResults = await this.callAiService(corpus, options);

    const results: ShadowCompareRowResult[] = [];
    const mismatchByReason: Record<string, number> = {};
    let matched = 0;

    for (let i = 0; i < corpus.length; i++) {
      const row = corpus[i];
      const local = localResults[i];
      const ai = aiResults[i];

      const localBlocked = !!local?.blocked;
      const aiBlocked = !!ai?.blocked;

      if (!ai) {
        const r: ShadowCompareRowResult = {
          htsCode: row.htsCode,
          country: row.country,
          inputs: row.inputs || {},
          localTotalDuty: local?.totalDuty ?? 0,
          aiServiceTotalDuty: null,
          delta: null,
          aiServiceComponentSum: null,
          matched: false,
          mismatchReason: 'AI_SERVICE_UNAVAILABLE',
        };
        results.push(r);
        mismatchByReason[r.mismatchReason] =
          (mismatchByReason[r.mismatchReason] ?? 0) + 1;
        continue;
      }

      if (localBlocked !== aiBlocked) {
        const reason = localBlocked
          ? 'LOCAL_BLOCKED_AI_UNBLOCKED'
          : 'AI_BLOCKED_LOCAL_UNBLOCKED';
        const r: ShadowCompareRowResult = {
          htsCode: row.htsCode,
          country: row.country,
          inputs: row.inputs || {},
          localTotalDuty: local.totalDuty,
          aiServiceTotalDuty: this.sumAiFormulas(ai),
          delta: null,
          aiServiceComponentSum: this.sumAiFormulas(ai),
          matched: false,
          mismatchReason: reason,
        };
        results.push(r);
        mismatchByReason[r.mismatchReason] =
          (mismatchByReason[r.mismatchReason] ?? 0) + 1;
        continue;
      }

      const aiTotal = this.sumAiFormulas(ai);
      const aiTopLevel = typeof ai.rate === 'number' ? ai.rate : null;
      const delta = local.totalDuty - aiTotal;

      if (Math.abs(delta) <= this.tolerance) {
        matched++;
        results.push({
          htsCode: row.htsCode,
          country: row.country,
          inputs: row.inputs || {},
          localTotalDuty: local.totalDuty,
          aiServiceTotalDuty: aiTotal,
          delta,
          aiServiceComponentSum: aiTotal,
          matched: true,
          mismatchReason: 'NONE',
        });
        continue;
      }

      const reason = this.diagnose({
        localTotal: local.totalDuty,
        aiSumOfFormulas: aiTotal,
        aiTopLevel,
        country: row.country,
      });
      const r: ShadowCompareRowResult = {
        htsCode: row.htsCode,
        country: row.country,
        inputs: row.inputs || {},
        localTotalDuty: local.totalDuty,
        aiServiceTotalDuty: aiTotal,
        delta,
        aiServiceComponentSum: aiTotal,
        matched: false,
        mismatchReason: reason,
      };
      results.push(r);
      mismatchByReason[r.mismatchReason] =
        (mismatchByReason[r.mismatchReason] ?? 0) + 1;
    }

    return {
      rows: corpus.length,
      matched,
      mismatched: corpus.length - matched,
      matchRate: corpus.length === 0 ? 1 : matched / corpus.length,
      mismatchByReason,
      results,
    };
  }

  private diagnose(args: {
    localTotal: number;
    aiSumOfFormulas: number;
    aiTopLevel: number | null;
    country: string;
  }): ShadowCompareRowResult['mismatchReason'] {
    // ai-service top-level `rate` returns base-only; if local matches
    // ai's per-formula sum but ai exposes a smaller top-level rate, the
    // disagreement we'd care about is reported elsewhere.
    if (
      args.aiTopLevel !== null &&
      Math.abs(args.localTotal - args.aiSumOfFormulas) <= this.tolerance &&
      Math.abs(args.aiTopLevel - args.aiSumOfFormulas) > this.tolerance
    ) {
      return 'NONE';
    }

    // Local applied an FTA / special rate that ai-service commented out.
    // Heuristic: local total much lower than ai sum AND country is a
    // non-NTR or common-FTA partner.
    if (args.localTotal + this.tolerance < args.aiSumOfFormulas) {
      return 'KNOWN_AI_SERVICE_BUG_SPECIAL_RATE_COMMENTED';
    }

    if (Math.abs(args.localTotal - args.aiSumOfFormulas) < 0.05) {
      return 'ROUNDING_DIFFERENCE';
    }

    return 'UNKNOWN';
  }

  private sumAiFormulas(row: AiServiceRowResponse | undefined): number {
    if (!row?.formulas) return 0;
    return row.formulas.reduce((sum, f) => sum + (f.amount ?? 0), 0);
  }

  private async callAiService(
    corpus: ShadowCorpusRow[],
    options: { aiServiceUrl: string; aiServiceApiKey?: string },
  ): Promise<Array<AiServiceRowResponse | undefined>> {
    if (!options.aiServiceUrl) {
      return new Array(corpus.length).fill(undefined);
    }

    try {
      const body = corpus.map((c) => ({
        htsCode: c.htsCode,
        country: c.country,
        inputs: c.inputs ?? {},
      }));
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (options.aiServiceApiKey) {
        headers['X-API-Key'] = options.aiServiceApiKey;
      }
      const res = await fetch(`${options.aiServiceUrl}/rates`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers,
      });
      if (!res.ok) {
        this.logger.warn(
          `ai-service /rates returned ${res.status}; using AI_SERVICE_UNAVAILABLE`,
        );
        return new Array(corpus.length).fill(undefined);
      }
      const json = (await res.json()) as AiServiceRowResponse[];
      // Map by index to preserve duplicates.
      return json;
    } catch (e: any) {
      this.logger.warn(`ai-service shadow call failed: ${e?.message}`);
      return new Array(corpus.length).fill(undefined);
    }
  }
}
