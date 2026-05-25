import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface AiRateRequest {
  htsCode: string;
  country: string;
  inputs?: Record<string, number>;
}

export interface AiRateRow {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string;
  blocked?: boolean;
  block_reason?: string | null;
  message?: string;
  rate?: number;
  /** ai-service rate label, e.g. "16.5%" or "41.7¢/kg + 0.9%" */
  tariffRate?: string;
  /** Special Programs Indicators in the HTS Special column (e.g. "S", "P", "MX") */
  special?: string[];
  formulas?: Array<{
    tariffType?: string;
    tariffTypeDescription?: string;
    formula?: string;
    formulaVariables?: Array<Record<string, any>>;
    chapter99HtsCode?: string | null;
    amount?: number;
  }>;
  exclusiveSection301?: boolean;
  /**
   * True when the HTS code is eligible for CUSMA / USMCA free-trade
   * treatment. ai-service ships this on the `/v2/tariff/{formulas,rates}`
   * response (feat/special-api-for-hts-calculator). When absent, treat as
   * "unknown" (undefined) rather than `false`.
   */
  isCusmaFreeTrade?: boolean;
}

export interface AiFormulaRequest {
  htsCode: string;
  country: string;
}

export interface AiFormulaRow {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string | null;
  blocked?: boolean;
  block_reason?: string | null;
  message?: string;
  formulas?: Array<{
    tariffType?: string;
    tariffTypeDescription?: string;
    formula?: string;
    formulaVariables?: Array<Record<string, any>>;
    chapter99HtsCode?: string | null;
  }>;
  exclusiveSection301?: boolean;
  /** See AiRateRow.isCusmaFreeTrade — same field, parallel endpoint. */
  isCusmaFreeTrade?: boolean;
}

/**
 * AiServiceProxyService
 *
 * Thin HTTP client over the legacy ai-service v2 tariff endpoints. Used
 * by the v1 public calculator controller to honour the "hts-web2 ↔ v1 ↔
 * ai-service" contract.
 *
 * - Treats upstream 401/403/429 as 502 so a misconfigured API key on
 *   ai-service doesn't leak to clients.
 * - 30-second default timeout.
 * - No retry — failures are propagated for callers to handle.
 *
 * Env vars (either name works — AI_SERVICE_* is the new canonical name;
 * TARIFF_FORMULAS_* is the historical name still in the prod .env file):
 *   AI_SERVICE_URL          | TARIFF_FORMULAS_API_URL
 *   AI_SERVICE_API_KEY      | TARIFF_FORMULAS_API_KEY
 *   AI_SERVICE_TIMEOUT_MS   (optional, default 30000)
 */
@Injectable()
export class AiServiceProxyService {
  private readonly logger = new Logger(AiServiceProxyService.name);
  private readonly client: AxiosInstance;
  private readonly baseURL: string;

  constructor(private readonly config: ConfigService) {
    this.baseURL =
      this.config.get<string>('AI_SERVICE_URL') ||
      this.config.get<string>('TARIFF_FORMULAS_API_URL') ||
      'https://staging.api.report.chitchats.com/v2/tariff';

    const apiKey =
      this.config.get<string>('AI_SERVICE_API_KEY') ||
      this.config.get<string>('TARIFF_FORMULAS_API_KEY');

    const timeout = Number(
      this.config.get<string>('AI_SERVICE_TIMEOUT_MS') || 30000,
    );

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    this.logger.log(
      `AiServiceProxy initialized — baseURL=${this.baseURL} hasApiKey=${!!apiKey}`,
    );
  }

  async getRates(rows: AiRateRequest[]): Promise<AiRateRow[]> {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return this.callOrThrow<AiRateRow[]>('/rates', rows);
  }

  async getFormulas(rows: AiFormulaRequest[]): Promise<AiFormulaRow[]> {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    // ai-service emits `isCusmaFreeTrade` (and any other CUSMA-related
    // enrichment) ONLY on the X-API-Key-gated `/hts-formulas` endpoint —
    // the unauthenticated `/formulas` path returns the bare formulas
    // without it. Both endpoints accept the same body shape; the key is
    // injected by the axios client when AI_SERVICE_API_KEY is set.
    return this.callOrThrow<AiFormulaRow[]>('/hts-formulas', rows);
  }

  /** Public helper for ops/health checks. */
  describeUpstream(): { baseURL: string } {
    return { baseURL: this.baseURL };
  }

  private async callOrThrow<T>(path: string, body: unknown): Promise<T> {
    try {
      const res = await this.client.post<T>(path, body);
      return res.data;
    } catch (err: any) {
      const upstreamStatus: number | undefined = err?.response?.status;
      const safeStatus = this.safeStatus(upstreamStatus);
      this.logger.warn(
        `ai-service ${path} failed: upstreamStatus=${upstreamStatus ?? 'n/a'} ` +
          `msg=${err?.message}`,
      );
      throw new HttpException(
        {
          statusCode: safeStatus,
          code: 'AI_SERVICE_UPSTREAM_FAILURE',
          message: 'Upstream tariff service unavailable',
        },
        safeStatus,
      );
    }
  }

  private safeStatus(status?: number): number {
    if (!status) return HttpStatus.BAD_GATEWAY;
    // Hide upstream auth/quota issues — never leak that the relay key was
    // rejected. Anything else (404, 422, 5xx) passes through directly.
    if (status === 401 || status === 403 || status === 429) {
      return HttpStatus.BAD_GATEWAY;
    }
    if (status >= 400 && status < 600) return status;
    return HttpStatus.BAD_GATEWAY;
  }
}
