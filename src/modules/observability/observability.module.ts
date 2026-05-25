import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PerTenantMetricsMiddleware } from './per-tenant-metrics.middleware';
import { PrometheusExporterController } from './prometheus-exporter.controller';
import { TelemetryService } from './telemetry.service';

@Global()
@Module({
  controllers: [PrometheusExporterController],
  providers: [TelemetryService, PerTenantMetricsMiddleware],
  exports: [TelemetryService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PerTenantMetricsMiddleware)
      .forRoutes('broker/*', 'broker-portal/*', 'marketplace/*');
  }
}
