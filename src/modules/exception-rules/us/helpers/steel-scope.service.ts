import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SteelScopeService (Phase 3, P3.T1).
 *
 * Mirror of AluminumScopeService for the Section 232 steel HTS list
 * (Proc 9705 + 2025 derivative expansions). Reports country-of-melt and
 * country-of-pour reporting requirement; the steel melt/pour rule reads
 * this service to gate applicability.
 */
export interface SteelScopeEntry {
  htsCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  source: string;
  note?: string;
}

@Injectable()
export class SteelScopeService {
  private readonly logger = new Logger(SteelScopeService.name);
  private readonly byCode: Map<string, SteelScopeEntry>;
  private readonly byPrefix6: Map<string, SteelScopeEntry[]>;

  constructor() {
    const dataPath = path.join(__dirname, '..', 'data', 'steel-hts-scope.json');
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as {
      entries: Array<{
        htsCode: string;
        effectiveFrom: string;
        effectiveTo?: string | null;
        source: string;
        note?: string;
      }>;
    };
    this.byCode = new Map();
    this.byPrefix6 = new Map();
    for (const e of raw.entries) {
      const code = normalizeHts(e.htsCode);
      const entry: SteelScopeEntry = {
        htsCode: code,
        effectiveFrom: new Date(e.effectiveFrom),
        effectiveTo: e.effectiveTo ? new Date(e.effectiveTo) : null,
        source: e.source,
        note: e.note,
      };
      this.byCode.set(code, entry);
      const p6 = code.slice(0, 6);
      const bucket = this.byPrefix6.get(p6) ?? [];
      bucket.push(entry);
      this.byPrefix6.set(p6, bucket);
    }
    this.logger.log(
      `steel scope loaded: ${this.byCode.size} HTS entries (${this.byPrefix6.size} 6-digit prefixes)`,
    );
  }

  isInScope(htsCode: string, asOf: Date = new Date()): boolean {
    const entry = this.byCode.get(normalizeHts(htsCode));
    if (!entry) return false;
    if (asOf < entry.effectiveFrom) return false;
    if (entry.effectiveTo && asOf >= entry.effectiveTo) return false;
    return true;
  }

  hasAnyInScope(htsCode: string, asOf: Date = new Date()): boolean {
    const bucket = this.byPrefix6.get(normalizeHts(htsCode).slice(0, 6));
    if (!bucket) return false;
    return bucket.some(
      (e) => asOf >= e.effectiveFrom && (!e.effectiveTo || asOf < e.effectiveTo),
    );
  }

  lookup(htsCode: string): SteelScopeEntry | undefined {
    return this.byCode.get(normalizeHts(htsCode));
  }

  size(): number {
    return this.byCode.size;
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
