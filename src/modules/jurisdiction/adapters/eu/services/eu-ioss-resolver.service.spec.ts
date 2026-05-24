import { EuIossResolverService } from './eu-ioss-resolver.service';

describe('EuIossResolverService', () => {
  const svc = new EuIossResolverService();

  it('B2B with EU VAT id: reverse-charge regardless of value', () => {
    const r = svc.decide({
      declaredValueEur: 1000,
      hsCode: '6109100010',
      buyerType: 'business',
      buyerVatId: 'DE123456789',
    });
    expect(r.collectionPoint).toBe('reverse_charge');
  });

  it('excise goods (Chapter 22 wine) > IOSS regardless of value: border', () => {
    const r = svc.decide({
      declaredValueEur: 50,
      hsCode: '22042131',
      sellerIossNumber: 'IM7777777777',
    });
    expect(r.collectionPoint).toBe('border');
  });

  it('Chapter 24 tobacco: border', () => {
    const r = svc.decide({
      declaredValueEur: 50,
      hsCode: '24021000',
      sellerIossNumber: 'IM7777777777',
    });
    expect(r.collectionPoint).toBe('border');
  });

  it('Cart <= EUR 150 with IOSS number: checkout VAT', () => {
    const r = svc.decide({
      declaredValueEur: 120,
      hsCode: '6109100010',
      sellerIossNumber: 'IM7777777777',
    });
    expect(r.collectionPoint).toBe('checkout');
  });

  it('Cart <= EUR 150 via deemed-supplier marketplace: checkout VAT', () => {
    const r = svc.decide({
      declaredValueEur: 120,
      hsCode: '6109100010',
      sellerIsMarketplace: true,
    });
    expect(r.collectionPoint).toBe('checkout');
  });

  it('Cart > EUR 150 even with IOSS: border', () => {
    const r = svc.decide({
      declaredValueEur: 200,
      hsCode: '6109100010',
      sellerIossNumber: 'IM7777777777',
    });
    expect(r.collectionPoint).toBe('border');
  });

  it('Cart <= EUR 150 without IOSS and not marketplace: border (default)', () => {
    const r = svc.decide({
      declaredValueEur: 120,
      hsCode: '6109100010',
    });
    expect(r.collectionPoint).toBe('border');
  });
});
