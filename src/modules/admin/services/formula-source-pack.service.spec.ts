import { FormulaSourcePackService } from './formula-source-pack.service';

function oneResultQueryBuilder<T>(result: T | null) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
    getMany: jest.fn().mockResolvedValue(result ? [result] : []),
  };
}

function manyResultQueryBuilder<T>(result: T[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result),
  };
}

describe('FormulaSourcePackService', () => {
  it('builds a deterministic source pack from staged and active rows', async () => {
    const staged = {
      id: 'stage-1',
      importId: 'import-1',
      htsNumber: '9903.88.03',
      sourceVersion: '2026 Revision 8',
      description: 'Articles subject to additional duties',
      unit: null,
      generalRate: '25%',
      special: null,
      other: null,
      chapter99: null,
      rowHash: 'row-hash',
      rawItem: { htsno: '9903.88.03' },
      normalized: { generalRate: '25%' },
    };
    const active = {
      id: 'active-1',
      htsNumber: '9903.88.03',
      sourceVersion: '2026 Revision 7',
      version: '2026_revision_7',
      description: 'Old description',
      unit: null,
      unitOfQuantity: null,
      generalRate: '25%',
      general: '25%',
      special: null,
      otherRate: null,
      other: null,
      chapter99: null,
      chapter99Links: ['9903.88.15'],
      chapter99ApplicableCountries: ['CN'],
      adjustedFormula: 'value * 0.25',
      adjustedFormulaVariables: [],
      isAdjustedFormulaGenerated: true,
      rateFormula: 'value * 0.25',
      rateVariables: [],
      isFormulaGenerated: true,
      otherRateFormula: null,
      otherRateVariables: null,
      isOtherFormulaGenerated: false,
      specialRates: null,
      otherChapter99Detail: null,
      metadata: { parser: 'fixture' },
      effectiveDate: new Date('2026-05-22T00:00:00Z'),
      rateTextHash: 'hash',
      formulaConfidence: 0.9,
      formulaGeneratedAt: new Date('2026-05-22T00:00:00Z'),
      requiredReview: false,
      requiredReviewComment: null,
      updateFormulaComment: null,
    };

    const service = new FormulaSourcePackService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).stageRepo = {
      createQueryBuilder: jest.fn(() => oneResultQueryBuilder(staged)),
    };
    (service as any).htsRepo = {
      createQueryBuilder: jest.fn(() => oneResultQueryBuilder(active)),
    };
    (service as any).cardRepo = {
      createQueryBuilder: jest.fn(() => manyResultQueryBuilder([])),
    };
    (service as any).evidenceRepo = {
      createQueryBuilder: jest.fn(() => manyResultQueryBuilder([])),
    };

    const pack = await service.build({
      htsNumber: '9903.88.03',
      sourceVersion: '2026 Revision 8',
      originCountry: 'CN',
    });

    expect(pack.sourcePackId).toHaveLength(64);
    expect(pack.sourceVersion).toBe('2026 Revision 8');
    expect(pack.articleDescription).toBe(
      'Articles subject to additional duties',
    );
    expect(pack.currentFormulaArtifact.general).toEqual(
      expect.objectContaining({ formulaText: 'value * 0.25' }),
    );
    expect(pack.chapter99Candidates[0]).toEqual(
      expect.objectContaining({
        htsNumber: '9903.88.15',
        isChapter99: true,
        chapter99Heading: '9903.88.15',
        programFamily: 'section_301',
        programAuthority: 'Section 301',
        programBasis: expect.arrayContaining([
          'heading:9903.88.15',
          'section_301_heading_pattern',
        ]),
      }),
    );
    expect(pack.chapter99Candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          htsNumber: '9903.88.03',
          source: 'active-hts.self',
          programFamily: 'section_301',
          programAuthority: 'Section 301',
        }),
      ]),
    );
    expect(pack.metadata).toEqual(
      expect.objectContaining({
        chapter99ProgramFamilies: ['section_301'],
      }),
    );
  });

  it('classifies non-301 Chapter 99 program families deterministically', () => {
    const service = new FormulaSourcePackService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const classify = (service as any).classifyChapter99Program.bind(service);

    expect(classify({ htsNumber: '9903.85.01', context: [] })).toEqual(
      expect.objectContaining({
        programFamily: 'section_232',
        programAuthority: 'Section 232',
      }),
    );
    expect(classify({ htsNumber: '9903.45.02', context: [] })).toEqual(
      expect.objectContaining({
        programFamily: 'section_201',
        programAuthority: 'Section 201',
      }),
    );
    expect(classify({ htsNumber: '9903.40.05', context: [] })).toEqual(
      expect.objectContaining({
        programFamily: 'section_421',
        programAuthority: 'Section 421',
      }),
    );
    expect(classify({ htsNumber: '9902.01.10', context: [] })).toEqual(
      expect.objectContaining({
        programFamily: 'temporary_duty_suspension',
      }),
    );
    expect(
      classify({
        htsNumber: '9903.99.99',
        context: ['Additional duty under Section 122.'],
      }),
    ).toEqual(
      expect.objectContaining({
        programFamily: 'section_122',
        programAuthority: 'Section 122',
      }),
    );
  });
});
