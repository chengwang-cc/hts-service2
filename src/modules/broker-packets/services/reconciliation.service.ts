import { Injectable } from '@nestjs/common';
import { BrokerExtractedFieldEntity } from '../entities';

export interface ReconciliationFinding {
  field: string;
  expected: string;
  actual: string;
  severity: 'blocker' | 'warning' | 'info';
  sourceDocumentIds: string[];
  notes?: string;
}

export interface ReconciliationOptions {
  /** R1-E-03 — percent tolerance for numeric comparisons, e.g. 1 = ±1%. */
  tolerancePct?: number;
}

const NUMERIC_KEYS = new Set([
  'totalValue',
  'grossWeight',
  'netWeight',
  'quantity',
]);

@Injectable()
export class PacketReconciliationService {
  reconcile(
    fields: BrokerExtractedFieldEntity[],
    opts: ReconciliationOptions = {},
  ): ReconciliationFinding[] {
    const tolerancePct = clampTolerance(
      opts.tolerancePct ??
        Number(process.env.BROKER_RECONCILIATION_DEFAULT_TOLERANCE ?? 1),
    );

    const grouped = new Map<string, BrokerExtractedFieldEntity[]>();
    for (const field of fields) {
      const key = this.canonicalKey(field.fieldPath);
      if (!key) continue;
      const bucket = grouped.get(key) ?? [];
      bucket.push(field);
      grouped.set(key, bucket);
    }

    const findings: ReconciliationFinding[] = [];
    for (const [key, group] of grouped) {
      const values = group
        .map((g) => this.preferValue(g))
        .filter((v): v is string => v != null && v.length > 0);
      if (values.length < 2) continue;

      const equivalent = this.allEquivalent(key, values, tolerancePct);
      if (!equivalent) {
        // Surface the canonical (first) value as expected and list the rest.
        const distinct = Array.from(new Set(values));
        findings.push({
          field: key,
          expected: distinct[0],
          actual: distinct.slice(1).join(' / '),
          severity: this.severityForKey(key),
          sourceDocumentIds: Array.from(new Set(group.map((g) => g.documentId))),
          notes:
            NUMERIC_KEYS.has(key) && tolerancePct > 0
              ? `Conflicting values across ${group.length} documents (tolerance ±${tolerancePct}%)`
              : `Conflicting values across ${group.length} documents`,
        });
      }
    }
    return findings;
  }

  private allEquivalent(
    key: string,
    values: string[],
    tolerancePct: number,
  ): boolean {
    if (NUMERIC_KEYS.has(key)) {
      const nums = values
        .map((v) => Number(v.replace(/[^0-9.\-]/g, '')))
        .filter((n) => Number.isFinite(n));
      if (nums.length !== values.length) {
        // Some value isn't a clean number — fall back to strict string compare.
        return new Set(values).size === 1;
      }
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      if (min === 0) return max === 0;
      const drift = ((max - min) / Math.abs(min)) * 100;
      return drift <= tolerancePct;
    }
    // Categorical fields: exact string match required.
    return new Set(values).size === 1;
  }

  private canonicalKey(fieldPath: string): string | null {
    const lower = fieldPath.toLowerCase();
    if (lower.includes('totalvalue')) return 'totalValue';
    if (lower.includes('grossweight')) return 'grossWeight';
    if (lower.includes('netweight')) return 'netWeight';
    if (lower.includes('origin.country') || lower.includes('countryoforigin')) {
      return 'countryOfOrigin';
    }
    if (lower.includes('quantity')) return 'quantity';
    if (lower.includes('portofunlading')) return 'portOfUnlading';
    if (lower.includes('portoflading')) return 'portOfLading';
    return null;
  }

  private preferValue(field: BrokerExtractedFieldEntity): string | null {
    if (field.acceptedStatus === 'overridden' && field.reviewedValue) {
      return field.reviewedValue.trim();
    }
    if (field.normalizedValue) return field.normalizedValue.trim();
    if (field.rawValue) return field.rawValue.trim();
    return null;
  }

  private severityForKey(key: string): 'blocker' | 'warning' | 'info' {
    if (
      key === 'totalValue' ||
      key === 'countryOfOrigin' ||
      key === 'quantity'
    ) {
      return 'blocker';
    }
    return 'warning';
  }
}

function clampTolerance(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 50) return 50;
  return n;
}
