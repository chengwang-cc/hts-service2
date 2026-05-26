import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationHistoryEntity } from '@hts/core';
import { ApiKeyEntity } from '../../api-keys/entities/api-key.entity';

/**
 * CalculationHistoryService — shared across v1 (ai-service proxy) and v2
 * (native hts-service) public calculator controllers.
 *
 * - `write()` persists the canonical row after any successful calculation,
 *   regardless of which engine produced it. The `source` field
 *   distinguishes (`ai_service_proxy_v1` vs `hts_native_v2`).
 * - `findOneForKey()` / `listForKey()` enforce per-API-key org scoping so a
 *   key cannot read another org's history.
 */
@Injectable()
export class CalculationHistoryService {
  private readonly logger = new Logger(CalculationHistoryService.name);

  constructor(
    @InjectRepository(CalculationHistoryEntity)
    private readonly repo: Repository<CalculationHistoryEntity>,
  ) {}

  async write(args: {
    /** API-key caller (public path). When omitted, `organizationId` + `userId` must be supplied. */
    apiKey?: ApiKeyEntity;
    /** JWT-path caller context (browser / app routes). */
    organizationId?: string;
    userId?: string | null;
    input: Record<string, any>;
    result: Record<string, any>;
    source: 'ai_service_proxy_v1' | 'hts_native_v2' | 'hts_native_v2_quote';
    /**
     * Phase F1 audit snapshot from CalculatorV2AuditService. Optional —
     * v1 callers don't produce one; v2 quote callers always do.
     */
    audit?: Record<string, unknown> | null;
  }): Promise<CalculationHistoryEntity> {
    const calculationId =
      args.result?.calculationId ||
      args.result?.quoteId ||
      args.result?.id ||
      this.generateCalculationId();

    const organizationId =
      args.organizationId ?? args.apiKey?.organizationId ?? null;
    if (!organizationId) {
      // No tenant scope — silently skip. CalculationHistory is per-org;
      // a write without an org would be unreadable later.
      this.logger.debug(
        `CalculationHistory write skipped (${args.source}): no organizationId`,
      );
      return null as unknown as CalculationHistoryEntity;
    }

    const row = this.repo.create({
      calculationId,
      organizationId,
      userId: args.userId ?? null,
      scenarioId: null,
      inputs: args.input,
      baseDuty: this.coerceNumber(
        args.result?.baseDuty ?? args.result?.totals?.baseDuty,
      ),
      additionalTariffs: this.coerceNumber(
        args.result?.additionalTariffs ?? args.result?.totals?.additionalTariffs,
      ),
      totalTaxes: this.coerceNumber(
        args.result?.totalTaxes ?? args.result?.totals?.taxes,
      ),
      totalDuty: this.coerceNumber(
        args.result?.totalDuty ?? args.result?.totals?.totalCustomsDuty ?? args.result?.totals?.totalDuty,
      ),
      landedCost: this.coerceNumber(
        args.result?.landedCost ?? args.result?.totals?.landedCost,
      ),
      breakdown: args.result?.breakdown ?? null,
      tradeAgreementInfo: args.result?.tradeAgreementInfo ?? null,
      complianceWarnings: args.result?.warnings ?? null,
      htsVersion: args.input?.htsVersion ?? null,
      ruleVersion: null,
      engineVersion: args.source,
      formulaUsed: args.result?.formulaUsed ?? null,
      audit: args.audit ?? null,
    });

    try {
      return await this.repo.save(row);
    } catch (e: any) {
      this.logger.warn(
        `CalculationHistory write failed (${args.source}): ${e?.message}`,
      );
      // History is audit-only; never block the request on a write failure.
      return row;
    }
  }

  async findOneForKey(
    calculationId: string,
    apiKey: ApiKeyEntity,
  ): Promise<CalculationHistoryEntity> {
    const row = await this.repo.findOne({
      where: {
        calculationId,
        organizationId: apiKey.organizationId,
      },
    });
    if (!row) {
      throw new NotFoundException(`Calculation ${calculationId} not found`);
    }
    return row;
  }

  async listForKey(
    apiKey: ApiKeyEntity,
    limit: number,
  ): Promise<CalculationHistoryEntity[]> {
    const max = Math.min(Math.max(1, Number(limit) || 10), 200);
    return this.repo.find({
      where: { organizationId: apiKey.organizationId },
      order: { createdAt: 'DESC' },
      take: max,
    });
  }

  private generateCalculationId(): string {
    const t = Date.now();
    const r = Math.random().toString(36).slice(2, 8);
    return `CALC-${t}-${r}`.toUpperCase();
  }

  private coerceNumber(v: any): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
