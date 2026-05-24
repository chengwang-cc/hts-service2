import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ClassificationCandidateEntity,
  ClassificationEntity,
} from '../catalog/entities';
import { CatalogModule } from '../catalog/catalog.module';
import { LookupModule } from '../lookup/lookup.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { QueueModule } from '../queue/queue.module';
import { ClassificationController } from './controllers/classification.controller';
import { ClassifyService } from './services/classify.service';

/**
 * ClassificationModule (P2.1)
 *
 * Exposes `POST /classify`, `POST /classify.api`, `POST /classify/bulk`,
 * `GET /classify/jobs/:id` and wraps the existing lookup classifier to:
 *   - persist candidates into the catalog
 *   - skip work when a confirmed ClassificationEntity already exists
 *
 * Does NOT physically move classification.service.ts; promotes it via
 * composition so that all the lookup-internal callers keep working.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClassificationEntity,
      ClassificationCandidateEntity,
    ]),
    CatalogModule,
    LookupModule,
    ApiKeysModule,
    QueueModule,
  ],
  controllers: [ClassificationController],
  providers: [ClassifyService],
  exports: [ClassifyService],
})
export class ClassificationModule {}
