import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Res,
  Headers,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { parse as csvParse } from 'csv-parse/sync';
import { BatchJobService } from './services/batch-job.service';
import { CreateBatchJobDto } from './dto';
import { Public } from '../lookup/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('batch')
export class BatchController {
  constructor(private readonly batchJobService: BatchJobService) {}

  // ── Create job via JSON ───────────────────────────────────────────────────

  @Public()
  @Post('jobs')
  async createJob(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Body() dto: CreateBatchJobDto,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);

    if (!dto.items?.length) {
      throw new BadRequestException('items array must not be empty');
    }

    const { job } = await this.batchJobService.createJob(
      owner,
      dto.method,
      dto.items,
      'api',
      undefined,
      dto.metadata,
    );

    const response: Record<string, unknown> = {
      success: true,
      data: job,
    };
    if (owner.isGuest) {
      response.guestToken = owner.guestToken;
    }
    return response;
  }

  // ── Create job via CSV upload ─────────────────────────────────────────────

  @Public()
  @Post('jobs/csv')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.csv$/i) && file.mimetype !== 'text/csv') {
          return cb(new BadRequestException('Only CSV files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async createJobFromCsv(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Query('method') method: 'autocomplete' | 'deep_search' = 'autocomplete',
  ) {
    if (!file) {
      throw new BadRequestException('CSV file is required (field name: "file")');
    }
    if (method !== 'autocomplete' && method !== 'deep_search') {
      throw new BadRequestException('method must be "autocomplete" or "deep_search"');
    }

    let records: Record<string, string>[];
    try {
      records = csvParse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
    } catch {
      throw new BadRequestException('Invalid CSV file');
    }

    if (!records.length) {
      throw new BadRequestException('CSV file is empty');
    }

    const items = records.map((row, i) => {
      const query = row['query'] || row['Query'] || row['QUERY'] || '';
      if (!query.trim()) {
        throw new BadRequestException(`Row ${i + 1}: "query" column is required`);
      }
      return {
        query: query.trim(),
        referenceId: row['reference_id'] || row['referenceId'] || row['id'] || undefined,
      };
    });

    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const { job } = await this.batchJobService.createJob(
      owner,
      method,
      items,
      'csv',
      file.originalname,
    );

    const response: Record<string, unknown> = {
      success: true,
      data: job,
    };
    if (owner.isGuest) {
      response.guestToken = owner.guestToken;
    }
    return response;
  }

  // ── List jobs ─────────────────────────────────────────────────────────────

  @Public()
  @Get('jobs')
  async listJobs(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const jobs = await this.batchJobService.listJobs(
      owner.ownerKey,
      status,
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, data: jobs };
  }

  // ── Get job status ────────────────────────────────────────────────────────

  @Public()
  @Get('jobs/:jobId')
  async getJob(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const job = await this.batchJobService.getJob(jobId, owner.ownerKey);
    return { success: true, data: job };
  }

  // ── Get job items (paginated) ─────────────────────────────────────────────

  @Public()
  @Get('jobs/:jobId/items')
  async getJobItems(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('jobId') jobId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const result = await this.batchJobService.getJobItems(
      jobId,
      owner.ownerKey,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 100,
    );
    return { success: true, ...result };
  }

  // ── Download results as CSV ───────────────────────────────────────────────

  @Public()
  @Get('jobs/:jobId/csv')
  async downloadCsv(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const csv = await this.batchJobService.getJobCsv(jobId, owner.ownerKey);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="batch-${jobId}.csv"`);
    res.send(csv);
  }

  // ── Cancel job ────────────────────────────────────────────────────────────

  @Public()
  @Delete('jobs/:jobId')
  async cancelJob(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const job = await this.batchJobService.cancelJob(jobId, owner.ownerKey);
    return { success: true, data: job };
  }

  // ── Pause job ─────────────────────────────────────────────────────────────

  @Public()
  @Patch('jobs/:jobId/pause')
  async pauseJob(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const job = await this.batchJobService.pauseJob(jobId, owner.ownerKey);
    return { success: true, data: job };
  }

  // ── Resume job ────────────────────────────────────────────────────────────

  @Public()
  @Patch('jobs/:jobId/resume')
  async resumeJob(
    @CurrentUser() user: any,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    const owner = this.batchJobService.resolveOwner(user, guestToken);
    const job = await this.batchJobService.resumeJob(jobId, owner.ownerKey);
    return { success: true, data: job };
  }
}
