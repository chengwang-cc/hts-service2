import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { TelemetryService } from './telemetry.service';

/**
 * R4-A-03 — exposes the in-process TelemetryService snapshot as
 * Prometheus text format on `GET /metrics`. The endpoint is public
 * (intended to be scraped on the loopback interface or behind a
 * mesh / private-network policy); operators should NOT publish it to
 * the open internet.
 *
 * When a real OpenTelemetry SDK + OTLP exporter is wired up, this
 * controller can be removed — the TelemetryService swap-out is the
 * preferred path long term. Until then this gives Prometheus
 * scrapers + the alert rules in hts-devops/observability/ a target.
 */
@Controller()
export class PrometheusExporterController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): string {
    const { counters, gauges, latencies } = this.telemetry.snapshot();
    const lines: string[] = [];

    emitGroupedMetrics(lines, counters, 'counter');
    emitGroupedMetrics(lines, gauges, 'gauge');

    if (Object.keys(latencies).length > 0) {
      lines.push(
        '# HELP broker_op_latency_ms Latency snapshot derived from TelemetryService.withSpan().',
      );
      lines.push('# TYPE broker_op_latency_ms summary');
      for (const [name, summary] of Object.entries(latencies)) {
        const safe = sanitizeMetricName(name);
        lines.push(`${safe}{quantile="0.5"} ${summary.p50}`);
        lines.push(`${safe}{quantile="0.95"} ${summary.p95}`);
        lines.push(`${safe}{quantile="1.0"} ${summary.max}`);
        lines.push(`${safe}_count ${summary.count}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }
}

/**
 * Group TelemetryService keys by base metric name so we emit one
 * `# TYPE foo counter|gauge` header per metric with every labelled
 * sample beneath it, per the Prometheus text format.
 */
function emitGroupedMetrics(
  lines: string[],
  entries: Record<string, number>,
  type: 'counter' | 'gauge',
): void {
  const grouped = new Map<
    string,
    Array<{ key: string; value: number }>
  >();
  for (const [key, value] of Object.entries(entries)) {
    const baseName = key.includes('{') ? key.slice(0, key.indexOf('{')) : key;
    const safe = sanitizeMetricName(baseName);
    const bucket = grouped.get(safe) ?? [];
    bucket.push({ key, value });
    grouped.set(safe, bucket);
  }
  for (const [safeName, rows] of grouped) {
    lines.push(`# TYPE ${safeName} ${type}`);
    for (const row of rows) {
      lines.push(`${toPrometheusKey(row.key)} ${row.value}`);
    }
  }
}

/**
 * Convert TelemetryService's `name{label=value,label=value}` key into a
 * Prometheus text-format line: `metric_name{label="value"} sample`.
 */
function toPrometheusKey(key: string): string {
  const labelStart = key.indexOf('{');
  if (labelStart === -1) {
    return sanitizeMetricName(key);
  }
  const name = sanitizeMetricName(key.slice(0, labelStart));
  const labelBody = key.slice(labelStart + 1, key.lastIndexOf('}'));
  const labels = labelBody
    .split(',')
    .map((pair) => {
      const [k, ...rest] = pair.split('=');
      const v = rest.join('=');
      return `${sanitizeLabelName(k)}="${escapeLabelValue(v)}"`;
    })
    .join(',');
  return `${name}{${labels}}`;
}

function sanitizeMetricName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function sanitizeLabelName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeLabelValue(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
