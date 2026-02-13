import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingTemplateEntity } from '../entities/onboarding-template.entity';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { GenerateTemplateDto, ValidateCsvDto } from '../dto/onboarding.dto';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    row: number;
    field: string;
    message: string;
    value?: any;
  }>;
  warnings: Array<{
    row: number;
    field: string;
    message: string;
    value?: any;
  }>;
  stats: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
}

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(OnboardingTemplateEntity)
    private readonly templateRepo: Repository<OnboardingTemplateEntity>,
  ) {}

  private readonly builtInTemplates = {
    'product-catalog': {
      name: 'Product Catalog',
      description: 'Standard product catalog for classification',
      fields: [
        {
          name: 'sku',
          type: 'string' as const,
          required: true,
          description: 'Product SKU or identifier',
          example: 'PROD-001',
        },
        {
          name: 'description',
          type: 'string' as const,
          required: true,
          description: 'Product description',
          example: 'Cotton T-Shirt, Blue, Size M',
        },
        {
          name: 'htsCode',
          type: 'string' as const,
          required: false,
          description: 'Existing HTS code if known',
          example: '6109.10.00',
          validation: {
            pattern: '^\\d{4}\\.\\d{2}\\.\\d{2}$',
          },
        },
        {
          name: 'originCountry',
          type: 'string' as const,
          required: false,
          description: 'Country of origin (ISO 2-letter code)',
          example: 'CN',
          validation: {
            pattern: '^[A-Z]{2}$',
          },
        },
        {
          name: 'value',
          type: 'number' as const,
          required: false,
          description: 'Product value in USD',
          example: '29.99',
        },
        {
          name: 'weight',
          type: 'number' as const,
          required: false,
          description: 'Weight in pounds',
          example: '0.5',
        },
      ],
      sampleData: [
        {
          sku: 'TSHIRT-BLU-M',
          description: 'Cotton T-Shirt, Blue, Size M',
          htsCode: '6109.10.00',
          originCountry: 'CN',
          value: 29.99,
          weight: 0.5,
        },
        {
          sku: 'JEANS-BLK-32',
          description: 'Denim Jeans, Black, 32" Waist',
          htsCode: '6203.42.40',
          originCountry: 'BD',
          value: 59.99,
          weight: 1.2,
        },
      ],
    },
    'sku-mapping': {
      name: 'SKU to HTS Mapping',
      description: 'Map existing SKUs to HTS codes',
      fields: [
        {
          name: 'sku',
          type: 'string' as const,
          required: true,
          description: 'Product SKU',
          example: 'PROD-001',
        },
        {
          name: 'htsCode',
          type: 'string' as const,
          required: true,
          description: 'HTS code',
          example: '6109.10.00',
          validation: {
            pattern: '^\\d{4}\\.\\d{2}\\.\\d{2}$',
          },
        },
        {
          name: 'confirmedBy',
          type: 'string' as const,
          required: false,
          description: 'Who confirmed this mapping',
          example: 'john@example.com',
        },
        {
          name: 'confirmedAt',
          type: 'date' as const,
          required: false,
          description: 'When this was confirmed',
          example: '2026-02-13',
        },
      ],
      sampleData: [
        {
          sku: 'TSHIRT-BLU-M',
          htsCode: '6109.10.00',
          confirmedBy: 'john@example.com',
          confirmedAt: '2026-02-13',
        },
      ],
    },
    'broker-format': {
      name: 'Customs Broker Format',
      description: 'ACE PGA format for customs brokers',
      fields: [
        {
          name: 'lineNumber',
          type: 'number' as const,
          required: true,
          description: 'Line item number',
          example: '1',
        },
        {
          name: 'htsNumber',
          type: 'string' as const,
          required: true,
          description: 'HTS number (10 digits)',
          example: '6109100040',
          validation: {
            pattern: '^\\d{10}$',
          },
        },
        {
          name: 'description',
          type: 'string' as const,
          required: true,
          description: 'Commercial description',
          example: 'Cotton T-Shirts',
        },
        {
          name: 'quantity',
          type: 'number' as const,
          required: true,
          description: 'Quantity',
          example: '100',
        },
        {
          name: 'uom',
          type: 'string' as const,
          required: true,
          description: 'Unit of measure',
          example: 'DOZ',
        },
        {
          name: 'value',
          type: 'number' as const,
          required: true,
          description: 'Total value USD',
          example: '2999.00',
        },
        {
          name: 'originCountry',
          type: 'string' as const,
          required: true,
          description: 'Country of origin',
          example: 'CN',
        },
      ],
      sampleData: [
        {
          lineNumber: 1,
          htsNumber: '6109100040',
          description: 'Cotton T-Shirts',
          quantity: 100,
          uom: 'DOZ',
          value: 2999.0,
          originCountry: 'CN',
        },
      ],
    },
    'customs-declaration': {
      name: 'Customs Declaration',
      description: 'Commercial invoice line items',
      fields: [
        {
          name: 'itemNumber',
          type: 'number' as const,
          required: true,
          description: 'Item number',
          example: '1',
        },
        {
          name: 'description',
          type: 'string' as const,
          required: true,
          description: 'Item description',
          example: 'Cotton T-Shirts',
        },
        {
          name: 'quantity',
          type: 'number' as const,
          required: true,
          description: 'Quantity',
          example: '100',
        },
        {
          name: 'unitPrice',
          type: 'number' as const,
          required: true,
          description: 'Unit price USD',
          example: '29.99',
        },
        {
          name: 'totalValue',
          type: 'number' as const,
          required: true,
          description: 'Total value USD',
          example: '2999.00',
        },
        {
          name: 'htsCode',
          type: 'string' as const,
          required: true,
          description: 'HTS code',
          example: '6109.10.00',
        },
        {
          name: 'countryOfOrigin',
          type: 'string' as const,
          required: true,
          description: 'Country of origin',
          example: 'China',
        },
      ],
      sampleData: [
        {
          itemNumber: 1,
          description: 'Cotton T-Shirts',
          quantity: 100,
          unitPrice: 29.99,
          totalValue: 2999.0,
          htsCode: '6109.10.00',
          countryOfOrigin: 'China',
        },
      ],
    },
  };

  async generateTemplate(dto: GenerateTemplateDto): Promise<string> {
    const template = this.builtInTemplates[dto.templateType];

    if (!template) {
      throw new Error(`Unknown template type: ${dto.templateType}`);
    }

    const headers = template.fields.map((f) => f.name);

    if (dto.includeSamples && template.sampleData) {
      const records = template.sampleData;
      return stringify(records, { header: true, columns: headers });
    }

    // Just headers
    return stringify([{}], { header: true, columns: headers });
  }

  async validateCsv(dto: ValidateCsvDto): Promise<ValidationResult> {
    const template = this.builtInTemplates[dto.templateType];

    if (!template) {
      throw new Error(`Unknown template type: ${dto.templateType}`);
    }

    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];

    // Parse CSV
    let records: any[];
    try {
      records = parse(dto.csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (e) {
      return {
        valid: false,
        errors: [{ row: 0, field: 'csv', message: 'Invalid CSV format' }],
        warnings: [],
        stats: { totalRows: 0, validRows: 0, invalidRows: 0 },
      };
    }

    // Validate each record
    records.forEach((record, index) => {
      const rowNumber = index + 2; // +2 because row 1 is header, and index starts at 0

      template.fields.forEach((field) => {
        const value = record[field.name];

        // Check required fields
        if (field.required && (value === undefined || value === null || value === '')) {
          errors.push({
            row: rowNumber,
            field: field.name,
            message: `Required field missing`,
            value,
          });
          return;
        }

        if (value === undefined || value === null || value === '') {
          return; // Skip validation for empty optional fields
        }

        // Type validation
        if (field.type === 'number') {
          const num = parseFloat(value);
          if (isNaN(num)) {
            errors.push({
              row: rowNumber,
              field: field.name,
              message: `Expected number, got "${value}"`,
              value,
            });
          }
        }

        // Pattern validation
        if (field.validation?.pattern) {
          const regex = new RegExp(field.validation.pattern);
          if (!regex.test(value)) {
            errors.push({
              row: rowNumber,
              field: field.name,
              message: `Value does not match expected pattern`,
              value,
            });
          }
        }

        // Range validation
        if (field.validation?.min !== undefined) {
          const num = parseFloat(value);
          if (!isNaN(num) && num < field.validation.min) {
            errors.push({
              row: rowNumber,
              field: field.name,
              message: `Value must be at least ${field.validation.min}`,
              value,
            });
          }
        }

        if (field.validation?.max !== undefined) {
          const num = parseFloat(value);
          if (!isNaN(num) && num > field.validation.max) {
            errors.push({
              row: rowNumber,
              field: field.name,
              message: `Value must not exceed ${field.validation.max}`,
              value,
            });
          }
        }
      });
    });

    const totalRows = records.length;
    const invalidRows = new Set(errors.map((e) => e.row)).size;
    const validRows = totalRows - invalidRows;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        totalRows,
        validRows,
        invalidRows,
      },
    };
  }

  async getTemplate(templateType: string): Promise<OnboardingTemplateEntity | null> {
    return this.templateRepo.findOne({
      where: {
        templateType: templateType as any,
        isActive: true
      }
    });
  }

  async listTemplates(): Promise<OnboardingTemplateEntity[]> {
    return this.templateRepo.find({ where: { isActive: true } });
  }

  getBuiltInTemplateInfo(templateType: string) {
    return this.builtInTemplates[templateType];
  }

  getAllBuiltInTemplates() {
    return Object.entries(this.builtInTemplates).map(([type, template]) => ({
      type,
      name: template.name,
      description: template.description,
      fields: template.fields,
    }));
  }
}
