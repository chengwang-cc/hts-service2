import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';
import { ExceptionRuleRegistry } from '../exception-rules/exception-rule.registry';

/**
 * Kubernetes health endpoints (H5 fix, 2026-05-27).
 *
 *   GET /health/live   — liveness probe. Returns 200 as long as the
 *                        Node process is responsive. Cheap; no I/O.
 *   GET /health/ready  — readiness probe. Returns 200 only when the
 *                        DB is reachable AND at least one exception
 *                        rule is registered (ensures `onModuleInit`
 *                        completed across the per-country modules).
 *                        Returns 503 otherwise so k8s can pull the pod
 *                        from the Service load balancer.
 *
 * Both routes are marked `@Public()` so they bypass the global
 * `JwtAuthGuard` — probes are unauthenticated by k8s convention.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly registry: ExceptionRuleRegistry,
  ) {}

  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — process is responsive.' })
  live(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — DB reachable + rules registered.' })
  async ready(): Promise<{
    status: 'ok' | 'not_ready';
    db: 'ok' | 'unreachable';
    rules: number;
    uptime: number;
  }> {
    let dbStatus: 'ok' | 'unreachable' = 'unreachable';
    try {
      // Cheapest possible probe: round-trip `SELECT 1` through TypeORM.
      await this.dataSource.query('SELECT 1');
      dbStatus = 'ok';
    } catch {
      dbStatus = 'unreachable';
    }
    const ruleCount = this.registry.size();
    const ok = dbStatus === 'ok' && ruleCount > 0;
    if (!ok) {
      // 503 — k8s pulls the pod from the Service rotation.
      throw new (class extends Error {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        constructor() {
          super(`not_ready: db=${dbStatus} rules=${ruleCount}`);
        }
      })();
    }
    return {
      status: 'ok',
      db: dbStatus,
      rules: ruleCount,
      uptime: Math.floor(process.uptime()),
    };
  }
}
