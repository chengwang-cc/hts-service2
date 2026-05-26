import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const QUERY_ROLES = [
  'broker',
  'exporter',
  'importer',
  'ecom_seller',
] as const;

export const QUERY_OUTPUTS = [
  'answer',
  'citations',
  'next_actions',
  'missing_information',
] as const;

export class QueryBuilderInputDto {
  @ApiProperty({ enum: QUERY_ROLES, example: 'broker' })
  @IsIn(QUERY_ROLES)
  role: (typeof QUERY_ROLES)[number];

  @ApiProperty({ example: 'Does the new CBAM rule apply to my aluminum extrusion shipment?' })
  @IsString()
  @MaxLength(2000)
  question: string;

  @ApiPropertyOptional({ example: 'CN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  originCountry?: string;

  @ApiPropertyOptional({ example: 'EU' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  destinationCountry?: string;

  @ApiPropertyOptional({ example: '7604.29.10' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  hts?: string;

  @ApiPropertyOptional({ example: 'CBAM' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ruleArea?: string;

  @ApiPropertyOptional({
    example: 'aluminum extrusions, 6063 alloy, anodized',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  productDescription?: string;

  @ApiPropertyOptional({ example: '2026-04-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ description: 'Confidence threshold 0-100' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  certaintyThreshold?: number;

  @ApiPropertyOptional({
    description: 'Knowledge source ids to scope the planner.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  sourceIds?: string[];

  @ApiPropertyOptional({
    enum: QUERY_OUTPUTS,
    isArray: true,
    description: 'Which sections to include in the result.',
  })
  @IsOptional()
  @IsArray()
  @IsIn(QUERY_OUTPUTS, { each: true })
  outputs?: string[];
}

export class QueryBuilderTemplateDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: QueryBuilderInputDto })
  @ValidateNested()
  @Type(() => QueryBuilderInputDto)
  input: QueryBuilderInputDto;
}
