import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalculatePublicDto {
  @ApiProperty({
    description: 'HTS classification number',
    example: '8471.30.0100',
  })
  @IsString()
  @MaxLength(20)
  htsNumber: string;

  @ApiProperty({
    description:
      'Country of origin as ISO-3166-1 alpha-2 code (e.g. "CN", "VN", "MX"). Case-insensitive; normalized to upper-case server-side.',
    example: 'CN',
  })
  @IsString()
  @IsNotEmpty({ message: 'countryOfOrigin is required' })
  @Matches(/^[A-Za-z]{2}$/, {
    message:
      'countryOfOrigin must be a 2-letter ISO-3166-1 alpha-2 country code (e.g. "CN", not "China" or "CHN")',
  })
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
