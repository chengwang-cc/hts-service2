import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LandedCostService } from '../../landed-cost/services/landed-cost.service';
import {
  BrokerEntryEntity,
  BrokerEntryLineEntity,
} from '../entities';

export interface DutyEstimateResult {
  estimatedAt: string;
  totalDuty: number | null;
  lines: Array<{
    lineId: string;
    estimatedDuty: number | null;
    assumptions: string[];
    warnings: string[];
    citations: Array<Record<string, unknown>>;
    error?: string;
  }>;
}

/**
 * R2-A-01 — bridges BrokerEntry lines into the existing LandedCostService.
 * For each line that has an HTS number, country of origin, and a value,
 * we synthesise a single-line landed-cost quote so the workbench can show
 * a duty estimate plus the underlying assumptions ("incomplete code
 * fallback used", "tariff history snapshot Q3 2026", etc.) on the line.
 *
 * Lines without enough data to estimate are returned with `estimatedDuty=null`
 * and a warning, never crashing the batch.
 */
@Injectable()
export class BrokerDutyEstimatorService {
  private readonly logger = new Logger(BrokerDutyEstimatorService.name);

  constructor(
    @InjectRepository(BrokerEntryEntity)
    private readonly entries: Repository<BrokerEntryEntity>,
    @InjectRepository(BrokerEntryLineEntity)
    private readonly lines: Repository<BrokerEntryLineEntity>,
    @Optional() private readonly landedCost: LandedCostService | null,
  ) {
    if (!landedCost) {
      this.logger.warn(
        'BrokerDutyEstimatorService booted without LandedCostService — estimateForEntry will no-op',
      );
    }
  }

  async estimateForEntry(entry: BrokerEntryEntity): Promise<DutyEstimateResult> {
    const lines = await this.lines.find({ where: { entryId: entry.id } });
    const out: DutyEstimateResult['lines'] = [];
    let totalDuty: number | null = null;

    for (const line of lines) {
      const result = await this.estimateLine(entry, line).catch((err) => {
        this.logger.warn(
          `Duty estimate failed for line ${line.id}: ${(err as Error).message}`,
        );
        return {
          lineId: line.id,
          estimatedDuty: null,
          assumptions: [],
          warnings: [(err as Error).message],
          citations: [],
          error: (err as Error).message,
        };
      });
      out.push(result);
      if (result.estimatedDuty != null) {
        totalDuty = (totalDuty ?? 0) + result.estimatedDuty;
      }
      await this.persistLineResult(line, result);
    }

    if (totalDuty != null) {
      entry.totalDuty = totalDuty.toFixed(4);
      await this.entries.save(entry);
    }
    return {
      estimatedAt: new Date().toISOString(),
      totalDuty,
      lines: out,
    };
  }

  private async estimateLine(
    entry: BrokerEntryEntity,
    line: BrokerEntryLineEntity,
  ): Promise<DutyEstimateResult['lines'][number]> {
    const missing: string[] = [];
    if (!line.htsNumber) missing.push('htsNumber');
    if (!line.countryOfOrigin) missing.push('countryOfOrigin');
    if (!line.unitValue && !line.totalValue) missing.push('value');
    if (missing.length || !this.landedCost) {
      return {
        lineId: line.id,
        estimatedDuty: null,
        assumptions: [],
        warnings: missing.length
          ? [`Missing required field(s): ${missing.join(', ')}`]
          : ['LandedCostService not configured'],
        citations: [],
      };
    }

    const unitValue = Number(line.unitValue ?? 0);
    const quantity = Number(line.quantity ?? 1);
    const totalValue =
      Number(line.totalValue) || (unitValue > 0 ? unitValue * quantity : 0);
    if (!Number.isFinite(totalValue) || totalValue <= 0) {
      return {
        lineId: line.id,
        estimatedDuty: null,
        assumptions: [],
        warnings: ['Total value is zero or not numeric'],
        citations: [],
      };
    }

    const currency = line.currency ?? entry.currency ?? 'USD';
    const quote = await this.landedCost.createQuote({
      organizationId: entry.brokerOrganizationId,
      request: {
        destination: { country: 'US' },
        origin: { country: line.countryOfOrigin! },
        currency,
        lines: [
          {
            sku: line.sku ?? undefined,
            description: line.description ?? 'Broker entry line',
            quantity: Math.max(quantity, 1),
            unitPrice: {
              amount: unitValue || totalValue / Math.max(quantity, 1),
              currency,
            },
            htsCode: line.htsNumber!,
          },
        ],
        seller: { type: 'business' } as any,
        buyer: { type: 'business' } as any,
      } as any,
    });

    const quoteLine = quote.lines?.[0];
    if (!quoteLine) {
      return {
        lineId: line.id,
        estimatedDuty: null,
        assumptions: quote.assumptions ?? [],
        warnings: ['LandedCostService returned no line result'],
        citations: [],
      };
    }
    const dutyAmount = quoteLine.duties.reduce(
      (sum, d) => sum + (Number(d.amount) || 0),
      0,
    );
    return {
      lineId: line.id,
      estimatedDuty: round(dutyAmount, 4),
      assumptions: quote.assumptions ?? [],
      warnings: quoteLine.warnings ?? [],
      citations: quoteLine.sourceCitations ?? [],
    };
  }

  private async persistLineResult(
    line: BrokerEntryLineEntity,
    result: DutyEstimateResult['lines'][number],
  ) {
    line.estimatedDuty =
      result.estimatedDuty != null ? result.estimatedDuty.toFixed(4) : null;
    line.metadata = {
      ...(line.metadata ?? {}),
      dutyEstimate: {
        estimatedAt: new Date().toISOString(),
        assumptions: result.assumptions,
        warnings: result.warnings,
        citations: result.citations,
        error: result.error ?? null,
      },
    };
    await this.lines.save(line);
  }
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}
