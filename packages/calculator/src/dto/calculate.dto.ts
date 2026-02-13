import { IsString, IsNumber, IsOptional, IsBoolean, Min } from 'class-validator';

export class CalculateDto {
  @IsString()
  htsNumber: string;

  @IsString()
  countryOfOrigin: string;

  @IsNumber()
  @Min(0)
  declaredValue: number;

  @IsString()
  @IsOptional()
  currency?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  weightKg?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  quantity?: number;

  @IsString()
  @IsOptional()
  quantityUnit?: string;

  @IsString()
  @IsOptional()
  htsVersion?: string;

  @IsString()
  @IsOptional()
  tradeAgreement?: string;

  @IsBoolean()
  @IsOptional()
  claimPreferential?: boolean;

  @IsOptional()
  additionalInputs?: Record<string, any>;
}
