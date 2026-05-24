import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { TariffSelectionMode } from '../../calculator/dto/calculate.dto';

export class DestinationDto {
  @IsString() country: string;
  /** EU member state (DE, FR, NL, ...) when country='EU'. */
  @IsOptional() @IsString() memberState?: string;
  /** Sub-national region — US state, CA province, etc. */
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() postalCode?: string;
}

export class OriginDto {
  @IsString() country: string;
  @IsOptional() @IsString() shipFromCountry?: string;
}

export class MoneyDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString() currency: string;
}

export class TaxRegistrationDto {
  @IsString() jurisdiction: string;
  @IsString() type: string;
  @IsString() id: string;
}

export class SellerDto {
  @IsOptional() @IsString() organizationId?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxRegistrationDto)
  taxRegistrations?: TaxRegistrationDto[];
  @IsOptional() @IsString() iossNumber?: string;
  @IsOptional() @IsBoolean() isMarketplace?: boolean;
}

export class BuyerDto {
  @IsOptional() @IsString() type?: 'consumer' | 'business';
  @IsOptional() @IsString() taxId?: string;
}

export class MaterialCompositionDto {
  @IsString() material: string;
  @IsNumber() @Min(0) percent: number;
}

export class LandedCostLineDto {
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsString() productId?: string;
  @IsString() description: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() material?: string;
  @IsOptional() @IsString() hsCode?: string;
  @IsOptional() @IsString() destinationCode?: string;
  @IsString() countryOfOrigin: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitValue: number;

  @IsOptional() @IsNumber() @Min(0) weightKg?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialCompositionDto)
  materialComposition?: MaterialCompositionDto[];

  @IsOptional() @IsObject() additionalInputs?: Record<string, any>;
}

export class FallbackPolicyDto {
  @IsOptional() @IsBoolean() classifyIfMissing?: boolean;
  @IsOptional() @IsBoolean() useMerchantDefaults?: boolean;
  @IsOptional() @IsBoolean() allowEstimate?: boolean;

  @IsOptional()
  @IsEnum(['preferred', 'maximum', 'median', 'minimum'])
  tariffSelectionMode?: TariffSelectionMode;
}

export class LandedCostQuoteRequestDto {
  @IsOptional() @IsString() calculationMethod?: 'DDP' | 'DAP';
  @IsString() currency: string;
  @IsOptional() @IsString() entryDate?: string;

  @ValidateNested() @Type(() => DestinationDto) destination: DestinationDto;
  @ValidateNested() @Type(() => OriginDto) origin: OriginDto;

  @IsOptional() @ValidateNested() @Type(() => MoneyDto) shipping?: MoneyDto;
  @IsOptional() @ValidateNested() @Type(() => MoneyDto) insurance?: MoneyDto;

  @IsOptional() @ValidateNested() @Type(() => SellerDto) seller?: SellerDto;
  @IsOptional() @ValidateNested() @Type(() => BuyerDto) buyer?: BuyerDto;

  // AUDIT FIX H1 — reject quotes with zero items at the validation
  // boundary so the LandedCostService never constructs an empty quote.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LandedCostLineDto)
  items: LandedCostLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FallbackPolicyDto)
  fallbackPolicy?: FallbackPolicyDto;
}
