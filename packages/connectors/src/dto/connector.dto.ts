import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsBoolean,
  IsNumber,
} from 'class-validator';

export class CreateConnectorDto {
  @IsEnum(['shopify', 'broker', 'woocommerce', 'magento', 'bigcommerce'])
  connectorType:
    | 'shopify'
    | 'broker'
    | 'woocommerce'
    | 'magento'
    | 'bigcommerce';

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsObject()
  config: {
    shopUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
    webhookUrl?: string;
    syncEnabled?: boolean;
    syncInterval?: number;
    fieldMappings?: Record<string, string>;
    filters?: Record<string, any>;
  };
}

export class UpdateConnectorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SyncConnectorDto {
  @IsEnum(['import', 'export', 'full-sync'])
  syncType: 'import' | 'export' | 'full-sync';

  @IsOptional()
  @IsObject()
  options?: {
    sinceDate?: string;
    productIds?: string[];
    limit?: number;
    dryRun?: boolean;
  };
}

export class TestConnectionDto {
  @IsObject()
  config: {
    shopUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    accessToken?: string;
  };
}
