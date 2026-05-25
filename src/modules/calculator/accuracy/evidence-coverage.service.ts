import { Injectable } from '@nestjs/common';
import type { ProgramFamily } from '../services/tariff-types';

/**
 * EvidenceCoverageService
 *
 * Tracks what evidence backs each active formula component. The plan
 * requires per-component evidence rows of these kinds:
 *
 *   - `official_source` — USITC/CBP/USTR/Federal Register citation
 *   - `broker_golden_set` — at least one human-curated broker quote match
 *   - `provider_quote` — at least one third-party tariff provider check
 *   - `ai_judge` — Codex / Qwen / Claude consensus
 *   - `human_review` — internal SME sign-off
 *
 * Per program family, certain evidence kinds are mandatory before a formula
 * is allowed to roll out to calculator-v2 production. High-risk programs
 * (Section 301/232/IEEPA/reciprocal) require official source + human review;
 * base/special rows only require an official source.
 *
 * The service is storage-agnostic on purpose — callers hand it a
 * `ComponentEvidenceRecord[]` from wherever evidence lives (JSONB on the
 * knowledge card, separate audit table, ai-service judge log, etc.). The
 * report it returns is what the admin coverage dashboard renders and what
 * the rollout gate consults.
 */

export type EvidenceKind =
  | 'official_source'
  | 'broker_golden_set'
  | 'provider_quote'
  | 'ai_judge'
  | 'human_review';

export interface ComponentEvidenceRecord {
  /** Stable component id (e.g. `card:<uuid>` or `extra-tax:<code>`). */
  componentId: string;
  /** Optional program family for SLA selection. */
  programFamily?: ProgramFamily;
  /** Optional Chapter 99 code so we can rank by reporting order. */
  chapter99HtsCode?: string | null;
  /** Set of evidence kinds present for this component. */
  evidence: ReadonlyArray<{
    kind: EvidenceKind;
    /** ISO date when the evidence was recorded. */
    recordedAt: string;
    /** Free-text reference (PR url, broker quote id, etc.). */
    reference?: string;
  }>;
}

/** Evidence kinds REQUIRED for a component to be allowed to roll out. */
export const REQUIRED_EVIDENCE_BY_FAMILY: Readonly<
  Record<ProgramFamily, EvidenceKind[]>
> = {
  // High-risk programs — block rollout without official source + human review.
  section_301: ['official_source', 'human_review'],
  section_232: ['official_source', 'human_review'],
  section_201: ['official_source', 'human_review'],
  section_421: ['official_source', 'human_review'],
  section_122: ['official_source', 'human_review'],
  ieepa: ['official_source', 'human_review'],
  reciprocal: ['official_source', 'human_review'],
  quota: ['official_source', 'human_review'],
  replacement_duty: ['official_source', 'human_review'],
  // Medium-risk — official source required, broker quote recommended.
  exclusion: ['official_source'],
  mtb: ['official_source'],
  temporary_duty_suspension: ['official_source'],
  other_chapter_99: ['official_source'],
  // Routine programs — official source only.
  base: ['official_source'],
  special: ['official_source'],
  non_ntr: ['official_source'],
  chapter_98: ['official_source'],
  mpf: ['official_source'],
  hmf: ['official_source'],
  tax: ['official_source'],
};

export interface ComponentCoverageReport {
  componentId: string;
  programFamily: ProgramFamily;
  chapter99HtsCode?: string | null;
  required: EvidenceKind[];
  present: EvidenceKind[];
  missing: EvidenceKind[];
  /** True when all required evidence kinds are present. */
  coverageComplete: boolean;
  /** True when component is allowed to roll out to calculator-v2 production. */
  rolloutAllowed: boolean;
  /** Most recent evidence timestamp across all kinds, ISO string. */
  lastRecordedAt: string | null;
}

export interface CoverageSummary {
  total: number;
  complete: number;
  incomplete: number;
  rolloutBlocked: number;
  coveragePercentage: number;
  byFamily: Partial<Record<ProgramFamily, { total: number; complete: number }>>;
}

@Injectable()
export class EvidenceCoverageService {
  reportFor(record: ComponentEvidenceRecord): ComponentCoverageReport {
    const family: ProgramFamily = record.programFamily ?? 'other_chapter_99';
    const required = REQUIRED_EVIDENCE_BY_FAMILY[family] ?? ['official_source'];
    const present = Array.from(new Set(record.evidence.map((e) => e.kind)));
    const missing = required.filter((k) => !present.includes(k));
    const coverageComplete = missing.length === 0;
    const rolloutAllowed = coverageComplete;
    const lastRecordedAt = record.evidence.reduce<string | null>((acc, e) => {
      if (!acc) return e.recordedAt;
      return e.recordedAt > acc ? e.recordedAt : acc;
    }, null);
    return {
      componentId: record.componentId,
      programFamily: family,
      chapter99HtsCode: record.chapter99HtsCode ?? null,
      required,
      present,
      missing,
      coverageComplete,
      rolloutAllowed,
      lastRecordedAt,
    };
  }

  reportBatch(records: ComponentEvidenceRecord[]): ComponentCoverageReport[] {
    return records.map((r) => this.reportFor(r));
  }

  summarize(reports: ComponentCoverageReport[]): CoverageSummary {
    const byFamily: CoverageSummary['byFamily'] = {};
    let complete = 0;
    let rolloutBlocked = 0;
    for (const r of reports) {
      const bucket = byFamily[r.programFamily] ?? { total: 0, complete: 0 };
      bucket.total++;
      if (r.coverageComplete) {
        complete++;
        bucket.complete++;
      }
      if (!r.rolloutAllowed) rolloutBlocked++;
      byFamily[r.programFamily] = bucket;
    }
    const total = reports.length;
    return {
      total,
      complete,
      incomplete: total - complete,
      rolloutBlocked,
      coveragePercentage: total === 0 ? 0 : Math.round((complete / total) * 1000) / 10,
      byFamily,
    };
  }
}
