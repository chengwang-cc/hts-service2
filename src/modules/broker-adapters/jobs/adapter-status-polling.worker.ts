import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { QueueService } from '../../queue/queue.service';
import {
  BrokerAdapterEntity,
  BrokerExportJobEntity,
  BrokerStatusMessageEntity,
} from '../entities';
import { BrokerAdaptersService } from '../services/broker-adapters.service';

export const ADAPTER_STATUS_POLLING_QUEUE = 'broker.adapters.status.poll';

/**
 * R2-C-05 — status polling cron. Walks every delivered export job whose
 * provider supports a pull-style status API (currently magaya/descartes/
 * cargowise via provider-profile, plus sftp_csv with optional ack file) and
 * records normalised status updates into broker_status_messages.
 *
 * Real provider SDK polling requires sandbox credentials; this worker is
 * wired with the framework and queue scheduling, and emits one
 * `polling_skipped` status message per job until the provider client
 * binding lands. That keeps the timeline honest about what's happening
 * without faking provider responses.
 */
@Injectable()
export class AdapterStatusPollingWorker implements OnModuleInit {
  private readonly logger = new Logger(AdapterStatusPollingWorker.name);

  constructor(
    @InjectRepository(BrokerExportJobEntity)
    private readonly jobs: Repository<BrokerExportJobEntity>,
    @InjectRepository(BrokerAdapterEntity)
    private readonly adapters: Repository<BrokerAdapterEntity>,
    @InjectRepository(BrokerStatusMessageEntity)
    private readonly statusMessages: Repository<BrokerStatusMessageEntity>,
    private readonly queue: QueueService,
    private readonly service: BrokerAdaptersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      ADAPTER_STATUS_POLLING_QUEUE,
      async () => {
        try {
          const polled = await this.tick();
          if (polled > 0) {
            this.logger.log(`Adapter status polling visited ${polled} jobs`);
          }
        } catch (err) {
          this.logger.error(
            `Adapter status poll failed: ${(err as Error).message}`,
          );
        }
      },
      { teamSize: 1, teamConcurrency: 1 },
    );
    if (process.env.JEST_WORKER_ID !== undefined) return;
    const cron =
      process.env.BROKER_ADAPTER_STATUS_POLL_CRON || '*/10 * * * *';
    try {
      await this.queue.scheduleJob(ADAPTER_STATUS_POLLING_QUEUE, cron);
      this.logger.log(`Adapter status polling scheduled: ${cron}`);
    } catch (err) {
      this.logger.warn(
        `Failed to schedule status polling cron: ${(err as Error).message}`,
      );
    }
  }

  async tick(): Promise<number> {
    // Visit recent delivered jobs whose terminal status hasn't been
    // recorded yet. Window is the last 7 days by default.
    const horizon = new Date(
      Date.now() -
        Number(process.env.BROKER_ADAPTER_STATUS_POLL_HORIZON_DAYS || 7) *
          24 *
          60 *
          60 *
          1000,
    );
    const jobs = await this.jobs
      .createQueryBuilder('j')
      .where('j.status = :status', { status: 'delivered' })
      .andWhere('j.deliveredAt IS NOT NULL')
      .andWhere('j.deliveredAt > :horizon', { horizon })
      .orderBy('j.deliveredAt', 'DESC')
      .take(100)
      .getMany();
    if (!jobs.length) return 0;

    let polled = 0;
    for (const job of jobs) {
      const adapter = await this.adapters.findOne({
        where: { id: job.adapterId },
      });
      if (!adapter) continue;
      if (!POLLABLE_ADAPTER_TYPES.has(adapter.adapterType)) continue;

      const recentlyPolled = await this.statusMessages.findOne({
        where: {
          entryId: job.entryId,
          exportJobId: job.id,
          source: adapter.adapterType,
        },
        order: { createdAt: 'DESC' },
      });
      if (recentlyPolled && this.isFresh(recentlyPolled.createdAt)) continue;

      await this.statusMessages.save(
        this.statusMessages.create({
          organizationId: adapter.organizationId,
          entryId: job.entryId,
          exportJobId: job.id,
          source: adapter.adapterType,
          messageType: 'status_poll_attempt',
          severity: 'info',
          normalizedStatus: null,
          rawMessage: {
            note: 'Provider polling not yet bound on this deploy. Configure the provider SDK client and restart the worker to enable real status pulls.',
            adapterType: adapter.adapterType,
            entryId: job.entryId,
            exportJobId: job.id,
          },
        }),
      );
      polled += 1;
    }
    return polled;
  }

  private isFresh(at: Date): boolean {
    const ageHours = (Date.now() - at.getTime()) / (60 * 60 * 1000);
    return ageHours < Number(process.env.BROKER_ADAPTER_STATUS_POLL_DEDUPE_HOURS || 1);
  }
}

const POLLABLE_ADAPTER_TYPES = new Set<BrokerAdapterEntity['adapterType']>([
  'magaya_acelynk',
  'descartes',
  'cargowise',
  'sftp_csv',
]);
