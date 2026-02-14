/**
 * Admin Module
 * Provides admin-level management functionality
 */

import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities - Phase 1
import { UserEntity } from '../auth/entities/user.entity';
import { RoleEntity } from '../auth/entities/role.entity';
import { OrganizationEntity } from '../auth/entities/organization.entity';

// Entities - Phase 2
import {
  HtsEntity,
  HtsImportHistoryEntity,
  HtsFormulaCandidateEntity,
  HtsTestCaseEntity,
  HtsTestResultEntity,
} from '@hts/core';

// Entities - Phase 3
import { HtsDocumentEntity, KnowledgeChunkEntity } from '@hts/knowledgebase';

// Core Services (from packages)
import { HtsProcessorService, FormulaGenerationService, OpenAiService } from '@hts/core';
import { FormulaEvaluationService } from '@hts/calculator';

// Wrapper modules that provide services with repository access
import { CoreWrapperModule } from '../core/core.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';

// Queue Module (provides QueueService with ConfigService)
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';

// Controllers - Phase 1
import { UsersAdminController } from './controllers/users.admin.controller';
import { RolesAdminController } from './controllers/roles.admin.controller';
import { PermissionsAdminController } from './controllers/permissions.admin.controller';
import { AnalyticsAdminController } from './controllers/analytics.admin.controller';

// Controllers - Phase 2
import { HtsImportAdminController } from './controllers/hts-import.admin.controller';
import { FormulaAdminController } from './controllers/formula.admin.controller';
import { TestCaseAdminController } from './controllers/test-case.admin.controller';

// Controllers - Phase 3
import { KnowledgeAdminController } from './controllers/knowledge.admin.controller';

// Services - Phase 1
import { UsersAdminService } from './services/users.admin.service';
import { RolesAdminService } from './services/roles.admin.service';
import { AnalyticsAdminService } from './services/analytics.admin.service';

// Services - Phase 2
import { HtsImportService } from './services/hts-import.service';
import { FormulaAdminService } from './services/formula.admin.service';
import { TestCaseService } from './services/test-case.service';

// Services - Phase 3
import { KnowledgeAdminService } from './services/knowledge.admin.service';

// Job Handlers - Phase 2
import { HtsImportJobHandler } from './jobs/hts-import.job-handler';
import { FormulaGenerationJobHandler } from './jobs/formula-generation.job-handler';
import { TestBatchExecutionJobHandler } from './jobs/test-batch-execution.job-handler';

// Job Handlers - Phase 3
import { DocumentProcessingJobHandler } from './jobs/document-processing.job-handler';
import { EmbeddingGenerationJobHandler } from './jobs/embedding-generation.job-handler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Phase 1 entities
      UserEntity,
      RoleEntity,
      OrganizationEntity,
      // Phase 2 entities
      HtsEntity,
      HtsImportHistoryEntity,
      HtsFormulaCandidateEntity,
      HtsTestCaseEntity,
      HtsTestResultEntity,
      // Phase 3 entities
      HtsDocumentEntity,
      KnowledgeChunkEntity,
    ]),
    // Import wrapper modules to access services with repositories
    CoreWrapperModule,
    CalculatorModule,
    KnowledgebaseModule,
    // Import QueueModule to access QueueService with ConfigService
    QueueModule,
  ],
  controllers: [
    // Phase 1 controllers
    UsersAdminController,
    RolesAdminController,
    PermissionsAdminController,
    AnalyticsAdminController,
    // Phase 2 controllers
    HtsImportAdminController,
    FormulaAdminController,
    TestCaseAdminController,
    // Phase 3 controllers
    KnowledgeAdminController,
  ],
  providers: [
    // Phase 1 services
    UsersAdminService,
    RolesAdminService,
    AnalyticsAdminService,
    // Phase 2 services
    HtsImportService,
    FormulaAdminService,
    TestCaseService,
    // Phase 3 services
    KnowledgeAdminService,
    // Job handlers - Phase 2
    HtsImportJobHandler,
    FormulaGenerationJobHandler,
    TestBatchExecutionJobHandler,
    // Job handlers - Phase 3
    DocumentProcessingJobHandler,
    EmbeddingGenerationJobHandler,
    // Core services (imported from wrapper modules, not provided here)
    // HtsProcessorService, FormulaGenerationService, FormulaEvaluationService, OpenAiService - from wrapper modules
    // QueueService - from QueueModule
  ],
  exports: [
    UsersAdminService,
    RolesAdminService,
    AnalyticsAdminService,
    HtsImportService,
    FormulaAdminService,
    TestCaseService,
    KnowledgeAdminService,
  ],
})
export class AdminModule implements OnModuleInit {
  private readonly logger = new Logger(AdminModule.name);

  constructor(
    private queueService: QueueService,
    private importHandler: HtsImportJobHandler,
    private formulaHandler: FormulaGenerationJobHandler,
    private testBatchHandler: TestBatchExecutionJobHandler,
    private documentProcessingHandler: DocumentProcessingJobHandler,
    private embeddingGenerationHandler: EmbeddingGenerationJobHandler,
  ) {}

  async onModuleInit() {
    this.logger.log('Registering job handlers with queue service...');

    // Register job handlers with pg-boss
    await this.queueService.registerHandler('hts-import', (job) =>
      this.importHandler.execute(job),
    );

    await this.queueService.registerHandler('formula-generation', (job) =>
      this.formulaHandler.execute(job),
    );

    await this.queueService.registerHandler('test-batch-execution', (job) =>
      this.testBatchHandler.execute(job),
    );

    await this.queueService.registerHandler('document-processing', (job) =>
      this.documentProcessingHandler.execute(job),
    );

    await this.queueService.registerHandler('embedding-generation', (job) =>
      this.embeddingGenerationHandler.execute(job),
    );

    this.logger.log('Job handlers registered successfully (5 handlers)');
  }
}
