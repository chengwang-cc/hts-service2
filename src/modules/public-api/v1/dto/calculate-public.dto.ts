import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CalculatePublicDto {
  @IsString()
  @MaxLength(20)
  htsNumber: string;

  @IsString()
  @MaxLength(8)
  countryOfOrigin: string;

  @IsNumber()
  @Min(0.000001)
  declaredValue: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  quantityUnit?: string;

  @IsOptional()
  @IsString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tradeAgreementCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  tradeAgreement?: string;

  @IsOptional()
  @IsBoolean()
  tradeAgreementCertificate?: boolean;

  @IsOptional()
  @IsBoolean()
  claimPreferential?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  htsVersion?: string;

  @IsOptional()
  @IsObject()
  additionalInputs?: Record<string, any>;
}
