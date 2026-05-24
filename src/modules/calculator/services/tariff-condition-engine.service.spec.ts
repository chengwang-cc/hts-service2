import { PolicyApplicabilityService } from './policy-applicability.service';
import { TariffConditionEngineService } from './tariff-condition-engine.service';

describe('TariffConditionEngineService', () => {
  let policy: PolicyApplicabilityService;
  let engine: TariffConditionEngineService;

  beforeEach(() => {
    policy = new PolicyApplicabilityService();
    engine = new TariffConditionEngineService(policy);
  });

  it('centralizes reciprocal Chapter 99 auto-selection', () => {
    const result = policy.applySystemChapter99Selections({
      additionalInputs: {},
      countryOfOrigin: 'CN',
      calculationDate: new Date('2026-05-24T12:00:00Z'),
    });

    expect(result.selectedChapter99Headings).toContain('9903.01.25');
    expect(result.systemSelectedChapter99Headings).toEqual(['9903.01.25']);
  });

  it('evaluates the full extra-tax condition set consistently', () => {
    const allowed = engine.evaluate(
      {
        htsHeading: '9903.01.25',
        minValue: 100,
        countryNotIn: ['CA'],
        modeOfTransport: 'OCEAN',
      },
      {
        countryOfOrigin: 'CN',
        declaredValue: 250,
        additionalInputs: { modeOfTransport: 'OCEAN' },
        selectedChapter99Headings: ['9903.01.25'],
      },
    );

    expect(allowed).toBe(true);
  });
});
