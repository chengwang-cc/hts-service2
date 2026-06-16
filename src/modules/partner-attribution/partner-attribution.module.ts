import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../auth/entities/organization.entity';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ApiUsageMetricEntity } from '../api-keys/entities/api-usage-metric.entity';
import { QueueModule } from '../queue/queue.module';
import { PartnerOriginEntity } from './entities/partner-origin.entity';
import { PartnerUserEntity } from './entities/partner-user.entity';
import { PartnerOriginCacheService } from './services/partner-origin-cache.service';
import { PartnerResolverService } from './services/partner-resolver.service';
import { PartnerRateLimitService } from './services/partner-rate-limit.service';
import { PartnerRateLimitMiddleware } from './middleware/partner-rate-limit.middleware';
import { AttributionMiddleware } from './middleware/attribution.middleware';
import { UsageRecordingInterceptor } from './interceptors/usage-recording.interceptor';
import { ApiUsageRecorderWorker } from './workers/api-usage-recorder.worker';
import { PartnerUsageRollupWorker } from './workers/partner-usage-rollup.worker';
import { PartnerUsageMonthlyRollupWorker } from './workers/partner-usage-monthly-rollup.worker';
import { PartnerAnomalyAlertWorker } from './workers/partner-anomaly-alert.worker';
import { PartnerUsageAdminController } from './controllers/partner-usage.admin.controller';
import { PartnerUsageController } from './controllers/partner-usage.controller';
import { PortalPartnerUsageController } from './controllers/portal-partner-usage.controller';
import { PartnerApiKeyAdminController } from './controllers/partner-api-key.admin.controller';
import { PartnerBillingAdminController } from './controllers/partner-billing.admin.controller';
import { PartnerUsageQueryService } from './services/partner-usage-query.service';
import { LlmUsageRecordingService } from './services/llm-usage-recording.service';
import { PartnerUsageHourlyEntity } from './entities/partner-usage-hourly.entity';
import { PartnerUsageMonthlyEntity } from './entities/partner-usage-monthly.entity';
import { AdminGuard } from '../admin/guards/admin.guard';
import { ApiKeyEntity } from '../api-keys/entities/api-key.entity';
import { BillingModule } from '../billing/billing.module';

const partnerAttributionTypeOrm = TypeOrmModule.forFeature([
  PartnerOriginEntity,
  PartnerUserEntity,
  PartnerUsageHourlyEntity,
  PartnerUsageMonthlyEntity,
  OrganizationEntity,
  ApiUsageMetricEntity,
  ApiKeyEntity,
]);

@Module({
  imports: [partnerAttributionTypeOrm, ApiKeysModule, QueueModule, BillingModule],
  controllers: [
    PartnerUsageAdminController,
    PartnerUsageController,
    PortalPartnerUsageController,
    PartnerApiKeyAdminController,
    PartnerBillingAdminController,
  ],
  providers: [
    PartnerOriginCacheService,
    PartnerResolverService,
    PartnerUsageQueryService,
    LlmUsageRecordingService,
    PartnerRateLimitService,
    AttributionMiddleware,
    PartnerRateLimitMiddleware,
    UsageRecordingInterceptor,
    ApiUsageRecorderWorker,
    PartnerUsageRollupWorker,
    PartnerUsageMonthlyRollupWorker,
    PartnerAnomalyAlertWorker,
    AdminGuard,
    // Register as a global interceptor from inside this module so DI can see
    // QueueService (provided by QueueModule, which this module imports).
    {
      provide: APP_INTERCEPTOR,
      useClass: UsageRecordingInterceptor,
    },
  ],
  exports: [
    PartnerOriginCacheService,
    PartnerResolverService,
    PartnerRateLimitService,
    AttributionMiddleware,
    PartnerRateLimitMiddleware,
    UsageRecordingInterceptor,
    LlmUsageRecordingService,
    // Re-export the TypeORM feature so AppModule (which applies
    // AttributionMiddleware globally) can resolve the middleware's
    // repository dependencies from its own DI context.
    partnerAttributionTypeOrm,
  ],
})
export class PartnerAttributionModule {}
