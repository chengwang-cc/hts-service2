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
import { ApiKeysAdminController } from './controllers/api-keys.admin.controller';
import { AdminGuard } from '../admin/guards/admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApiKeyEntity,
      ApiUsageMetricEntity,
      ApiUsageSummaryEntity,
    ]),
  ],
  controllers: [ApiKeysController, ApiKeysAdminController],
  // AdminGuard is declared here (not just imported via AdminModule) because
  // Nest instantiates per-controller @UseGuards in the consumer module's
  // DI context — same pattern as partner-attribution.module.ts.
  providers: [ApiKeyService, ApiKeyGuard, AdminGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeysModule {}
