import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { CalculationService, FormulaEvaluationService } from '../services';
import { CalculateDto } from '../dto';
import { CalculationScenarioEntity } from '../entities';
import { Public } from '../../auth/decorators/public.decorator';

interface ExternalFormulaVariable {
  name: string;
  unit: string;
  type: string;
  description: string;
}

interface ExternalFormula {
  tariffType: string;
  tariffTypeDescription: string;
  /**
   * Plain-language explanation of the tariff type (e.g. "Section 301
   * tariffs on Chinese-origin products are applied through HTS Chapter 99
   * amendments."). Emitted by ai-service for non-base formulas; surfaced
   * in the calculator UI as a tooltip on the breakdown row.
   */
  tariffTypeExplanation?: string;
  formula: string;
  formulaVariables?: ExternalFormulaVariable[];
  chapter99HtsCode?: string;
  amount?: number;
}

interface ExternalTariffResult {
  htsCode: string;
  country: string;
  effectiveHtsCode?: string;
  message: string;
  blocked: boolean;
  block_reason: string | null;
  exclusiveSection301?: boolean;
  /**
   * True when the HTS code is eligible for CUSMA / USMCA preferential
   * treatment. Only emitted by ai-service's X-API-Key-gated
   * /v2/tariff/hts-formulas endpoint (not the public /formulas one).
   */
  isCusmaFreeTrade?: boolean | null;
  formulas: ExternalFormula[];
}

@Controller('calculator')
export class CalculatorController {
  constructor(
    private readonly calculationService: CalculationService,
    private readonly formulaEvaluation: FormulaEvaluationService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(CalculationScenarioEntity)
    private readonly scenarioRepository: Repository<CalculationScenarioEntity>,
  ) {}

  /**
   * Anonymous calculate. Proxies ai-service POST /v2/tariff/rates and
   * returns the single-row response verbatim so the hts-web2 calculator UI
   * (which expects the raw ai-service shape: { htsCode, country, formulas[],
   * rate, block_reason, isCusmaFreeTrade, … }) can render correctly.
   *
   * Anonymous traffic from hts-web2 doesn't persist by design — we don't
   * attribute anonymous calls to any organization.
   *
   * POST /calculator/calculate
   */
  @Public()
  @Post('calculate')
  async calculate(@Body() calculateDto: CalculateDto): Promise<unknown> {
    // Use /hts-formulas (not /rates) because hts-web2 needs the
    // tariffTypeExplanation + isCusmaFreeTrade fields that only
    // /hts-formulas emits. The frontend evaluates per-formula `amount`
    // locally via its sandboxed evaluator, so we don't need the
    // pre-evaluated amounts that /rates would supply.
    const aiRequest = this.toAiRateRequest(calculateDto);
    const [item] = await this.fetchFormulasFromAiService([
      { htsCode: aiRequest.htsCode, country: aiRequest.country },
    ]);
    if (!item) {
      throw new HttpException(
        'Upstream tariff service returned no rows',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      htsCode: item.htsCode ?? aiRequest.htsCode,
      country: item.country ?? aiRequest.country,
      effectiveHtsCode: item.effectiveHtsCode ?? null,
      blocked: !!item.blocked,
      // Emit both casings so callers don't have to guess which form is
      // canonical. ai-service uses block_reason (snake) natively.
      block_reason: item.block_reason ?? null,
      blockReason: item.block_reason ?? null,
      message: item.message ?? '',
      exclusiveSection301: item.exclusiveSection301 ?? false,
      // Forwarded from /hts-formulas; drives the CUSMA Free Trade row.
      isCusmaFreeTrade: item.isCusmaFreeTrade ?? null,
      // Pass through the formulas[] so the FE can render its own
      // per-tariff breakdown — same shape /formula returns. The FE
      // evaluates each formula client-side against `inputs` to get the
      // per-row amount, then sums for the total.
      formulas: (item.formulas ?? []).map((f) => ({
        tariffType: f.tariffType,
        tariffTypeDescription: f.tariffTypeDescription,
        tariffTypeExplanation: f.tariffTypeExplanation ?? null,
        formula: f.formula,
        formulaVariables: f.formulaVariables ?? [],
        chapter99HtsCode: f.chapter99HtsCode ?? null,
      })),
      // Echo back the resolved inputs so callers can see exactly what
      // values fed the formula evaluation (helpful for debugging).
      inputs: aiRequest.inputs,
    };
  }

  /**
   * Convert the hts-web2 CalculateDto into the ai-service /v2/tariff/rates
   * per-row request. `value` / `weight` / `quantity` are the canonical
   * variable names; anything else hts-web2 sends via additionalInputs (e.g.
   * aluminum_value / steel_value for metal-tariff formulas) rides through
   * as-is so the formula evaluator picks it up in scope.
   */
  private toAiRateRequest(dto: CalculateDto): {
    htsCode: string;
    country: string;
    inputs: Record<string, number>;
  } {
    const inputs: Record<string, number> = {};
    if (typeof dto.declaredValue === 'number' && Number.isFinite(dto.declaredValue)) {
      inputs.value = dto.declaredValue;
    }
    if (typeof dto.weightKg === 'number' && Number.isFinite(dto.weightKg)) {
      inputs.weight = dto.weightKg;
    }
    if (typeof dto.quantity === 'number' && Number.isFinite(dto.quantity)) {
      inputs.quantity = dto.quantity;
    }
    if (dto.additionalInputs && typeof dto.additionalInputs === 'object') {
      for (const [k, v] of Object.entries(dto.additionalInputs)) {
        if (typeof v === 'number' && Number.isFinite(v)) inputs[k] = v;
      }
    }
    return {
      htsCode: dto.htsNumber,
      country: (dto.countryOfOrigin ?? '').toUpperCase(),
      inputs,
    };
  }

  /**
   * Fetch tariff formula metadata (variables + descriptions) for a single
   * HTS code / country pair, without evaluating. Used by the calculator UI
   * to render a form whose inputs match what the formula actually needs.
   *
   * GET /calculator/formula?htsCode=&country=
   *
   * Proxies ai-service POST /v2/tariff/formulas — ai-service is the single
   * source of truth for formulas and calculation.
   */
  @Public()
  @Get('formula')
  async getFormula(
    @Query('htsCode') htsCode: string,
    @Query('country') country: string,
  ): Promise<unknown> {
    if (!htsCode || !country) {
      throw new HttpException(
        'htsCode and country are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const [item] = await this.fetchFormulasFromAiService([{ htsCode, country }]);
    if (!item) {
      throw new HttpException(
        'No formula returned by upstream',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return {
      htsCode: item.htsCode ?? htsCode,
      country: item.country ?? country,
      effectiveHtsCode: item.effectiveHtsCode ?? null,
      blocked: !!item.blocked,
      // Emit both casings so callers don't have to guess. ai-service uses
      // block_reason (snake) natively; the camelCase alias stays for
      // back-compat with existing hts-web2 builds.
      block_reason: item.block_reason ?? null,
      blockReason: item.block_reason ?? null,
      message: item.message ?? '',
      exclusiveSection301: item.exclusiveSection301 ?? false,
      // Forwarded from /hts-formulas; drives the CUSMA Free Trade badge
      // + results row in the calculator UI.
      isCusmaFreeTrade: item.isCusmaFreeTrade ?? null,
      formulas: (item.formulas ?? []).map((f) => ({
        tariffType: f.tariffType,
        tariffTypeDescription: f.tariffTypeDescription,
        // Per-formula human-readable explanation — shown as a tooltip on
        // the breakdown row in the calculator UI.
        tariffTypeExplanation: f.tariffTypeExplanation ?? null,
        formula: f.formula,
        formulaVariables: f.formulaVariables ?? [],
        chapter99HtsCode: f.chapter99HtsCode ?? null,
      })),
    };
  }

  private aiServiceUrl(): string {
    return (
      this.configService.get<string>('AI_SERVICE_URL') ??
      this.configService.get<string>(
        'TARIFF_FORMULAS_API_URL',
        'http://localhost:3001/v2/tariff',
      )
    );
  }

  private aiServiceHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Accept either env var name. Prod secrets use TARIFF_FORMULAS_API_KEY
    // (see hts/app-secrets in Secrets Manager); some local envs use the
    // older AI_SERVICE_API_KEY. Either resolves /hts-formulas auth.
    const apiKey =
      this.configService.get<string>('AI_SERVICE_API_KEY') ||
      this.configService.get<string>('TARIFF_FORMULAS_API_KEY') ||
      '';
    if (apiKey) headers['X-API-Key'] = apiKey;
    return headers;
  }

  private async fetchFormulasFromAiService(
    requests: Array<{ htsCode: string; country: string }>,
  ): Promise<ExternalTariffResult[]> {
    if (!requests.length) return [];
    try {
      // Use /hts-formulas (X-API-Key gated) rather than the public
      // /formulas endpoint — only /hts-formulas emits isCusmaFreeTrade
      // and the per-formula tariffTypeExplanation.
      const response = await firstValueFrom(
        this.httpService.post<ExternalTariffResult[]>(
          `${this.aiServiceUrl()}/hts-formulas`,
          requests,
          { headers: this.aiServiceHeaders() },
        ),
      );
      return response.data ?? [];
    } catch (err: unknown) {
      throw this.translateUpstreamError(err);
    }
  }

  private translateUpstreamError(err: unknown): HttpException {
    const status =
      (err as { response?: { status?: number } })?.response?.status ??
      HttpStatus.BAD_GATEWAY;
    // Treat upstream auth/quota failures as 502 to avoid leaking key state.
    const safeStatus =
      status === 401 || status === 403 || status === 429
        ? HttpStatus.BAD_GATEWAY
        : status >= 400 && status < 600
          ? status
          : HttpStatus.BAD_GATEWAY;
    return new HttpException(
      'Tariff formulas service request failed',
      safeStatus,
    );
  }
}
