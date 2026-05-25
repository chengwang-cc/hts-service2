import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

const targetTypes = [
  'broker_entry',
  'broker_entry_line',
  'broker_document_packet',
  'broker_document',
  'broker_missing_info_task',
] as const;

const suggestionTypes = [
  'hts_classification',
  'origin',
  'value',
  'pga_disclaimer',
  'special_program',
  'document_field_fix',
  'missing_info_question',
  'reject_remediation',
] as const;

export class CreateSuggestionDto {
  @IsIn(targetTypes)
  targetType: (typeof targetTypes)[number];

  @IsUUID('4')
  targetId: string;

  @IsIn(suggestionTypes)
  suggestionType: (typeof suggestionTypes)[number];

  @IsObject()
  value: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => (value == null ? null : Number(value)))
  confidence?: number | null;

  @IsString()
  @Length(1, 80)
  modelVersion: string;

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown> | null;
}

export class DecideSuggestionDto {
  @IsIn(['accept', 'reject', 'override'])
  decision: 'accept' | 'reject' | 'override';

  @IsOptional()
  @IsObject()
  finalValue?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  licensedBrokerSatisfied?: boolean;

  @IsOptional()
  @IsUUID('4')
  licensedBrokerUserId?: string | null;
}

export class BulkDecisionItemDto {
  @IsUUID('4')
  suggestionId: string;

  @IsOptional()
  @IsObject()
  finalValue?: Record<string, unknown> | null;
}

export class BulkDecisionDto {
  @IsIn(['accept', 'reject'])
  decision: 'accept' | 'reject';

  @IsString()
  @Length(20, 4000)
  sharedRationale: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkDecisionItemDto)
  items: BulkDecisionItemDto[];

  @IsOptional()
  @IsBoolean()
  licensedBrokerSatisfied?: boolean;

  @IsOptional()
  @IsUUID('4')
  licensedBrokerUserId?: string | null;
}

export class ClassifyLineDto {
  @IsString()
  @Length(2, 2000)
  description: string;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  destinationCountry?: string;
}
