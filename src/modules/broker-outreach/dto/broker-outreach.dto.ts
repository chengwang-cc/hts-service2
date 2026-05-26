import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const LEAD_PROVIDERS = ['manual', 'osm', 'google', 'csv', 'api'] as const;
const LEAD_STATUSES = [
  'new',
  'reviewed',
  'qualified',
  'invited',
  'converted',
  'suppressed',
] as const;
const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed'] as const;

export class UpsertBrokerOutreachLeadDto {
  @ApiProperty({ example: 'Pacific Customs Brokers' })
  @IsString()
  @MaxLength(255)
  companyName: string;

  @ApiProperty({ enum: LEAD_PROVIDERS, example: 'osm' })
  @IsIn(LEAD_PROVIDERS)
  sourceProvider: string;

  @ApiPropertyOptional({ example: 'node/123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceExternalId?: string;

  @ApiPropertyOptional({ example: 'customs_broker' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessCategory?: string;

  @ApiPropertyOptional({ example: 'https://example-broker.com' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'sales@example-broker.com' })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+1 604 555 0100' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ example: 'Washington' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @ApiPropertyOptional({ example: 'Seattle' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: '1200 Harbor Ave, Seattle, WA' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @ApiPropertyOptional({ example: 47.6062 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: -122.3321 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ enum: LEAD_STATUSES, example: 'qualified' })
  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 82 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional({ example: ['customs', 'freight-forwarder'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: { osmTags: { office: 'logistics' } } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class BulkUpsertBrokerOutreachLeadsDto {
  @ApiProperty({ type: [UpsertBrokerOutreachLeadDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpsertBrokerOutreachLeadDto)
  leads: UpsertBrokerOutreachLeadDto[];
}

export class CreateBrokerOutreachCampaignDto {
  @ApiProperty({ example: 'Broker marketplace launch - Pacific Northwest' })
  @IsString()
  @MaxLength(180)
  name: string;

  @ApiPropertyOptional({ enum: CAMPAIGN_STATUSES, example: 'draft' })
  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: 'Customs brokers and freight forwarders near major ports.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  audience?: string;

  @ApiPropertyOptional({ example: 'Invite broker companies to try the DigiTrend broker workspace.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  objective?: string;

  @ApiPropertyOptional({ example: 'A faster way to qualify importer requests' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  emailSubject?: string;

  @ApiPropertyOptional({ example: 'Hi {{companyName}}, ...' })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  emailBody?: string;

  @ApiPropertyOptional({ example: 'Professional, concise, customs-broker specific.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  aiPrompt?: string;
}

export class DraftBrokerOutreachEmailDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  leadId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ example: 'professional' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tone?: string;

  @ApiPropertyOptional({ example: 'https://app.example.com/broker-outreach/invite?token=...' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  claimUrl?: string;
}

export class CreateBrokerOutreachInviteDto {
  @ApiProperty()
  @IsUUID()
  leadId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ example: 'ops@example-broker.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;
}

export class ClaimBrokerOutreachInviteDto {
  @ApiProperty({ example: 'ops@example-broker.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'A strong password' })
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  password: string;

  @ApiProperty({ example: 'Alex' })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Morgan' })
  @IsString()
  @MaxLength(100)
  lastName: string;
}

/**
 * Allowed name keywords for OSM Overpass searches. Restricting to an
 * allowlist prevents arbitrary regex injection (which could trigger
 * expensive scans on the public Overpass server).
 */
export const OSM_NAME_CATEGORIES = [
  'customs',
  'broker',
  'freight',
  'forwarder',
  'logistics',
  'import',
  'export',
  'shipping',
  'cargo',
  'warehouse',
  'distribution',
] as const;

export class DiscoverOsmBrokerLeadsDto {
  @ApiProperty({
    example: [47.40, -122.60, 47.85, -121.95],
    description:
      '[south, west, north, east] bounding box. Latitude in [-90,90], longitude in [-180,180], south<north, west<east.',
  })
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsNumber({}, { each: true })
  bbox: number[];

  @ApiPropertyOptional({
    description:
      'Restrict OSM name matches to one or more allowlisted categories.',
    enum: OSM_NAME_CATEGORIES,
    isArray: true,
    example: ['customs', 'broker', 'freight'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(OSM_NAME_CATEGORIES.length)
  @IsIn(OSM_NAME_CATEGORIES, { each: true })
  nameCategories?: string[];

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(250)
  limit?: number;
}

export class DiscoverGoogleBrokerLeadsDto {
  @ApiProperty({ example: 'customs broker near Seattle port' })
  @IsString()
  @MaxLength(300)
  textQuery: string;

  @ApiPropertyOptional({
    description: 'Number of search results to scrape (max 20).',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  pageSize?: number;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  languageCode?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  countryCode?: string;
}
