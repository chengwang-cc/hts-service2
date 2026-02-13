import { IsString, IsEnum, IsOptional, IsObject, IsBoolean } from 'class-validator';

export class StartOnboardingDto {
  @IsEnum(['merchant', 'broker', 'developer'])
  persona: 'merchant' | 'broker' | 'developer';

  @IsOptional()
  @IsObject()
  initialData?: Record<string, any>;
}

export class UpdateOnboardingStepDto {
  @IsString()
  step: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  complete?: boolean;
}

export class ValidateCsvDto {
  @IsString()
  templateType: string;

  @IsString()
  csvContent: string;
}

export class GenerateTemplateDto {
  @IsEnum(['product-catalog', 'sku-mapping', 'broker-format', 'customs-declaration'])
  templateType: 'product-catalog' | 'sku-mapping' | 'broker-format' | 'customs-declaration';

  @IsOptional()
  @IsBoolean()
  includeSamples?: boolean;
}
