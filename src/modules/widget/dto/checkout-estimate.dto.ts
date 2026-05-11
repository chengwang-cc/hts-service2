import {
  IsString,
  IsOptional,
  IsNumber,
  IsNotEmpty,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MoneyDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  currency: string;
}

export class ProductLineItemDto {
  @IsString()
  sku: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @ValidateNested()
  @Type(() => MoneyDto)
  declaredValue: MoneyDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @IsString()
  hsCode?: string;

  @IsOptional()
  @IsString()
  countryOfOrigin?: string;
}

export class CheckoutEstimateDto {
  @IsString()
  @IsNotEmpty()
  destinationCountry: string;

  @IsOptional()
  @IsString()
  destinationState?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductLineItemDto)
  lines: ProductLineItemDto[];

  @IsOptional()
  @IsString()
  platformOrderRef?: string;
}
