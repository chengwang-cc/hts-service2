import { JpConsumptionTaxRule } from './consumption-tax.rule';
import { JpCptppQualifyingRule } from './cptpp-qualifying.rule';
import { JpRcepQualifyingRule } from './rcep-qualifying.rule';
import { JpEuEpaQualifyingRule } from './eu-epa-qualifying.rule';
import { JpUkCepaQualifyingRule } from './uk-cepa-qualifying.rule';
import { JpAuEpaQualifyingRule } from './au-epa-qualifying.rule';
import { JpIndiaCepaQualifyingRule } from './india-cepa-qualifying.rule';
import { JpThailandEpaQualifyingRule } from './thailand-epa-qualifying.rule';
import { JpAseanCepQualifyingRule } from './asean-cep-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

/**
 * Phase 11 (Wave 1, JP — 2026-05-26): integration aggregator for the
 * Japan rule pack. Verifies cross-rule behavior — priority order,
 * conflictsWith semantics, FTA qualifying logic.
 *
 * Pattern: mirrors `us/phase4-rules.spec.ts` and similar phase specs.
 */
function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'VN',
    destination: 'JP',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 100_000,
    currency: 'JPY',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('JpConsumptionTaxRule', () => {
  const rule = new JpConsumptionTaxRule();

  it('applies for JP destination', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('does not apply for non-JP destination', () => {
    expect(rule.isApplicable(ctx({ destination: 'US' }))).toBe(false);
  });

  it('emits 10% standard rate component with post_tax type', () => {
    const d = rule.evaluate(ctx());
    expect(d.add).toHaveLength(1);
    expect(d.add![0].componentType).toBe('post_tax');
    expect(d.add![0].identifier).toBe('JP_CONSUMPTION_TAX');
    // 10% on declaredValue default base
    expect(d.add![0].formula).toBe('10000');
  });

  it('emits 8% reduced rate for HS Ch04 (dairy)', () => {
    const d = rule.evaluate(ctx({ htsCode: '0401.10.0000' }));
    expect(d.add![0].formula).toBe('8000');
  });

  it('populates structured data with rate + base', () => {
    const d = rule.evaluate(ctx());
    expect(d.data?.rate).toBe(0.10);
    expect(d.data?.base).toBe(100_000);
    expect(d.data?.amount).toBe(10000);
  });

  it('warns when missing input falls back to declared value', () => {
    const d = rule.evaluate(ctx({ additionalInputs: {} }));
    // No note when defaultIfMissing resolves cleanly.
    expect(d.notes?.some((n) => /base=100000/i.test(n))).toBe(true);
  });
});

describe('JP FTA-qualifying rules', () => {
  it('jp.cptpp.qualifying applies for AU origin with flag true', () => {
    const rule = new JpCptppQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'AU', additionalInputs: { cptpp_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('jp.cptpp.qualifying does not apply without flag', () => {
    const rule = new JpCptppQualifyingRule();
    expect(rule.isApplicable(ctx({ origin: 'AU' }))).toBe(false);
  });

  it('jp.rcep.qualifying applies for CN origin with flag', () => {
    const rule = new JpRcepQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'CN', additionalInputs: { rcep_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('jp.eu-epa.qualifying applies for DE origin', () => {
    const rule = new JpEuEpaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'DE', additionalInputs: { jp_eu_epa_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('jp.uk-cepa.qualifying applies for GB origin only', () => {
    const rule = new JpUkCepaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'GB', additionalInputs: { jp_uk_cepa_qualifying: true } }),
      ),
    ).toBe(true);
    expect(rule.isApplicable(ctx({ origin: 'CN' }))).toBe(false);
  });

  it('jp.au-epa.qualifying applies for AU origin only', () => {
    const rule = new JpAuEpaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'AU', additionalInputs: { jaepa_qualifying: true } }),
      ),
    ).toBe(true);
    expect(rule.isApplicable(ctx({ origin: 'NZ' }))).toBe(false);
  });

  it('jp.india-cepa.qualifying applies for IN origin', () => {
    const rule = new JpIndiaCepaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'IN', additionalInputs: { jicepa_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('jp.thailand-epa.qualifying applies for TH origin', () => {
    const rule = new JpThailandEpaQualifyingRule();
    expect(
      rule.isApplicable(
        ctx({ origin: 'TH', additionalInputs: { jtepa_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('jp.asean-cep.qualifying covers all 10 ASEAN origins', () => {
    const rule = new JpAseanCepQualifyingRule();
    for (const origin of ['BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'VN']) {
      const applies = rule.isApplicable(
        ctx({ origin, additionalInputs: { ajcep_qualifying: true } }),
      );
      if (!applies) {
        throw new Error(`expected ${origin} to be applicable for jp.asean-cep.qualifying`);
      }
    }
  });
});
