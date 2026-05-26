import { FormulaSemanticsService } from '../../calculator/services/formula-semantics.service';
import { FormulaValidationArtifactService } from './formula-validation-artifact.service';

describe('FormulaValidationArtifactService', () => {
  let service: FormulaValidationArtifactService;

  beforeEach(() => {
    service = new FormulaValidationArtifactService(
      new FormulaSemanticsService(),
    );
  });

  it('normalizes local calculator rows into component-keyed artifacts', () => {
    const artifact = service.fromLocalCalculator(
      {
        htsNumber: '8302.49.60.85',
        originCountry: 'CN',
        entryDate: '2026-05-25',
        inputs: { value: 10000 },
      },
      {
        htsCode: '8302.49.60.85',
        country: 'CN',
        effectiveHtsCode: '8302.49.60.85',
        blocked: false,
        blockReason: null,
        message: '',
        totalDuty: 1700,
        fees: 0,
        taxes: 0,
        totals: { duty: 1700, fees: 0, taxes: 0, payable: 1700 },
        breakdown: [
          {
            componentType: 'section_301',
            tariffType: 'SECTION_301',
            tariffTypeDescription: 'Section 301',
            amount: 1700,
            formula: 'value * 0.17',
            formulaVariables: [{ name: 'value', type: 'number' }],
            programFamily: 'section_301',
            chapter99HtsCode: '9903.88.15',
            formulaCanonical: 'value * 0.17',
            formulaSemanticHash: new FormulaSemanticsService().analyze(
              'value * 0.17',
            ).semanticHash,
            sourceCitation: { source: 'test' },
            error: null,
          },
        ],
      },
    );

    expect(artifact.source).toBe('LOCAL_CALCULATOR');
    expect(artifact.components).toHaveLength(1);
    expect(artifact.components[0].programFamily).toBe('section_301');
    expect(artifact.totals.landedCost).toBe(11700);
  });

  it('treats commutative formula forms as equivalent when comparing artifacts', () => {
    const left = service.fromLocalCalculator(
      {
        htsNumber: '8302.49.60.85',
        originCountry: 'CN',
        entryDate: '2026-05-25',
        inputs: { value: 10000 },
      },
      {
        htsCode: '8302.49.60.85',
        country: 'CN',
        blocked: false,
        blockReason: null,
        message: '',
        totalDuty: 1700,
        totals: { duty: 1700, fees: 0, taxes: 0, payable: 1700 },
        breakdown: [
          {
            componentType: 'chapter_99',
            tariffType: 'CHAPTER_99',
            tariffTypeDescription: 'Chapter 99',
            amount: 1700,
            formula: 'value * 0.17',
            formulaVariables: [{ name: 'value', type: 'number' }],
            programFamily: 'other_chapter_99',
            chapter99HtsCode: '9903.99.01',
            sourceCitation: { source: 'left' },
            error: null,
          },
        ],
      },
    );
    const right = service.fromLocalCalculator(
      {
        htsNumber: '8302.49.60.85',
        originCountry: 'CN',
        entryDate: '2026-05-25',
        inputs: { value: 10000 },
      },
      {
        htsCode: '8302.49.60.85',
        country: 'CN',
        blocked: false,
        blockReason: null,
        message: '',
        totalDuty: 1700,
        totals: { duty: 1700, fees: 0, taxes: 0, payable: 1700 },
        breakdown: [
          {
            componentType: 'chapter_99',
            tariffType: 'CHAPTER_99',
            tariffTypeDescription: 'Chapter 99',
            amount: 1700,
            formula: '0.17 * value',
            formulaVariables: [{ name: 'value', type: 'number' }],
            programFamily: 'other_chapter_99',
            chapter99HtsCode: '9903.99.01',
            sourceCitation: { source: 'right' },
            error: null,
          },
        ],
      },
    );

    expect(service.compareArtifacts(left, right).isMatch).toBe(true);
  });

  it('detects provider/local amount differences by canonical component key', () => {
    const left = service.fromLocalCalculator(
      {
        htsNumber: '8302.49.60.85',
        originCountry: 'CN',
        inputs: { value: 10000 },
      },
      {
        htsCode: '8302.49.60.85',
        country: 'CN',
        blocked: false,
        blockReason: null,
        message: '',
        totalDuty: 1500,
        totals: { duty: 1500, fees: 0, taxes: 0, payable: 1500 },
        breakdown: [
          {
            componentType: 'section_301',
            tariffType: 'SECTION_301',
            tariffTypeDescription: 'Section 301',
            amount: 1500,
            formula: 'value * 0.15',
            formulaVariables: [{ name: 'value', type: 'number' }],
            programFamily: 'section_301',
            chapter99HtsCode: '9903.88.15',
            sourceCitation: { source: 'left' },
            error: null,
          },
        ],
      },
    );
    const right = service.fromBrokerGoldenSetCase({
      id: 'broker-case-1',
      brokerName: 'broker',
      brokerReference: 'ref',
      htsNumber: '8302.49.60.85',
      originCountry: 'CN',
      destinationCountry: 'US',
      entryDate: null as any,
      declaredValue: 10000 as any,
      currency: 'USD',
      inputs: { value: 10000 },
      expectedTotalDuty: 1700 as any,
      expectedComponents: [
        {
          componentType: 'section_301',
          programFamily: 'section_301',
          chapter99HtsCode: '9903.88.15',
          amount: 1700,
          formula: 'value * 0.17',
        },
      ],
      citations: [],
      status: 'active',
      lastValidatedAt: null,
      brokerConfidence: 0.95 as any,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const comparison = service.compareArtifacts(left, right);

    expect(comparison.isMatch).toBe(false);
    expect(comparison.differences.map((diff) => diff.kind)).toContain(
      'amount_mismatch',
    );
  });

  it('labels provider quote local artifacts as local calculator evidence', () => {
    const quote = {
      id: 'quote-1',
      provider: 'FLEXPORT',
      queryHash: 'hash',
      htsNumber: '8302.49.60.85',
      originCountry: 'CN',
      destinationCountry: 'US',
      declaredValue: 10000 as any,
      currency: 'USD',
      entryDate: '2026-05-25',
      query: { value: 10000 },
      providerTotalDuty: 1700 as any,
      providerComponents: [{ amount: 1700, formulaText: '0.17 * value' }],
      localTotalDuty: 1700 as any,
      localComponents: [{ amount: 1700, formulaText: 'value * 0.17' }],
      delta: 0 as any,
      agreementStatus: 'matched',
      rawResponseUri: null,
      rawResponse: null,
      fetchedAt: new Date(),
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(
      service.fromExternalProviderQuote(quote as any, 'provider').source,
    ).toBe('FLEXPORT');
    expect(
      service.fromExternalProviderQuote(quote as any, 'local').source,
    ).toBe('LOCAL_CALCULATOR');
  });
});
