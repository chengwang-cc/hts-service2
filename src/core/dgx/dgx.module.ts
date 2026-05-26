import { Global, Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DgxRerankerService } from './dgx-reranker.service';

/**
 * DGX Spark Module
 *
 * Provides HTTP clients for the self-hosted AI services running on the
 * DGX Spark supercomputer (192.168.1.201):
 *   - /rerank  → DgxRerankerService   (port 8002, via nginx :80)
 *
 * The embedding service (port 8001 / `/embed`) was retired 2026-05-27.
 * Embeddings now go through `OpenAI.text-embedding-3-small` exclusively.
 * The reranker is preserved because it serves a different purpose
 * (cross-encoder ranking, not vector generation or LLM completion).
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
  providers: [DgxRerankerService],
  exports: [DgxRerankerService],
})
export class DgxModule {}
