import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DgxEmbeddingService } from './dgx-embedding.service';
import { DgxRerankerService } from './dgx-reranker.service';

/**
 * DGX Spark Module
 *
 * Provides HTTP clients for the self-hosted AI services running on the
 * DGX Spark supercomputer (192.168.1.201):
 *   - /embed   → DgxEmbeddingService  (port 8001, via nginx :80)
 *   - /rerank  → DgxRerankerService   (port 8002, via nginx :80)
 *
 * Marked @Global so it can be injected anywhere without re-importing.
 */
@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>('DGX_SPARK_URL', 'http://192.168.1.201'),
        timeout: config.get<number>('DGX_REQUEST_TIMEOUT_MS', 15_000),
        headers: {
          'x-api-key': config.get<string>('DGX_SPARK_API_KEY', ''),
          'Content-Type': 'application/json',
        },
      }),
    }),
  ],
  providers: [DgxEmbeddingService, DgxRerankerService],
  exports: [DgxEmbeddingService, DgxRerankerService],
})
export class DgxModule {}
