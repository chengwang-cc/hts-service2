import { Injectable, Logger } from '@nestjs/common';

/**
 * R4-A-01 / R4-A-02 — minimal observability shim. We deliberately avoid
 * pulling the @opentelemetry/* stack into this package's runtime
 * dependencies; instead the service exposes a tiny `withSpan(...)` plus
 * `countEvent(...)` API that production deploys can rebind to a real
 * provider via dependency injection (CoreModule + a TelemetryAdapter
 * future iteration).
 *
 * Today the implementation:
 *   - Logs span enter/exit + duration when OTEL_DEBUG_SPANS=true.
 *   - Maintains per-route + per-org rolling counters in-process so
 *     `/admin/broker/metrics` can return non-zero values without an
 *     external Prometheus scrape configured.
 *
 * The intent is that we ship the abstraction now and swap the impl out
 * when the operator picks an OTLP collector — no code changes required
 * at call sites.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly debug =
    (process.env.OTEL_DEBUG_SPANS ?? 'false').toLowerCase() === 'true';
  private readonly counters = new Map<string, number>();
  private readonly latencyBuckets = new Map<string, number[]>();
  /** Cap per-key histogram retention to avoid unbounded memory in dev. */
  private readonly latencyCap = Number(
    process.env.TELEMETRY_LATENCY_CAP ?? 500,
  );

  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean> | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const ms = Date.now() - start;
      this.recordLatency(name, ms);
      if (this.debug) {
        this.logger.debug(
          `span ok ${name} ${ms}ms ${attributes ? JSON.stringify(attributes) : ''}`,
        );
      }
      return result;
    } catch (err) {
      const ms = Date.now() - start;
      this.recordLatency(`${name}.error`, ms);
      if (this.debug) {
        this.logger.debug(
          `span err ${name} ${ms}ms: ${(err as Error).message}`,
        );
      }
      throw err;
    }
  }

  /**
   * Bump a labeled counter. Labels are flattened into a single key string
   * (`<name>{label=value,label=value}`) so the in-process map fits the
   * "low cardinality" requirement from the plan.
   */
  countEvent(
    name: string,
    labels: Record<string, string> = {},
  ): void {
    const key = this.buildKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  /**
   * Snapshot every counter + latency p50/p95 for the admin metrics page.
   */
  snapshot() {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const latencies: Record<
      string,
      { count: number; p50: number; p95: number; max: number }
    > = {};
    for (const [k, samples] of this.latencyBuckets) {
      if (samples.length === 0) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      const p = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      latencies[k] = {
        count: sorted.length,
        p50: p(0.5),
        p95: p(0.95),
        max: sorted[sorted.length - 1],
      };
    }
    return { counters, latencies };
  }

  private recordLatency(name: string, ms: number) {
    const bucket = this.latencyBuckets.get(name) ?? [];
    bucket.push(ms);
    if (bucket.length > this.latencyCap) bucket.shift();
    this.latencyBuckets.set(name, bucket);
  }

  private buildKey(name: string, labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (entries.length === 0) return name;
    const labelStr = entries
      .map(([k, v]) => `${k}=${String(v).replace(/[,}=]/g, '_')}`)
      .join(',');
    return `${name}{${labelStr}}`;
  }
}
