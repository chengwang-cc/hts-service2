/**
 * HTS Import DTOs
 * Data transfer objects for HTS import management
 */

import { IsString, IsOptional, IsNumber, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Trigger Import DTO
 * Used to initiate a new HTS import from USITC
 */
export class TriggerImportDto {
  @ApiProperty({
    description: 'Source version identifier (e.g., "2025_revision_1")',
    example: '2025_revision_1',
  })
  @IsString()
  sourceVersion: string;

  @ApiProperty({
    description: 'URL where USITC data can be downloaded',
    example: 'https://hts.usitc.gov/export/2025_revision_1.csv',
  })
  @IsString()
  sourceUrl: string;

  @ApiPropertyOptional({
    description: 'SHA-256 hash of the source file for integrity verification',
    example: 'a1b2c3d4e5f6...',
  })
  @IsOptional()
  @IsString()
  sourceFileHash?: string;
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
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK'])
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
