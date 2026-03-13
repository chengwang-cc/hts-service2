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
  HtsSettingEntity,
  HtsStageEntryEntity,
  HtsStageValidationIssueEntity,
  HtsStageDiffEntity,
  HtsExtraTaxEntity,
  HtsFormulaUpdateEntity,
  HtsFormulaCandidateEntity,
  HtsTestCaseEntity,
  HtsTestResultEntity,
  ExternalProviderFormulaEntity,
  HtsTariffHistory2025Entity,
} from '@hts/core';

// Entities - Phase 3
import { HtsDocumentEntity, KnowledgeChunkEntity } from '@hts/knowledgebase';

// Entities - Phase 5
import { LookupConversationFeedbackEntity } from '@hts/lookup';

// Core Services (from packages)
import {
  HtsProcessorService,
  FormulaGenerationService,
  OpenAiService,
} from '@hts/core';
import { FormulaEvaluationService } from '@hts/calculator';

// Wrapper modules that provide services with repository access
import { CoreWrapperModule } from '../core/core.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { KnowledgebaseModule } from '../knowledgebase/knowledgebase.module';
import { LookupModule } from '../lookup/lookup.module';

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
import { ExternalProviderFormulaAdminController } from './controllers/external-provider-formula.admin.controller';
import { ReciprocalTariffAdminController } from './controllers/reciprocal-tariff.admin.controller';
import { HtsEmbeddingAdminController } from './controllers/hts-embedding.admin.controller';

// Controllers - Phase 6
import { RerankerRetrainAdminController } from './controllers/reranker-retrain.admin.controller';

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
import { ExternalProviderFormulaAdminService } from './services/external-provider-formula.admin.service';
import { ReciprocalTariffAdminService } from './services/reciprocal-tariff.admin.service';
import { LookupAccuracySmokeService } from './services/lookup-accuracy-smoke.service';
import { LookupAccuracyReportService } from './services/lookup-accuracy-report.service';

// Job Handlers - Phase 2
import { HtsImportJobHandler } from './jobs/hts-import.job-handler';
import { FormulaGenerationJobHandler } from './jobs/formula-generation.job-handler';
import { TestBatchExecutionJobHandler } from './jobs/test-batch-execution.job-handler';
import { AdminPermissionsGuard } from './guards/admin-permissions.guard';

// Job Handlers - Phase 3
import { DocumentProcessingJobHandler } from './jobs/document-processing.job-handler';
import { EmbeddingGenerationJobHandler } from './jobs/embedding-generation.job-handler';
import { LookupAccuracyReportJobHandler } from './jobs/lookup-accuracy-report.job-handler';

// Services + Job Handlers - Phase 5
import { LookupRuleAnalysisService } from './services/lookup-rule-analysis.service';
import { LookupRuleAnalysisJobHandler } from './jobs/lookup-rule-analysis.job-handler';

// Services + Job Handlers - Phase 6
import { RerankerRetrainService } from './services/reranker-retrain.service';
import { RerankerRetrainJobHandler } from './jobs/reranker-retrain.job-handler';
import { RerankerTrainingRunEntity } from './entities/reranker-training-run.entity';

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
      HtsSettingEntity,
      HtsStageEntryEntity,
      HtsStageValidationIssueEntity,
      HtsStageDiffEntity,
      HtsExtraTaxEntity,
      HtsFormulaUpdateEntity,
      HtsFormulaCandidateEntity,
      HtsTestCaseEntity,
      HtsTestResultEntity,
      ExternalProviderFormulaEntity,
      HtsTariffHistory2025Entity,
      // Phase 3 entities
      HtsDocumentEntity,
      KnowledgeChunkEntity,
      // Phase 5 entities
      LookupConversationFeedbackEntity,
      // Phase 6 entities
      RerankerTrainingRunEntity,
    ]),
    // Import wrapper modules to access services with repositories
    CoreWrapperModule,
    CalculatorModule,
    KnowledgebaseModule,
    LookupModule,
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
    ExternalProviderFormulaAdminController,
    ReciprocalTariffAdminController,
    HtsEmbeddingAdminController,
    // Phase 6 controllers
    RerankerRetrainAdminController,
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
    ExternalProviderFormulaAdminService,
    ReciprocalTariffAdminService,
    LookupAccuracySmokeService,
    LookupAccuracyReportService,
    // Job handlers - Phase 2
    HtsImportJobHandler,
    FormulaGenerationJobHandler,
    TestBatchExecutionJobHandler,
    // Job handlers - Phase 3
    DocumentProcessingJobHandler,
    EmbeddingGenerationJobHandler,
    LookupAccuracyReportJobHandler,
    // Services + Job handlers - Phase 5
    LookupRuleAnalysisService,
    LookupRuleAnalysisJobHandler,
    // Services + Job handlers - Phase 6
    RerankerRetrainService,
    RerankerRetrainJobHandler,
    AdminPermissionsGuard,
    // Core services (imported from wrapper modules, not provided here)
    // HtsProcessorService, FormulaGenerationService, HtsEmbeddingGenerationService, FormulaEvaluationService, OpenAiService - from CoreWrapperModule
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
    ExternalProviderFormulaAdminService,
    ReciprocalTariffAdminService,
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
    private lookupAccuracyReportHandler: LookupAccuracyReportJobHandler,
    private lookupRuleAnalysisHandler: LookupRuleAnalysisJobHandler,
    private rerankerRetrainHandler: RerankerRetrainJobHandler,
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

    await this.queueService.registerHandler('lookup-accuracy-report', (job) =>
      this.lookupAccuracyReportHandler.execute(job),
    );

    await this.queueService.registerHandler('lookup-rule-analysis', (job) =>
      this.lookupRuleAnalysisHandler.execute(job),
    );

    await this.queueService.registerHandler('reranker-retrain', (job) =>
      this.rerankerRetrainHandler.execute(job),
    );

    this.logger.log('Job handlers registered successfully (8 handlers)');

    await this.configureNightlyLookupAccuracySchedule();
    await this.configureWeeklyRuleAnalysisSchedule();
    await this.configureMonthlyRerankerRetrainSchedule();
  }

  private async configureNightlyLookupAccuracySchedule(): Promise<void> {
    const enabledRaw = process.env.HTS_LOOKUP_NIGHTLY_ENABLED;
    const enabled =
      enabledRaw !== undefined
        ? enabledRaw === 'true'
        : process.env.NODE_ENV === 'production';

    if (!enabled) {
      this.logger.log(
        'Nightly lookup accuracy schedule disabled (HTS_LOOKUP_NIGHTLY_ENABLED=false).',
      );
      return;
    }

    const cronExpression = process.env.HTS_LOOKUP_NIGHTLY_CRON || '0 6 * * *';
    const timezone = process.env.HTS_LOOKUP_NIGHTLY_TZ || 'UTC';

    await this.queueService.scheduleJob(
      'lookup-accuracy-report',
      cronExpression,
      {
        triggeredBy: 'nightly-schedule',
      },
      { tz: timezone },
    );

    this.logger.log(
      `Nightly lookup accuracy schedule active: cron="${cronExpression}" tz=${timezone}`,
    );
  }

  private async configureWeeklyRuleAnalysisSchedule(): Promise<void> {
    const enabledRaw = process.env.HTS_RULE_ANALYSIS_ENABLED;
    const enabled =
      enabledRaw !== undefined
        ? enabledRaw === 'true'
        : process.env.NODE_ENV === 'production';

    if (!enabled) {
      this.logger.log(
        'Weekly rule analysis schedule disabled (HTS_RULE_ANALYSIS_ENABLED=false).',
      );
      return;
    }

    // Default: every Monday at 07:00 UTC
    const cronExpression = process.env.HTS_RULE_ANALYSIS_CRON || '0 7 * * 1';
    const timezone = process.env.HTS_RULE_ANALYSIS_TZ || 'UTC';

    await this.queueService.scheduleJob(
      'lookup-rule-analysis',
      cronExpression,
      { triggeredBy: 'weekly-schedule' },
      { tz: timezone },
    );

    this.logger.log(
      `Weekly rule analysis schedule active: cron="${cronExpression}" tz=${timezone}`,
    );
  }

  private async configureMonthlyRerankerRetrainSchedule(): Promise<void> {
    const enabled = process.env.RERANKER_RETRAIN_ENABLED === 'true';

    if (!enabled) {
      this.logger.log(
        'Monthly reranker retrain schedule disabled (RERANKER_RETRAIN_ENABLED != true).',
      );
      return;
    }

    const cronExpression = process.env.RERANKER_RETRAIN_CRON || '0 2 1 * *';

    await this.queueService.scheduleJob(
      'reranker-retrain',
      cronExpression,
      { triggeredBy: 'cron' },
    );

    this.logger.log(
      `Monthly reranker retrain schedule active: cron="${cronExpression}"`,
    );
  }
}
