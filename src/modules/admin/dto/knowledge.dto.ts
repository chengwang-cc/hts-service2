/**
 * Knowledge Library DTOs
 * Data transfer objects for knowledge document management
 */

import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Upload Document DTO
 * Simplified: Auto-detect latest OR specify year + revision
 */
export class UploadDocumentDto {
  @ApiPropertyOptional({
    description: 'Set to "latest" to auto-import latest full HTS PDF',
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

  @ApiPropertyOptional({
    description: 'HTS chapter (2-digit string or "00" for full document)',
    example: '00',
    default: '00',
  })
  @IsOptional()
  @IsString()
  chapter?: string;

  // Legacy support - deprecated but still accepted
  @ApiPropertyOptional({
    description: '[DEPRECATED] Use version="latest" or year+revision',
    example: 'HTS Full 2026',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: '[DEPRECATED] Document type. Use version="latest" or year+revision instead',
    enum: ['PDF', 'URL', 'TEXT'],
  })
  @IsOptional()
  @IsIn(['PDF', 'URL', 'TEXT'])
  documentType?: string;

  @ApiPropertyOptional({
    description: '[DEPRECATED] Source URL. Use version="latest" or year+revision instead',
  })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({
    description: '[DEPRECATED] For custom text content only',
  })
  @IsOptional()
  @IsString()
  textContent?: string;
}

/**
 * List Documents DTO
 */
export class ListDocumentsDto {
  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'])
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by year',
    example: 2025,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @ApiPropertyOptional({
    description: 'Filter by chapter',
    example: '01',
  })
  @IsOptional()
  @IsString()
  chapter?: string;

  @ApiPropertyOptional({
    description: 'Filter by document type',
    enum: ['PDF', 'URL', 'TEXT'],
  })
  @IsOptional()
  @IsIn(['PDF', 'URL', 'TEXT'])
  type?: string;

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
