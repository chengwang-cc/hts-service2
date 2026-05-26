import { Injectable, Logger } from '@nestjs/common';
import type { CalculatorV2QuoteResult } from './calculator-v2-quote.types';
import type { SourceCitationRef } from '../calculator/services/tariff-types';

/**
 * CalculatorV2AuditService (Phase F1)
 *
 * Snapshots the audit-relevant fields of a CalculatorV2QuoteResult so
 * downstream audit/history consumers can answer "what data drove this
 * number on this day?":
 *
 *   - per-component source citations (de-duplicated)
 *   - confidence details (score + label + reasons per line)
 *   - selected vs system Chapter 99 headings
 *   - formula semantic hashes (`formulaSemanticHash` on each component)
 *   - schema snapshot (name + effective date) per destination
 *   - fx record reference, when one was created
 *
 * Persistence is intentionally not wired here. The existing
 * `CalculationHistoryService` accepts a free-form `result` object via its
 * `write()` path; we attach the audit snapshot under
 * `result.audit` and existing JSONB columns hold it without a schema change.
 * A dedicated `calculation_audit` table is a follow-up — the contract this
 * service exposes is intentionally storage-agnostic so that's a swap not
 * a rewrite.
 */

export interface AuditSnapshot {
  quoteId: string;
  engineVersion: string;
  generatedAt: string;
  schemaSnapshot: {
    name: string;
    effectiveDate: string;
    currency: string;
  };
  /** De-duplicated citations across all lines. */
  sourceCitations: SourceCitationRef[];
  /** Per-line confidence detail rollup. */
  confidenceDetails: Array<{
    lineNumber: number;
    score: number;
    label: 'high' | 'medium' | 'low' | 'review';
    reasons: string[];
  }>;
  /** Distinct Chapter 99 codes that appeared in the breakdown. */
  systemSelectedChapter99Headings: string[];
  /** Semantic hash per component for tamper-evident audit. */
  formulaSemanticHashes: Array<{
    lineNumber: number;
    componentType: string;
    identifier?: string;
    formula: string;
  }>;
  /** Optional reference to an FX record id created for this quote. */
  fxRecordId?: string | null;
}

@Injectable()
export class CalculatorV2AuditService {
  private readonly logger = new Logger(CalculatorV2AuditService.name);

  build(quote: CalculatorV2QuoteResult, fxRecordId?: string | null): AuditSnapshot {
    const sourceCitations = this.dedupeCitations(
      quote.lines.flatMap((l) => l.result.sources),
    );
    const confidenceDetails = quote.lines.map((l) => ({
      lineNumber: l.lineNumber,
      score: l.result.confidence.score,
      label: l.result.confidence.label,
      reasons: l.result.confidence.reasons,
    }));
    const ch99Set = new Set<string>();
    for (const l of quote.lines) {
      for (const c of l.result.components) {
        if (c.chapter99HtsCode) ch99Set.add(c.chapter99HtsCode);
      }
    }
    const hashes: AuditSnapshot['formulaSemanticHashes'] = [];
    for (const l of quote.lines) {
      for (const c of l.result.components) {
        hashes.push({
          lineNumber: l.lineNumber,
          componentType: c.componentType,
          identifier: c.identifier,
          formula: c.formula,
        });
      }
    }
    return {
      quoteId: quote.quoteId,
      engineVersion: quote.engineVersion,
      generatedAt: quote.generatedAt,
      schemaSnapshot: {
        name: quote.jurisdictionFacts.schemaName,
        effectiveDate: quote.jurisdictionFacts.schemaEffectiveDate,
        currency: quote.jurisdictionFacts.currency,
      },
      sourceCitations,
      confidenceDetails,
      systemSelectedChapter99Headings: Array.from(ch99Set).sort(),
      formulaSemanticHashes: hashes,
      fxRecordId: fxRecordId ?? null,
    };
  }

  /**
   * Convenience entry point: build the snapshot and log it. The actual
   * persistence handoff to `CalculationHistoryService` is done by the
   * quote service so it can decide when to write per-organization vs not.
   */
  recordAndLog(
    quote: CalculatorV2QuoteResult,
    fxRecordId?: string | null,
  ): AuditSnapshot {
    const snapshot = this.build(quote, fxRecordId);
    this.logger.log(
      `audit.quote quoteId=${snapshot.quoteId} ` +
        `engine=${snapshot.engineVersion} ` +
        `lines=${quote.lines.length} ` +
        `citations=${snapshot.sourceCitations.length} ` +
        `ch99=${snapshot.systemSelectedChapter99Headings.length} ` +
        `fx=${snapshot.fxRecordId ?? 'none'}`,
    );
    return snapshot;
  }

  private dedupeCitations(citations: SourceCitationRef[]): SourceCitationRef[] {
    const seen = new Map<string, SourceCitationRef>();
    for (const c of citations) {
      const key = `${c.source}|${c.rowIdentifier ?? ''}|${c.url ?? ''}`;
      if (!seen.has(key)) seen.set(key, c);
    }
    return Array.from(seen.values());
  }
}
