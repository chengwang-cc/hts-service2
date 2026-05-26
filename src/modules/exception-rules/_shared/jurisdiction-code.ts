import { Injectable } from '@nestjs/common';

/**
 * JurisdictionCodeNormalizer (W0.5.T1 — 2026-05-26).
 *
 * Per-country national-code length normalization. Replaces the
 * hardcoded `padEnd(10).slice(0, 10)` in `AdCvdLookupService` /
 * `AdCvdImporterService`, which silently mangles non-10-digit codes:
 *
 *   - JP: 9-digit national codes were being padded to 10 → lookup miss
 *   - IN: 8-digit CTH was being padded to 10 → same
 *   - AE: 12-digit GCC was being truncated to 10 → lost national digits
 *   - TH: 11-digit AHTN extension was being truncated to 10 → same
 *
 * The normalizer:
 *   - Strips dots + whitespace
 *   - Pads on the right with zeros if shorter than the country's standard
 *   - Truncates from the right if longer (warn-worthy)
 *   - Returns a stable HS6 prefix via `hs6Prefix()`
 */
export interface NormalizationProfile {
  destination: string;          // ISO-2
  nationalCodeLength: number;
  /** Why this length — for logs / docs only. */
  notes?: string;
}

const PROFILES: Record<string, NormalizationProfile> = {
  US: { destination: 'US', nationalCodeLength: 10, notes: 'HTSUS' },
  CA: { destination: 'CA', nationalCodeLength: 10 },
  GB: { destination: 'GB', nationalCodeLength: 10, notes: 'UK Global Tariff' },
  EU: { destination: 'EU', nationalCodeLength: 10, notes: 'TARIC' },
  KR: { destination: 'KR', nationalCodeLength: 10, notes: 'HSK' },
  SG: { destination: 'SG', nationalCodeLength: 8 },
  AU: { destination: 'AU', nationalCodeLength: 10 },
  NZ: { destination: 'NZ', nationalCodeLength: 10 },
  TW: { destination: 'TW', nationalCodeLength: 10 },
  HK: { destination: 'HK', nationalCodeLength: 8 },
  // 11-country expansion
  JP: { destination: 'JP', nationalCodeLength: 9, notes: 'Japan import statistical' },
  MX: { destination: 'MX', nationalCodeLength: 10, notes: 'TIGIE 8 + NICO 2' },
  CN: { destination: 'CN', nationalCodeLength: 10 },
  IN: { destination: 'IN', nationalCodeLength: 8, notes: 'CTH' },
  VN: { destination: 'VN', nationalCodeLength: 10, notes: 'AHTN' },
  PH: { destination: 'PH', nationalCodeLength: 8, notes: 'AHTN 2022' },
  ID: { destination: 'ID', nationalCodeLength: 8, notes: 'BTKI / AHTN' },
  MY: { destination: 'MY', nationalCodeLength: 10 },
  TH: { destination: 'TH', nationalCodeLength: 11, notes: 'AHTN + statistical extensions' },
  AE: { destination: 'AE', nationalCodeLength: 12, notes: 'GCC integrated tariff' },
  BR: { destination: 'BR', nationalCodeLength: 8, notes: 'NCM' },
};

const DEFAULT_LENGTH = 10;

@Injectable()
export class JurisdictionCodeNormalizer {
  /**
   * Strip dots + spaces; pad/truncate to the country's standard length.
   * Unknown countries fall back to 10-digit normalization (the
   * pre-W0.5.T1 behavior) so existing call sites stay compatible.
   */
  normalize(destination: string | undefined, raw: string): string {
    const length = this.profileFor(destination).nationalCodeLength;
    const cleaned = (raw || '').replace(/[\s.]/g, '');
    if (cleaned.length >= length) {
      return cleaned.slice(0, length);
    }
    return cleaned.padEnd(length, '0');
  }

  /** Always returns 6 digits — HS6 is universal regardless of national tail. */
  hs6Prefix(raw: string): string {
    const cleaned = (raw || '').replace(/[\s.]/g, '');
    if (cleaned.length >= 6) return cleaned.slice(0, 6);
    return cleaned.padEnd(6, '0');
  }

  /** Profile lookup; falls back to a default for unknown countries. */
  profileFor(destination: string | undefined): NormalizationProfile {
    if (!destination) {
      return { destination: '', nationalCodeLength: DEFAULT_LENGTH };
    }
    const key = destination.toUpperCase();
    return PROFILES[key] ?? { destination: key, nationalCodeLength: DEFAULT_LENGTH };
  }

  /** Surface for the admin UI / docs. */
  listProfiles(): NormalizationProfile[] {
    return Object.values(PROFILES);
  }
}

/**
 * Stateless convenience — useful for tests and pure-function call sites
 * that don't want to inject the service. Delegates to a shared singleton.
 */
const SINGLETON = new JurisdictionCodeNormalizer();

export function normalizeJurisdictionCode(
  destination: string | undefined,
  raw: string,
): string {
  return SINGLETON.normalize(destination, raw);
}

export function hs6Prefix(raw: string): string {
  return SINGLETON.hs6Prefix(raw);
}
