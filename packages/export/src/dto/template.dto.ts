import { IsString, IsObject, IsBoolean, IsOptional, IsEnum } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(['shopify', 'broker', 'customs', 'audit-pack', 'invoice', 'packing-list', 'custom'])
  templateType: 'shopify' | 'broker' | 'customs' | 'audit-pack' | 'invoice' | 'packing-list' | 'custom';

  @IsObject()
  fieldMapping: {
    [key: string]: {
      sourceField: string;
      transform?: string;
      required?: boolean;
      defaultValue?: any;
    };
  };

  @IsObject()
  @IsOptional()
  formatOptions?: {
    delimiter?: string;
    quoteChar?: string;
    encoding?: string;
    dateFormat?: string;
    includeHeader?: boolean;
  };
}

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  fieldMapping?: {
    [key: string]: {
      sourceField: string;
      transform?: string;
      required?: boolean;
      defaultValue?: any;
    };
  };

  @IsObject()
  @IsOptional()
  formatOptions?: {
    delimiter?: string;
    quoteChar?: string;
    encoding?: string;
    dateFormat?: string;
    includeHeader?: boolean;
  };

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class TemplateResponseDto {
  id: string;
  name: string;
  description?: string;
  templateType: string;
  fieldMapping: Record<string, any>;
  formatOptions?: Record<string, any>;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
