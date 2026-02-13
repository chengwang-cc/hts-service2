import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyEntity } from './entities/api-key.entity';
import {
  ApiUsageMetricEntity,
  ApiUsageSummaryEntity,
} from './entities/api-usage-metric.entity';
import { ApiKeyService } from './services/api-key.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeysController } from './controllers/api-keys.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiKeyEntity,
      ApiUsageMetricEntity,
      ApiUsageSummaryEntity,
    ]),
  ],
  controllers: [ApiKeysController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeysModule {}
