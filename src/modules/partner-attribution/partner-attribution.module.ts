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
import { AttributionMiddleware } from './middleware/attribution.middleware';
import { UsageRecordingInterceptor } from './interceptors/usage-recording.interceptor';
import { ApiUsageRecorderWorker } from './workers/api-usage-recorder.worker';
import { PartnerUsageAdminController } from './controllers/partner-usage.admin.controller';
import { AdminGuard } from '../admin/guards/admin.guard';

const partnerAttributionTypeOrm = TypeOrmModule.forFeature([
  PartnerOriginEntity,
  PartnerUserEntity,
  OrganizationEntity,
  ApiUsageMetricEntity,
]);

@Module({
  imports: [partnerAttributionTypeOrm, ApiKeysModule, QueueModule],
  controllers: [PartnerUsageAdminController],
  providers: [
    PartnerOriginCacheService,
    PartnerResolverService,
    AttributionMiddleware,
    UsageRecordingInterceptor,
    ApiUsageRecorderWorker,
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
    AttributionMiddleware,
    UsageRecordingInterceptor,
    // Re-export the TypeORM feature so AppModule (which applies
    // AttributionMiddleware globally) can resolve the middleware's
    // repository dependencies from its own DI context.
    partnerAttributionTypeOrm,
  ],
})
export class PartnerAttributionModule {}
