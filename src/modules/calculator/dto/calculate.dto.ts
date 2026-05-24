import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdditionalInputsDto } from './additional-inputs.dto';

export type TariffSelectionMode =
  | 'preferred'
  | 'maximum'
  | 'median'
  | 'minimum';

export class CalculateDto {
  @IsString()
  htsNumber: string;

  @IsString()
  countryOfOrigin: string;

  /**
   * Destination jurisdiction. Defaults to 'US' during P0 (the only supported
   * destination today). Required for non-US destinations in P1+.
   */
  @IsString()
  @IsOptional()
  destinationCountry?: string;

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
  entryDate?: string;

  @IsString()
  @IsOptional()
  tradeAgreement?: string;

  @IsString()
  @IsOptional()
  tradeAgreementCode?: string;

  @IsBoolean()
  @IsOptional()
  claimPreferential?: boolean;

  @IsBoolean()
  @IsOptional()
  tradeAgreementCertificate?: boolean;

  /**
   * Selection mode for incomplete (6-digit) HS classifications.
   * Used by landed-cost / 6-digit fallback in P3. Ignored when a full
   * 10-digit HTS code is provided.
   */
  @IsEnum(['preferred', 'maximum', 'median', 'minimum'])
  @IsOptional()
  tariffSelectionMode?: TariffSelectionMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdditionalInputsDto)
  additionalInputs?: AdditionalInputsDto;
}
