import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../../api-keys/guards/api-key.guard';
import { ApiPermissions } from '../../api-keys/decorators/api-permissions.decorator';
import { SkipJwtAuth } from '../../api-keys/decorators/skip-jwt-auth.decorator';
import {
  BulkClassifyRequestDto,
  ClassifyRequestDto,
} from '../dto/classify.dto';
import { ClassifyService } from '../services/classify.service';
import { QueueService } from '../../queue/queue.service';

interface CallerContext {
  organizationId: string;
}

function requireCallerContext(req: any): CallerContext {
  const userOrg = req?.user?.organizationId;
  if (userOrg) return { organizationId: userOrg };
  const apiOrg = req?.organizationId;
  if (apiOrg) return { organizationId: apiOrg };
  throw new ForbiddenException('Authenticated organization is required');
}

@Controller('classify')
export class ClassificationController {
  constructor(
    private readonly classifyService: ClassifyService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * POST /classify (JWT) — single classify; replaces lookup `POST /lookup/classify`
   * (which is 410 Gone).
   */
  @Post()
  async classify(@Body() dto: ClassifyRequestDto, @Req() req: any) {
    const ctx = requireCallerContext(req);
    return this.classifyService.classify(ctx.organizationId, dto);
  }

  /**
   * POST /classify.api (API key) — same as above for machine clients.
   */
  @SkipJwtAuth()
  @UseGuards(ApiKeyGuard)
  @ApiPermissions('classify:write')
  @Post('.api')
  async classifyApi(@Body() dto: ClassifyRequestDto, @Req() req: any) {
    const organizationId = req.organizationId as string;
    if (!organizationId) {
      throw new ForbiddenException('Missing organization on API key');
    }
    return this.classifyService.classify(organizationId, dto);
  }

  /**
   * POST /classify/bulk — enqueue a classify-bulk pg-boss job. Returns
   * the job id immediately. Status/results are pulled from
   * GET /classify/jobs/:id.
   */
  @Post('bulk')
  async bulk(@Body() dto: BulkClassifyRequestDto, @Req() req: any) {
    const ctx = requireCallerContext(req);
    if (!dto.inputCsvUrl) {
      throw new BadRequestException('inputCsvUrl is required');
    }
    const jobId = await this.queueService.sendJob('classify-bulk', {
      organizationId: ctx.organizationId,
      inputCsvUrl: dto.inputCsvUrl,
      destinationCountry: dto.destinationCountry || 'US',
      callbackUrl: dto.callbackUrl,
      triggeredBy: 'http:POST /classify/bulk',
    });
    return { jobId, status: 'queued' };
  }

  @Get('jobs/:id')
  async getJob(@Param('id') id: string) {
    const status = await this.queueService.getJobStatus('classify-bulk', id);
    return { jobId: id, status };
  }
}
