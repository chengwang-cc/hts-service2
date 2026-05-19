import {
  IsEmail,
  IsString,
  MinLength,
  IsUUID,
  IsOptional,
  IsIn,
  Length,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// Supported countries (ISO 2-letter codes). Keep in sync with hts-web2 country-list.ts
export const SUPPORTED_COUNTRY_CODES = [
  'US', 'CA', 'GB', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE',
  'JP', 'KR', 'SG', 'HK', 'NZ', 'MX', 'BR',
];

export class CompanyInfoDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @IsOptional()
  websiteUrl?: string;

  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an uppercase ISO 2-letter code' })
  @IsIn(SUPPORTED_COUNTRY_CODES, { message: 'country must be a supported country code' })
  country: string;

  @IsString()
  @IsOptional()
  shippingCarrier?: string;

  @IsIn(['ecommerce', 'supply_chain'])
  @IsOptional()
  integrationType?: string;

  @IsString()
  @IsOptional()
  platform?: string;
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsUUID()
  @IsOptional()
  organizationId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyInfoDto)
  company?: CompanyInfoDto;
}
