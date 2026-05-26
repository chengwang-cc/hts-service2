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
import {
  FormulaEvaluationService,
  TariffCardShadowComparisonEntity,
  TariffEvidenceEntity,
  TariffKnowledgeCardEntity,
} from '@hts/calculator';

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
import { PolicyDocumentEntity } from './entities/policy-document.entity';
import { PolicyChangeProposalEntity } from './entities/policy-change-proposal.entity';
import { ExternalProviderQuoteEntity } from './entities/external-provider-quote.entity';
import { BrokerGoldenSetCaseEntity } from './entities/broker-golden-set-case.entity';
import { EvidenceReconciliationPacketEntity } from './entities/evidence-reconciliation-packet.entity';
import { CbpCrossRulingEntity } from './entities/cbp-cross-ruling.entity';
import { FormulaAccuracyLabReportEntity } from './entities/formula-accuracy-lab-report.entity';
import { FormulaMaintenanceRunEntity } from './entities/formula-maintenance-run.entity';
import { FormulaMaintenanceItemEntity } from './entities/formula-maintenance-item.entity';

// P1.7 — Formula Stale Scan
import { FormulaStaleScanJobHandler } from './jobs/formula-stale-scan.job-handler';

// P2.4 — Classify Bulk
import { ClassifyBulkJobHandler } from './jobs/classify-bulk.job-handler';
import { ClassificationModule } from '../classification/classification.module';

// P3.4 — Landed-Cost Quote Expirer
import { LandedCostQuoteExpirerJobHandler } from './jobs/landed-cost-quote-expirer.job-handler';
import { LandedCostModule } from '../landed-cost/landed-cost.module';

// P4.3 — Jurisdiction Rules Admin
import { JurisdictionRulesAdminController } from './controllers/jurisdiction-rules.admin.controller';
import {
  FeeRuleEntity,
  LowValueRuleEntity,
  TariffSourceEntity,
  TaxRuleEntity,
} from '../jurisdiction/entities';

// Parity Comparison Platform (sibling plan 1725)
import { ParityComparisonRunEntity } from './entities/parity-comparison-run.entity';
import { ParityComparisonRowEntity } from './entities/parity-comparison-row.entity';
import { ParityCorpusService } from './services/parity-corpus.service';
import { ParityAdminService } from './services/parity.admin.service';
import { ParityAdminController } from './controllers/parity.admin.controller';
import { FormulaAccuracyAdminController } from './controllers/formula-accuracy.admin.controller';
import { FormulaAiValidationAdminController } from './controllers/formula-ai-validation.admin.controller';
import { FormulaMaintenanceAdminController } from './controllers/formula-maintenance.admin.controller';
import { TariffParityComparisonJobHandler } from './jobs/tariff-parity-comparison.job-handler';
import { ParityAiValidateJobHandler } from './jobs/parity-ai-validate.job-handler';
import { PublicApiModule } from '../public-api/public-api.module';
import { PolicyChangeMonitorService } from './services/policy-change-monitor.service';
import { ExternalProviderQuoteService } from './services/external-provider-quote.service';
import { BrokerGoldenSetService } from './services/broker-golden-set.service';
import { PolicyChangeMonitorJobHandler } from './jobs/policy-change-monitor.job-handler';
import { TariffKnowledgeCardRecomputeJobHandler } from './jobs/tariff-knowledge-card-recompute.job-handler';
import { BrokerGoldenSetValidationJobHandler } from './jobs/broker-golden-set-validation.job-handler';
import { ExternalProviderOracleJobHandler } from './jobs/external-provider-oracle.job-handler';
import { CbpCrossRulingService } from './services/cbp-cross-ruling.service';
import { CbpCrossIngestJobHandler } from './jobs/cbp-cross-ingest.job-handler';
import { EvidenceReconciliationService } from './services/evidence-reconciliation.service';
import { EvidenceReconcileJobHandler } from './jobs/evidence-reconcile.job-handler';
import { FormulaAccuracyLabService } from './services/formula-accuracy-lab.service';
import { FormulaAccuracyLabJobHandler } from './jobs/formula-accuracy-lab.job-handler';
import { FormulaMaintenanceService } from './services/formula-maintenance.service';
import { FormulaMaintenanceJobHandler } from './jobs/formula-maintenance.job-handler';
import { FormulaAiValidationHealthService } from './services/formula-ai-validation-health.service';
import { FormulaSourcePackService } from './services/formula-source-pack.service';
import {
  ClaudeFormulaJudgeService,
  CodexFormulaExtractorService,
  FormulaExtractorPromptService,
  QwenFormulaExtractorService,
} from './services/formula-llm-runner.service';
import {
  FORMULA_EVIDENCE_RECONCILIATION_GATEWAY,
  FormulaLlmComparisonService,
} from './services/formula-llm-comparison.service';
import { FormulaAiEvidenceService } from './services/formula-ai-evidence.service';
import { FormulaAiSkillRegistryService } from './services/formula-ai-skill-registry.service';
import { FormulaAiRunArtifactService } from './services/formula-ai-run-artifact.service';
import { FormulaAiRolloutService } from './services/formula-ai-rollout.service';
import { FormulaAiHoldoutEvaluationJobHandler } from './jobs/formula-ai-holdout-evaluation.job-handler';
import { FormulaValidationArtifactService } from './services/formula-validation-artifact.service';

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
      // P4.3 — Jurisdiction rule entities for the admin CRUD controller
      TaxRuleEntity,
      FeeRuleEntity,
      LowValueRuleEntity,
      // Parity comparison platform
      ParityComparisonRunEntity,
      ParityComparisonRowEntity,
      // Formula accuracy operating model
      PolicyDocumentEntity,
      PolicyChangeProposalEntity,
      ExternalProviderQuoteEntity,
      BrokerGoldenSetCaseEntity,
      EvidenceReconciliationPacketEntity,
      CbpCrossRulingEntity,
      FormulaAccuracyLabReportEntity,
      FormulaMaintenanceRunEntity,
      FormulaMaintenanceItemEntity,
      TariffEvidenceEntity,
      TariffKnowledgeCardEntity,
      TariffCardShadowComparisonEntity,
      TariffSourceEntity,
    ]),
    // Import wrapper modules to access services with repositories
    CoreWrapperModule,
    CalculatorModule,
    KnowledgebaseModule,
    LookupModule,
    // P2 — classification module exposes ClassifyService for the bulk job
    ClassificationModule,
    // P3 — landed-cost module exposes LandedCostService for the expirer job
    LandedCostModule,
    // Parity needs AiServiceProxyService (lives in PublicApiModule)
    PublicApiModule,
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
    // P4.3 controllers
    JurisdictionRulesAdminController,
    // Parity comparison platform
    ParityAdminController,
    FormulaAccuracyAdminController,
    FormulaAiValidationAdminController,
    FormulaMaintenanceAdminController,
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
    // Job handlers - P1.7
    FormulaStaleScanJobHandler,
    // Job handlers - P2.4
    ClassifyBulkJobHandler,
    // Job handlers - P3.4
    LandedCostQuoteExpirerJobHandler,
    // Parity comparison platform
    ParityCorpusService,
    ParityAdminService,
    TariffParityComparisonJobHandler,
    ParityAiValidateJobHandler,
    PolicyChangeMonitorService,
    ExternalProviderQuoteService,
    BrokerGoldenSetService,
    CbpCrossRulingService,
    EvidenceReconciliationService,
    {
      provide: FORMULA_EVIDENCE_RECONCILIATION_GATEWAY,
      useExisting: EvidenceReconciliationService,
    },
    FormulaAccuracyLabService,
    FormulaMaintenanceService,
    FormulaAiValidationHealthService,
    FormulaSourcePackService,
    FormulaExtractorPromptService,
    QwenFormulaExtractorService,
    CodexFormulaExtractorService,
    ClaudeFormulaJudgeService,
    FormulaLlmComparisonService,
    FormulaAiEvidenceService,
    FormulaAiSkillRegistryService,
    FormulaAiRunArtifactService,
    FormulaAiRolloutService,
    FormulaValidationArtifactService,
    PolicyChangeMonitorJobHandler,
    TariffKnowledgeCardRecomputeJobHandler,
    BrokerGoldenSetValidationJobHandler,
    ExternalProviderOracleJobHandler,
    CbpCrossIngestJobHandler,
    EvidenceReconcileJobHandler,
    FormulaAccuracyLabJobHandler,
    FormulaMaintenanceJobHandler,
    FormulaAiHoldoutEvaluationJobHandler,
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
    PolicyChangeMonitorService,
    ExternalProviderQuoteService,
    BrokerGoldenSetService,
    CbpCrossRulingService,
    EvidenceReconciliationService,
    FormulaAccuracyLabService,
    FormulaMaintenanceService,
    FormulaAiValidationHealthService,
    FormulaSourcePackService,
    FormulaExtractorPromptService,
    QwenFormulaExtractorService,
    CodexFormulaExtractorService,
    ClaudeFormulaJudgeService,
    FormulaLlmComparisonService,
    FormulaAiEvidenceService,
    FormulaAiSkillRegistryService,
    FormulaAiRunArtifactService,
    FormulaAiRolloutService,
    FormulaValidationArtifactService,
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
    private formulaStaleScanHandler: FormulaStaleScanJobHandler,
    private classifyBulkHandler: ClassifyBulkJobHandler,
    private landedCostQuoteExpirerHandler: LandedCostQuoteExpirerJobHandler,
    private tariffParityComparisonHandler: TariffParityComparisonJobHandler,
    private parityAiValidateHandler: ParityAiValidateJobHandler,
    private policyChangeMonitorHandler: PolicyChangeMonitorJobHandler,
    private tariffKnowledgeCardRecomputeHandler: TariffKnowledgeCardRecomputeJobHandler,
    private brokerGoldenSetValidationHandler: BrokerGoldenSetValidationJobHandler,
    private externalProviderOracleHandler: ExternalProviderOracleJobHandler,
    private cbpCrossIngestHandler: CbpCrossIngestJobHandler,
    private evidenceReconcileHandler: EvidenceReconcileJobHandler,
    private formulaAccuracyLabHandler: FormulaAccuracyLabJobHandler,
    private formulaMaintenanceHandler: FormulaMaintenanceJobHandler,
    private formulaAiHoldoutEvaluationHandler: FormulaAiHoldoutEvaluationJobHandler,
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

    await this.queueService.registerHandler('formula-stale-scan', (job) =>
      this.formulaStaleScanHandler.execute(job),
    );

    await this.queueService.registerHandler('classify-bulk', (job) =>
      this.classifyBulkHandler.execute(job),
    );

    await this.queueService.registerHandler(
      'landed-cost-quote-expirer',
      (job) => this.landedCostQuoteExpirerHandler.execute(job),
    );

    await this.queueService.registerHandler('tariff-parity-comparison', (job) =>
      this.tariffParityComparisonHandler.execute(job),
    );

    await this.queueService.registerHandler('parity-ai-validate', (job) =>
      this.parityAiValidateHandler.execute(job),
    );

    await this.queueService.registerHandler('policy-change-monitor', (job) =>
      this.policyChangeMonitorHandler.execute(job),
    );

    await this.queueService.registerHandler(
      'tariff-knowledge-card-recompute',
      (job) => this.tariffKnowledgeCardRecomputeHandler.execute(job),
    );

    await this.queueService.registerHandler(
      'broker-golden-set-validation',
      (job) => this.brokerGoldenSetValidationHandler.execute(job),
    );

    await this.queueService.registerHandler('external-provider-oracle', (job) =>
      this.externalProviderOracleHandler.execute(job),
    );

    await this.queueService.registerHandler('cbp-cross-ingest', (job) =>
      this.cbpCrossIngestHandler.execute(job),
    );

    await this.queueService.registerHandler('evidence-reconcile', (job) =>
      this.evidenceReconcileHandler.execute(job),
    );

    await this.queueService.registerHandler('formula-accuracy-lab', (job) =>
      this.formulaAccuracyLabHandler.execute(job),
    );

    await this.queueService.registerHandler('formula-maintenance', (job) =>
      this.formulaMaintenanceHandler.execute(job),
    );

    await this.queueService.registerHandler(
      'formula-ai-holdout-evaluation',
      (job) => this.formulaAiHoldoutEvaluationHandler.execute(job),
    );

    this.logger.log('Job handlers registered successfully (22 handlers)');

    await this.configureNightlyLookupAccuracySchedule();
    await this.configureWeeklyRuleAnalysisSchedule();
    await this.configureMonthlyRerankerRetrainSchedule();
    await this.configureFormulaStaleScanSchedule();
    await this.configureLandedCostQuoteExpirerSchedule();
    await this.configurePolicyChangeMonitorSchedule();
    await this.configureTariffKnowledgeCardRecomputeSchedule();
    await this.configureBrokerGoldenSetValidationSchedule();
    await this.configureExternalProviderOracleSchedule();
    await this.configureCbpCrossIngestSchedule();
    await this.configureEvidenceReconcileSchedule();
    await this.configureFormulaAccuracyLabSchedule();
    await this.configureFormulaMaintenanceSchedule();
    await this.configureFormulaAiHoldoutEvaluationSchedule();
  }

  private async configureFormulaAiHoldoutEvaluationSchedule(): Promise<void> {
    const enabled =
      process.env.FORMULA_AI_HOLDOUT_EVALUATION_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Formula AI holdout evaluation disabled (FORMULA_AI_HOLDOUT_EVALUATION_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.FORMULA_AI_HOLDOUT_EVALUATION_CRON || '0 7 * * 1';
    const timezone = process.env.FORMULA_AI_HOLDOUT_EVALUATION_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'formula-ai-holdout-evaluation',
      cron,
      {
        triggeredBy: 'formula-ai-holdout-evaluation-schedule',
        skill: process.env.FORMULA_AI_HOLDOUT_SKILL || 'extractor',
      },
      { tz: timezone },
    );
    this.logger.log(
      `Formula AI holdout evaluation schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureFormulaMaintenanceSchedule(): Promise<void> {
    const enabled = process.env.FORMULA_MAINTENANCE_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Formula maintenance disabled (FORMULA_MAINTENANCE_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.FORMULA_MAINTENANCE_CRON || '30 4 * * *';
    const timezone = process.env.FORMULA_MAINTENANCE_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'formula-maintenance',
      cron,
      {
        triggeredBy: 'formula-maintenance-schedule',
        limit: Number(process.env.FORMULA_MAINTENANCE_LIMIT || 250),
        aiEnabled: process.env.FORMULA_MAINTENANCE_AI_ENABLED === 'true',
        includeParserGaps:
          process.env.FORMULA_MAINTENANCE_INCLUDE_PARSER_GAPS !== 'false',
      },
      { tz: timezone },
    );
    this.logger.log(
      `Formula maintenance schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureFormulaAccuracyLabSchedule(): Promise<void> {
    const enabled = process.env.FORMULA_ACCURACY_LAB_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Formula accuracy lab disabled (FORMULA_ACCURACY_LAB_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.FORMULA_ACCURACY_LAB_CRON || '0 4 * * *';
    const timezone = process.env.FORMULA_ACCURACY_LAB_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'formula-accuracy-lab',
      cron,
      {
        triggeredBy: 'formula-accuracy-lab-schedule',
        windowDays: Number(process.env.FORMULA_ACCURACY_LAB_WINDOW_DAYS || 7),
      },
      { tz: timezone },
    );
    this.logger.log(
      `Formula accuracy lab schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureEvidenceReconcileSchedule(): Promise<void> {
    const enabled = process.env.EVIDENCE_RECONCILE_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Evidence reconcile schedule disabled (EVIDENCE_RECONCILE_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.EVIDENCE_RECONCILE_CRON || '15 * * * *';
    const timezone = process.env.EVIDENCE_RECONCILE_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'evidence-reconcile',
      cron,
      { triggeredBy: 'evidence-reconcile-schedule' },
      { tz: timezone },
    );
    this.logger.log(
      `Evidence reconcile schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureCbpCrossIngestSchedule(): Promise<void> {
    const enabled = process.env.CBP_CROSS_INGEST_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'CBP CROSS ingest disabled (CBP_CROSS_INGEST_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.CBP_CROSS_INGEST_CRON || '0 6 * * 0';
    const timezone = process.env.CBP_CROSS_INGEST_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'cbp-cross-ingest',
      cron,
      {
        triggeredBy: 'cbp-cross-ingest-schedule',
        limit: Number(process.env.CBP_CROSS_INGEST_LIMIT || 50),
        generateEmbeddings:
          process.env.CBP_CROSS_GENERATE_EMBEDDINGS === 'true',
      },
      { tz: timezone },
    );
    this.logger.log(
      `CBP CROSS ingest schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureExternalProviderOracleSchedule(): Promise<void> {
    const enabled = process.env.EXTERNAL_PROVIDER_ORACLE_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'External provider oracle disabled (EXTERNAL_PROVIDER_ORACLE_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.EXTERNAL_PROVIDER_ORACLE_CRON || '30 3 * * *';
    const timezone = process.env.EXTERNAL_PROVIDER_ORACLE_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'external-provider-oracle',
      cron,
      {
        triggeredBy: 'external-provider-oracle-schedule',
        limit: Number(process.env.EXTERNAL_PROVIDER_ORACLE_LIMIT || 25),
      },
      { tz: timezone },
    );
    this.logger.log(
      `External provider oracle schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureBrokerGoldenSetValidationSchedule(): Promise<void> {
    const enabled = process.env.BROKER_GOLDEN_SET_VALIDATION_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Broker golden-set validation disabled (BROKER_GOLDEN_SET_VALIDATION_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.BROKER_GOLDEN_SET_VALIDATION_CRON || '0 5 * * *';
    const timezone = process.env.BROKER_GOLDEN_SET_VALIDATION_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'broker-golden-set-validation',
      cron,
      {
        triggeredBy: 'broker-golden-set-validation-schedule',
        limit: Number(process.env.BROKER_GOLDEN_SET_VALIDATION_LIMIT || 50),
      },
      { tz: timezone },
    );
    this.logger.log(
      `Broker golden-set validation schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureTariffKnowledgeCardRecomputeSchedule(): Promise<void> {
    const enabled = process.env.TARIFF_CARD_RECOMPUTE_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Tariff knowledge card recompute disabled (TARIFF_CARD_RECOMPUTE_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.TARIFF_CARD_RECOMPUTE_CRON || '0 * * * *';
    const timezone = process.env.TARIFF_CARD_RECOMPUTE_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'tariff-knowledge-card-recompute',
      cron,
      { triggeredBy: 'tariff-card-recompute-schedule' },
      { tz: timezone },
    );
    this.logger.log(
      `Tariff knowledge card recompute schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configurePolicyChangeMonitorSchedule(): Promise<void> {
    const enabled = process.env.POLICY_CHANGE_MONITOR_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Policy change monitor disabled (POLICY_CHANGE_MONITOR_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.POLICY_CHANGE_MONITOR_CRON || '*/30 * * * *';
    const timezone = process.env.POLICY_CHANGE_MONITOR_TZ || 'UTC';
    await this.queueService.scheduleJob(
      'policy-change-monitor',
      cron,
      { triggeredBy: 'policy-monitor-schedule' },
      { tz: timezone },
    );
    this.logger.log(
      `Policy change monitor schedule active: cron="${cron}" tz=${timezone}`,
    );
  }

  private async configureLandedCostQuoteExpirerSchedule(): Promise<void> {
    const enabled = process.env.LANDED_COST_QUOTE_EXPIRER_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Landed-cost quote expirer disabled (LANDED_COST_QUOTE_EXPIRER_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.LANDED_COST_QUOTE_EXPIRER_CRON || '*/5 * * * *';
    await this.queueService.scheduleJob('landed-cost-quote-expirer', cron, {
      triggeredBy: '5min-schedule',
    });
    this.logger.log(
      `Landed-cost quote expirer schedule active: cron="${cron}"`,
    );
  }

  private async configureFormulaStaleScanSchedule(): Promise<void> {
    const enabled = process.env.FORMULA_STALE_SCAN_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Formula stale scan schedule disabled (FORMULA_STALE_SCAN_ENABLED != true).',
      );
      return;
    }
    const cron = process.env.FORMULA_STALE_SCAN_CRON || '0 2 * * *';
    await this.queueService.scheduleJob('formula-stale-scan', cron, {
      triggeredBy: 'nightly-schedule',
    });
    this.logger.log(`Formula stale scan schedule active: cron="${cron}"`);
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

    await this.queueService.scheduleJob('reranker-retrain', cronExpression, {
      triggeredBy: 'cron',
    });

    this.logger.log(
      `Monthly reranker retrain schedule active: cron="${cronExpression}"`,
    );
  }
}
