import { Logger, Module } from '@nestjs/common';
import { HttpMailerNotificationAdapter } from './adapters/http-mailer.adapter';
import {
  LogNotificationAdapter,
  NotificationAdapter,
  NotificationService,
  NOTIFICATION_ADAPTER,
} from './notification.service';

const logger = new Logger('NotificationsModule');

function resolveProvider(): 'log' | 'http' {
  const env = (process.env.NOTIFICATION_PROVIDER ?? '').toLowerCase();
  if (env === 'log' || env === 'http') return env;
  return process.env.NOTIFICATION_HTTP_ENDPOINT ? 'http' : 'log';
}

const provider = resolveProvider();
logger.log(`Notification provider resolved to "${provider}"`);

@Module({
  providers: [
    LogNotificationAdapter,
    HttpMailerNotificationAdapter,
    {
      provide: NOTIFICATION_ADAPTER,
      inject: [LogNotificationAdapter, HttpMailerNotificationAdapter],
      useFactory: (
        log: LogNotificationAdapter,
        http: HttpMailerNotificationAdapter,
      ): NotificationAdapter => (provider === 'http' ? http : log),
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
