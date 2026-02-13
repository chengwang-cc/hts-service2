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
 */
export class UploadDocumentDto {
  @ApiProperty({
    description: 'Document title',
    example: 'HTS Chapter 1 Notes 2025',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Document year',
    example: 2025,
  })
  @IsNumber()
  year: number;

  @ApiProperty({
    description: 'HTS chapter (2-digit string or "00" for general)',
    example: '01',
  })
  @IsString()
  chapter: string;

  @ApiProperty({
    description: 'Document type',
    enum: ['PDF', 'URL', 'TEXT'],
    example: 'PDF',
  })
  @IsIn(['PDF', 'URL', 'TEXT'])
  type: string;

  @ApiPropertyOptional({
    description: 'Source URL (required for URL and PDF types)',
    example: 'https://hts.usitc.gov/view/chapter1-notes.pdf',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({
    description: 'Text content (required for TEXT type)',
  })
  @IsOptional()
  @IsString()
  textContent?: string;

  @ApiPropertyOptional({
    description: 'Document category/classification',
    example: 'regulations',
  })
  @IsOptional()
  @IsString()
  category?: string;
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
