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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrgPermissions } from '../../auth/decorators/org-permissions.decorator';
import { OrgPermissionsGuard } from '../../auth/guards/org-permissions.guard';
import { resolveRequestContext } from '../../auth/interfaces/request-context.interface';
import {
  CreateAdapterDto,
  CreateExportJobDto,
  ImportStatusMessageDto,
  UpdateAdapterDto,
} from '../dto/broker-adapters.dto';
import { BrokerAdaptersService } from '../services/broker-adapters.service';

@Controller('broker')
@UseGuards(OrgPermissionsGuard)
export class BrokerAdaptersController {
  constructor(private readonly adapters: BrokerAdaptersService) {}

  @Get('adapters')
  @OrgPermissions('broker:adapters:view', 'broker:adapters:write')
  async list(@Req() req: Request) {
    return {
      success: true,
      data: await this.adapters.listAdapters(resolveRequestContext(req)),
    };
  }

  @Post('adapters')
  @OrgPermissions('broker:adapters:write')
  async create(@Req() req: Request, @Body() dto: CreateAdapterDto) {
    return {
      success: true,
      data: await this.adapters.createAdapter(resolveRequestContext(req), dto),
    };
  }

  @Patch('adapters/:id')
  @OrgPermissions('broker:adapters:write')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdapterDto,
  ) {
    return {
      success: true,
      data: await this.adapters.updateAdapter(
        resolveRequestContext(req),
        id,
        dto,
      ),
    };
  }

  @Post('adapters/:id/test')
  @OrgPermissions('broker:adapters:write')
  async test(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return {
      success: true,
      data: await this.adapters.testAdapter(resolveRequestContext(req), id),
    };
  }

  @Post('entries/:id/export')
  @OrgPermissions('broker:entries:write', 'broker:adapters:write')
  async export(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { adapterId: string },
  ) {
    const dto: CreateExportJobDto = { entryId: id, adapterId: body.adapterId };
    return {
      success: true,
      data: await this.adapters.createExportJob(
        resolveRequestContext(req),
        dto,
      ),
    };
  }

  @Get('export-jobs')
  @OrgPermissions(
    'broker:entries:view',
    'broker:adapters:view',
    'broker:adapters:write',
  )
  async listJobs(@Req() req: Request, @Query('entryId') entryId?: string) {
    return {
      success: true,
      data: await this.adapters.listJobs(resolveRequestContext(req), entryId),
    };
  }

  @Get('export-jobs/:id/artifact')
  @OrgPermissions(
    'broker:entries:view',
    'broker:adapters:view',
    'broker:adapters:write',
  )
  async exportArtifact(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.adapters.getExportArtifact(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Post('entries/:id/status-import')
  @OrgPermissions('broker:adapters:write', 'broker:entries:write')
  async importStatus(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Omit<ImportStatusMessageDto, 'entryId'>,
  ) {
    const dto: ImportStatusMessageDto = { ...body, entryId: id };
    return {
      success: true,
      data: await this.adapters.importStatusMessage(
        resolveRequestContext(req),
        dto,
      ),
    };
  }

  @Get('entries/:id/status-messages')
  @OrgPermissions('broker:entries:view', 'broker:entries:write')
  async listStatus(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      success: true,
      data: await this.adapters.listStatusMessages(
        resolveRequestContext(req),
        id,
      ),
    };
  }

  @Get('adapters/catair-feasibility')
  @OrgPermissions('broker:adapters:view', 'broker:adapters:write')
  async catairFeasibility() {
    return {
      success: true,
      data: this.adapters.catairFeasibilityReport(),
    };
  }
}
