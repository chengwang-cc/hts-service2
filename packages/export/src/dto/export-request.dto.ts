import {
  IsEnum,
  IsObject,
  IsOptional,
  IsBoolean,
  IsArray,
  IsString,
} from 'class-validator';

export class ExportRequestDto {
  @IsEnum(['csv', 'excel', 'pdf', 'json'])
  format: 'csv' | 'excel' | 'pdf' | 'json';

  @IsEnum([
    'shopify',
    'broker',
    'customs',
    'audit-pack',
    'invoice',
    'packing-list',
    'custom',
  ])
  template:
    | 'shopify'
    | 'broker'
    | 'customs'
    | 'audit-pack'
    | 'invoice'
    | 'packing-list'
    | 'custom';

  @IsString()
  @IsOptional()
  customTemplateId?: string;

  @IsObject()
  @IsOptional()
  filters?: {
    dateRange?: { start: Date; end: Date };
    status?: string[];
    htsCodePrefix?: string;
    originCountry?: string[];
    productIds?: string[];
    classificationIds?: string[];
    calculationIds?: string[];
  };

  @IsBoolean()
  @IsOptional()
  includeMetadata?: boolean;

  @IsBoolean()
  @IsOptional()
  includeHistory?: boolean;

  @IsBoolean()
  @IsOptional()
  includeAuditTrail?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  columns?: string[];
}

export class ExportResponseDto {
  jobId: string;
  status: string;
  message: string;
  estimatedCompletionTime?: number;
}

export class ExportJobStatusDto {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    failed: number;
    percentage: number;
  };
  fileUrl?: string;
  fileSize?: number;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  expiresAt?: Date;
}
