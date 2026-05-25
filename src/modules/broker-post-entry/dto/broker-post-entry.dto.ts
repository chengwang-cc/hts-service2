import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const caseTypes = [
  'cf28',
  'cf29',
  'psc',
  'protest',
  'reconciliation',
  'drawback',
  'classification_review',
] as const;

export class CreateCaseDto {
  @IsUUID('4')
  entryId: string;

  @IsIn(caseTypes)
  caseType: (typeof caseTypes)[number];

  @IsOptional()
  @IsString()
  @Length(0, 80)
  cbpReference?: string | null;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  dueAt?: Date | null;
}

export class UpdateCaseDto {
  @IsOptional()
  @IsIn(['open', 'in_progress', 'awaiting_cbp', 'resolved', 'cancelled'])
  status?: 'open' | 'in_progress' | 'awaiting_cbp' | 'resolved' | 'cancelled';

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID('4')
  assigneeUserId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value) : null))
  dueAt?: Date | null;
}

export class SearchPriorDecisionsDto {
  @IsOptional()
  @IsString()
  hts?: string;

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
