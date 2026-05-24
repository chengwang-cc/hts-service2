import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface GbCommodityResponse {
  id: string;
  code: string;
  description: string;
  formattedDescription?: string;
  importMeasures: Array<{
    measureTypeId: string;
    measureTypeDescription: string;
    dutyExpressionAbbreviation?: string;
    dutyExpressionFormattedBase?: string;
    dutyExpressionFormatted?: string;
    geographicalAreaId?: string;
    additionalCode?: string | null;
    conditions?: Array<{
      measureConditionCode: string;
      action: string;
      condition: string;
      certificate?: { code: string; description: string } | null;
    }>;
    effectiveStartDate?: string;
    effectiveEndDate?: string;
  }>;
  raw?: any;
}

/**
 * GbTradeTariffIngestionService (P5.1)
 *
 * Thin client over the official GOV.UK Trade Tariff API
 * (https://www.trade-tariff.service.gov.uk/uk/api). Returns the raw
 * commodity / measure data for further normalization by
 * GbMeasureNormalizerService.
 *
 * The service is intentionally read-only and idempotent. Persisting
 * snapshots to S3 / tariff_snapshots is the responsibility of the
 * (future) GB ingestion job — this class is what that job calls.
 */
@Injectable()
export class GbTradeTariffIngestionService {
  private readonly logger = new Logger(GbTradeTariffIngestionService.name);
  private readonly baseUrl =
    process.env.GB_TRADE_TARIFF_API_URL ||
    'https://www.trade-tariff.service.gov.uk/uk/api/v2';
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      timeout: 30000,
      headers: {
        Accept: 'application/vnd.api+json',
        'User-Agent': 'hts-service/0.0.1 (+https://api.usahts.com)',
      },
    });
  }

  /**
   * Fetch a commodity by 10-digit GB code. Includes inline measures.
   */
  async fetchCommodity(code10: string): Promise<GbCommodityResponse | null> {
    const code = (code10 || '').replace(/\D/g, '');
    if (code.length < 8) {
      throw new Error('GB commodity code must be at least 8 digits');
    }
    const url = `${this.baseUrl}/commodities/${code.padEnd(10, '0').slice(0, 10)}`;
    try {
      const res = await this.axios.get<any>(url);
      if (res.status !== 200) return null;
      return this.normalizeCommodity(res.data);
    } catch (e: any) {
      this.logger.warn(
        `GB tariff fetch failed for ${code}: ${e?.message ?? e}`,
      );
      return null;
    }
  }

  async fetchSection(sectionId: number): Promise<any> {
    const res = await this.axios.get(`${this.baseUrl}/sections/${sectionId}`);
    return res.data;
  }

  async fetchHeadings(chapterId: string): Promise<any> {
    const res = await this.axios.get(`${this.baseUrl}/chapters/${chapterId}`);
    return res.data;
  }

  /**
   * Convert the JSON:API envelope returned by GOV.UK Trade Tariff into
   * the flatter GbCommodityResponse shape callers want.
   */
  private normalizeCommodity(payload: any): GbCommodityResponse {
    const data = payload?.data ?? {};
    const attrs = data?.attributes ?? {};
    const included = Array.isArray(payload?.included) ? payload.included : [];

    const measureRelationships =
      data?.relationships?.import_measures?.data ?? [];
    const measureIds: string[] = measureRelationships.map((m: any) =>
      String(m?.id || ''),
    );

    const measures = included
      .filter(
        (it: any) => it?.type === 'measure' && measureIds.includes(String(it.id)),
      )
      .map((m: any) => {
        const a = m.attributes ?? {};
        return {
          measureTypeId: a.measure_type_id || a.measureTypeId || '',
          measureTypeDescription:
            a.measure_type_description || a.import_measure_type_description || '',
          dutyExpressionAbbreviation: a.duty_expression_abbreviation || undefined,
          dutyExpressionFormattedBase:
            a.duty_expression_formatted_base || a.duty_expression || undefined,
          dutyExpressionFormatted: a.duty_expression_formatted || undefined,
          geographicalAreaId: a.geographical_area_id || a.geographicalAreaId,
          additionalCode: a.additional_code_id || null,
          conditions: a.conditions || [],
          effectiveStartDate: a.effective_start_date || a.effectiveStartDate,
          effectiveEndDate: a.effective_end_date || a.effectiveEndDate,
        };
      });

    return {
      id: data?.id || '',
      code: attrs.goods_nomenclature_item_id || attrs.code || '',
      description: attrs.description || '',
      formattedDescription: attrs.formatted_description,
      importMeasures: measures,
      raw: payload,
    };
  }
}
