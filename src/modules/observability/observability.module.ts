import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PerTenantMetricsMiddleware } from './per-tenant-metrics.middleware';
import { PrometheusExporterController } from './prometheus-exporter.controller';
import { HealthController } from './health.controller';
import { TelemetryService } from './telemetry.service';
import { ExceptionRulesModule } from '../exception-rules/exception-rules.module';

@Global()
@Module({
  imports: [ExceptionRulesModule], // for HealthController → ExceptionRuleRegistry
  controllers: [PrometheusExporterController, HealthController],
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
