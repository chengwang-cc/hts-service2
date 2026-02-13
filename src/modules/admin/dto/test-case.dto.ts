/**
 * Test Case Admin DTOs
 * Data transfer objects for test case management
 */

import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsObject,
  IsArray,
  IsUUID,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create Test Case DTO
 */
export class CreateTestCaseDto {
  @ApiProperty({
    description: 'HTS number to test',
    example: '0101.21.00',
  })
  @IsString()
  htsNumber: string;

  @ApiProperty({
    description: 'Test case name',
    example: 'Basic ad valorem duty test',
  })
  @IsString()
  testName: string;

  @ApiPropertyOptional({
    description: 'Country code',
    example: 'ALL',
    default: 'ALL',
  })
  @IsOptional()
  @IsString()
  country?: string = 'ALL';

  @ApiProperty({
    description: 'Input values for formula calculation',
    example: { value: 1000, weight: 50 },
  })
  @IsObject()
  inputValues: Record<string, number>;

  @ApiProperty({
    description: 'Expected output (duty amount)',
    example: 50,
  })
  @IsNumber()
  expectedOutput: number;

  @ApiPropertyOptional({
    description: 'Tolerance for comparison',
    example: 0.01,
    default: 0.01,
  })
  @IsOptional()
  @IsNumber()
  tolerance?: number = 0.01;

  @ApiPropertyOptional({
    description: 'Rate type being tested',
    enum: ['GENERAL', 'OTHER', 'CHAPTER_99', 'SPECIAL'],
    default: 'GENERAL',
  })
  @IsOptional()
  @IsIn(['GENERAL', 'OTHER', 'CHAPTER_99', 'SPECIAL'])
  rateType?: string = 'GENERAL';

  @ApiPropertyOptional({
    description: 'Test description',
    example: 'Tests 5% ad valorem duty calculation',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Update Test Case DTO
 */
export class UpdateTestCaseDto {
  @ApiPropertyOptional({
    description: 'Test case name',
  })
  @IsOptional()
  @IsString()
  testName?: string;

  @ApiPropertyOptional({
    description: 'Input values for formula calculation',
  })
  @IsOptional()
  @IsObject()
  inputValues?: Record<string, number>;

  @ApiPropertyOptional({
    description: 'Expected output (duty amount)',
  })
  @IsOptional()
  @IsNumber()
  expectedOutput?: number;

  @ApiPropertyOptional({
    description: 'Whether test case is active',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Run Batch DTO
 */
export class RunBatchDto {
  @ApiProperty({
    description: 'Test case IDs to run',
    example: ['uuid-1', 'uuid-2', 'uuid-3'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  testCaseIds: string[];
}

/**
 * List Test Results DTO
 */
export class ListTestResultsDto {
  @ApiPropertyOptional({
    description: 'Filter by run ID',
  })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiPropertyOptional({
    description: 'Show only passed tests',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  passedOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
