import { CaLowValueResolverService } from './ca-low-value-resolver.service';

describe('CaLowValueResolverService', () => {
  const svc = new CaLowValueResolverService();

  it('CUSMA courier from US under CAD 40: duty + tax exempt', () => {
    const r = svc.resolve({ declaredValueCad: 35, shipFromCountry: 'US' });
    expect(r.dutyExempt).toBe(true);
    expect(r.taxExempt).toBe(true);
  });

  it('CUSMA courier from MX between CAD 40-150: duty-free, taxes apply', () => {
    const r = svc.resolve({ declaredValueCad: 120, shipFromCountry: 'MX' });
    expect(r.dutyExempt).toBe(true);
    expect(r.taxExempt).toBe(false);
  });

  it('CUSMA courier from US over CAD 150: full border', () => {
    const r = svc.resolve({ declaredValueCad: 200, shipFromCountry: 'US' });
    expect(r.dutyExempt).toBe(false);
    expect(r.taxExempt).toBe(false);
  });

  it('Casual personal import under CAD 20 (any origin)', () => {
    const r = svc.resolve({ declaredValueCad: 15, shipFromCountry: 'CN' });
    expect(r.dutyExempt).toBe(true);
    expect(r.taxExempt).toBe(true);
  });

  it('Postal from US under CAD 40: standard border (no CUSMA courier benefit)', () => {
    const r = svc.resolve({
      declaredValueCad: 35,
      shipFromCountry: 'US',
      channel: 'postal',
    });
    expect(r.dutyExempt).toBe(false);
  });

  it('Non-CUSMA origin over CAD 20: standard border', () => {
    const r = svc.resolve({ declaredValueCad: 50, shipFromCountry: 'CN' });
    expect(r.dutyExempt).toBe(false);
    expect(r.taxExempt).toBe(false);
  });
});
