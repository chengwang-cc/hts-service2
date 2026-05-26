import { SteelScopeService } from './steel-scope.service';

describe('SteelScopeService', () => {
  const svc = new SteelScopeService();

  it('loads a non-empty dataset', () => {
    expect(svc.size()).toBeGreaterThan(20);
  });

  it('in scope for 7326.20.0020 from 2025-03-12', () => {
    expect(svc.isInScope('7326.20.0020', new Date('2025-03-12'))).toBe(true);
    expect(svc.isInScope('7326.20.0020', new Date('2025-03-11'))).toBe(false);
  });

  it('in scope for primary steel codes from 2018', () => {
    expect(svc.isInScope('7208.10.1500', new Date('2018-03-23'))).toBe(true);
  });

  it('out of scope for apparel', () => {
    expect(svc.isInScope('6109.10.0004')).toBe(false);
  });

  it('hasAnyInScope true for 7326 heading', () => {
    expect(svc.hasAnyInScope('7326.20.0000', new Date('2026-05-26'))).toBe(true);
  });
});
