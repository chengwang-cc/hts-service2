import { AluminumScopeService } from './aluminum-scope.service';

describe('AluminumScopeService', () => {
  let svc: AluminumScopeService;

  beforeAll(() => {
    svc = new AluminumScopeService();
  });

  it('loads a non-empty dataset', () => {
    expect(svc.size()).toBeGreaterThan(20);
  });

  it('isInScope true for 8302.49.6085 on/after 2025-03-12', () => {
    expect(svc.isInScope('8302.49.6085', new Date('2025-03-12'))).toBe(true);
    expect(svc.isInScope('8302.49.6085', new Date('2026-05-26'))).toBe(true);
  });

  it('isInScope false for 8302.49.6085 before 2025-03-12', () => {
    expect(svc.isInScope('8302.49.6085', new Date('2025-03-11'))).toBe(false);
  });

  it('isInScope false for an apparel HTS', () => {
    expect(svc.isInScope('6109.10.0004', new Date())).toBe(false);
  });

  it('accepts both dotted and undotted HTS formats', () => {
    expect(svc.isInScope('8302496085', new Date('2026-05-26'))).toBe(true);
    expect(svc.isInScope('8302.49.6085', new Date('2026-05-26'))).toBe(true);
  });

  it('hasAnyInScope returns true for a 6-digit heading with in-scope children', () => {
    expect(svc.hasAnyInScope('8302.49.0000', new Date('2026-05-26'))).toBe(true);
    expect(svc.hasAnyInScope('7616.99.0000', new Date('2026-05-26'))).toBe(true);
  });

  it('hasAnyInScope false for unrelated heading', () => {
    expect(svc.hasAnyInScope('6109.10.0000', new Date())).toBe(false);
  });

  it('lookup returns the source citation for an in-scope code', () => {
    const entry = svc.lookup('8302.49.6085');
    expect(entry?.source).toBe('fr.proclamation.10895');
  });
});
