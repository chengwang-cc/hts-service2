import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { CbamQuarterlySettlementEntity } from './entities/cbam-quarterly-settlement.entity';

/**
 * CbamQuarterlySettlementService.
 *
 * Persists CBAM provisional contributions per quote so the quarterly
 * report aggregates across replicas + survives restart. Falls back to
 * an in-memory map when the repository is unavailable (test seam).
 *
 * D7 fix (2026-05-27): promoted from in-memory-only to DB-backed. The
 * quote service wires `record()` after every line where the CBAM rule
 * fires. The admin report endpoint reads from this same surface.
 *
 * Bucket key: `YYYY-Qn` (e.g. `2026-Q2`).
 */
export interface CbamProvisional {
  quoteId: string;
  htsCode: string;
  sector: string;
  defaultApplied: boolean;
  cbamCertificates: number;
  provisionalCostEur: number;
  observedAt: Date;
}

export interface CbamQuarterlyRow {
  quarter: string;
  quoteCount: number;
  totalCertificates: number;
  totalCostEur: number;
  sectors: Record<
    string,
    { certificates: number; costEur: number; quoteCount: number }
  >;
}

@Injectable()
export class CbamQuarterlySettlementService {
  private readonly logger = new Logger(CbamQuarterlySettlementService.name);
  /** Fallback when the repo is unavailable (unit tests). */
  private readonly memoryByQuarter = new Map<string, CbamProvisional[]>();

  constructor(
    @Optional()
    @InjectRepository(CbamQuarterlySettlementEntity)
    private readonly repo?: Repository<CbamQuarterlySettlementEntity>,
  ) {}

  async record(provisional: CbamProvisional): Promise<void> {
    const quarter = toQuarter(provisional.observedAt);
    if (!this.repo) {
      const bucket = this.memoryByQuarter.get(quarter) ?? [];
      bucket.push(provisional);
      this.memoryByQuarter.set(quarter, bucket);
      this.logger.debug(
        `cbam.recorded (memory) quoteId=${provisional.quoteId} quarter=${quarter} cost=€${provisional.provisionalCostEur.toFixed(2)}`,
      );
      return;
    }
    try {
      await this.repo.save(
        this.repo.create({
          quarter,
          quoteId: provisional.quoteId,
          htsCode: provisional.htsCode,
          sector: provisional.sector,
          defaultApplied: provisional.defaultApplied,
          cbamCertificates: provisional.cbamCertificates,
          provisionalCostEur: provisional.provisionalCostEur,
          observedAt: provisional.observedAt,
        } as CbamQuarterlySettlementEntity),
      );
      this.logger.debug(
        `cbam.recorded quoteId=${provisional.quoteId} quarter=${quarter} cost=€${provisional.provisionalCostEur.toFixed(2)}`,
      );
    } catch (e: any) {
      this.logger.warn(
        `cbam.record failed for quoteId=${provisional.quoteId}: ${e?.message ?? e}`,
      );
    }
  }

  async summary(quarter?: string): Promise<CbamQuarterlyRow[]> {
    if (!this.repo) {
      const keys = quarter
        ? [quarter]
        : Array.from(this.memoryByQuarter.keys()).sort();
      return keys.map((q) =>
        this.summarizeQuarterRows(q, this.memoryByQuarter.get(q) ?? []),
      );
    }
    try {
      const rows = await this.repo.find({
        where: quarter ? { quarter } : {},
        order: { observedAt: 'ASC' },
      });
      const byQuarter = new Map<string, CbamProvisional[]>();
      for (const r of rows) {
        const list = byQuarter.get(r.quarter) ?? [];
        list.push({
          quoteId: r.quoteId,
          htsCode: r.htsCode,
          sector: r.sector,
          defaultApplied: r.defaultApplied,
          cbamCertificates: Number(r.cbamCertificates),
          provisionalCostEur: Number(r.provisionalCostEur),
          observedAt: r.observedAt,
        });
        byQuarter.set(r.quarter, list);
      }
      const keys = quarter
        ? [quarter]
        : Array.from(byQuarter.keys()).sort();
      return keys.map((q) =>
        this.summarizeQuarterRows(q, byQuarter.get(q) ?? []),
      );
    } catch (e: any) {
      this.logger.warn(`cbam.summary DB failed: ${e?.message ?? e}`);
      return [];
    }
  }

  private summarizeQuarterRows(
    quarter: string,
    rows: CbamProvisional[],
  ): CbamQuarterlyRow {
    const sectors: CbamQuarterlyRow['sectors'] = {};
    let totalCertificates = 0;
    let totalCost = 0;
    for (const r of rows) {
      totalCertificates += r.cbamCertificates;
      totalCost += r.provisionalCostEur;
      const s = sectors[r.sector] ?? {
        certificates: 0,
        costEur: 0,
        quoteCount: 0,
      };
      s.certificates += r.cbamCertificates;
      s.costEur += r.provisionalCostEur;
      s.quoteCount += 1;
      sectors[r.sector] = s;
    }
    return {
      quarter,
      quoteCount: rows.length,
      totalCertificates: round4(totalCertificates),
      totalCostEur: round4(totalCost),
      sectors,
    };
  }

  /** Test seam — clears the in-memory bucket (DB rows unaffected). */
  clear(): void {
    this.memoryByQuarter.clear();
  }
}

export function toQuarter(d: Date): string {
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${year}-Q${q}`;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
