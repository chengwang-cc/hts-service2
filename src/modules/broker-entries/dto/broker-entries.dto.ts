import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

const shipmentModes = [
  'ocean',
  'air',
  'truck',
  'rail',
  'parcel',
  'multimodal',
] as const;

export class CreateShipmentDto {
  @IsUUID('4')
  clientId: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  shipmentReference?: string | null;

  @IsIn(shipmentModes)
  mode: (typeof shipmentModes)[number];

  @IsOptional()
  @IsString()
  @Length(0, 160)
  carrierName?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  vesselOrFlight?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  originCountry?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  destinationCountry?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  portOfLading?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  portOfUnlading?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  eta?: Date | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class EntryLineInputDto {
  @IsInt()
  @Min(1)
  lineNumber: number;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  sku?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  htsNumber?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  countryOfOrigin?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  unitOfMeasure?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitValue?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  currency?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}

export class CreateEntryDto {
  @IsUUID('4')
  clientId: string;

  @IsOptional()
  @IsUUID('4')
  shipmentId?: string | null;

  @IsOptional()
  @IsUUID('4')
  packetId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  entryNumber?: string | null;

  @IsOptional()
  @IsIn([
    'consumption',
    'informal',
    'warehouse',
    'fta',
    'tib',
    'in_bond',
    'isf',
    'other',
  ])
  entryType?:
    | 'consumption'
    | 'informal'
    | 'warehouse'
    | 'fta'
    | 'tib'
    | 'in_bond'
    | 'isf'
    | 'other';

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  dueAt?: Date | null;

  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  currency?: string | null;

  @IsOptional()
  @IsString()
  internalNotes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => EntryLineInputDto)
  lines?: EntryLineInputDto[];
}

export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  @Length(0, 60)
  entryNumber?: string | null;

  @IsOptional()
  @IsIn([
    'draft',
    'in_review',
    'ready_to_file',
    'approved',
    'exported',
    'transmitted',
    'accepted',
    'rejected',
    'cancelled',
  ])
  status?:
    | 'draft'
    | 'in_review'
    | 'ready_to_file'
    | 'approved'
    | 'exported'
    | 'transmitted'
    | 'accepted'
    | 'rejected'
    | 'cancelled';

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  riskLevel?: 'low' | 'medium' | 'high';

  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  dueAt?: Date | null;

  @IsOptional()
  @IsString()
  internalNotes?: string | null;
}

export class ListEntriesDto {
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  riskLevel?: string;

  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string;

  @IsOptional()
  @IsString()
  q?: string;

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

export class UpsertEntryLineDto extends EntryLineInputDto {}
