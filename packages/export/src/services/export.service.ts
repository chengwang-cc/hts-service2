import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExportJobEntity } from '../entities';
import { ExportRequestDto, ExportResponseDto, ExportJobStatusDto } from '../dto';
import { CsvExportService } from './csv-export.service';
import { ExcelExportService } from './excel-export.service';

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(ExportJobEntity)
    private readonly exportJobRepo: Repository<ExportJobEntity>,
    private readonly csvExportService: CsvExportService,
    private readonly excelExportService: ExcelExportService,
  ) {}

  /**
   * Create export job
   */
  async createExportJob(
    organizationId: string,
    userId: string,
    request: ExportRequestDto,
  ): Promise<ExportResponseDto> {
    const job = this.exportJobRepo.create({
      organizationId,
      createdBy: userId,
      template: request.template,
      format: request.format,
      filters: request.filters || null,
      status: 'pending',
      metadata: {
        includeMetadata: request.includeMetadata,
        includeHistory: request.includeHistory,
        includeAuditTrail: request.includeAuditTrail,
        columns: request.columns,
        customTemplateId: request.customTemplateId,
      },
    });

    const savedJob = await this.exportJobRepo.save(job);

    // TODO: Queue job for background processing
    // await this.queueService.send('export-generation', { jobId: savedJob.id });

    return {
      jobId: savedJob.id,
      status: 'pending',
      message: 'Export job created successfully. Processing will begin shortly.',
      estimatedCompletionTime: this.estimateCompletionTime(request),
    };
  }

  /**
   * Get export job status
   */
  async getJobStatus(jobId: string): Promise<ExportJobStatusDto> {
    const job = await this.exportJobRepo.findOne({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Export job not found');
    }

    return {
      id: job.id,
      status: job.status,
      progress: {
        total: job.recordCount,
        processed: job.processedRecords,
        failed: job.failedRecords,
        percentage: job.recordCount > 0
          ? Math.round((job.processedRecords / job.recordCount) * 100)
          : 0,
      },
      fileUrl: job.fileUrl || undefined,
      fileSize: job.fileSize ? Number(job.fileSize) : undefined,
      error: job.error || undefined,
      createdAt: job.createdAt,
      completedAt: job.completedAt || undefined,
      expiresAt: job.expiresAt || undefined,
    };
  }

  /**
   * List export jobs for organization
   */
  async listExportJobs(
    organizationId: string,
    options?: {
      limit?: number;
      offset?: number;
      status?: string;
    },
  ): Promise<ExportJobEntity[]> {
    const query = this.exportJobRepo
      .createQueryBuilder('job')
      .where('job.organizationId = :organizationId', { organizationId })
      .orderBy('job.createdAt', 'DESC')
      .take(options?.limit || 50)
      .skip(options?.offset || 0);

    if (options?.status) {
      query.andWhere('job.status = :status', { status: options.status });
    }

    return query.getMany();
  }

  /**
   * Update export job status
   */
  async updateJobStatus(
    jobId: string,
    update: {
      status?: 'processing' | 'completed' | 'failed';
      fileUrl?: string;
      fileSize?: number;
      recordCount?: number;
      processedRecords?: number;
      failedRecords?: number;
      error?: string;
      completedAt?: Date;
    },
  ): Promise<ExportJobEntity> {
    const job = await this.exportJobRepo.findOne({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Export job not found');
    }

    Object.assign(job, update);

    if (update.status === 'completed' && !job.completedAt) {
      job.completedAt = new Date();
      job.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    }

    return this.exportJobRepo.save(job);
  }

  /**
   * Delete expired export jobs
   */
  async deleteExpiredJobs(): Promise<number> {
    const result = await this.exportJobRepo
      .createQueryBuilder()
      .delete()
      .where('expiresAt < :now', { now: new Date() })
      .execute();

    return result.affected || 0;
  }

  /**
   * Generate export synchronously (for small datasets)
   */
  async generateExport(
    template: string,
    format: 'csv' | 'excel',
    data: any[],
  ): Promise<Buffer> {
    if (format === 'csv') {
      return this.generateCsvExport(template, data);
    } else if (format === 'excel') {
      return this.generateExcelExport(template, data);
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  /**
   * Generate CSV export by template
   */
  private generateCsvExport(template: string, data: any[]): Buffer {
    switch (template) {
      case 'shopify':
        return this.csvExportService.generateShopifyExport(data);
      case 'broker':
      case 'customs':
        return this.csvExportService.generateBrokerExport(data);
      case 'audit-pack':
        return this.csvExportService.generateAuditPack(data[0]);
      default:
        return this.csvExportService.generate(data);
    }
  }

  /**
   * Generate Excel export by template
   */
  private async generateExcelExport(template: string, data: any[]): Promise<Buffer> {
    switch (template) {
      case 'audit-pack':
        return this.excelExportService.generateAuditPackExcel({
          classification: data[0],
          history: data[0].history || [],
          calculations: data[0].calculations || [],
        });
      default:
        return this.excelExportService.generate(data, {
          sheetName: template.charAt(0).toUpperCase() + template.slice(1),
          title: `${template} Export`,
        });
    }
  }

  /**
   * Estimate completion time based on request
   */
  private estimateCompletionTime(request: ExportRequestDto): number {
    // Estimate based on template complexity
    const baseTime = 5000; // 5 seconds base
    const formatMultiplier = request.format === 'pdf' ? 3 : 1;
    const metadataMultiplier = request.includeMetadata ? 1.5 : 1;

    return Math.round(baseTime * formatMultiplier * metadataMultiplier);
  }
}
