import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Section301ListLoader (Phase 3, P3.T6).
 *
 * Loads the §301 list CSV files at boot and answers `lookup(htsCode, asOf)`
 * in O(1). Each list (1, 2, 3, 4A, exclusions) is loaded once into its
 * own map.
 *
 * CSV format:
 *   htsCode,effectiveFrom,effectiveTo,rate,chapter99,source,description
 *   (exclusions also include exclusionCode in place of rate/chapter99)
 *
 * Comments (#) and blank lines are tolerated.
 */
export type Section301ListId = '1' | '2' | '3' | '4A';

export interface Section301ListEntry {
  htsCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rate: number;
  chapter99: string;
  source: string;
  description?: string;
}

export interface Section301ExclusionEntry {
  htsCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  exclusionCode: string;
  source: string;
  description?: string;
}

@Injectable()
export class Section301ListLoader {
  private readonly logger = new Logger(Section301ListLoader.name);
  private readonly lists: Record<Section301ListId, Map<string, Section301ListEntry>> = {
    '1': new Map(),
    '2': new Map(),
    '3': new Map(),
    '4A': new Map(),
  };
  private readonly exclusions = new Map<string, Section301ExclusionEntry[]>();

  constructor() {
    this.lists['1'] = this.loadList('section301-list-1.csv');
    this.lists['2'] = this.loadList('section301-list-2.csv');
    this.lists['3'] = this.loadList('section301-list-3.csv');
    this.lists['4A'] = this.loadList('section301-list-4a.csv');
    this.loadExclusions('section301-exclusions.csv');
    this.logger.log(
      `§301 lists loaded: L1=${this.lists['1'].size} L2=${this.lists['2'].size} ` +
        `L3=${this.lists['3'].size} L4A=${this.lists['4A'].size} ` +
        `exclusions=${Array.from(this.exclusions.values()).reduce((s, b) => s + b.length, 0)}`,
    );
  }

  /** Lookup the entry for a given list (or null if HTS not present / not in effect). */
  lookup(
    listId: Section301ListId,
    htsCode: string,
    asOf: Date = new Date(),
  ): Section301ListEntry | null {
    const entry = this.lists[listId].get(normalizeHts(htsCode));
    if (!entry) return null;
    if (asOf < entry.effectiveFrom) return null;
    if (entry.effectiveTo && asOf >= entry.effectiveTo) return null;
    return entry;
  }

  /** Lookup any currently-active exclusion entries for an HTS. */
  lookupExclusions(htsCode: string, asOf: Date = new Date()): Section301ExclusionEntry[] {
    const bucket = this.exclusions.get(normalizeHts(htsCode));
    if (!bucket) return [];
    return bucket.filter(
      (e) => asOf >= e.effectiveFrom && (!e.effectiveTo || asOf < e.effectiveTo),
    );
  }

  /** Size of a list (admin / sanity). */
  sizeOf(listId: Section301ListId): number {
    return this.lists[listId].size;
  }

  // ── internals ──────────────────────────────────────────────────────

  private loadList(file: string): Map<string, Section301ListEntry> {
    const out = new Map<string, Section301ListEntry>();
    const csv = readCsv(this.csvPath(file));
    for (const row of csv) {
      try {
        const entry: Section301ListEntry = {
          htsCode: normalizeHts(row.htsCode),
          effectiveFrom: new Date(row.effectiveFrom),
          effectiveTo: row.effectiveTo ? new Date(row.effectiveTo) : null,
          rate: Number(row.rate),
          chapter99: row.chapter99,
          source: row.source,
          description: row.description,
        };
        if (!Number.isFinite(entry.rate)) {
          this.logger.warn(`${file}: row ${row.htsCode} has bad rate "${row.rate}"; skipping`);
          continue;
        }
        out.set(entry.htsCode, entry);
      } catch (e: any) {
        this.logger.warn(`${file}: failed to load row ${row.htsCode}: ${e?.message ?? e}`);
      }
    }
    return out;
  }

  private loadExclusions(file: string): void {
    const csv = readCsv(this.csvPath(file));
    for (const row of csv) {
      try {
        const entry: Section301ExclusionEntry = {
          htsCode: normalizeHts(row.htsCode),
          effectiveFrom: new Date(row.effectiveFrom),
          effectiveTo: row.effectiveTo ? new Date(row.effectiveTo) : null,
          exclusionCode: row.exclusionCode,
          source: row.source,
          description: row.description,
        };
        const bucket = this.exclusions.get(entry.htsCode) ?? [];
        bucket.push(entry);
        this.exclusions.set(entry.htsCode, bucket);
      } catch (e: any) {
        this.logger.warn(`exclusions: failed row ${row.htsCode}: ${e?.message ?? e}`);
      }
    }
  }

  private csvPath(file: string): string {
    return path.join(__dirname, '..', 'data', file);
  }
}

function normalizeHts(input: string): string {
  return (input || '').replace(/\./g, '').padEnd(10, '0').slice(0, 10);
}

/**
 * Minimal CSV reader. Honors header row, treats `#`-prefixed lines and
 * blank lines as comments. Doesn't handle quoted commas — our datasets
 * are simple enough that we don't need a full parser.
 */
function readCsv(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  let header: string[] | null = null;
  const out: Array<Record<string, string>> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!header) {
      header = line.split(',').map((h) => h.trim());
      continue;
    }
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    out.push(row);
  }
  return out;
}
