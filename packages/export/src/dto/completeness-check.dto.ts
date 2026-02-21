import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CompletenessCheckRequestDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  resourceIds?: string[];

  @IsEnum(['classification', 'calculation', 'product'])
  resourceType: 'classification' | 'calculation' | 'product';

  @IsArray()
  @IsEnum(
    ['classification', 'valuation', 'origin', 'weight', 'documentation'],
    { each: true },
  )
  checkTypes: (
    | 'classification'
    | 'valuation'
    | 'origin'
    | 'weight'
    | 'documentation'
  )[];
}

export class CompletenessIssue {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  blocker: boolean;
  suggestion?: string;
}

export class CompletenessReportDto {
  resourceId: string;
  resourceType: string;
  overallScore: number;
  isExportReady: boolean;
  issues: CompletenessIssue[];
  completeness: {
    classification?: number;
    valuation?: number;
    origin?: number;
    weight?: number;
    documentation?: number;
  };
  timestamp: Date;
}

export class BatchCompletenessReportDto {
  totalResources: number;
  exportReadyCount: number;
  averageScore: number;
  reports: CompletenessReportDto[];
  summary: {
    critical: number;
    warnings: number;
    passed: number;
  };
}
