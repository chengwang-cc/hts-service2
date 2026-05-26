import { Injectable, Logger } from '@nestjs/common';

/**
 * DocumentClassifierService (Phase 8, P8.T6).
 *
 * Heuristic-first classification of source documents. Maps an
 * extracted text + optional URL hint into:
 *   - documentType (csms / proclamation / fr-notice / eu-regulation / usitc-note / other)
 *   - jurisdiction (US / EU / GB / CA / KR / AU / NZ / SG / TW / INTL)
 *   - suggestedCardKey (publisher.type.identifier)
 *   - effectiveDate (when a date phrase is present)
 *
 * LLM fallback is a future hook — heuristics handle the common formats
 * (CBP CSMS, Federal Register, EU OJ, USITC publications) deterministically.
 */
export interface ClassifyInput {
  text: string;
  url?: string | null;
  hint?: { documentType?: string; suggestedCardKey?: string; jurisdiction?: string };
}

export interface ClassifyResult {
  documentType: string;
  jurisdiction: string | null;
  suggestedCardKey: string;
  effectiveDate?: Date | null;
  confidence: number; // 0..1
  matchedHeuristic: string | null;
}

@Injectable()
export class DocumentClassifierService {
  private readonly logger = new Logger(DocumentClassifierService.name);

  classify(input: ClassifyInput): ClassifyResult {
    if (input.hint?.suggestedCardKey) {
      return {
        documentType: input.hint.documentType ?? 'other',
        jurisdiction: input.hint.jurisdiction ?? null,
        suggestedCardKey: input.hint.suggestedCardKey,
        effectiveDate: this.extractEffectiveDate(input.text),
        confidence: 1,
        matchedHeuristic: 'caller-hint',
      };
    }

    const text = input.text || '';
    const head = text.slice(0, 8_000); // classification only reads the head

    // --- US CBP CSMS ---
    const csms = head.match(/CSMS\s*#?\s*([\d-]+)/i);
    if (csms) {
      return {
        documentType: 'csms',
        jurisdiction: 'US',
        suggestedCardKey: `cbp.csms.${csms[1].replace(/-/g, '')}`,
        effectiveDate: this.extractEffectiveDate(text),
        confidence: 0.95,
        matchedHeuristic: 'csms-number',
      };
    }

    // --- US Federal Register: "FR Vol. XX, No. YY" / "90 FR 11251" ---
    const frCite = head.match(/\b(\d{2,3})\s+FR\s+(\d{2,5})\b/);
    if (frCite) {
      return {
        documentType: 'fr-notice',
        jurisdiction: 'US',
        suggestedCardKey: `fr.notice.${frCite[1]}-${frCite[2]}`,
        effectiveDate: this.extractEffectiveDate(text),
        confidence: 0.9,
        matchedHeuristic: 'fr-cite',
      };
    }

    // --- US Presidential Proclamation: "Proclamation 10895" ---
    const proc = head.match(/Proclamation\s+(\d{4,5})/i);
    if (proc) {
      return {
        documentType: 'proclamation',
        jurisdiction: 'US',
        suggestedCardKey: `fr.proclamation.${proc[1]}`,
        effectiveDate: this.extractEffectiveDate(text),
        confidence: 0.9,
        matchedHeuristic: 'proclamation',
      };
    }

    // --- USITC HTS notes ---
    if (/\bUSITC\b/i.test(head) || /Harmonized Tariff Schedule/i.test(head)) {
      return {
        documentType: 'usitc-note',
        jurisdiction: 'US',
        suggestedCardKey: this.deriveFallbackKey('usitc.note', input.url ?? null, text),
        effectiveDate: this.extractEffectiveDate(text),
        confidence: 0.7,
        matchedHeuristic: 'usitc-keyword',
      };
    }

    // --- EU regulations ---
    const euReg = head.match(/Regulation\s+\(EU\)\s+(\d{4})\/(\d{1,5})/i);
    if (euReg) {
      return {
        documentType: 'eu-regulation',
        jurisdiction: 'EU',
        suggestedCardKey: `eu.regulation.${euReg[1]}-${euReg[2]}`,
        effectiveDate: this.extractEffectiveDate(text),
        confidence: 0.95,
        matchedHeuristic: 'eu-regulation',
      };
    }

    // --- UK statutory instruments / TRA ---
    if (/Trade Remedies Authority|gov\.uk\/trade-tariff/i.test(head)) {
      return {
        documentType: 'gb-tra',
        jurisdiction: 'GB',
        suggestedCardKey: this.deriveFallbackKey('gb.tra', input.url ?? null, text),
        effectiveDate: this.extractEffectiveDate(text),
        confidence: 0.7,
        matchedHeuristic: 'gb-tra-keyword',
      };
    }

    // --- Fallback: URL-host-derived key ---
    return {
      documentType: 'other',
      jurisdiction: input.hint?.jurisdiction ?? null,
      suggestedCardKey: this.deriveFallbackKey('other', input.url ?? null, text),
      effectiveDate: this.extractEffectiveDate(text),
      confidence: 0.3,
      matchedHeuristic: null,
    };
  }

  /**
   * "effective" date phrase parser. Returns the first plausible
   * effective-date phrase found in the body.
   */
  private extractEffectiveDate(text: string): Date | null {
    // Match common phrasings: "effective <Month> <day>, <year>"
    const re = /effective\s+(?:as of\s+)?([A-Z][a-z]+\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})/i;
    const m = (text || '').match(re);
    if (!m) return null;
    const parsed = new Date(m[1]);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  private deriveFallbackKey(
    prefix: string,
    url: string | null,
    text: string,
  ): string {
    if (url) {
      try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        const slug = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
        return `${prefix}.${host.replace(/\./g, '-')}.${slug || 'index'}`;
      } catch { /* ignore */ }
    }
    const sniff = (text || '').slice(0, 60).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `${prefix}.unknown.${sniff || Date.now().toString(36)}`;
  }
}
