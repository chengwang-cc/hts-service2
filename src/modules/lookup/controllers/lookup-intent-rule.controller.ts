import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntentRuleAdminService } from '../services/intent-rule-admin.service';
import { IntentRule } from '../services/intent-rules';
import { Public } from '../../auth/decorators/public.decorator';

interface UpsertRuleDto extends IntentRule {
  priority?: number;
}

interface AddSampleDto {
  htsNumber: string;
  query: string;
}

interface UpdateSampleDto {
  htsNumber?: string;
  query?: string;
}

@Controller('lookup/intent-rules')
export class LookupIntentRuleController {
  private readonly logger = new Logger(LookupIntentRuleController.name);

  constructor(private readonly adminService: IntentRuleAdminService) {}

  @Get()
  async listRules(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('search') search?: string,
    @Query('enabled') enabled?: string,
  ) {
    const enabledBool = enabled === undefined ? undefined : enabled === 'true';
    return this.adminService.listRules(
      parseInt(page, 10),
      parseInt(pageSize, 10),
      search,
      enabledBool,
    );
  }

  @Get(':ruleId')
  async getRule(@Param('ruleId') ruleId: string) {
    return this.adminService.getRule(ruleId);
  }

  @Post()
  async upsertRule(@Body() body: UpsertRuleDto) {
    const { priority, ...rule } = body;
    await this.adminService.upsertRule(rule, priority ?? 0);
    return this.adminService.getRule(rule.id);
  }

  @Patch(':ruleId')
  async updateRule(
    @Param('ruleId') ruleId: string,
    @Body() body: Partial<IntentRule> & { priority?: number },
  ) {
    await this.adminService.updateRule(ruleId, body);
    return this.adminService.getRule(ruleId);
  }

  @Patch(':ruleId/toggle')
  async toggleRule(@Param('ruleId') ruleId: string) {
    return this.adminService.toggleRule(ruleId);
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRule(@Param('ruleId') ruleId: string) {
    await this.adminService.removeRule(ruleId);
  }
}

@Controller('lookup/test-samples')
export class LookupTestSampleController {
  private readonly logger = new Logger(LookupTestSampleController.name);

  constructor(private readonly adminService: IntentRuleAdminService) {}

  @Get()
  async listSamples(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('htsNumber') htsNumber?: string,
  ) {
    return this.adminService.listSamples(
      parseInt(page, 10),
      parseInt(pageSize, 10),
      htsNumber,
    );
  }

  @Post()
  async addSample(@Body() body: AddSampleDto) {
    return this.adminService.addSample(body.htsNumber, body.query);
  }

  @Patch(':id')
  async updateSample(@Param('id') id: string, @Body() body: UpdateSampleDto) {
    return this.adminService.updateSample(id, body.htsNumber, body.query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSample(@Param('id') id: string) {
    await this.adminService.deleteSample(id);
  }

  /**
   * Upload a CSV and start an AI-powered async import.
   * Returns immediately with a jobId — poll GET /import-status/:jobId for progress.
   *
   * Handles real-world messy CSVs:
   *  - columns: hts_code/custom_description OR hts_number/query (auto-detected)
   *  - HTS codes with or without dots (e.g. 0901.21.00.20 → 0901210020)
   *  - HTML content in descriptions (stripped automatically)
   *  - Near-duplicate descriptions (AI-deduplicated)
   */
  @Public()
  @Post('import-csv')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.csv$/i) && file.mimetype !== 'text/csv') {
          return cb(new BadRequestException('Only CSV files are accepted'), false);
        }
        cb(null, true);
      },
    }),
  )
  async importCsv(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('CSV file is required (field name: "file")');
    }
    const result = await this.adminService.startCsvImport(file.buffer);
    return { success: true, ...result };
  }

  /** Poll the status of an async CSV import job. */
  @Public()
  @Get('import-status/:jobId')
  getImportStatus(@Param('jobId') jobId: string) {
    const status = this.adminService.getImportStatus(jobId);
    if (!status) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }
    return status;
  }
}
