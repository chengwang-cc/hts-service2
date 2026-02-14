import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { CoreModuleOptions } from './interfaces/core-config.interface';

// Services
import { OpenAiService } from './services/openai.service';
import { VisionService } from './services/vision.service';
import { EmbeddingService } from './services/embedding.service';
import { S3StorageService } from './services/s3-storage.service';
import { UsitcDownloaderService } from './services/usitc-downloader.service';

/**
 * Core Module
 * Provides shared entities, services, and repositories for HTS system
 *
 * Usage:
 * @Module({
 *   imports: [
 *     CoreModule.forRoot({
 *       openai: {
 *         apiKey: process.env.OPENAI_API_KEY,
 *       },
 *     }),
 *   ],
 * })
 */
@Global()
@Module({})
export class CoreModule {
  /**
   * Configure Core Module with options
   */
  static forRoot(options: CoreModuleOptions): DynamicModule {
    // Create providers array
    const providers: Provider[] = [
      // Configuration
      {
        provide: 'CORE_CONFIG',
        useValue: options,
      },

      // OpenAI Service
      {
        provide: OpenAiService,
        useFactory: () => new OpenAiService(options.openai.apiKey),
      },

      // Vision Service (depends on OpenAI Service)
      VisionService,

      // Embedding Service
      EmbeddingService,

      // S3 Storage Service
      S3StorageService,

      // USITC Downloader Service
      UsitcDownloaderService,
    ];

    return {
      module: CoreModule,
      global: true,
      providers,
      exports: [
        // Export services
        OpenAiService,
        VisionService,
        EmbeddingService,
        S3StorageService,
        UsitcDownloaderService,

        // Export config
        'CORE_CONFIG',
      ],
    };
  }

  /**
   * Configure Core Module for use in other modules (without root config)
   * Use this when the root module has already been configured
   * 
   * This is a lightweight import that doesn't add any providers.
   * All repository-dependent services should be provided in the 
   * wrapper modules where TypeORM entities are registered.
   */
  static forFeature(): DynamicModule {
    return {
      module: CoreModule,
    };
  }
}
