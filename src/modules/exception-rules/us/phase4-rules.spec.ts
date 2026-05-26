import { IeepaFentanylCnRule } from './ieepa-fentanyl-cn.rule';
import { IeepaFentanylMxRule } from './ieepa-fentanyl-mx.rule';
import { IeepaFentanylCaRule } from './ieepa-fentanyl-ca.rule';
import { IeepaReciprocalBaselineRule } from './ieepa-reciprocal-baseline.rule';
import { Chapter98UsGoodsReturnedRule } from './chapter98-us-goods-returned.rule';
import { UsmcaQualifyingRule } from './usmca-qualifying.rule';
import { Section201SolarRule } from './section201-solar.rule';
import type { ExceptionRuleContext, TariffFormulaComponent } from '../types';

function ctx(overrides: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '6109.10.0004',
    origin: 'CN',
    destination: 'US',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 1000,
    currency: 'USD',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...overrides,
  };
}

function baseRow(overrides: Partial<TariffFormulaComponent> = {}): TariffFormulaComponent {
  return {
    componentType: 'base',
    formula: 'value * 0.165',
    requiredVariables: [],
    identifier: 'BASE_AD_VALOREM',
    programFamily: 'base',
    appliesWhen: { kind: 'always' },
    sourceCitation: { source: 'HTS column 1' },
    confidence: 1,
    ...overrides,
  };
}

describe('IeepaFentanylCnRule', () => {
  const rule = new IeepaFentanylCnRule();

  it('applies to CN→US from 2025-02-04 onwards', () => {
    expect(rule.isApplicable(ctx({ origin: 'CN', asOfDate: new Date('2025-02-04') }))).toBe(true);
    expect(rule.isApplicable(ctx({ origin: 'CN', asOfDate: new Date('2025-02-03') }))).toBe(false);
  });

  it('does not apply for non-CN origin', () => {
    expect(rule.isApplicable(ctx({ origin: 'VN' }))).toBe(false);
  });

  it('emits 10% from 2025-02-04 to 2025-03-03', () => {
    const d = rule.evaluate(ctx({ asOfDate: new Date('2025-02-15') }));
    expect(d.add![0].formula).toBe('value * 0.1');
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.20');
  });

  it('emits 20% from 2025-03-04 onwards', () => {
    const d = rule.evaluate(ctx({ asOfDate: new Date('2025-03-04') }));
    expect(d.add![0].formula).toBe('value * 0.2');
  });
});

describe('IeepaFentanylMxRule', () => {
  const rule = new IeepaFentanylMxRule();

  it('applies to MX→US from 2025-03-04 when not USMCA-qualifying', () => {
    expect(rule.isApplicable(ctx({ origin: 'MX', asOfDate: new Date('2025-03-04') }))).toBe(true);
  });

  it('does NOT apply when USMCA-qualifying', () => {
    expect(
      rule.isApplicable(
        ctx({
          origin: 'MX',
          asOfDate: new Date('2025-03-04'),
          additionalInputs: { usmca_qualifying: true },
        }),
      ),
    ).toBe(false);
  });

  it('emits 25% under 9903.01.21', () => {
    const d = rule.evaluate(ctx({ origin: 'MX' }));
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.21');
    expect(d.add![0].formula).toBe('value * 0.25');
  });
});

describe('IeepaFentanylCaRule', () => {
  const rule = new IeepaFentanylCaRule();

  it('emits standard 25% (9903.01.22) for general CA goods', () => {
    const d = rule.evaluate(ctx({ origin: 'CA' }));
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.22');
    expect(d.add![0].formula).toBe('value * 0.25');
  });

  it('emits 10% under 9903.01.23 for energy/critical-mineral', () => {
    const d = rule.evaluate(
      ctx({
        origin: 'CA',
        additionalInputs: { canada_energy_or_critical_mineral: true },
      }),
    );
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.23');
    expect(d.add![0].formula).toBe('value * 0.1');
  });

  it('not applicable when USMCA-qualifying', () => {
    expect(
      rule.isApplicable(
        ctx({
          origin: 'CA',
          asOfDate: new Date('2025-04-01'),
          additionalInputs: { usmca_qualifying: true },
        }),
      ),
    ).toBe(false);
  });
});

describe('IeepaReciprocalBaselineRule', () => {
  const rule = new IeepaReciprocalBaselineRule();

  it('applies from 2025-04-09 onwards for non-exempt origins', () => {
    expect(rule.isApplicable(ctx({ origin: 'VN', asOfDate: new Date('2025-04-09') }))).toBe(true);
  });

  it('does not apply for US-territory origins', () => {
    expect(rule.isApplicable(ctx({ origin: 'PR' }))).toBe(false);
    expect(rule.isApplicable(ctx({ origin: 'US' }))).toBe(false);
  });

  it('does not apply for USMCA-qualifying MX/CA', () => {
    expect(
      rule.isApplicable(
        ctx({
          origin: 'MX',
          additionalInputs: { usmca_qualifying: true },
        }),
      ),
    ).toBe(false);
  });

  it('emits 10% baseline for unlisted origins', () => {
    const d = rule.evaluate(ctx({ origin: 'VN' }));
    expect(d.add![0].formula).toBe('value * 0.1');
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.25');
  });

  it('emits 15% for EU deal origin', () => {
    const d = rule.evaluate(ctx({ origin: 'EU', asOfDate: new Date('2025-08-01') }));
    expect(d.add![0].formula).toBe('value * 0.15');
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.27');
  });

  it('emits 10% for UK deal origin', () => {
    const d = rule.evaluate(ctx({ origin: 'GB', asOfDate: new Date('2025-07-01') }));
    expect(d.add![0].chapter99HtsCode).toBe('9903.01.26');
  });
});

describe('Chapter98UsGoodsReturnedRule', () => {
  const rule = new Chapter98UsGoodsReturnedRule();

  it('not applicable without subheading + documentation', () => {
    expect(rule.isApplicable(ctx())).toBe(false);
  });

  it('applicable with 9801.00.10 + documentation', () => {
    expect(
      rule.isApplicable(
        ctx({
          additionalInputs: {
            chapter98_subheading: '9801.00.10',
            chapter98_documentation_attached: true,
          },
        }),
      ),
    ).toBe(true);
  });

  it('replaces base with zero when applicable', () => {
    const d = rule.evaluate(
      ctx({
        pendingComponents: [baseRow()],
        additionalInputs: {
          chapter98_subheading: '9801.00.10',
          chapter98_documentation_attached: true,
        },
      }),
    );
    expect(d.replace![0].with.formula).toBe('0');
    expect(d.replace![0].with.componentType).toBe('chapter_98');
  });
});

describe('UsmcaQualifyingRule', () => {
  const rule = new UsmcaQualifyingRule();

  it('applies for MX with usmca_qualifying=true', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'MX', additionalInputs: { usmca_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('not applicable for CN', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', additionalInputs: { usmca_qualifying: true } }),
      ),
    ).toBe(false);
  });

  it('replaces base with 0 when applicable', () => {
    const d = rule.evaluate(
      ctx({
        origin: 'MX',
        pendingComponents: [baseRow()],
        additionalInputs: { usmca_qualifying: true },
      }),
    );
    expect(d.replace![0].with.formula).toBe('0');
    expect(d.replace![0].with.programFamily).toBe('special');
  });
});

describe('Section201SolarRule', () => {
  const rule = new Section201SolarRule();

  it('applicable for 8541.43.0010 (module)', () => {
    expect(rule.isApplicable(ctx({ htsCode: '8541.43.0010' }))).toBe(true);
  });

  it('emits ~14.25% in 2024 for modules', () => {
    const d = rule.evaluate(
      ctx({ htsCode: '8541.43.0010', asOfDate: new Date('2024-06-01') }),
    );
    expect(d.add![0].chapter99HtsCode).toBe('9903.45.25');
    expect(d.add![0].formula).toBe('value * 0.1425');
  });

  it('emits 0% for cells in quota', () => {
    const d = rule.evaluate(ctx({ htsCode: '8541.42.0010' }));
    expect(d.add![0].chapter99HtsCode).toBe('9903.45.21');
    expect(d.add![0].formula).toBe('value * 0');
  });

  it('emits full rate for cells out of quota', () => {
    const d = rule.evaluate(
      ctx({
        htsCode: '8541.42.0010',
        asOfDate: new Date('2025-06-01'),
        additionalInputs: { solar_cells_out_of_quota: true },
      }),
    );
    expect(d.add![0].chapter99HtsCode).toBe('9903.45.22');
  });

  it('not applicable for exempt developing-country origin', () => {
    expect(rule.isApplicable(ctx({ htsCode: '8541.43.0010', origin: 'KH' }))).toBe(false);
  });
});
