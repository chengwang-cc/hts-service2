import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  IsNumber,
  Min,
} from 'class-validator';

export class HtsFormulaUpdateDto {
  @IsString()
  htsNumber: string;

  @IsString()
  countryCode: string;

  @IsString()
  formulaType: string;

  @IsString()
  formula: string;

  @IsOptional()
  @IsArray()
  formulaVariables?: Array<{
    name: string;
    type: string;
    description?: string;
    unit?: string;
  }>;

  @IsOptional()
  @IsString()
  comment?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  carryover?: boolean;

  @IsOptional()
  @IsBoolean()
  overrideExtraTax?: boolean;

  @IsString()
  updateVersion: string;
}

export class SearchFormulaUpdateDto {
  @IsOptional()
  @IsString()
  htsNumber?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  formulaType?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';
}
