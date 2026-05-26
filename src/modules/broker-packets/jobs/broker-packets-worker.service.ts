import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../queue/queue.service';
import {
  BrokerPacketsService,
  BROKER_PACKET_PROCESS_QUEUE,
} from '../services/broker-packets.service';

@Injectable()
export class BrokerPacketsWorker implements OnModuleInit {
  private readonly logger = new Logger(BrokerPacketsWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly packets: BrokerPacketsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.registerHandler(
      BROKER_PACKET_PROCESS_QUEUE,
      async (job) => {
        const { packetId } = job.data as { packetId: string };
        await this.packets.processSystem(packetId, 'queue_worker');
      },
      { teamSize: 1, teamConcurrency: 3 },
    );
    this.logger.log('Broker packet worker registered');
  }
}
