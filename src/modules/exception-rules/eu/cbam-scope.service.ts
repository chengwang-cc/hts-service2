import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CbamScopeService (Phase 7, P7.T2).
 *
 * Loads `eu/data/cbam-scope.json` and answers:
 *   - `isInScope(htsCode)` — whether the HS is in CBAM scope
 *   - `defaultEmissions(htsCode)` — per-tonne default direct + indirect
 *     emissions when the exporter declaration is not provided
 *   - `freeAllocationShare(year)` — free-allocation share for the year
 *     (phased out from 2026 → 2034)
 *   - `certificatePriceEurPerTCO2e()` — current configured price
 */
export type CbamSector =
  | 'cement'
  | 'iron_steel'
  | 'aluminum'
  | 'fertilizers'
  | 'electricity'
  | 'hydrogen';

export interface CbamScopeEntry {
  htsCode: string;
  sector: CbamSector;
  defaultDirectTCO2eperT: number;
  defaultIndirectTCO2eperT: number;
  note?: string;
}

interface CbamScopeData {
  certificatePriceEurPerTCO2e: number;
  freeAllocationShare: { byYear: Array<{ year: number; share: number }> };
  entries: CbamScopeEntry[];
}

@Injectable()
export class CbamScopeService {
  private readonly logger = new Logger(CbamScopeService.name);
  private readonly data: CbamScopeData;
  private readonly byCode: Map<string, CbamScopeEntry>;
  private readonly byPrefix6: Map<string, CbamScopeEntry[]>;
  private readonly shareByYear: Map<number, number>;

  constructor() {
    const dataPath = path.join(__dirname, 'data', 'cbam-scope.json');
    this.data = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as CbamScopeData;
    this.byCode = new Map();
    this.byPrefix6 = new Map();
    for (const e of this.data.entries) {
      const code = normalizeHts(e.htsCode);
      this.byCode.set(code, e);
      const p6 = code.slice(0, 6);
      const bucket = this.byPrefix6.get(p6) ?? [];
      bucket.push(e);
      this.byPrefix6.set(p6, bucket);
    }
    this.shareByYear = new Map(
      this.data.freeAllocationShare.byYear.map((r) => [r.year, r.share]),
    );
    this.logger.log(
      `CBAM scope loaded: ${this.byCode.size} entries across ${this.byPrefix6.size} 6-digit prefixes`,
    );
  }

  isInScope(htsCode: string): boolean {
    const code = normalizeHts(htsCode);
    if (this.byCode.has(code)) return true;
    return this.byPrefix6.has(code.slice(0, 6));
  }

  defaultEmissions(htsCode: string): { direct: number; indirect: number } | null {
    const code = normalizeHts(htsCode);
    const exact = this.byCode.get(code);
    if (exact) {
      return {
        direct: exact.defaultDirectTCO2eperT,
        indirect: exact.defaultIndirectTCO2eperT,
      };
    }
    const bucket = this.byPrefix6.get(code.slice(0, 6));
    if (!bucket || bucket.length === 0) return null;
    const avgDirect = average(bucket.map((b) => b.defaultDirectTCO2eperT));
    const avgIndirect = average(bucket.map((b) => b.defaultIndirectTCO2eperT));
    return { direct: avgDirect, indirect: avgIndirect };
  }

  sectorFor(htsCode: string): CbamSector | null {
    const code = normalizeHts(htsCode);
    const exact = this.byCode.get(code);
    if (exact) return exact.sector;
    const bucket = this.byPrefix6.get(code.slice(0, 6));
    return bucket?.[0]?.sector ?? null;
  }

  freeAllocationShare(year: number): number {
    const exact = this.shareByYear.get(year);
    if (exact !== undefined) return exact;
    // Beyond range: 0 (fully phased out)
    return 0;
  }

  certificatePriceEurPerTCO2e(): number {
    return this.data.certificatePriceEurPerTCO2e;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
