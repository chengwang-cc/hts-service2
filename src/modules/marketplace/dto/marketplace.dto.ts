import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

const profileStatuses = ['draft', 'published', 'suspended'] as const;
const verificationStatuses = [
  'unverified',
  'pending',
  'verified',
  'rejected',
] as const;

export class SearchMarketplaceBrokersDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;
}

export class UpsertBrokerProfileDto {
  @IsString()
  @Length(2, 160)
  companyName: string;

  @IsOptional()
  @IsString()
  @Length(0, 220)
  tagline?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string | null;

  @IsOptional()
  @IsIn(profileStatuses)
  status?: 'draft' | 'published' | 'suspended';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  countries?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  ports?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  serviceCategories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  shipmentModes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  languages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  specialties?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  complianceBadges?: string[];

  @IsOptional()
  @IsObject()
  aiCapabilities?: {
    supportsAiClassification?: boolean;
    supportsDocumentAutomation?: boolean;
    supportsDutyAudit?: boolean;
    notes?: string;
  } | null;

  @IsOptional()
  @IsObject()
  metrics?: {
    averageResponseHours?: number;
    completedShipments?: number;
    satisfactionScore?: number;
  } | null;

  @IsOptional()
  @IsUrl()
  websiteUrl?: string | null;

  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  contactPhone?: string | null;

  @IsOptional()
  @IsObject()
  officeAddress?: Record<string, string | undefined> | null;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  minimumEngagement?: string | null;
}

export class CreateBrokerCredentialDto {
  @IsString()
  @Length(2, 80)
  credentialType: string;

  @IsString()
  @Length(2, 160)
  label: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  issuingAuthority?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  identifier?: string | null;

  @IsOptional()
  @IsString()
  secretValue?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  expiresAt?: Date | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class VerifyBrokerProfileDto {
  @IsIn(['verified', 'rejected', 'suspended'])
  status: 'verified' | 'rejected' | 'suspended';

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string | null;
}

export class AdminListBrokerProfilesDto extends SearchMarketplaceBrokersDto {
  @IsOptional()
  @IsIn(profileStatuses)
  status?: 'draft' | 'published' | 'suspended';

  @IsOptional()
  @IsIn(verificationStatuses)
  verificationStatus?: 'unverified' | 'pending' | 'verified' | 'rejected';
}

export class AiCapabilityDto {
  @IsOptional()
  @IsBoolean()
  supportsAiClassification?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsDocumentAutomation?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsDutyAudit?: boolean;
}

export class BrokerMetricDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  averageResponseHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  completedShipments?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  satisfactionScore?: number;
}
