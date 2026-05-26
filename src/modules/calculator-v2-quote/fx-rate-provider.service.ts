import { Injectable, Logger } from '@nestjs/common';

/**
 * FxRateProviderService
 *
 * Fetches real-time FX rates from frankfurter.app — a free ECB-backed
 * service with no API key requirement. Designed as a single replaceable
 * port: swap in OXR / open.er-api / a self-hosted source by injecting a
 * different `FxRateProviderService` (or by calling `configureUpstream()`).
 *
 * Behavior:
 *   - 5-minute in-process cache per (from, to) pair.
 *   - 2.5-second fetch timeout; failure returns `null` (caller falls back
 *     to a placeholder rate).
 *   - Result is `{ rate, observedAt, provider }`; `observedAt` is the
 *     upstream snapshot date, not the local fetch time.
 *
 * Upstream: https://api.frankfurter.app/latest?from=USD&to=AUD
 */

export interface FxRateLookup {
  rate: number;
  observedAt: string;
  provider: string;
}

interface CacheEntry {
  value: FxRateLookup;
  expiresAt: number;
}

@Injectable()
export class FxRateProviderService {
  private readonly logger = new Logger(FxRateProviderService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private upstream = 'https://api.frankfurter.app';
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes
  private readonly fetchTimeoutMs = 2_500;

  configureUpstream(url: string): void {
    this.upstream = url.replace(/\/$/, '');
  }

  /**
   * Fetch the current rate to multiply a `from`-currency amount by to get
   * the `to`-currency value. Returns null when the upstream fails or the
   * pair is unsupported — caller decides the fallback (typically `rate=1`
   * with a warning).
   */
  async fetchRate(from: string, to: string): Promise<FxRateLookup | null> {
    const f = (from || '').toUpperCase();
    const t = (to || '').toUpperCase();
    if (!f || !t) return null;
    if (f === t) {
      return { rate: 1, observedAt: this.today(), provider: 'identity' };
    }
    const cacheKey = `${f}->${t}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    try {
      const url = `${this.upstream}/latest?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        this.logger.warn(
          `frankfurter ${f}->${t} returned HTTP ${response.status}`,
        );
        return null;
      }
      const json = (await response.json()) as {
        amount?: number;
        base?: string;
        date?: string;
        rates?: Record<string, number>;
      };
      const rate = json?.rates?.[t];
      if (typeof rate !== 'number' || !Number.isFinite(rate)) {
        this.logger.warn(
          `frankfurter ${f}->${t} returned malformed payload`,
        );
        return null;
      }
      const out: FxRateLookup = {
        rate,
        observedAt: json.date || this.today(),
        provider: 'frankfurter',
      };
      this.cache.set(cacheKey, {
        value: out,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      this.logger.debug(`fx.fetch ${f}->${t} rate=${rate} observed=${out.observedAt}`);
      return out;
    } catch (e: any) {
      this.logger.warn(
        `frankfurter ${f}->${t} fetch failed: ${e?.message || e}`,
      );
      return null;
    }
  }

  /** Drop cache entries — primarily for tests. */
  clearCache(): void {
    this.cache.clear();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
