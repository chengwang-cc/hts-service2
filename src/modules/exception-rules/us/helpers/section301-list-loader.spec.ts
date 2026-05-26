import { Section301ListLoader } from './section301-list-loader';

describe('Section301ListLoader', () => {
  const loader = new Section301ListLoader();

  it('loads non-empty scaffold lists', () => {
    expect(loader.sizeOf('1')).toBeGreaterThan(0);
    expect(loader.sizeOf('2')).toBeGreaterThan(0);
    expect(loader.sizeOf('3')).toBeGreaterThan(0);
    expect(loader.sizeOf('4A')).toBeGreaterThan(0);
  });

  it('looks up a List 1 HTS', () => {
    const entry = loader.lookup('1', '8471.30.0100', new Date('2026-05-26'));
    expect(entry?.rate).toBe(0.25);
    expect(entry?.chapter99).toBe('9903.88.01');
  });

  it('looks up a List 4A HTS', () => {
    const entry = loader.lookup('4A', '6109.10.0004', new Date('2026-05-26'));
    expect(entry?.rate).toBe(0.075);
    expect(entry?.chapter99).toBe('9903.88.15');
  });

  it('returns null for unknown HTS', () => {
    expect(loader.lookup('1', '9999.99.9999')).toBeNull();
  });

  it('returns null before effectiveFrom', () => {
    expect(loader.lookup('4A', '6109.10.0004', new Date('2020-01-01'))).toBeNull();
  });

  it('finds active exclusions', () => {
    const matches = loader.lookupExclusions('8479.89.9499', new Date('2024-06-01'));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].exclusionCode).toBe('9903.88.45');
  });

  it('returns no exclusion outside the effective window', () => {
    expect(loader.lookupExclusions('8479.89.9499', new Date('2019-01-01'))).toEqual([]);
    expect(loader.lookupExclusions('8479.89.9499', new Date('2027-01-01'))).toEqual([]);
  });
});
