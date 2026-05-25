import { RequestPreflightService } from '../../src/modules/marketplace-requests/services/request-preflight.service';

const svc = new RequestPreflightService();

describe('RequestPreflightService', () => {
  it('detects FDA flag from "supplement" keyword', async () => {
    const r = await svc.preflight({
      commoditySummary: 'Vitamin D dietary supplement bottles',
    });
    expect(r.regulatoryFlags).toContain('FDA');
  });

  it('detects textile flag from t-shirt keyword and seeds candidate HTS', async () => {
    const r = await svc.preflight({
      commoditySummary: 'Cotton t-shirt for adults, screen-printed',
    });
    expect(r.regulatoryFlags).toContain('TEXTILE');
    expect(r.candidateHtsNumbers).toContain('6109.10');
  });

  it('adds Section 301 and Chapter 99 flags when origin is CN', async () => {
    const r = await svc.preflight({
      commoditySummary: 'Plastic phone case',
      originCountry: 'CN',
    });
    expect(r.regulatoryFlags).toContain('SECTION_301');
    expect(r.regulatoryFlags).toContain('CHAPTER_99');
    expect(r.candidateHtsNumbers).toContain('3926.90');
  });

  it('marks formal entry likely when shipment value exceeds $2500', async () => {
    const r = await svc.preflight({
      commoditySummary: 'shoes',
      shipmentValue: 5000,
    });
    expect(r.regulatoryFlags).toContain('FORMAL_ENTRY_LIKELY');
  });

  it('readiness breakdown sums into score 0..100', async () => {
    const r = await svc.preflight({
      commoditySummary:
        'Detailed description of imported polyester knit t-shirts from Vietnam to Long Beach with FOB pricing',
      originCountry: 'VN',
      destinationCountry: 'US',
      shipmentValue: 35_000,
    });
    expect(r.readinessScore).toBeGreaterThanOrEqual(0);
    expect(r.readinessScore).toBeLessThanOrEqual(100);
    expect(r.readinessBreakdown.documents.score).toBeGreaterThan(0);
    expect(r.readinessBreakdown.classification.score).toBeGreaterThan(0);
  });

  it('honors user-supplied candidate HTS over heuristics', async () => {
    const r = await svc.preflight({
      commoditySummary: 'arbitrary',
      candidateHtsNumbers: ['1234.56'],
    });
    expect(r.candidateHtsNumbers).toEqual(['1234.56']);
  });
});
