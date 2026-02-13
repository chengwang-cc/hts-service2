/**
 * Test Case Service
 * Business logic for test case management and execution
 */

import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HtsTestCaseEntity } from '@hts/core';
import { HtsTestResultEntity } from '@hts/core';
import { HtsEntity } from '@hts/core';
import { FormulaEvaluationService } from '@hts/calculator';
import { QueueService } from '../../queue/queue.service';
import { CreateTestCaseDto, UpdateTestCaseDto, ListTestResultsDto } from '../dto/test-case.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TestCaseService {
  private readonly logger = new Logger(TestCaseService.name);

  constructor(
    @InjectRepository(HtsTestCaseEntity)
    private testCaseRepo: Repository<HtsTestCaseEntity>,
    @InjectRepository(HtsTestResultEntity)
    private testResultRepo: Repository<HtsTestResultEntity>,
    @InjectRepository(HtsEntity)
    private htsRepo: Repository<HtsEntity>,
    private formulaEvalService: FormulaEvaluationService,
    private queueService: QueueService,
  ) {}

  /**
   * Create test case
   */
  async create(dto: CreateTestCaseDto, createdBy: string): Promise<HtsTestCaseEntity> {
    const testCase = this.testCaseRepo.create({
      htsNumber: dto.htsNumber,
      testName: dto.testName,
      country: dto.country || 'ALL',
      inputValues: dto.inputValues,
      expectedOutput: dto.expectedOutput,
      tolerance: dto.tolerance || 0.01,
      rateType: dto.rateType || 'GENERAL',
      description: dto.description || null,
      source: 'ADMIN_MANUAL',
      createdBy,
      isActive: true,
    });

    return this.testCaseRepo.save(testCase);
  }

  /**
   * Update test case
   */
  async update(id: string, dto: UpdateTestCaseDto): Promise<HtsTestCaseEntity> {
    const testCase = await this.testCaseRepo.findOne({ where: { id } });

    if (!testCase) {
      throw new NotFoundException(`Test case not found: ${id}`);
    }

    Object.assign(testCase, dto);
    return this.testCaseRepo.save(testCase);
  }

  /**
   * Delete test case
   */
  async remove(id: string): Promise<void> {
    const result = await this.testCaseRepo.delete(id);

    if (result.affected === 0) {
      throw new NotFoundException(`Test case not found: ${id}`);
    }
  }

  /**
   * Find all test cases
   */
  async findAll(): Promise<HtsTestCaseEntity[]> {
    return this.testCaseRepo.find({
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Run single test case
   */
  async runSingle(testCaseId: string): Promise<HtsTestResultEntity> {
    const testCase = await this.testCaseRepo.findOne({ where: { id: testCaseId } });

    if (!testCase) {
      throw new NotFoundException(`Test case not found: ${testCaseId}`);
    }

    const hts = await this.htsRepo.findOne({ where: { htsNumber: testCase.htsNumber } });

    if (!hts) {
      throw new NotFoundException(`HTS entry not found: ${testCase.htsNumber}`);
    }

    const formula = this.getFormulaByType(hts, testCase.rateType);

    if (!formula) {
      throw new Error(`No formula found for rate type: ${testCase.rateType}`);
    }

    const runId = uuidv4();
    const startTime = Date.now();

    try {
      // Evaluate formula
      const actualOutput = this.formulaEvalService.evaluate(
        formula,
        testCase.inputValues
      );

      const difference = Math.abs(actualOutput - testCase.expectedOutput);
      const passed = difference <= testCase.tolerance;
      const percentageError =
        testCase.expectedOutput !== 0
          ? (difference / Math.abs(testCase.expectedOutput)) * 100
          : 0;

      const result = this.testResultRepo.create({
        testCaseId: testCase.id,
        runId,
        passed,
        actualOutput,
        expectedOutput: testCase.expectedOutput,
        difference,
        percentageError,
        formulaUsed: formula,
        formulaSource: hts.isFormulaGenerated ? 'ai_generated' : 'manual',
        executionTimeMs: Date.now() - startTime,
        inputValues: testCase.inputValues,
        environment: 'production',
      });

      return this.testResultRepo.save(result);
    } catch (error) {
      // Save error result
      const result = this.testResultRepo.create({
        testCaseId: testCase.id,
        runId,
        passed: false,
        actualOutput: 0,
        expectedOutput: testCase.expectedOutput,
        difference: testCase.expectedOutput,
        formulaUsed: formula || 'N/A',
        formulaSource: 'unknown',
        errorMessage: error.message,
        stackTrace: error.stack,
        executionTimeMs: Date.now() - startTime,
        inputValues: testCase.inputValues,
        environment: 'production',
      });

      return this.testResultRepo.save(result);
    }
  }

  /**
   * Run batch of tests
   */
  async runBatch(testCaseIds: string[]): Promise<{ jobId: string; runId: string }> {
    const runId = uuidv4();

    const jobId = await this.queueService.sendJob('test-batch-execution', {
      testCaseIds,
      runId,
    });

    this.logger.log(`Batch test job triggered: ${jobId} for ${testCaseIds.length} tests`);

    return { jobId: jobId || '', runId };
  }

  /**
   * Run regression suite (all active tests)
   */
  async runRegression(): Promise<{ jobId: string; runId: string }> {
    const testCases = await this.testCaseRepo.find({
      where: { isActive: true },
      select: ['id'],
    });

    const testCaseIds = testCases.map((tc) => tc.id);

    this.logger.log(`Running regression suite with ${testCaseIds.length} tests`);

    return this.runBatch(testCaseIds);
  }

  /**
   * Get test results
   */
  async getResults(dto: ListTestResultsDto): Promise<{
    data: HtsTestResultEntity[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { runId, passedOnly } = dto;
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const query = this.testResultRepo.createQueryBuilder('result');

    if (runId) {
      query.andWhere('result.runId = :runId', { runId });
    }

    if (passedOnly) {
      query.andWhere('result.passed = :passed', { passed: true });
    }

    query.orderBy('result.executedAt', 'DESC');

    const [data, total] = await query
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data, total, page, pageSize };
  }

  /**
   * Get formula by rate type
   */
  private getFormulaByType(hts: HtsEntity, rateType: string): string | null {
    switch (rateType) {
      case 'GENERAL':
        return hts.rateFormula || null;
      case 'OTHER':
        return hts.otherRateFormula || null;
      case 'CHAPTER_99':
        return hts.chapter99 || null;
      default:
        return hts.rateFormula || null;
    }
  }
}
