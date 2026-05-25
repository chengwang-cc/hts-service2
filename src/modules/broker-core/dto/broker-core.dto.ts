import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateBrokerClientDto {
  @IsString()
  @Length(2, 200)
  name: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  legalName?: string | null;

  @IsOptional()
  @IsUUID('4')
  clientOrganizationId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  importerId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  defaultCurrency?: string | null;

  @IsOptional()
  @IsEmail()
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  contactPhone?: string | null;

  @IsOptional()
  @IsObject()
  address?: Record<string, string | undefined> | null;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string | null;

  @IsOptional()
  @IsIn(['active', 'onboarding', 'inactive', 'archived'])
  status?: 'active' | 'onboarding' | 'inactive' | 'archived';

  /**
   * R1-E-03 — per-client reconciliation tolerance, percent (0..50). Null
   * resets to the system default. Persisted on `broker_clients`.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50)
  reconciliationTolerancePct?: number | null;
}

export class UpdateBrokerClientDto extends CreateBrokerClientDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  declare name: string;
}

export class ListBrokerClientsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['active', 'onboarding', 'inactive', 'archived'])
  status?: 'active' | 'onboarding' | 'inactive' | 'archived';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  offset?: number;
}

export class UpsertPoaDto {
  @IsOptional()
  @IsIn(['missing', 'pending', 'verified', 'expired', 'revoked'])
  status?: 'missing' | 'pending' | 'verified' | 'expired' | 'revoked';

  @IsOptional()
  @IsIn(['continuous', 'single_transaction', 'limited'])
  poaType?: 'continuous' | 'single_transaction' | 'limited';

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  effectiveDate?: Date | null;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  expiresAt?: Date | null;

  @IsOptional()
  @IsString()
  documentStorageKey?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class OnboardingChecklistItemDto {
  @IsString()
  @Length(1, 80)
  key: string;

  @IsString()
  @Length(1, 200)
  label: string;

  @IsIn(['pending', 'completed', 'skipped'])
  status: 'pending' | 'completed' | 'skipped';
}

export class UpdateRelationshipChecklistDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => OnboardingChecklistItemDto)
  items: OnboardingChecklistItemDto[];
}
