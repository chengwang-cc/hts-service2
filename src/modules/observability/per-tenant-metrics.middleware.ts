import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TelemetryService } from './telemetry.service';

/**
 * R4-A-02 — records per-route + per-tenant request counters and a
 * latency histogram for every broker / broker-portal / marketplace route.
 * The label cardinality is capped to (route prefix, tenant org id) so the
 * in-process counter map stays bounded even with many active orgs.
 */
@Injectable()
export class PerTenantMetricsMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const path = (req.originalUrl ?? req.url).split('?')[0];
    const routePrefix = pickRoutePrefix(path);
    if (!routePrefix) return next();
    res.on('finish', () => {
      const user = (req as any).user as
        | { organizationId?: string }
        | undefined;
      const org = user?.organizationId ?? 'anonymous';
      const labels = {
        route: routePrefix,
        method: req.method,
        status: String(res.statusCode),
        org,
      };
      this.telemetry.countEvent('broker.http.request', labels);
      this.telemetry.withSpan(
        `broker.http.${routePrefix.replace(/\//g, '_')}`,
        labels,
        async () => Date.now() - start,
      ).catch(() => {
        // swallow — span recording is fire-and-forget
      });
    });
    next();
  }
}

function pickRoutePrefix(path: string): string | null {
  // Pick the first two path segments after any leading /api/v1.
  const trimmed = path.replace(/^\/?api\/v\d+/, '');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  if (
    first === 'broker' ||
    first === 'broker-portal' ||
    first === 'marketplace'
  ) {
    return segments.length >= 2 ? `${first}/${segments[1]}` : first;
  }
  return null;
}
