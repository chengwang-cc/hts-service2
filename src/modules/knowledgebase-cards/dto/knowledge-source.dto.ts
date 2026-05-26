import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SOURCE_TYPES = ['rss', 'html', 'document', 'api', 'sitemap'] as const;
const SOURCE_STATUSES = ['active', 'paused', 'archived', 'error'] as const;
const TRUST_TIERS = ['official', 'partner', 'industry', 'internal'] as const;

export class CreateKnowledgeSourceDto {
  @ApiProperty({ example: 'CBP CSMS - Customs Service Messaging' })
  @IsString()
  @MaxLength(180)
  name: string;

  @ApiPropertyOptional({ example: 'U.S. Customs and Border Protection' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  publisher?: string;

  @ApiProperty({ enum: SOURCE_TYPES, example: 'rss' })
  @IsIn(SOURCE_TYPES)
  sourceType: string;

  @ApiProperty({ example: 'https://content.govdelivery.com/accounts/USDHSCBP/bulletins.rss' })
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  url: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  jurisdiction?: string;

  @ApiPropertyOptional({ example: 'csms' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string;

  @ApiPropertyOptional({ example: 'customs-policy' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ enum: TRUST_TIERS, example: 'official' })
  @IsOptional()
  @IsIn(TRUST_TIERS)
  trustTier?: string;

  @ApiPropertyOptional({ enum: SOURCE_STATUSES, example: 'active' })
  @IsOptional()
  @IsIn(SOURCE_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  crawlFrequencyHours?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(250)
  itemLimit?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  respectRobots?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean;

  @ApiPropertyOptional({ example: { policyArea: 'section-232' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateKnowledgeSourceDto {
  @ApiPropertyOptional({ example: 'CBP CSMS - Customs Service Messaging' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  name?: string;

  @ApiPropertyOptional({ example: 'U.S. Customs and Border Protection' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  publisher?: string | null;

  @ApiPropertyOptional({ enum: SOURCE_TYPES, example: 'rss' })
  @IsOptional()
  @IsIn(SOURCE_TYPES)
  sourceType?: string;

  @ApiPropertyOptional({ example: 'https://content.govdelivery.com/accounts/USDHSCBP/bulletins.rss' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  url?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  jurisdiction?: string | null;

  @ApiPropertyOptional({ example: 'csms' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string | null;

  @ApiPropertyOptional({ example: 'customs-policy' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string | null;

  @ApiPropertyOptional({ enum: TRUST_TIERS, example: 'official' })
  @IsOptional()
  @IsIn(TRUST_TIERS)
  trustTier?: string;

  @ApiPropertyOptional({ enum: SOURCE_STATUSES, example: 'paused' })
  @IsOptional()
  @IsIn(SOURCE_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  crawlFrequencyHours?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(250)
  itemLimit?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  respectRobots?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean;

  @ApiPropertyOptional({ example: { policyArea: 'section-232' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class RunKnowledgeSourceCrawlDto {
  @ApiPropertyOptional({ enum: ['enqueue', 'inline'], default: 'enqueue' })
  @IsOptional()
  @IsIn(['enqueue', 'inline'])
  mode?: 'enqueue' | 'inline';

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
