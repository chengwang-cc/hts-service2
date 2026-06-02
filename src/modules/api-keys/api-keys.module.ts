import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyEntity } from './entities/api-key.entity';
import {
  ApiUsageMetricEntity,
  ApiUsageSummaryEntity,
} from './entities/api-usage-metric.entity';
import { ApiKeyService } from './services/api-key.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiKeyEntity,
      ApiUsageMetricEntity,
      ApiUsageSummaryEntity,
    ]),
  ],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeysModule {}
