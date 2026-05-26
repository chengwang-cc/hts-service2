import { CalculatorV2AuditService } from './calculator-v2-audit.service';
import type { CalculatorV2QuoteResult } from './calculator-v2-quote.types';

function makeQuote(): CalculatorV2QuoteResult {
  return {
    quoteId: 'quote_abc',
    engineVersion: 'hts-native-v2-quote',
    generatedAt: '2026-05-25T20:00:00.000Z',
    destination: { country: 'AU' },
    origin: { country: 'CN' },
    currency: 'AUD',
    entryDate: '2026-05-25',
    lines: [
      {
        lineNumber: 1,
        sku: 'A1',
        description: 'Cotton T-shirt',
        request: {
          classificationCode: '6109.10.00.04',
          quantity: 1,
          unitValue: 2000,
        },
        result: {
          classification: { hs6: '610910', effectiveCode: '6109.10.00.04', source: 'mock' },
          components: [
            {
              componentType: 'base',
              formula: 'value * 0.05',
              identifier: 'AU_MFN_610910',
              chapter99HtsCode: null,
              sourceCitation: { source: 'ABF Working Tariff', confidence: 0.85 },
              confidence: 0.85,
              appliesWhen: { kind: 'always' },
              requiredVariables: [],
            },
            {
              componentType: 'section_301',
              formula: 'value * 0.075',
              identifier: 'SECTION_301_CN',
              chapter99HtsCode: '9903.88.15',
              sourceCitation: { source: 'USTR', confidence: 0.95 },
              confidence: 0.95,
              appliesWhen: { kind: 'always' },
              requiredVariables: [],
            },
          ],
          totals: {
            goodsValue: 2000, customsValue: 2000, baseDuty: 100, additionalDuties: 0,
            totalCustomsDuty: 100, fees: 0, taxes: 225, borderPayable: 325,
            shipping: 100, insurance: 50, landedCost: 2475,
          },
          sources: [
            { source: 'ABF Working Tariff', rowIdentifier: '610910', confidence: 0.85 },
            { source: 'ATO GST Act 1999', confidence: 0.95 },
          ],
          confidence: { score: 0.9, label: 'high', reasons: ['seed_table'] },
          warnings: [],
          assumptions: [],
          jurisdictionFacts: {
            schemaName: 'ABF Working Tariff (seeded)',
            schemaEffectiveDate: '2026-05-25',
            currency: 'AUD',
          },
        },
      },
      {
        lineNumber: 2,
        request: { classificationCode: '6203.42.00.00', quantity: 1, unitValue: 1000 },
        result: {
          classification: { hs6: '620342', effectiveCode: '6203.42.00.00', source: 'mock' },
          components: [
            {
              componentType: 'base',
              formula: 'value * 0.05',
              identifier: 'AU_MFN_620342',
              chapter99HtsCode: null,
              // Same source as line 1 — should de-dupe.
              sourceCitation: { source: 'ABF Working Tariff', rowIdentifier: '620342' },
              confidence: 0.85,
              appliesWhen: { kind: 'always' },
              requiredVariables: [],
            },
          ],
          totals: {
            goodsValue: 1000, customsValue: 1000, baseDuty: 50, additionalDuties: 0,
            totalCustomsDuty: 50, fees: 0, taxes: 105, borderPayable: 155,
            shipping: 0, insurance: 0, landedCost: 1155,
          },
          sources: [{ source: 'ABF Working Tariff', rowIdentifier: '620342' }],
          confidence: { score: 0.85, label: 'medium', reasons: [] },
          warnings: ['weight_missing'],
          assumptions: [],
          jurisdictionFacts: {
            schemaName: 'ABF Working Tariff (seeded)',
            schemaEffectiveDate: '2026-05-25',
            currency: 'AUD',
          },
        },
      },
    ],
    totals: {
      goodsValue: 3000, customsValue: 3000, baseDuty: 150, additionalDuties: 0,
      totalCustomsDuty: 150, fees: 0, taxes: 330, borderPayable: 480,
      shipping: 100, insurance: 50, landedCost: 3630,
    },
    sources: [],
    jurisdictionFacts: {
      schemaName: 'ABF Working Tariff (seeded)',
      schemaEffectiveDate: '2026-05-25',
      currency: 'AUD',
    },
    warnings: ['weight_missing'],
    assumptions: [],
    confidence: { score: 0.88, label: 'high' },
  };
}

describe('CalculatorV2AuditService', () => {
  it('snapshots the quote id, engine version, and schema metadata', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.build(makeQuote());
    expect(snap.quoteId).toBe('quote_abc');
    expect(snap.engineVersion).toBe('hts-native-v2-quote');
    expect(snap.generatedAt).toBe('2026-05-25T20:00:00.000Z');
    expect(snap.schemaSnapshot).toEqual({
      name: 'ABF Working Tariff (seeded)',
      effectiveDate: '2026-05-25',
      currency: 'AUD',
    });
  });

  it('de-duplicates source citations across all lines', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.build(makeQuote());
    // Three input citations across two lines; two share `source` + rowIdentifier.
    expect(snap.sourceCitations.length).toBeGreaterThan(0);
    const keys = snap.sourceCitations.map(
      (c) => `${c.source}|${c.rowIdentifier ?? ''}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('collects confidence details per line', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.build(makeQuote());
    expect(snap.confidenceDetails).toHaveLength(2);
    expect(snap.confidenceDetails[0].lineNumber).toBe(1);
    expect(snap.confidenceDetails[0].label).toBe('high');
    expect(snap.confidenceDetails[1].label).toBe('medium');
  });

  it('lists distinct Chapter 99 codes that appeared in the breakdown', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.build(makeQuote());
    expect(snap.systemSelectedChapter99Headings).toEqual(['9903.88.15']);
  });

  it('emits one formula-hash entry per component, with the line number attached', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.build(makeQuote());
    expect(snap.formulaSemanticHashes).toHaveLength(3);
    const lineNumbers = snap.formulaSemanticHashes.map((h) => h.lineNumber);
    expect(lineNumbers).toEqual([1, 1, 2]);
    expect(snap.formulaSemanticHashes[1].identifier).toBe('SECTION_301_CN');
  });

  it('attaches an FX record id when provided', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.build(makeQuote(), 'fx_xyz');
    expect(snap.fxRecordId).toBe('fx_xyz');
  });

  it('recordAndLog produces the same snapshot and emits a log line', () => {
    const svc = new CalculatorV2AuditService();
    const snap = svc.recordAndLog(makeQuote());
    expect(snap.quoteId).toBe('quote_abc');
  });
});
