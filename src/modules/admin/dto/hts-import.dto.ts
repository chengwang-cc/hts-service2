/**
 * HTS Import DTOs
 * Data transfer objects for HTS import management
 */

import { IsString, IsOptional, IsNumber, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Trigger Import DTO
 * Simplified: Auto-detect latest OR specify year + revision
 */
export class TriggerImportDto {
  @ApiPropertyOptional({
    description: 'Set to "latest" to auto-detect and import the latest available revision',
    example: 'latest',
  })
  @IsOptional()
  @IsString()
  version?: 'latest' | string;

  @ApiPropertyOptional({
    description: 'HTS year (e.g., 2026). Required if not using "latest"',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @ApiPropertyOptional({
    description: 'Revision number (e.g., 3). Required if not using "latest"',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  revision?: number;

  // Legacy support - deprecated but still accepted
  @ApiPropertyOptional({
    description: '[DEPRECATED] Use version="latest" or year+revision instead',
    example: 'https://hts.usitc.gov/data.json',
  })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({
    description: '[DEPRECATED] Use version="latest" or year+revision instead',
    example: '2025_revision_1',
  })
  @IsOptional()
  @IsString()
  sourceVersion?: string;
}

/**
 * List Imports DTO
 * Query parameters for listing import history
 */
export class ListImportsDto {
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

  @ApiPropertyOptional({
    description: 'Filter by import status',
    enum: ['PENDING', 'IN_PROGRESS', 'STAGED_READY', 'REQUIRES_REVIEW', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'REJECTED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'STAGED_READY', 'REQUIRES_REVIEW', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'REJECTED'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by source version',
    example: '2025_revision_1',
  })
  @IsOptional()
  @IsString()
  sourceVersion?: string;
}

/**
 * Logs Pagination DTO
 * Query parameters for retrieving import logs
 */
export class LogsPaginationDto {
  @ApiPropertyOptional({
    description: 'Offset for log entries (0-indexed)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Maximum number of log entries to return',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}

/**
 * Reject Import DTO
 */
export class RejectImportDto {
  @ApiPropertyOptional({
    description: 'Reason for rejection',
    example: 'Validation errors exceed threshold',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * Stage Validation Query DTO
 */
export class StageValidationQueryDto {
  @ApiPropertyOptional({
    description: 'Severity filter',
    enum: ['ERROR', 'WARNING', 'INFO'],
  })
  @IsOptional()
  @IsIn(['ERROR', 'WARNING', 'INFO'])
  severity?: string;

  @ApiPropertyOptional({
    description: 'Offset for results (0-indexed)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}

/**
 * Stage Diff Query DTO
 */
export class StageDiffQueryDto {
  @ApiPropertyOptional({
    description: 'Diff type filter',
    enum: ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'],
  })
  @IsOptional()
  @IsIn(['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'])
  diffType?: string;

  @ApiPropertyOptional({
    description: 'Filter by HTS number',
    example: '0101.21.0000',
  })
  @IsOptional()
  @IsString()
  htsNumber?: string;

  @ApiPropertyOptional({
    description: 'Offset for results (0-indexed)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}

/**
 * Stage Chapter 99 Synthesis Preview Query DTO
 */
export class StageChapter99PreviewQueryDto {
  @ApiPropertyOptional({
    description: 'Preview status filter',
    enum: ['LINKED', 'UNRESOLVED', 'NONE'],
  })
  @IsOptional()
  @IsIn(['LINKED', 'UNRESOLVED', 'NONE'])
  status?: 'LINKED' | 'UNRESOLVED' | 'NONE';

  @ApiPropertyOptional({
    description: 'Filter by HTS number (partial match)',
    example: '1202.41',
  })
  @IsOptional()
  @IsString()
  htsNumber?: string;

  @ApiPropertyOptional({
    description: 'Offset for results (0-indexed)',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({
    description: 'Maximum number of results to return',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}
