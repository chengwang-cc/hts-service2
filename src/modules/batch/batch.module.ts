import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchJobEntity } from './entities/batch-job.entity';
import { BatchJobItemEntity } from './entities/batch-job-item.entity';
import { BatchJobService } from './services/batch-job.service';
import { BatchWorkerService } from './services/batch-worker.service';
import { BatchController } from './batch.controller';
import { QueueModule } from '../queue/queue.module';
import { AuthModule } from '../auth/auth.module';
import { LookupModule } from '../lookup/lookup.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BatchJobEntity, BatchJobItemEntity]),
    QueueModule,
    AuthModule,
    LookupModule,
  ],
  controllers: [BatchController],
  providers: [BatchJobService, BatchWorkerService],
  exports: [BatchJobService],
})
export class BatchModule {}
