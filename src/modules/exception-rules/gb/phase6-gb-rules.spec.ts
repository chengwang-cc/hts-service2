import { GbSteelSafeguardRule } from './steel-safeguard.rule';
import { GbRussiaSanctionsRule } from './russia-sanctions.rule';
import { GbTraAdCvdRule } from './tra-ad-cvd.rule';
import { AdCvdLookupService } from '../_shared/ad-cvd-lookup.service';
import type { ExceptionRuleContext } from '../types';

function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '7208.10.0000',
    origin: 'CN',
    destination: 'GB',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'GBP',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('GbSteelSafeguardRule', () => {
  const rule = new GbSteelSafeguardRule();

  it('applies for GB destination on steel HTS', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('emits 0% in-quota when flag absent', async () => {
    const d = await rule.evaluate(ctx());
    expect(d.add![0].formula).toBe('value * 0');
    expect(d.add![0].identifier).toBe('GB_STEEL_SAFEGUARD_IN');
  });

  it('emits 25% above-quota when flag true', async () => {
    const d = await rule.evaluate(
      ctx({ additionalInputs: { gb_steel_safeguard_above_quota: true } }),
    );
    expect(d.add![0].formula).toBe('value * 0.25');
    expect(d.add![0].identifier).toBe('GB_STEEL_SAFEGUARD_OVER');
  });

  it('declares conflictsWith russia-sanctions (lower-priority gives way)', () => {
    expect(rule.conflictsWith).toEqual(['gb.russia-sanctions']);
  });
});

describe('GbRussiaSanctionsRule', () => {
  const rule = new GbRussiaSanctionsRule();

  it('applies for RU origin', () => {
    expect(rule.isApplicable(ctx({ origin: 'RU' }))).toBe(true);
  });

  it('applies for BY origin', () => {
    expect(rule.isApplicable(ctx({ origin: 'BY' }))).toBe(true);
  });

  it('not applicable for CN', () => {
    expect(rule.isApplicable(ctx({ origin: 'CN' }))).toBe(false);
  });

  it('emits 35% sanctions duty', async () => {
    const d = await rule.evaluate(ctx({ origin: 'RU' }));
    expect(d.add![0].formula).toBe('value * 0.35');
  });
});

describe('GbTraAdCvdRule', () => {
  // Phase 9 promoted this rule to the async AD/CVD base. With no data
  // loaded, the lookup returns null and the rule emits its "no order"
  // notes branch.
  const lookup = new AdCvdLookupService(undefined as any);
  const rule = new GbTraAdCvdRule(lookup);

  it('always potentially applicable for GB destination', () => {
    expect(rule.isApplicable(ctx())).toBe(true);
  });

  it('async evaluate returns no-match notes when no data loaded', async () => {
    const d = await rule.evaluate(ctx());
    expect(d.add).toBeUndefined();
    expect(d.notes?.[0]).toMatch(/no AD\/CVD/);
  });
});
