/**
 * Formula Admin DTOs
 * Data transfer objects for formula management
 */

import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  IsUUID,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * List Formulas DTO
 * Query parameters for listing formulas
 */
export class ListFormulasDto {
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
    description: 'Filter by HTS number',
    example: '0101.21.00',
  })
  @IsOptional()
  @IsString()
  htsNumber?: string;

  @ApiPropertyOptional({
    description: 'Only show AI-generated formulas',
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  generatedOnly?: boolean;
}

/**
 * List Candidates DTO
 * Query parameters for listing formula candidates
 */
export class ListCandidatesDto {
  @ApiPropertyOptional({
    description: 'Filter by candidate status',
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: string = 'PENDING';

  @ApiPropertyOptional({
    description: 'Minimum confidence score (0.0 to 1.0)',
    example: 0.7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence?: number;

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

/**
 * Generate Formulas DTO
 * Trigger formula generation for HTS entries
 */
export class GenerateFormulasDto {
  @ApiPropertyOptional({
    description: 'Specific HTS numbers to generate formulas for (if empty, generates for all missing formulas)',
    example: ['0101.21.00', '0101.29.10'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  htsNumbers?: string[];

  @ApiPropertyOptional({
    description: 'Batch size for generation',
    example: 100,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  batchSize?: number = 100;
}

/**
 * Review DTO
 * Review comment for approving/rejecting candidates
 */
export class ReviewDto {
  @ApiPropertyOptional({
    description: 'Review comment',
    example: 'Formula looks correct based on USITC documentation',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}

/**
 * Bulk Approve DTO
 * Bulk approve candidates above confidence threshold
 */
export class BulkApproveDto {
  @ApiProperty({
    description: 'Minimum confidence threshold (0.0 to 1.0)',
    example: 0.9,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  minConfidence: number;

  @ApiPropertyOptional({
    description: 'Optional comment for bulk approval',
    example: 'Bulk approval for high-confidence candidates',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}
