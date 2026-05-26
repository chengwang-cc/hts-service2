import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * AluminumScopeService (Phase 2, P2.T2).
 *
 * Loads the curated CBP Section 232 aluminum-derivative HTS list from
 * `us/data/aluminum-hts-scope.json` at construction time and answers
 * "is this HTS in scope at this date?" in O(1).
 *
 * The dataset is a snapshot — keeping it in the repo (rather than a DB
 * table) keeps the rule self-contained and git-auditable. CSMS additions
 * land as PR diffs against the JSON.
 */
export interface AluminumScopeEntry {
  htsCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  source: string;
  note?: string;
}

@Injectable()
export class AluminumScopeService {
  private readonly logger = new Logger(AluminumScopeService.name);
  private readonly byCode: Map<string, AluminumScopeEntry>;
  /** Codes indexed by 6-digit prefix for `hasAnyInScope`. */
  private readonly byPrefix6: Map<string, AluminumScopeEntry[]>;

  constructor() {
    const dataPath = path.join(__dirname, '..', 'data', 'aluminum-hts-scope.json');
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
      const entry: AluminumScopeEntry = {
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
      `aluminum scope loaded: ${this.byCode.size} HTS entries (${this.byPrefix6.size} 6-digit prefixes)`,
    );
  }

  /**
   * True when `htsCode` is on the aluminum-scope list at `asOf` (between
   * effectiveFrom inclusive and effectiveTo exclusive).
   */
  isInScope(htsCode: string, asOf: Date = new Date()): boolean {
    const code = normalizeHts(htsCode);
    const entry = this.byCode.get(code);
    if (!entry) return false;
    if (asOf < entry.effectiveFrom) return false;
    if (entry.effectiveTo && asOf >= entry.effectiveTo) return false;
    return true;
  }

  /**
   * Prefix-aware variant: returns true when ANY child 10-digit HTS under
   * the same 6-digit heading is in scope. Used by the formula endpoint
   * to decide whether to surface the smelt/cast inputs before a full
   * 10-digit classification is entered.
   */
  hasAnyInScope(htsCode: string, asOf: Date = new Date()): boolean {
    const code = normalizeHts(htsCode);
    const p6 = code.slice(0, 6);
    const bucket = this.byPrefix6.get(p6);
    if (!bucket) return false;
    return bucket.some(
      (e) => asOf >= e.effectiveFrom && (!e.effectiveTo || asOf < e.effectiveTo),
    );
  }

  /** Returns the entry record (or undefined). Useful for citation. */
  lookup(htsCode: string): AluminumScopeEntry | undefined {
    return this.byCode.get(normalizeHts(htsCode));
  }

  /** Total count — sanity-check after load + admin display. */
  size(): number {
    return this.byCode.size;
  }
}

/** Strip dots and pad to 10 digits where possible. */
function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}
