import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModuleOptions } from './interfaces/core-config.interface';

// Entities
import {
  HtsEntity,
  HtsEmbeddingEntity,
  HtsFormulaUpdateEntity,
  HtsTestCaseEntity,
  HtsTestResultEntity,
  HtsImportHistoryEntity,
  HtsSettingEntity,
  HtsExtraTaxEntity,
} from './entities';

// Services
import { OpenAiService } from './services/openai.service';
import { VisionService } from './services/vision.service';
import { EmbeddingService } from './services/embedding.service';
import { UsitcDownloaderService } from './services/usitc-downloader.service';
import { HtsProcessorService } from './services/hts-processor.service';
import { FormulaGenerationService } from './services/formula-generation.service';
import { HtsEmbeddingGenerationService } from './services/hts-embedding-generation.service';
import { HtsFormulaUpdateService } from './services/hts-formula-update.service';
import { HtsFormulaGenerationService } from './services/hts-formula-generation.service';
import { HtsFormulaUpdateController } from './controllers/hts-formula-update.controller';

// Repositories
import { HtsRepository } from './repositories/hts.repository';

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

      // HTS Repository
      HtsRepository,

      // USITC Downloader Service
      UsitcDownloaderService,

      // HTS Processor Service
      HtsProcessorService,

      // Formula Generation Service
      FormulaGenerationService,
    ];

    return {
      module: CoreModule,
      global: true,
      imports: [
        // TypeORM entities
        TypeOrmModule.forFeature([
          HtsEntity,
          HtsEmbeddingEntity,
          HtsFormulaUpdateEntity,
          HtsTestCaseEntity,
          HtsTestResultEntity,
          HtsImportHistoryEntity,
          HtsSettingEntity,
          HtsExtraTaxEntity,
        ]),
      ],
      providers: [...providers, HtsFormulaUpdateService, HtsFormulaGenerationService],
      controllers: [HtsFormulaUpdateController],
      exports: [
        // Export TypeORM repositories
        TypeOrmModule,

        // Export services
        OpenAiService,
        VisionService,
        EmbeddingService,
        HtsRepository,
        UsitcDownloaderService,
        HtsProcessorService,
        FormulaGenerationService,
        HtsFormulaUpdateService,
        HtsFormulaGenerationService,

        // Export config
        'CORE_CONFIG',
      ],
    };
  }

  /**
   * Configure Core Module for use in other modules (without root config)
   * Use this when the root module has already been configured
   */
  static forFeature(): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        TypeOrmModule.forFeature([
          HtsEntity,
          HtsEmbeddingEntity,
          HtsFormulaUpdateEntity,
          HtsTestCaseEntity,
          HtsTestResultEntity,
          HtsImportHistoryEntity,
          HtsSettingEntity,
          HtsExtraTaxEntity,
        ]),
      ],
      providers: [
        EmbeddingService,
        HtsProcessorService,
        FormulaGenerationService,
        HtsEmbeddingGenerationService,
        HtsFormulaUpdateService,
        HtsFormulaGenerationService,
      ],
      exports: [
        TypeOrmModule,
        EmbeddingService,
        HtsProcessorService,
        FormulaGenerationService,
        HtsEmbeddingGenerationService,
        HtsFormulaUpdateService,
        HtsFormulaGenerationService,
      ],
    };
  }
}
