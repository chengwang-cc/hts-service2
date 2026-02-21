import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ExportService,
  ExportRequestDto,
  DataCompletenessService,
  CompletenessCheckRequestDto,
  TemplateRegistryService,
  CreateTemplateDto,
  UpdateTemplateDto,
} from '@hts/export';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('exports')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly completenessService: DataCompletenessService,
    private readonly templateService: TemplateRegistryService,
  ) {}

  /**
   * Create new export job
   */
  @Post()
  async createExport(
    @CurrentUser() user: any,
    @Body() request: ExportRequestDto,
  ) {
    return this.exportService.createExportJob(
      user.organizationId,
      user.id,
      request,
    );
  }

  /**
   * Get export job status
   */
  @Get(':jobId')
  async getExportStatus(@Param('jobId') jobId: string) {
    return this.exportService.getJobStatus(jobId);
  }

  /**
   * List export jobs
   */
  @Get()
  async listExports(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
  ) {
    return this.exportService.listExportJobs(user.organizationId, {
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      status,
    });
  }

  /**
   * Download export file
   */
  @Get(':jobId/download')
  async downloadExport(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = await this.exportService.getJobStatus(jobId);

    if (job.status !== 'completed' || !job.fileUrl) {
      throw new HttpException(
        'Export not ready or file not available',
        HttpStatus.NOT_FOUND,
      );
    }

    // In production, this would redirect to S3 signed URL
    // For now, return the file URL
    res.redirect(job.fileUrl);
  }

  /**
   * Check data completeness
   */
  @Post('completeness/check')
  async checkCompleteness(
    @CurrentUser() user: any,
    @Body() request: CompletenessCheckRequestDto,
  ) {
    // This would need to fetch actual resources
    // For now, return error indicating implementation needed
    throw new HttpException(
      'Completeness check requires integration with resource services',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * List export templates
   */
  @Get('templates/list')
  async listTemplates(
    @CurrentUser() user: any,
    @Query('includeSystem') includeSystem?: string,
  ) {
    return this.templateService.listTemplates(
      user.organizationId,
      includeSystem !== 'false',
    );
  }

  /**
   * Get template by ID
   */
  @Get('templates/:templateId')
  async getTemplate(@Param('templateId') templateId: string) {
    const template = await this.templateService.getTemplate(templateId);

    if (!template) {
      throw new HttpException('Template not found', HttpStatus.NOT_FOUND);
    }

    return template;
  }

  /**
   * Create custom template
   */
  @Post('templates')
  async createTemplate(
    @CurrentUser() user: any,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templateService.createTemplate(user.organizationId, dto);
  }

  /**
   * Update template
   */
  @Post('templates/:templateId')
  async updateTemplate(
    @CurrentUser() user: any,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templateService.updateTemplate(
      templateId,
      user.organizationId,
      dto,
    );
  }

  /**
   * Delete template
   */
  @Post('templates/:templateId/delete')
  async deleteTemplate(
    @CurrentUser() user: any,
    @Param('templateId') templateId: string,
  ) {
    await this.templateService.deleteTemplate(templateId, user.organizationId);
    return { success: true };
  }
}
