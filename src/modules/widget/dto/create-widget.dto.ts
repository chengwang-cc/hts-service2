import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  IsObject,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateWidgetDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsUUID()
  apiKeyId: string;

  @IsEnum(['lookup', 'calculator', 'combined'])
  widgetType: 'lookup' | 'calculator' | 'combined';

  @IsArray()
  @IsString({ each: true })
  allowedDomains: string[];

  @IsOptional()
  @IsObject()
  styling?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    width?: string;
    height?: string;
    theme?: 'light' | 'dark' | 'auto';
    customCss?: string;
  };

  @IsOptional()
  @IsObject()
  features?: {
    showDescription?: boolean;
    showRates?: boolean;
    showHierarchy?: boolean;
    enableCalculation?: boolean;
    enableSearch?: boolean;
    enableRecommendations?: boolean;
    showFootnotes?: boolean;
    maxResults?: number;
  };

  @IsOptional()
  @IsObject()
  defaults?: {
    countryOfOrigin?: string;
    currency?: string;
    [key: string]: any;
  };

  @IsOptional()
  @IsObject()
  labels?: {
    searchPlaceholder?: string;
    calculateButton?: string;
    resultsTitle?: string;
    [key: string]: string | undefined;
  };
}

export class UpdateWidgetDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[];

  @IsOptional()
  @IsObject()
  styling?: any;

  @IsOptional()
  @IsObject()
  features?: any;

  @IsOptional()
  @IsObject()
  defaults?: any;

  @IsOptional()
  @IsObject()
  labels?: any;
}
