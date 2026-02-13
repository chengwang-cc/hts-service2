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

// Core Services (from packages)
import { HtsProcessorService, FormulaGenerationService } from '@hts/core';
import { FormulaEvaluationService } from '@hts/calculator';

// Queue Service
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

// Services - Phase 1
import { UsersAdminService } from './services/users.admin.service';
import { RolesAdminService } from './services/roles.admin.service';
import { AnalyticsAdminService } from './services/analytics.admin.service';

// Services - Phase 2
import { HtsImportService } from './services/hts-import.service';
import { FormulaAdminService } from './services/formula.admin.service';
import { TestCaseService } from './services/test-case.service';

// Job Handlers
import { HtsImportJobHandler } from './jobs/hts-import.job-handler';
import { FormulaGenerationJobHandler } from './jobs/formula-generation.job-handler';
import { TestBatchExecutionJobHandler } from './jobs/test-batch-execution.job-handler';

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
    ]),
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
    // Job handlers
    HtsImportJobHandler,
    FormulaGenerationJobHandler,
    TestBatchExecutionJobHandler,
    // Core services (required by job handlers)
    HtsProcessorService,
    FormulaGenerationService,
    FormulaEvaluationService,
  ],
  exports: [
    UsersAdminService,
    RolesAdminService,
    AnalyticsAdminService,
    HtsImportService,
    FormulaAdminService,
    TestCaseService,
  ],
})
export class AdminModule implements OnModuleInit {
  private readonly logger = new Logger(AdminModule.name);

  constructor(
    private queueService: QueueService,
    private importHandler: HtsImportJobHandler,
    private formulaHandler: FormulaGenerationJobHandler,
    private testBatchHandler: TestBatchExecutionJobHandler,
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

    this.logger.log('Job handlers registered successfully');
  }
}
