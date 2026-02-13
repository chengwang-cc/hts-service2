import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataCompletenessCheckEntity } from '../entities';
import {
  CompletenessReportDto,
  BatchCompletenessReportDto,
  CompletenessIssue,
} from '../dto';

interface CompletenessRule {
  field: string;
  required: boolean;
  validations?: Array<(value: any) => { valid: boolean; message: string }>;
  dependencies?: string[];
  weight?: number; // For scoring
}

@Injectable()
export class DataCompletenessService {
  // Classification completeness rules
  private readonly CLASSIFICATION_RULES: CompletenessRule[] = [
    {
      field: 'productDescription',
      required: true,
      weight: 15,
      validations: [
        (value: string) => ({
          valid: !!(value && value.length >= 10),
          message: 'Product description must be at least 10 characters',
        }),
      ],
    },
    {
      field: 'confirmedHtsCode',
      required: true,
      weight: 25,
      validations: [
        (value: string) => ({
          valid: /^\d{4}\.\d{2}\.\d{4}$/.test(value),
          message: 'HTS code must be in format XXXX.XX.XXXX',
        }),
      ],
    },
    {
      field: 'originCountry',
      required: true,
      weight: 15,
      validations: [
        (value: string) => ({
          valid: !!(value && value.length === 2),
          message: 'Origin country must be a 2-letter ISO code',
        }),
      ],
    },
    {
      field: 'confirmedBy',
      required: true,
      weight: 10,
    },
    {
      field: 'confirmedAt',
      required: true,
      weight: 10,
    },
    {
      field: 'confidenceScore',
      required: false,
      weight: 5,
      validations: [
        (value: number) => ({
          valid: value >= 0.7,
          message: 'Confidence score is below 70%, consider review',
        }),
      ],
    },
  ];

  // Calculation completeness rules
  private readonly CALCULATION_RULES: CompletenessRule[] = [
    {
      field: 'htsCode',
      required: true,
      weight: 20,
    },
    {
      field: 'declaredValue',
      required: true,
      weight: 20,
      validations: [
        (value: number) => ({
          valid: value > 0,
          message: 'Declared value must be greater than 0',
        }),
      ],
    },
    {
      field: 'quantity',
      required: true,
      weight: 15,
      validations: [
        (value: number) => ({
          valid: value > 0,
          message: 'Quantity must be greater than 0',
        }),
      ],
    },
    {
      field: 'originCountry',
      required: true,
      weight: 15,
    },
    {
      field: 'weight',
      required: false,
      weight: 10,
      dependencies: ['htsCode'], // Required if HTS has specific rate
    },
    {
      field: 'currency',
      required: true,
      weight: 10,
    },
    {
      field: 'unitOfMeasure',
      required: true,
      weight: 10,
    },
  ];

  constructor(
    @InjectRepository(DataCompletenessCheckEntity)
    private readonly completenessRepo: Repository<DataCompletenessCheckEntity>,
  ) {}

  /**
   * Check single resource completeness
   */
  async checkResource(
    organizationId: string,
    resourceType: 'classification' | 'calculation' | 'product',
    resource: any,
  ): Promise<CompletenessReportDto> {
    const rules = this.getRulesForType(resourceType);
    const issues: CompletenessIssue[] = [];

    let totalWeight = 0;
    let achievedWeight = 0;

    for (const rule of rules) {
      const value = resource[rule.field];
      const weight = rule.weight || 10;
      totalWeight += weight;

      // Check required field
      if (rule.required && !value) {
        issues.push({
          field: rule.field,
          severity: 'error',
          message: `${rule.field} is required`,
          blocker: true,
          suggestion: `Please provide a value for ${rule.field}`,
        });
        continue;
      }

      // Check dependencies
      if (rule.dependencies && value) {
        for (const dep of rule.dependencies) {
          if (resource[dep] && this.fieldRequiresValue(resource, rule.field, dep)) {
            if (!value) {
              issues.push({
                field: rule.field,
                severity: 'warning',
                message: `${rule.field} is recommended when ${dep} is provided`,
                blocker: false,
                suggestion: `Consider adding ${rule.field} for complete export`,
              });
            }
          }
        }
      }

      // Run validations
      if (value && rule.validations) {
        for (const validation of rule.validations) {
          const result = validation(value);
          if (!result.valid) {
            issues.push({
              field: rule.field,
              severity: 'warning',
              message: result.message,
              blocker: false,
            });
          } else {
            achievedWeight += weight;
          }
        }
      } else if (value || !rule.required) {
        achievedWeight += weight;
      }
    }

    const overallScore = totalWeight > 0 ? (achievedWeight / totalWeight) * 100 : 0;
    const isExportReady = issues.filter(i => i.blocker).length === 0;

    // Save check result
    const checkEntity = this.completenessRepo.create({
      organizationId,
      resourceType,
      resourceId: resource.id,
      overallScore,
      isExportReady,
      issues,
      completeness: this.calculateComponentScores(resource, rules),
    });

    await this.completenessRepo.save(checkEntity);

    return {
      resourceId: resource.id,
      resourceType,
      overallScore: Math.round(overallScore * 100) / 100,
      isExportReady,
      issues,
      completeness: checkEntity.completeness || {},
      timestamp: checkEntity.createdAt,
    };
  }

  /**
   * Check multiple resources (batch)
   */
  async checkBatch(
    organizationId: string,
    resourceType: 'classification' | 'calculation' | 'product',
    resources: any[],
  ): Promise<BatchCompletenessReportDto> {
    const reports: CompletenessReportDto[] = [];

    for (const resource of resources) {
      const report = await this.checkResource(organizationId, resourceType, resource);
      reports.push(report);
    }

    const exportReadyCount = reports.filter(r => r.isExportReady).length;
    const averageScore = reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length;

    const allIssues = reports.flatMap(r => r.issues);
    const summary = {
      critical: allIssues.filter(i => i.severity === 'error').length,
      warnings: allIssues.filter(i => i.severity === 'warning').length,
      passed: reports.filter(r => r.issues.length === 0).length,
    };

    return {
      totalResources: resources.length,
      exportReadyCount,
      averageScore: Math.round(averageScore * 100) / 100,
      reports,
      summary,
    };
  }

  /**
   * Get latest completeness check for resource
   */
  async getLatestCheck(
    resourceType: string,
    resourceId: string,
  ): Promise<DataCompletenessCheckEntity | null> {
    return this.completenessRepo.findOne({
      where: { resourceType: resourceType as any, resourceId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get completeness history for resource
   */
  async getCheckHistory(
    resourceType: string,
    resourceId: string,
    limit = 10,
  ): Promise<DataCompletenessCheckEntity[]> {
    return this.completenessRepo.find({
      where: { resourceType: resourceType as any, resourceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get rules for resource type
   */
  private getRulesForType(
    resourceType: 'classification' | 'calculation' | 'product',
  ): CompletenessRule[] {
    switch (resourceType) {
      case 'classification':
        return this.CLASSIFICATION_RULES;
      case 'calculation':
        return this.CALCULATION_RULES;
      default:
        return [...this.CLASSIFICATION_RULES, ...this.CALCULATION_RULES];
    }
  }

  /**
   * Calculate component scores
   */
  private calculateComponentScores(
    resource: any,
    rules: CompletenessRule[],
  ): Record<string, number> {
    const scores: Record<string, number> = {};

    // Group rules by component
    const components = {
      classification: ['productDescription', 'confirmedHtsCode', 'originCountry', 'confirmedBy'],
      valuation: ['declaredValue', 'currency', 'quantity'],
      origin: ['originCountry', 'manufacturer'],
      weight: ['weight', 'unitOfMeasure'],
      documentation: ['documentUrls', 'imageUrls', 'reviewNotes'],
    };

    for (const [component, fields] of Object.entries(components)) {
      const relevantRules = rules.filter(r => fields.includes(r.field));
      const totalWeight = relevantRules.reduce((sum, r) => sum + (r.weight || 10), 0);
      const achievedWeight = relevantRules
        .filter(r => resource[r.field])
        .reduce((sum, r) => sum + (r.weight || 10), 0);

      scores[component] = totalWeight > 0 ? (achievedWeight / totalWeight) * 100 : 0;
    }

    return scores;
  }

  /**
   * Check if field requires value based on dependency
   */
  private fieldRequiresValue(resource: any, field: string, dependency: string): boolean {
    // Example: weight is required if HTS code has specific duty rate
    if (field === 'weight' && dependency === 'htsCode') {
      const htsCode = resource.htsCode;
      // Check if HTS code has specific rate (would need HTS data lookup in real implementation)
      return htsCode && htsCode.includes('kg'); // Simplified check
    }
    return false;
  }
}
