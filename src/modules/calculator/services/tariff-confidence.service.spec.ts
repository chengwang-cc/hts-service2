import { TariffConfidenceService } from './tariff-confidence.service';

function queryBuilderWith(result: {
  many?: unknown[];
  rawOne?: unknown;
  count?: number;
}) {
  const qb: any = {};
  for (const method of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'limit',
    'select',
    'addSelect',
  ]) {
    qb[method] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(result.many || []);
  qb.getRawOne = jest.fn().mockResolvedValue(result.rawOne || null);
  qb.getCount = jest.fn().mockResolvedValue(result.count || 0);
  return qb;
}

describe('TariffConfidenceService', () => {
  it('returns high confidence for fresh authoritative cards with evidence', async () => {
    const now = new Date();
    const cardRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilderWith({
          many: [
            {
              id: 'card-1',
              htsNumber: '0101.21.00',
              countryCode: 'CN',
              destinationCode: 'US',
              status: 'authoritative',
              evidenceCount: 5,
              agreementScore: 1,
              confidenceScore: 0.98,
              lastReviewedAt: now,
              updatedAt: now,
              createdAt: now,
              metadata: { brokerGoldenSetMatch: true },
            },
          ],
        }),
      ),
    };
    const evidenceRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilderWith({
          rawOne: {
            evidenceCount: '5',
            latestEvidenceAt: now,
          },
        }),
      ),
    };
    const shadowRepo = {
      createQueryBuilder: jest.fn(() => queryBuilderWith({ count: 0 })),
    };
    const service = new TariffConfidenceService(
      cardRepo as any,
      evidenceRepo as any,
      shadowRepo as any,
    );

    const result = await service.scoreFor({
      htsNumber: '0101.21.00',
      countryCode: 'CN',
      fallbackConfidence: 0.75,
    });

    expect(result.label).toBe('high');
    expect(result.source).toBe('knowledge-card');
    expect(result.basedOn.cardId).toBe('card-1');
    expect(result.basedOn.evidenceCount).toBe(5);
    expect(result.basedOn.brokerGoldenSetMatch).toBe(true);
    expect(result.caveats).toEqual([]);
  });

  it('surfaces review caveats when no card or evidence exists', async () => {
    const cardRepo = {
      createQueryBuilder: jest.fn(() => queryBuilderWith({ many: [] })),
    };
    const evidenceRepo = {
      createQueryBuilder: jest.fn(() =>
        queryBuilderWith({
          rawOne: {
            evidenceCount: '0',
            latestEvidenceAt: null,
          },
        }),
      ),
    };
    const shadowRepo = {
      createQueryBuilder: jest.fn(() => queryBuilderWith({ count: 2 })),
    };
    const service = new TariffConfidenceService(
      cardRepo as any,
      evidenceRepo as any,
      shadowRepo as any,
    );

    const result = await service.scoreFor({
      htsNumber: '9999.99.99',
      countryCode: 'CN',
      fallbackConfidence: 0.5,
    });

    expect(result.label).toBe('review');
    expect(result.source).toBe('fallback');
    expect(result.basedOn.evidenceCount).toBe(0);
    expect(result.basedOn.shadowPendingMismatches).toBe(2);
    expect(result.caveats).toContain(
      'No knowledge card matched this HTS/country scope.',
    );
    expect(result.caveats).toContain(
      'No accepted evidence rows were found for this scope.',
    );
  });
});
