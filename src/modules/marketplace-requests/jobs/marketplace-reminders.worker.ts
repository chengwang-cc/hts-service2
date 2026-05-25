import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Not, Repository } from 'typeorm';
import { OrganizationEntity } from '../../auth/entities/organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { NotificationService } from '../../notifications/notification.service';
import { QueueService } from '../../queue/queue.service';
import {
  MarketplaceBrokerMatchEntity,
  MarketplaceQuoteEntity,
  MarketplaceRequestEntity,
} from '../entities';

export const RFQ_REMINDER_QUEUE = 'marketplace.rfq.reminder';
export const QUOTE_EXPIRY_WARNING_QUEUE = 'marketplace.quote.expiry.warning';

/**
 * R2-B-02 — RFQ reminder cron. Picks matches older than the configured
 *           threshold (default 24h) where the broker hasn't viewed the
 *           lead yet, sends one notification per match, then stamps
 *           reminderNotifiedAt so we don't redeliver.
 *
 * R2-B-03 — Quote expiry warning cron. Finds submitted quotes whose
 *           expiresAt is within the warning window (default 24h ahead),
 *           emails the business, and stamps expiryWarningSentAt.
 */
@Injectable()
export class MarketplaceRemindersWorker implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceRemindersWorker.name);

  constructor(
    @InjectRepository(MarketplaceBrokerMatchEntity)
    private readonly matches: Repository<MarketplaceBrokerMatchEntity>,
    @InjectRepository(MarketplaceQuoteEntity)
    private readonly quotes: Repository<MarketplaceQuoteEntity>,
    @InjectRepository(MarketplaceRequestEntity)
    private readonly requests: Repository<MarketplaceRequestEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
    private readonly queue: QueueService,
    @Optional()
    private readonly notifications: NotificationService | null,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      RFQ_REMINDER_QUEUE,
      async () => {
        const n = await this.runRfqReminders().catch((err) => {
          this.logger.error(
            `RFQ reminder tick failed: ${(err as Error).message}`,
          );
          return 0;
        });
        if (n > 0) this.logger.log(`RFQ reminder emitted ${n} notifications`);
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    await this.queue.registerHandler(
      QUOTE_EXPIRY_WARNING_QUEUE,
      async () => {
        const n = await this.runExpiryWarnings().catch((err) => {
          this.logger.error(
            `Quote expiry warning tick failed: ${(err as Error).message}`,
          );
          return 0;
        });
        if (n > 0) {
          this.logger.log(`Quote expiry warning emitted ${n} notifications`);
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    if (process.env.JEST_WORKER_ID !== undefined) return;
    const rfqCron = process.env.MARKETPLACE_RFQ_REMINDER_CRON || '0 * * * *';
    const expiryCron =
      process.env.MARKETPLACE_QUOTE_EXPIRY_WARNING_CRON || '0 * * * *';
    try {
      await this.queue.scheduleJob(RFQ_REMINDER_QUEUE, rfqCron);
      await this.queue.scheduleJob(QUOTE_EXPIRY_WARNING_QUEUE, expiryCron);
      this.logger.log(
        `Reminders scheduled: rfq="${rfqCron}" quoteExpiry="${expiryCron}"`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to schedule reminder crons: ${(err as Error).message}`,
      );
    }
  }

  async runRfqReminders(): Promise<number> {
    const windowHours = Number(
      process.env.MARKETPLACE_RFQ_REMINDER_HOURS || 24,
    );
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const stale = await this.matches.find({
      where: {
        viewedAt: undefined as unknown as Date,
        status: Not('declined') as any,
        createdAt: LessThan(cutoff) as any,
        reminderNotifiedAt: undefined as unknown as Date,
      },
      take: 100,
    });
    let sent = 0;
    for (const match of stale) {
      // skip if already notified or already viewed (re-check defensively;
      // the find filter above is just an optimisation).
      if (match.viewedAt || match.reminderNotifiedAt) continue;
      if (this.notifications) {
        const recipient = await this.firstActiveUser(
          match.brokerOrganizationId,
        );
        const request = await this.requests.findOne({
          where: { id: match.requestId },
        });
        if (recipient?.email && request) {
          await this.notifications
            .send({
              templateKey: 'marketplace.rfq.reminder',
              subject: 'You have an unviewed RFQ in HTS Marketplace',
              bodyText: `A request matching your broker profile has been waiting ${windowHours}h.\n\nSummary: ${request.commoditySummary?.slice(0, 240) ?? '(no summary)'}\n\nReply through the broker portal to claim the lead.`,
              recipient: {
                email: recipient.email,
                userId: recipient.id,
                organizationId: match.brokerOrganizationId,
              },
              context: {
                matchId: match.id,
                requestId: match.requestId,
              },
            })
            .catch((err) =>
              this.logger.warn(
                `Reminder notification failed: ${(err as Error).message}`,
              ),
            );
        }
      }
      match.reminderNotifiedAt = new Date();
      await this.matches.save(match);
      sent += 1;
    }
    return sent;
  }

  async runExpiryWarnings(): Promise<number> {
    const windowHours = Number(
      process.env.MARKETPLACE_QUOTE_EXPIRY_WARNING_HOURS || 24,
    );
    const now = Date.now();
    const lower = new Date(now); // warn anything expiring between now and +window
    const upper = new Date(now + windowHours * 60 * 60 * 1000);
    const due = await this.quotes
      .createQueryBuilder('q')
      .where('q.status = :status', { status: 'submitted' })
      .andWhere('q.expiresAt IS NOT NULL')
      .andWhere('q.expiresAt > :lower', { lower })
      .andWhere('q.expiresAt <= :upper', { upper })
      .andWhere('q.expiryWarningSentAt IS NULL')
      .take(100)
      .getMany();
    let sent = 0;
    for (const quote of due) {
      if (this.notifications) {
        const request = await this.requests.findOne({
          where: { id: quote.requestId },
        });
        const recipient = request
          ? await this.firstActiveUser(request.requestingOrganizationId)
          : null;
        if (recipient?.email && request) {
          await this.notifications
            .send({
              templateKey: 'marketplace.quote.expiry.warning',
              subject: 'A broker quote on your RFQ expires soon',
              bodyText: `Quote ${quote.id.slice(0, 8)} on your request "${request.commoditySummary?.slice(0, 80) ?? request.id}" expires at ${quote.expiresAt?.toISOString()}.\n\nAccept or request a revision to keep the engagement moving.`,
              recipient: {
                email: recipient.email,
                userId: recipient.id,
                organizationId: request.requestingOrganizationId,
              },
              context: {
                quoteId: quote.id,
                requestId: quote.requestId,
              },
            })
            .catch((err) =>
              this.logger.warn(
                `Expiry warning notification failed: ${(err as Error).message}`,
              ),
            );
        }
      }
      quote.expiryWarningSentAt = new Date();
      await this.quotes.save(quote);
      sent += 1;
    }
    return sent;
  }

  private async firstActiveUser(
    organizationId: string,
  ): Promise<UserEntity | null> {
    return this.users.findOne({
      where: { organizationId, isActive: true },
      order: { lastLoginAt: 'DESC' },
    });
  }
}
