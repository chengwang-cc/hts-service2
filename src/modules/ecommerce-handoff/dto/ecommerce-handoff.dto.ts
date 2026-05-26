import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const ECOM_PLATFORMS = [
  'shopify',
  'woocommerce',
  'magento',
  'wix',
  'etsy',
  'wordpress',
  'custom',
] as const;

export const ECOM_HANDOFF_STATES = [
  'classification_needed',
  'landed_cost_ready',
  'broker_review_required',
  'fulfillment_blocked',
  'broker_released',
] as const;

export class EcommerceHandoffItemDto {
  @ApiProperty({ example: 'Cotton T-Shirt, mens, M' })
  @IsString()
  @MaxLength(500)
  productDescription: string;

  @ApiPropertyOptional({ example: '6109.10.0012' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  hts?: string;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  originCountry?: string;

  @ApiPropertyOptional({ example: 24.95 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitValue?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;
}

export class EcommerceHandoffDto {
  @ApiProperty({ enum: ECOM_PLATFORMS })
  @IsIn(ECOM_PLATFORMS)
  platform: (typeof ECOM_PLATFORMS)[number];

  @ApiProperty({ example: 'shop-12345' })
  @IsString()
  @MaxLength(120)
  externalOrderId: string;

  @ApiPropertyOptional({ example: 'shop.example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalStoreId?: string;

  @ApiProperty({ example: 'US' })
  @IsString()
  @MaxLength(8)
  originCountry: string;

  @ApiProperty({ example: 'CA' })
  @IsString()
  @MaxLength(8)
  destinationCountry: string;

  @ApiPropertyOptional({ example: 'YYZ' })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  portOfEntry?: string;

  @ApiProperty({ type: [EcommerceHandoffItemDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EcommerceHandoffItemDto)
  items: EcommerceHandoffItemDto[];

  @ApiPropertyOptional({ example: 199.95 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shipmentValue?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  shipmentCurrency?: string;

  @ApiPropertyOptional({ description: 'Free-form metadata from the source platform.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
