import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueModule } from '../queue/queue.module';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AuditRetentionWorker } from './jobs/audit-retention.worker';
import { BrokerApiAccessMiddleware } from './middleware/broker-api-access.middleware';
import { AuditService } from './services/audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditEventEntity]), QueueModule],
  providers: [AuditService, BrokerApiAccessMiddleware, AuditRetentionWorker],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(BrokerApiAccessMiddleware)
      .forRoutes('broker/*', 'broker-portal/*', 'marketplace/*');
  }
}
