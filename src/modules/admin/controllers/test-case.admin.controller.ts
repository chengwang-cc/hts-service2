/**
 * Test Case Admin Controller
 * REST API endpoints for test case management
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { TestCaseService } from '../services/test-case.service';
import {
  CreateTestCaseDto,
  UpdateTestCaseDto,
  RunBatchDto,
  ListTestResultsDto,
} from '../dto/test-case.dto';

@ApiTags('Admin - Test Cases')
@ApiBearerAuth()
@Controller('admin/test-cases')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TestCaseAdminController {
  constructor(private readonly testCaseService: TestCaseService) {}

  /**
   * GET /admin/test-cases
   * List all test cases
   */
  @Get()
  @ApiOperation({ summary: 'List all test cases' })
  @ApiResponse({ status: 200, description: 'Test cases retrieved successfully' })
  async findAll() {
    const testCases = await this.testCaseService.findAll();

    return {
      success: true,
      data: testCases,
      meta: {
        total: testCases.length,
      },
    };
  }

  /**
   * POST /admin/test-cases
   * Create a new test case
   */
  @Post()
  @ApiOperation({ summary: 'Create test case' })
  @ApiResponse({ status: 201, description: 'Test case created successfully' })
  async create(@Body() dto: CreateTestCaseDto, @Request() req) {
    const createdBy = req.user?.email || 'ADMIN';
    const testCase = await this.testCaseService.create(dto, createdBy);

    return {
      success: true,
      data: testCase,
      message: 'Test case created successfully',
    };
  }

  /**
   * PATCH /admin/test-cases/:id
   * Update a test case
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update test case' })
  @ApiResponse({ status: 200, description: 'Test case updated successfully' })
  @ApiResponse({ status: 404, description: 'Test case not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateTestCaseDto) {
    const testCase = await this.testCaseService.update(id, dto);

    return {
      success: true,
      data: testCase,
      message: 'Test case updated successfully',
    };
  }

  /**
   * DELETE /admin/test-cases/:id
   * Delete a test case
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete test case' })
  @ApiResponse({ status: 200, description: 'Test case deleted successfully' })
  @ApiResponse({ status: 404, description: 'Test case not found' })
  async remove(@Param('id') id: string) {
    await this.testCaseService.remove(id);

    return {
      success: true,
      message: 'Test case deleted successfully',
    };
  }

  /**
   * POST /admin/test-cases/:id/run
   * Run a single test case
   */
  @Post(':id/run')
  @ApiOperation({ summary: 'Run single test' })
  @ApiResponse({ status: 200, description: 'Test executed successfully' })
  @ApiResponse({ status: 404, description: 'Test case not found' })
  async runSingle(@Param('id') id: string) {
    const result = await this.testCaseService.runSingle(id);

    return {
      success: true,
      data: result,
      message: result.passed ? 'Test passed' : 'Test failed',
    };
  }

  /**
   * POST /admin/test-cases/run-batch
   * Run batch of tests
   */
  @Post('run-batch')
  @ApiOperation({ summary: 'Run batch of tests' })
  @ApiResponse({ status: 201, description: 'Batch test execution started' })
  async runBatch(@Body() dto: RunBatchDto) {
    const result = await this.testCaseService.runBatch(dto.testCaseIds);

    return {
      success: true,
      data: result,
      message: `Batch test execution started for ${dto.testCaseIds.length} tests`,
    };
  }

  /**
   * POST /admin/test-cases/run-regression
   * Run all active tests
   */
  @Post('run-regression')
  @ApiOperation({ summary: 'Run regression suite' })
  @ApiResponse({ status: 201, description: 'Regression suite execution started' })
  async runRegression() {
    const result = await this.testCaseService.runRegression();

    return {
      success: true,
      data: result,
      message: 'Regression suite execution started',
    };
  }

  /**
   * GET /admin/test-cases/test-results
   * Get test results
   */
  @Get('test-results')
  @ApiOperation({ summary: 'Get test results' })
  @ApiResponse({ status: 200, description: 'Test results retrieved successfully' })
  async getResults(@Query() query: ListTestResultsDto) {
    const result = await this.testCaseService.getResults(query);

    return {
      success: true,
      data: result.data,
      meta: {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }
}
