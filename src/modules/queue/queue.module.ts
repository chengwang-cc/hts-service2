/**
 * Queue Module
 * Provides job queue functionality using pg-boss
 */

import { Module, DynamicModule, Global, Logger } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { QueueService } from './queue.service';

@Global()
@Module({})
export class QueueModule {
  private static readonly logger = new Logger(QueueModule.name);

  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: 'PG_BOSS',
          useFactory: async () => {
            const connectionString = `postgres://${process.env.DB_USERNAME || 'postgres'}:${process.env.DB_PASSWORD || ''}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_DATABASE || 'hts'}`;

            QueueModule.logger.log('Initializing pg-boss...');

            const boss = new PgBoss({
              connectionString,
              schema: 'pgboss',
              retryLimit: parseInt(process.env.QUEUE_RETRY_LIMIT || '3'),
              retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '60'),
              retryBackoff: true,
              expireInHours: parseInt(process.env.QUEUE_EXPIRE_HOURS || '24'),
              monitorStateIntervalSeconds: 60,
              archiveCompletedAfterSeconds: 86400, // 24 hours
            });

            await boss.start();
            QueueModule.logger.log('pg-boss started successfully');

            return boss;
          },
        },
        QueueService,
      ],
      exports: ['PG_BOSS', QueueService],
    };
  }
}
