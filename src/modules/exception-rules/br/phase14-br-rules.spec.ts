import { BrImportDutyRule } from './ii-import-duty.rule';
import { BrIcmsRule } from './icms.rule';
import { BrMercosurOriginQualifyingRule } from './mercosur-origin-qualifying.rule';
import type { ExceptionRuleContext } from '../types';

/**
 * Phase 14 (Wave 4, BR — 2026-05-26): Brazil integration aggregator.
 *
 * Critical W0.5.T2 + ICMS coverage:
 *   - ICMS rule reads `ctx.destinationSubdivision` (the BR-canonical
 *     subnational field, generalized from EU's `destinationMemberState`).
 *   - Falls back to `additionalInputs.br_destination_state` for callers
 *     not yet on the subdivision field.
 *   - Defaults to federal-average 18% when no state supplied, with a
 *     user-facing warning.
 */
function ctx(o: Partial<ExceptionRuleContext> = {}): ExceptionRuleContext {
  return {
    htsCode: '8517.13.0000',
    origin: 'CN',
    destination: 'BR',
    asOfDate: new Date('2026-05-26'),
    declaredValue: 10_000,
    currency: 'BRL',
    additionalInputs: {},
    baseComponents: [],
    pendingComponents: [],
    firedRules: [],
    ...o,
  };
}

describe('BrImportDutyRule', () => {
  const rule = new BrImportDutyRule();

  it('emits 14% default rate', () => {
    const d = rule.evaluate(ctx());
    expect(d.data?.rate as number).toBeCloseTo(0.14, 5);
    expect(d.data?.amount as number).toBeCloseTo(1_400, 3);
  });

  it('honors br_ii_rate_override', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { br_ii_rate_override: 20 } }),
    );
    expect(d.data?.rate).toBe(0.20);
  });
});

describe('BrIcmsRule (uses destinationSubdivision per W0.5.T2)', () => {
  const rule = new BrIcmsRule();

  it('reads destinationSubdivision for SP state rate (18%)', () => {
    const d = rule.evaluate(ctx({ destinationSubdivision: 'SP' }));
    expect(d.data?.state).toBe('SP');
    expect(d.data?.rate).toBe(0.18);
    expect(d.data?.stateProvided).toBe(true);
  });

  it('reads destinationSubdivision for RJ state rate (22%)', () => {
    const d = rule.evaluate(ctx({ destinationSubdivision: 'RJ' }));
    expect(d.data?.state).toBe('RJ');
    expect(d.data?.rate).toBe(0.22);
  });

  it('falls back to additionalInputs.br_destination_state when subdivision absent', () => {
    const d = rule.evaluate(
      ctx({ additionalInputs: { br_destination_state: 'MA' } }),
    );
    expect(d.data?.state).toBe('MA');
    expect(d.data?.rate).toBe(0.22);
  });

  it('emits estimate warning when state is missing', () => {
    const d = rule.evaluate(ctx());
    expect(d.data?.stateProvided).toBe(false);
    expect(d.data?.rate).toBe(0.18);
    expect(d.notes?.some((n) => /destination state missing/i.test(n))).toBe(true);
  });

  it('emits estimate when unknown state code supplied', () => {
    const d = rule.evaluate(ctx({ destinationSubdivision: 'XX' }));
    expect(d.data?.stateProvided).toBe(false);
    expect(d.notes?.some((n) => /destination state missing/i.test(n))).toBe(true);
  });

  it('component identifier reflects state for audit replay', () => {
    const d = rule.evaluate(ctx({ destinationSubdivision: 'SP' }));
    expect(d.add![0].identifier).toBe('BR_ICMS_SP');
  });

  it('component identifier reflects estimate path when state missing', () => {
    const d = rule.evaluate(ctx());
    expect(d.add![0].identifier).toBe('BR_ICMS_ESTIMATE');
  });
});

describe('BrMercosurOriginQualifyingRule', () => {
  const rule = new BrMercosurOriginQualifyingRule();

  it('applies for AR origin with mercosur_qualifying=true', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'AR', additionalInputs: { mercosur_qualifying: true } }),
      ),
    ).toBe(true);
  });

  it('does NOT apply for non-Mercosur origin (US)', () => {
    expect(
      rule.isApplicable(
        ctx({ origin: 'US', additionalInputs: { mercosur_qualifying: true } }),
      ),
    ).toBe(false);
  });

  it('does NOT apply for AR origin without flag', () => {
    expect(rule.isApplicable(ctx({ origin: 'AR' }))).toBe(false);
  });
});
