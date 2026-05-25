import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import {
  TariffKnowledgeCardEntity,
  TariffRateBatchService,
} from '@hts/calculator';
import { ExternalProviderQuoteEntity } from '../entities/external-provider-quote.entity';
import { EvidenceReconciliationService } from './evidence-reconciliation.service';

type JsonObject = Record<string, unknown>;

export interface RecordExternalProviderQuoteInput {
  provider: string;
  htsNumber: string;
  originCountry: string;
  destinationCountry?: string;
  declaredValue: number;
  currency?: string;
  entryDate?: string | null;
  query?: JsonObject;
  providerTotalDuty?: number | null;
  providerComponents?: JsonObject[] | null;
  localTotalDuty?: number | null;
  localComponents?: JsonObject[] | null;
  rawResponseUri?: string | null;
  rawResponse?: JsonObject | null;
  metadata?: JsonObject | null;
}

export interface ExternalProviderOracleConfig {
  provider: string;
  endpointUrl: string;
  enabled?: boolean;
  termsAccepted: boolean;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  responseTotalPath?: string;
  responseComponentsPath?: string;
}

export interface RunExternalProviderOracleOptions {
  providers?: ExternalProviderOracleConfig[];
  limit?: number;
  declaredValue?: number;
  currency?: string;
  countries?: string[];
  entryDate?: string;
  dryRun?: boolean;
}

export interface RunExternalProviderOracleResult {
  sampledCards: number;
  providerRequests: number;
  quotesRecorded: number;
  skippedProviders: string[];
}

@Injectable()
export class ExternalProviderQuoteService {
  constructor(
    @InjectRepository(ExternalProviderQuoteEntity)
    private readonly quoteRepo: Repository<ExternalProviderQuoteEntity>,
    @InjectRepository(TariffKnowledgeCardEntity)
    private readonly cardRepo: Repository<TariffKnowledgeCardEntity>,
    private readonly tariffRateBatch: TariffRateBatchService,
    private readonly reconciliation: EvidenceReconciliationService,
  ) {}

  async recordQuote(
    input: RecordExternalProviderQuoteInput,
  ): Promise<ExternalProviderQuoteEntity> {
    const normalizedQuery = {
      htsNumber: input.htsNumber,
      originCountry: input.originCountry.toUpperCase(),
      destinationCountry: (input.destinationCountry || 'US').toUpperCase(),
      declaredValue: input.declaredValue,
      currency: (input.currency || 'USD').toUpperCase(),
      entryDate: input.entryDate || null,
      ...(input.query || {}),
    };
    const queryHash = createHash('sha256')
      .update(JSON.stringify({ provider: input.provider, normalizedQuery }))
      .digest('hex');
    const delta =
      typeof input.providerTotalDuty === 'number' &&
      typeof input.localTotalDuty === 'number'
        ? input.localTotalDuty - input.providerTotalDuty
        : null;
    const componentComparison = this.compareComponents(
      input.providerComponents || [],
      input.localComponents || [],
    );
    const agreementStatus =
      delta === null
        ? 'pending'
        : Math.abs(delta) <= 0.01 && componentComparison.mismatches.length === 0
          ? 'matched'
          : 'mismatched';

    const existing = await this.quoteRepo.findOne({ where: { queryHash } });
    const values = {
      provider: input.provider.toUpperCase(),
      queryHash,
      htsNumber: input.htsNumber,
      originCountry: input.originCountry.toUpperCase(),
      destinationCountry: (input.destinationCountry || 'US').toUpperCase(),
      declaredValue: input.declaredValue,
      currency: (input.currency || 'USD').toUpperCase(),
      entryDate: input.entryDate || null,
      query: normalizedQuery,
      providerTotalDuty: input.providerTotalDuty ?? null,
      providerComponents: input.providerComponents || null,
      localTotalDuty: input.localTotalDuty ?? null,
      localComponents: input.localComponents || null,
      delta,
      agreementStatus,
      rawResponseUri: input.rawResponseUri || null,
      rawResponse: input.rawResponse || null,
      fetchedAt: new Date(),
      metadata: {
        ...(input.metadata || {}),
        componentComparison,
      },
    };

    const saved = await this.quoteRepo.save(
      existing ? { ...existing, ...values } : this.quoteRepo.create(values),
    );
    if (agreementStatus === 'mismatched') {
      await this.createReconciliationPacketForQuote(saved, componentComparison);
    }
    return saved;
  }

  async runOracleComparison(
    options: RunExternalProviderOracleOptions = {},
  ): Promise<RunExternalProviderOracleResult> {
    const providers = options.providers || this.loadProviderConfigFromEnv();
    const skippedProviders = providers
      .filter((provider) => !provider.enabled || !provider.termsAccepted)
      .map((provider) => provider.provider);
    const activeProviders = providers.filter(
      (provider) => provider.enabled && provider.termsAccepted,
    );
    if (activeProviders.length === 0) {
      return {
        sampledCards: 0,
        providerRequests: 0,
        quotesRecorded: 0,
        skippedProviders,
      };
    }

    const cards = await this.loadOracleSample({
      limit: options.limit ?? 25,
      countries: options.countries || ['CN', 'DE', 'CA', 'MX', 'KR'],
    });
    let providerRequests = 0;
    let quotesRecorded = 0;

    for (const card of cards) {
      const originCountry =
        card.countryCode === 'ALL' ? 'CN' : card.countryCode;
      const declaredValue = options.declaredValue ?? 1000;
      const [local] = await this.withCardPrimaryMode(() =>
        this.tariffRateBatch.batchCalculate([
          {
            htsCode: card.htsNumber,
            country: originCountry,
            entryDate: options.entryDate,
            inputs: { value: declaredValue },
          },
        ]),
      );

      for (const provider of activeProviders) {
        providerRequests++;
        const payload = {
          htsNumber: card.htsNumber,
          originCountry,
          destinationCountry: card.destinationCode,
          declaredValue,
          currency: options.currency || 'USD',
          entryDate: options.entryDate || null,
        };
        const rawResponse = await this.fetchProviderQuote(provider, payload);
        const providerTotalDuty = this.numberAtPath(
          rawResponse,
          provider.responseTotalPath || 'totalDuty',
        );
        const providerComponents = this.arrayAtPath(
          rawResponse,
          provider.responseComponentsPath || 'components',
        );

        if (!options.dryRun) {
          await this.recordQuote({
            provider: provider.provider,
            htsNumber: card.htsNumber,
            originCountry,
            destinationCountry: card.destinationCode,
            declaredValue,
            currency: options.currency || 'USD',
            entryDate: options.entryDate || null,
            query: payload,
            providerTotalDuty,
            providerComponents,
            localTotalDuty: local.blocked ? null : local.totalDuty,
            localComponents: local.breakdown,
            rawResponse,
            metadata: {
              source: 'external-provider-oracle',
              cardId: card.id,
              localBlocked: local.blocked,
              localBlockReason: local.blockReason,
              localRuntimeMode: 'card-primary',
            },
          });
          quotesRecorded++;
        }
      }
    }

    return {
      sampledCards: cards.length,
      providerRequests,
      quotesRecorded,
      skippedProviders,
    };
  }

  async providerAgreementSummary(): Promise<
    Array<{
      provider: string;
      chapter: string;
      originCountry: string;
      agreementStatus: string;
      count: number;
    }>
  > {
    const rows = await this.quoteRepo
      .createQueryBuilder('quote')
      .select('quote.provider', 'provider')
      .addSelect(
        "SUBSTRING(REGEXP_REPLACE(quote.htsNumber, '[^0-9]', '', 'g') FROM 1 FOR 2)",
        'chapter',
      )
      .addSelect('quote.originCountry', 'originCountry')
      .addSelect('quote.agreementStatus', 'agreementStatus')
      .addSelect('COUNT(*)', 'count')
      .groupBy('quote.provider')
      .addGroupBy(
        "SUBSTRING(REGEXP_REPLACE(quote.htsNumber, '[^0-9]', '', 'g') FROM 1 FOR 2)",
      )
      .addGroupBy('quote.originCountry')
      .addGroupBy('quote.agreementStatus')
      .orderBy('quote.provider', 'ASC')
      .getRawMany<{
        provider: string;
        chapter: string;
        originCountry: string;
        agreementStatus: string;
        count: string;
      }>();

    return rows.map((row) => ({
      provider: row.provider,
      chapter: row.chapter,
      originCountry: row.originCountry,
      agreementStatus: row.agreementStatus,
      count: Number(row.count),
    }));
  }

  private async loadOracleSample(args: {
    limit: number;
    countries: string[];
  }): Promise<TariffKnowledgeCardEntity[]> {
    return this.cardRepo
      .createQueryBuilder('card')
      .where('card.status IN (:...statuses)', {
        statuses: ['authoritative', 'provisional'],
      })
      .andWhere('card.destinationCode = :destinationCode', {
        destinationCode: 'US',
      })
      .andWhere('card.consensusFormula IS NOT NULL')
      .andWhere(
        '(card.countryCode IN (:...countries) OR card.countryCode = :all)',
        {
          countries: args.countries.map((country) => country.toUpperCase()),
          all: 'ALL',
        },
      )
      .orderBy('card.lastReviewedAt', 'ASC', 'NULLS FIRST')
      .addOrderBy('card.updatedAt', 'ASC')
      .limit(Math.min(Math.max(args.limit, 1), 250))
      .getMany();
  }

  private loadProviderConfigFromEnv(): ExternalProviderOracleConfig[] {
    const raw = process.env.EXTERNAL_PROVIDER_ORACLE_CONFIG_JSON;
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as ExternalProviderOracleConfig[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async fetchProviderQuote(
    provider: ExternalProviderOracleConfig,
    payload: JsonObject,
  ): Promise<JsonObject> {
    const method = provider.method || 'POST';
    const url =
      method === 'GET'
        ? this.withQuery(provider.endpointUrl, payload)
        : provider.endpointUrl;
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(provider.headers || {}),
      },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
    });
    if (!response.ok) {
      throw new Error(
        `Provider ${provider.provider} returned HTTP ${response.status}`,
      );
    }
    return (await response.json()) as JsonObject;
  }

  private withQuery(url: string, payload: JsonObject): string {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(payload)) {
      if (value === null || value === undefined) {
        continue;
      }
      parsed.searchParams.set(key, String(value));
    }
    return parsed.toString();
  }

  private valueAtPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }
      return (current as Record<string, unknown>)[segment];
    }, value);
  }

  private numberAtPath(value: unknown, path: string): number | null {
    const candidate = this.valueAtPath(value, path);
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private arrayAtPath(value: unknown, path: string): JsonObject[] | null {
    const candidate = this.valueAtPath(value, path);
    if (!Array.isArray(candidate)) {
      return null;
    }
    return candidate.filter(
      (item): item is JsonObject =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    );
  }

  private async withCardPrimaryMode<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.TARIFF_CARD_READ_MODE;
    process.env.TARIFF_CARD_READ_MODE = 'primary';
    try {
      return await fn();
    } finally {
      if (previous === undefined) {
        delete process.env.TARIFF_CARD_READ_MODE;
      } else {
        process.env.TARIFF_CARD_READ_MODE = previous;
      }
    }
  }

  private compareComponents(
    providerComponents: JsonObject[],
    localComponents: JsonObject[],
  ): { matched: number; mismatches: JsonObject[] } {
    const providerMap = this.componentAmountMap(providerComponents);
    const localMap = this.componentAmountMap(localComponents);
    const keys = Array.from(
      new Set([...providerMap.keys(), ...localMap.keys()]),
    ).sort();
    let matched = 0;
    const mismatches: JsonObject[] = [];
    for (const key of keys) {
      const providerAmount = providerMap.get(key);
      const localAmount = localMap.get(key);
      if (
        providerAmount !== undefined &&
        localAmount !== undefined &&
        Math.abs(providerAmount - localAmount) <= 0.01
      ) {
        matched++;
        continue;
      }
      mismatches.push({
        component: key,
        providerAmount: providerAmount ?? null,
        localAmount: localAmount ?? null,
        delta:
          providerAmount !== undefined && localAmount !== undefined
            ? localAmount - providerAmount
            : null,
      });
    }
    return { matched, mismatches };
  }

  private async createReconciliationPacketForQuote(
    quote: ExternalProviderQuoteEntity,
    componentComparison: { matched: number; mismatches: JsonObject[] },
  ): Promise<void> {
    try {
      await this.reconciliation.createPacketForScope({
        htsNumber: quote.htsNumber,
        countryCode: quote.originCountry,
        destinationCode: quote.destinationCountry,
        reason: 'external_provider_oracle_mismatch',
        metadata: {
          quoteId: quote.id,
          provider: quote.provider,
          delta: quote.delta,
          componentComparison,
        },
      });
    } catch {
      // Quote storage is the authoritative oracle event; packet creation is a
      // follow-up workflow and should not make provider ingestion fail.
    }
  }

  private componentAmountMap(components: JsonObject[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const component of components || []) {
      const key =
        this.stringValue(component.componentType) ||
        this.stringValue(component.tariffType) ||
        this.stringValue(component.type) ||
        'unknown';
      const amount =
        this.numberValue(component.amount) ??
        this.numberValue(component.total) ??
        this.numberValue(component.duty);
      if (amount === null) {
        continue;
      }
      out.set(key.toLowerCase(), (out.get(key.toLowerCase()) || 0) + amount);
    }
    return out;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
