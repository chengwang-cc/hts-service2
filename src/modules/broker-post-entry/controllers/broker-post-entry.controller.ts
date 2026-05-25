import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  CreateCaseDto,
  SearchPriorDecisionsDto,
  UpdateCaseDto,
} from '../dto/broker-post-entry.dto';
import { BrokerPostEntryService } from '../services/broker-post-entry.service';

@Controller('broker/post-entry')
export class BrokerPostEntryController {
  constructor(private readonly postEntry: BrokerPostEntryService) {}

  @Post('cases')
  async create(@Req() req: Request, @Body() dto: CreateCaseDto) {
    return {
      success: true,
      data: await this.postEntry.createCase(resolveRequestContext(req), dto),
    };
  }

  @Get('cases')
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('entryId') entryId?: string,
  ) {
    return {
      success: true,
      data: await this.postEntry.listCases(resolveRequestContext(req), {
        status,
        entryId,
      }),
    };
  }

  @Patch('cases/:id')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCaseDto,
  ) {
    return {
      success: true,
      data: await this.postEntry.updateCase(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Post('entries/:entryId/audit-pack')
  async generatePack(
    @Req() req: Request,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return {
      success: true,
      data: await this.postEntry.generateAuditPack(
        resolveRequestContext(req),
        entryId,
      ),
    };
  }

  @Get('entries/:entryId/audit-packs')
  async listPacks(
    @Req() req: Request,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return {
      success: true,
      data: await this.postEntry.listAuditPacksForEntry(
        resolveRequestContext(req),
        entryId,
      ),
    };
  }

  @Get('audit-packs/:id')
  async getPack(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.postEntry.getAuditPack(resolveRequestContext(req), id),
    };
  }

  /**
   * R2-E-01 — render an existing JSON audit pack into a portable HTML
   * snapshot. Returns the new pack row (format='html').
   */
  @Post('audit-packs/:id/render-html')
  async renderHtml(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.postEntry.renderAuditPackHtml(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  /**
   * R2-E-02 — short-lived download URL for the underlying storage object.
   */
  @Get('audit-packs/:id/download-url')
  async downloadUrl(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.postEntry.getAuditPackDownloadUrl(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Get('prior-decisions')
  async searchPrior(
    @Req() req: Request,
    @Query() query: SearchPriorDecisionsDto,
  ) {
    return {
      success: true,
      data: await this.postEntry.searchPriorDecisions(
        resolveRequestContext(req),
        query,
      ),
    };
  }
}
