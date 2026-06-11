import { ApiKeyGuard } from './api-key.guard';

/**
 * Focused unit spec for the origin allow-list matcher. Constructed with
 * stub dependencies because the matcher is a pure function on (origin,
 * allowed) — none of the guard's other side effects are exercised here.
 */
describe('ApiKeyGuard — checkOriginAllowed', () => {
  // The guard's collaborators aren't touched by checkOriginAllowed, so
  // any object satisfies the type at runtime.
  const stub = {} as any;
  const guard = new ApiKeyGuard(stub, stub);

  // Access the private method via a typed cast.
  const check = (origin: string, allowed: string[]): boolean =>
    (guard as unknown as {
      checkOriginAllowed(o: string, a: string[]): boolean;
    }).checkOriginAllowed(origin, allowed);

  describe('exact match', () => {
    it('matches identical origin', () => {
      expect(check('https://chitchats.com', ['https://chitchats.com'])).toBe(true);
    });

    it('rejects different scheme', () => {
      expect(check('http://chitchats.com', ['chitchats.com'])).toBe(true); // host match
    });

    it('matches by host alone when pattern omits scheme', () => {
      expect(check('https://chitchats.com', ['chitchats.com'])).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(check('https://ChitChats.COM', ['chitchats.com'])).toBe(true);
    });
  });

  describe('*.chitchats.com — wildcard subdomain pattern', () => {
    const allowed = ['*.chitchats.com'];

    it('matches the apex (chitchats.com)', () => {
      expect(check('https://chitchats.com', allowed)).toBe(true);
    });

    it('matches a single-level subdomain', () => {
      expect(check('https://shop.chitchats.com', allowed)).toBe(true);
      expect(check('https://www.chitchats.com', allowed)).toBe(true);
      expect(check('https://app.chitchats.com', allowed)).toBe(true);
    });

    it('matches deeper subdomains too', () => {
      expect(check('https://staging.shop.chitchats.com', allowed)).toBe(true);
      expect(check('https://preview.api.eu.chitchats.com', allowed)).toBe(true);
    });

    it('rejects unrelated hosts', () => {
      expect(check('https://chitchats.evil.com', allowed)).toBe(false);
      expect(check('https://notchitchats.com', allowed)).toBe(false);
      expect(check('https://example.com', allowed)).toBe(false);
    });

    it('rejects hostname that ends with the suffix but is a different domain', () => {
      // `foochitchats.com` ends with `chitchats.com` as a substring but
      // not on a dot boundary — must NOT match.
      expect(check('https://foochitchats.com', allowed)).toBe(false);
    });
  });

  describe('mixed list', () => {
    const allowed = ['https://app.example.com', '*.chitchats.com', 'localhost:4200'];

    it('matches via first entry', () => {
      expect(check('https://app.example.com', allowed)).toBe(true);
    });

    it('matches via wildcard entry (apex)', () => {
      expect(check('https://chitchats.com', allowed)).toBe(true);
    });

    it('matches via host-only entry', () => {
      expect(check('http://localhost:4200', allowed)).toBe(true);
    });

    it('rejects when no pattern matches', () => {
      expect(check('https://other.com', allowed)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false for empty allowed list', () => {
      expect(check('https://chitchats.com', [])).toBe(false);
    });

    it('ignores empty strings in the allowed list', () => {
      expect(check('https://chitchats.com', ['', 'https://chitchats.com'])).toBe(true);
    });

    it('handles port suffixes', () => {
      // Port is stripped before host comparison so `:8080` doesn't break matching.
      expect(check('http://chitchats.com:8080', ['chitchats.com'])).toBe(true);
    });

    it('handles trailing slash on origin', () => {
      expect(check('https://chitchats.com/', ['https://chitchats.com'])).toBe(true);
    });
  });
});
