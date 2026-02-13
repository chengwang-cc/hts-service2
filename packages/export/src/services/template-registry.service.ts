import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExportTemplateEntity } from '../entities';
import { CreateTemplateDto, UpdateTemplateDto, TemplateResponseDto } from '../dto';

@Injectable()
export class TemplateRegistryService {
  constructor(
    @InjectRepository(ExportTemplateEntity)
    private readonly templateRepo: Repository<ExportTemplateEntity>,
  ) {}

  /**
   * Initialize system templates
   */
  async initializeSystemTemplates(): Promise<void> {
    const systemTemplates = this.getSystemTemplateDefinitions();

    for (const template of systemTemplates) {
      const existing = await this.templateRepo.findOne({
        where: {
          name: template.name,
          isSystem: true,
        },
      });

      if (!existing) {
        await this.templateRepo.save(template);
      }
    }
  }

  /**
   * Get system template definitions
   */
  private getSystemTemplateDefinitions(): Partial<ExportTemplateEntity>[] {
    return [
      {
        organizationId: null,
        name: 'Shopify Product Export',
        description: 'Standard Shopify product export format with HS codes',
        templateType: 'shopify',
        isSystem: true,
        isActive: true,
        fieldMapping: {
          'Product Title': { sourceField: 'productDescription', required: true },
          'HS Code': { sourceField: 'confirmedHtsCode', required: true },
          'Country of Origin': { sourceField: 'originCountry', required: true },
          'Harmonized Code': {
            sourceField: 'confirmedHtsCode',
            transform: 'removeDotsFromHtsCode',
            required: true,
          },
          'Variant SKU': { sourceField: 'sku', required: false },
        },
        formatOptions: {
          delimiter: ',',
          quoteChar: '"',
          encoding: 'utf-8',
          includeHeader: true,
        },
      },
      {
        organizationId: null,
        name: 'Customs Broker Export',
        description: 'ACE PGA compatible format for customs brokers',
        templateType: 'broker',
        isSystem: true,
        isActive: true,
        fieldMapping: {
          'HTS Number': { sourceField: 'htsCode', required: true },
          'Description': { sourceField: 'productDescription', required: true },
          'Quantity': { sourceField: 'quantity', required: true },
          'Value': { sourceField: 'declaredValue', required: true },
          'Country of Origin': { sourceField: 'originCountry', required: true },
          'Duty Rate': { sourceField: 'results.effectiveRate', required: true },
          'Duty Amount': { sourceField: 'results.totalDuty', required: true },
        },
        formatOptions: {
          delimiter: ',',
          quoteChar: '"',
          encoding: 'utf-8',
          includeHeader: true,
        },
      },
      {
        organizationId: null,
        name: 'Classification Audit Pack',
        description: 'Complete audit trail for HTS classifications',
        templateType: 'audit-pack',
        isSystem: true,
        isActive: true,
        fieldMapping: {
          'Classification Date': { sourceField: 'confirmedAt', required: true },
          'Product Description': { sourceField: 'productDescription', required: true },
          'Suggested HTS': { sourceField: 'suggestedHtsCode', required: false },
          'Confirmed HTS': { sourceField: 'confirmedHtsCode', required: true },
          'Confidence Score': { sourceField: 'confidenceScore', required: false },
          'Confirmed By': { sourceField: 'confirmedBy.email', required: true },
          'AI Reasoning': { sourceField: 'aiReasoning', required: false },
          'Tariff Version': { sourceField: 'tariffVersion', required: true },
        },
        formatOptions: {
          delimiter: ',',
          quoteChar: '"',
          encoding: 'utf-8',
          includeHeader: true,
        },
      },
    ];
  }

  /**
   * Create custom template
   */
  async createTemplate(
    organizationId: string,
    dto: CreateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const template = this.templateRepo.create({
      organizationId,
      name: dto.name,
      description: dto.description || null,
      templateType: dto.templateType,
      fieldMapping: dto.fieldMapping,
      formatOptions: dto.formatOptions || null,
      isSystem: false,
      isActive: true,
    });

    const saved = await this.templateRepo.save(template);
    return this.toResponseDto(saved);
  }

  /**
   * Get template by ID
   */
  async getTemplate(templateId: string): Promise<ExportTemplateEntity | null> {
    return this.templateRepo.findOne({
      where: { id: templateId },
    });
  }

  /**
   * List templates for organization
   */
  async listTemplates(
    organizationId: string,
    includeSystem = true,
  ): Promise<TemplateResponseDto[]> {
    const query = this.templateRepo
      .createQueryBuilder('template')
      .where('template.isActive = :isActive', { isActive: true })
      .andWhere(
        '(template.organizationId = :organizationId OR template.isSystem = :includeSystem)',
        { organizationId, includeSystem },
      )
      .orderBy('template.isSystem', 'DESC')
      .addOrderBy('template.name', 'ASC');

    const templates = await query.getMany();
    return templates.map(t => this.toResponseDto(t));
  }

  /**
   * Update template
   */
  async updateTemplate(
    templateId: string,
    organizationId: string,
    dto: UpdateTemplateDto,
  ): Promise<TemplateResponseDto> {
    const template = await this.templateRepo.findOne({
      where: { id: templateId, organizationId },
    });

    if (!template) {
      throw new Error('Template not found or access denied');
    }

    if (template.isSystem) {
      throw new Error('Cannot modify system templates');
    }

    Object.assign(template, {
      name: dto.name ?? template.name,
      description: dto.description ?? template.description,
      fieldMapping: dto.fieldMapping ?? template.fieldMapping,
      formatOptions: dto.formatOptions ?? template.formatOptions,
      isActive: dto.isActive ?? template.isActive,
    });

    const saved = await this.templateRepo.save(template);
    return this.toResponseDto(saved);
  }

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string, organizationId: string): Promise<void> {
    const template = await this.templateRepo.findOne({
      where: { id: templateId, organizationId },
    });

    if (!template) {
      throw new Error('Template not found or access denied');
    }

    if (template.isSystem) {
      throw new Error('Cannot delete system templates');
    }

    await this.templateRepo.remove(template);
  }

  /**
   * Convert entity to response DTO
   */
  private toResponseDto(entity: ExportTemplateEntity): TemplateResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description || undefined,
      templateType: entity.templateType,
      fieldMapping: entity.fieldMapping,
      formatOptions: entity.formatOptions || undefined,
      isSystem: entity.isSystem,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
