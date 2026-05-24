import { HkDutiableCommodityResolverService } from './hk-dutiable-commodity-resolver.service';

describe('HkDutiableCommodityResolverService', () => {
  const svc = new HkDutiableCommodityResolverService();

  describe('classify()', () => {
    it('returns dutiable=false for ordinary goods (Chapter 61)', () => {
      const r = svc.classify('6109100040');
      expect(r.dutiable).toBe(false);
      expect(r.category).toBeNull();
      expect(r.requiredVariables).toHaveLength(0);
    });

    it('flags liquor (22.04 wine) with volume + alcohol_strength', () => {
      const r = svc.classify('22041000');
      expect(r.dutiable).toBe(true);
      expect(r.category).toBe('liquor');
      const names = r.requiredVariables.map((v) => v.name).sort();
      expect(names).toEqual(['alcohol_strength', 'volume_liters']);
    });

    it('flags tobacco (24.02 cigars) with quantity + weight', () => {
      const r = svc.classify('24021000');
      expect(r.dutiable).toBe(true);
      expect(r.category).toBe('tobacco');
      const names = r.requiredVariables.map((v) => v.name).sort();
      expect(names).toEqual(['quantity', 'weight']);
    });

    it('flags hydrocarbon oil (27.10 diesel) with volume', () => {
      const r = svc.classify('27101991');
      expect(r.dutiable).toBe(true);
      expect(r.category).toBe('hydrocarbon_oil');
      expect(r.requiredVariables.map((v) => v.name)).toEqual(['volume_liters']);
    });

    it('flags methyl alcohol (22.07) before liquor (chapter 22 prefix)', () => {
      const r = svc.classify('22072000');
      expect(r.dutiable).toBe(true);
      expect(r.category).toBe('methyl_alcohol');
    });

    it('returns empty for invalid input', () => {
      const r = svc.classify('');
      expect(r.dutiable).toBe(false);
    });
  });

  describe('buildComponents()', () => {
    it('returns a single zero base component for ordinary goods', () => {
      const comps = svc.buildComponents('6109100040');
      expect(comps).toHaveLength(1);
      expect(comps[0].componentType).toBe('base');
      expect(comps[0].formula).toBe('0');
      expect(comps[0].sourceCitation.source).toBe('HK Customs and Excise');
    });

    it('returns base + post_tax placeholder for dutiable commodities', () => {
      const comps = svc.buildComponents('22041000');
      expect(comps).toHaveLength(2);
      expect(comps.map((c) => c.componentType)).toEqual(['base', 'post_tax']);
      expect(comps[1].identifier).toBe('HK_EXCISE_LIQUOR');
      expect(comps[1].formula).toBe('0'); // placeholder until FeeRuleEntity supplies a rate
      expect(comps[1].requiredVariables.map((v) => v.name).sort()).toEqual([
        'alcohol_strength',
        'volume_liters',
      ]);
    });
  });
});
