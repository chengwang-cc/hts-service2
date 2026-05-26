import { EuSteelSafeguardRule } from './steel-safeguard.rule';
import { EuRussiaSanctionsRule } from './russia-sanctions.rule';
import { EuAdCvdRule } from './ad-cvd.rule';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7208.10.0000',
    origin: 'CN',
    destination: 'EU',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'EUR',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('EuSteelSafeguardRule', () => {
  const rule = new EuSteelSafeguardRule();
  it('emits in-quota zero by default', async () => {
    const d = await rule.evaluate(ctx());
    expect(d.add![0].formula).toBe('value * 0');
  });
  it('emits 25% above-quota', async () => {
    const d = await rule.evaluate(
      ctx({ additionalInputs: { eu_steel_safeguard_above_quota: true } }),
    );
    expect(d.add![0].formula).toBe('value * 0.25');
  });
});

describe('EuRussiaSanctionsRule', () => {
  const rule = new EuRussiaSanctionsRule();
  it('applies for RU/BY', () => {
    expect(rule.isApplicable(ctx({ origin: 'RU' }))).toBe(true);
    expect(rule.isApplicable(ctx({ origin: 'BY' }))).toBe(true);
  });
  it('emits 35%', async () => {
    const d = await rule.evaluate(ctx({ origin: 'RU' }));
    expect(d.add![0].formula).toBe('value * 0.35');
  });
});

describe('EuAdCvdRule', () => {
  // Lookup with no repo → returns null for everything, so the rule
  // emits its "no AD/CVD order in scope" notes branch.
  const rule = new EuAdCvdRule(new AdCvdLookupService(undefined as any));
  it('always potentially applicable for EU destination', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });
  it('async evaluate returns no-match notes when no data loaded', async () => {
    const d = await rule.evaluate(ctx());
    expect(d.add).toBeUndefined();
    expect(d.notes?.[0]).toMatch(/no AD\/CVD/);
  });
});
