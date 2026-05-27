import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { E2eTeardownWorker } from './jobs/e2e-teardown.worker';
import { E2eTeardownService } from './services/e2e-teardown.service';

@Module({
  imports: [QueueModule],
  providers: [E2eTeardownService, E2eTeardownWorker],
  exports: [E2eTeardownService],
})
export class E2eTeardownModule {}
