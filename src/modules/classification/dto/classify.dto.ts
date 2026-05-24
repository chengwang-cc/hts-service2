import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class MaterialDto {
  @IsString() material: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  percent: number;
}

/**
 * ClassifyRequestDto - P2.1 single classify input.
 */
export class ClassifyRequestDto {
  @IsString()
  description: string;

  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialDto)
  materials?: MaterialDto[];

  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() existingHsCode?: string;
  @IsOptional() @IsString() countryOfOrigin?: string;

  /** Destination jurisdiction (P0 only supports US). */
  @IsOptional() @IsString() destinationCountry?: string;

  /** Optional catalog link. If present, candidates persist as catalog candidates. */
  @IsOptional() @IsString() productId?: string;
}

export class BulkClassifyRequestDto {
  @IsString() inputCsvUrl: string;
  @IsOptional() @IsString() destinationCountry?: string;
  @IsOptional() @IsString() callbackUrl?: string;
}
