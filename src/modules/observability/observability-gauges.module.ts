import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeCardEntity } from '../knowledgebase-cards/entities/knowledge-card.entity';
import { EcommerceHandoffEntity } from '../ecommerce-handoff/entities/ecommerce-handoff.entity';
import { ObservabilityGaugeRefresherService } from './observability-gauge-refresher.service';

/**
 * Separate module from ObservabilityModule so the refresher can depend
 * on entities from other feature modules without forcing every consumer
 * of `TelemetryService` to import them too. ObservabilityModule remains
 * `@Global()` and minimal.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeCardEntity, EcommerceHandoffEntity]),
  ],
  providers: [ObservabilityGaugeRefresherService],
  exports: [ObservabilityGaugeRefresherService],
})
export class ObservabilityGaugesModule {}
