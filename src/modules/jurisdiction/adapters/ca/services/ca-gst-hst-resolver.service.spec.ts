import { CaGstHstResolverService } from './ca-gst-hst-resolver.service';

describe('CaGstHstResolverService', () => {
  const svc = new CaGstHstResolverService();

  it('Ontario HST 13% on duty-paid value', () => {
    const r = svc.compute(100, 'ON');
    expect(r.totalTax).toBe(13);
    expect(r.components).toEqual([{ type: 'HST', rate: 0.13, amount: 13 }]);
    expect(r.warnings).toHaveLength(0);
  });

  it('Nova Scotia HST 15%', () => {
    const r = svc.compute(100, 'NS');
    expect(r.totalTax).toBe(15);
    expect(r.components[0].type).toBe('HST');
  });

  it('Alberta GST only (5%)', () => {
    const r = svc.compute(100, 'AB');
    expect(r.totalTax).toBe(5);
    expect(r.components.map((c) => c.type)).toEqual(['GST']);
  });

  it('British Columbia GST + PST', () => {
    const r = svc.compute(100, 'BC');
    expect(r.components.map((c) => c.type)).toEqual(['GST', 'PST']);
    expect(r.totalTax).toBeCloseTo(12, 2);
  });

  it('Quebec GST + QST (9.975%)', () => {
    const r = svc.compute(100, 'QC');
    expect(r.components.map((c) => c.type)).toEqual(['GST', 'QST']);
    expect(r.components[1].rate).toBeCloseTo(0.09975, 5);
    expect(r.totalTax).toBeCloseTo(14.98, 2);
  });

  it('Manitoba GST + RST', () => {
    const r = svc.compute(100, 'MB');
    expect(r.components.map((c) => c.type)).toEqual(['GST', 'RST']);
  });

  it('warns and defaults to GST only when no province supplied', () => {
    const r = svc.compute(100);
    expect(r.totalTax).toBe(5);
    expect(r.warnings).toContain(
      'CA_NO_PROVINCE: defaulted to federal GST 5% only',
    );
    expect(r.province).toBe('');
  });

  it('rounds to 2 decimals on awkward bases', () => {
    const r = svc.compute(123.45, 'ON');
    expect(r.totalTax).toBe(16.05); // 123.45 * 0.13 = 16.0485
  });
});
