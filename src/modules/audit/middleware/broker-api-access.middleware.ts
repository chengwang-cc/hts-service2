import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuditService } from '../services/audit.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BROKER_PATH_PREFIXES = ['/broker', '/broker-portal', '/marketplace'];

/**
 * Records a low-cardinality `broker.api.access` audit event for any
 * successful write call on a broker / broker-portal / marketplace route.
 * Skipped for unauthenticated and read-only requests to keep audit volume
 * dominated by intent-bearing writes rather than poll-style reads.
 */
@Injectable()
export class BrokerApiAccessMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BrokerApiAccessMiddleware.name);

  constructor(private readonly audit: AuditService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!WRITE_METHODS.has(req.method)) return next();
    const path = req.originalUrl?.split('?')[0] ?? req.url;
    const matched = BROKER_PATH_PREFIXES.some((prefix) =>
      pathStartsWith(path, prefix),
    );
    if (!matched) return next();

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const user = (req as any).user as
        | { id?: string; organizationId?: string }
        | undefined;
      if (!user?.id || !user?.organizationId) return;
      this.audit
        .record({
          eventType: 'broker.api.access',
          organizationId: user.organizationId,
          actorUserId: user.id,
          resourceType: 'http_request',
          source: 'middleware',
          ipAddress: extractIp(req),
          userAgent: req.headers['user-agent'] ?? null,
          metadata: {
            method: req.method,
            path,
            status: res.statusCode,
          },
        })
        .catch((err) =>
          this.logger.warn(
            `broker.api.access audit failed: ${(err as Error).message}`,
          ),
        );
    });
    next();
  }
}

function pathStartsWith(path: string, prefix: string): boolean {
  // Match paths like /api/v1/broker/... or /broker/... (no api/v1 prefix).
  return (
    path.startsWith(`${prefix}/`) ||
    path === prefix ||
    path.includes(`/api/v1${prefix}/`)
  );
}

function extractIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string') return real;
  return req.socket?.remoteAddress ?? null;
}
