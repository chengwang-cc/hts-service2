import { MxIvaRule } from './iva.rule';
import { MxUsmcaQualifyingRule } from './usmca-qualifying.rule';
import { MxCptppQualifyingRule } from './cptpp-qualifying.rule';
import { MxEuFtaQualifyingRule } from './eu-fta-qualifying.rule';
import { MxJapanEpaQualifyingRule } from './japan-epa-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

/**
 * Phase 11 (Wave 1, MX): integration aggregator for the Mexico rule pack.
 */
function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'US',
    destination: 'MX',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'MXN',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('MxIvaRule', () => {
  const rule = new MxIvaRule();

  it('emits 16% standard rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('MX_IVA_STANDARD');
    expect(d.add![0].formula).toBe('1600');
    expect(d.data?.rate).toBe(0.16);
  });

  it('emits 8% border-zone rate when flagged', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { mx_border_zone: true } }),
    );
    expect(d.add![0].identifier).toBe('MX_IVA_BORDER');
    expect(d.add![0].formula).toBe('800');
    expect(d.data?.borderZone).toBe(true);
  });
});

describe('MX FTA-qualifying rules', () => {
  it('usmca-qualifying applies for US origin with flag', () => {
    const rule = new MxUsmcaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', additionalInputs: { usmca_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('usmca-qualifying does NOT apply for non-US/CA origin', () => {
    const rule = new MxUsmcaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { usmca_qualifying: true } }),
      ),
    ).toBe(false);
  });

  it('cptpp-qualifying applies for JP origin', () => {
    const rule = new MxCptppQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { cptpp_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('eu-fta-qualifying applies for EU/DE/FR origin', () => {
    const rule = new MxEuFtaQualifyingRule();
    for (const origin of ['EU', 'DE', 'FR']) {
      expect(
        rule.isApplicable(
          ctx({ origin, additionalInputs: { mx_eu_qualifying: true } }),
        ),
      ).toBe(true);
    }
  });

  it('japan-epa-qualifying applies for JP origin', () => {
    const rule = new MxJapanEpaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'JP', additionalInputs: { mx_jp_epa_qualifying: true } }),
      ),
    ).toBe(true);
  });
});
