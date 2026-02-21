/**
 * Test Batch Execution Job Handler
 * Processes batch test execution asynchronously using pg-boss
 */

import { Injectable, Logger } from '@nestjs/common';
import { TestCaseService } from '../services/test-case.service';

@Injectable()
export class TestBatchExecutionJobHandler {
  private readonly logger = new Logger(TestBatchExecutionJobHandler.name);

  constructor(private testCaseService: TestCaseService) {}

  /**
   * Execute batch test job
   */
  async execute(job: any): Promise<void> {
    const { testCaseIds, runId } = job.data;

    this.logger.log(
      `Starting batch test execution for ${testCaseIds.length} tests. Run ID: ${runId}`,
    );

    let passed = 0;
    let failed = 0;

    for (const testCaseId of testCaseIds) {
      try {
        const result = await this.testCaseService.runSingle(testCaseId);

        if (result.passed) {
          passed++;
        } else {
          failed++;
        }

        if ((passed + failed) % 10 === 0) {
          this.logger.log(
            `Progress: ${passed + failed}/${testCaseIds.length} tests executed`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Test case ${testCaseId} execution failed: ${error.message}`,
        );
        failed++;
      }
    }

    this.logger.log(
      `Batch test execution completed. Run ID: ${runId}, Passed: ${passed}, Failed: ${failed}`,
    );
  }
}
